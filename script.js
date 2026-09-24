const state={chars:[],questions:[],templates:{},genre:"all",answers:[],asked:new Set(),history:[],scores:{},screen:"genre",current:null};

const ANSWERS=[
  ["yes","はい"],["mostlyYes","どちらかというとはい"],["neutral","どちらともいえない"],["mostlyNo","どちらかというといいえ"],["no","いいえ"]
];
const CAT_WEIGHT={appearance:.40,alignment:.25,personality:.20,relationships:.10,likes:.05};
const VALUE={yes:2,mostlyYes:1,neutral:0,mostlyNo:-1,no:-2};
const appearanceFields=["species","body","face","hair","eyes","clothing","color","other"];
const personalityAxes=["EI","NS","TF","PJ","AT"];

async function init(){
  try{
    const [c,q]=await Promise.all([fetch("data/characters.json"),fetch("data/questions.json")]);
    const cd=await c.json(), qd=await q.json();
    state.chars=cd.characters; state.questions=qd.questions; state.templates=qd.templates;
    render();
  }catch(e){document.getElementById("app").innerHTML=`<div class="app-shell"><div class="screen"><div class="error"><h2>データを読み込めませんでした</h2><p>${e.message}</p><p>GitHub Pages等のHTTP環境で開いてください。</p></div></div></div>`}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function imgFor(c,type){return c.images?.[type]||""}
function eligible(c){
  if(state.genre==="all") return true;
  if(state.genre==="humanoid") return c.appearance.species.includes("human")||c.appearance.species.includes("humanoid");
  if(state.genre==="stick") return c.appearance.species.includes("stick");
  return !(c.appearance.species.includes("human")||c.appearance.species.includes("humanoid")||c.appearance.species.includes("stick"));
}
function getTagValue(c,tag){
  if(tag==="__alignment_good") return c.alignment;
  if(tag==="__alignment_evil") return -c.alignment;
  if(tag==="__EI_positive") return c.personality.EI;
  if(tag==="__EI_negative") return -c.personality.EI;
  for(const f of appearanceFields) if(c.appearance[f]?.includes(tag)) return 5;
  if(c.personality.tags?.includes(tag)) return 5;
  if(c.relationships?.includes(tag)) return 5;
  if(c.likesTags?.includes(tag)) return 5;
  return null;
}
function getInitialTargetScore(key){
  return state.scores[key]??0;
}
function setScore(key,delta){
  state.scores[key]=Math.max(-5,Math.min(5,getInitialTargetScore(key)+delta));
}
function applyEffects(q,ans){
  const effects=q.effects?.[ans]||{};
  const base=VALUE[ans];
  const targets=q.targetTags||[];
  if(Object.keys(effects).length){
    for(const [k,v] of Object.entries(effects)) setScore(k, v===null?base:v);
  }else{
    for(const tag of targets) setScore(tag,base);
  }
  // Default score effects for tags can be overridden explicitly.
}
function templateText(q){
  if(q.text) return q.text;
  let t=state.templates[String(q.template)]||"";
  const replacements={word:q.word,word1:q.word1,word2:q.word2,name:q.name};
  return t.replace(/\{(word|word1|word2|name)\}/g,(_,k)=>replacements[k]??"");
}
function candidates(){return state.chars.filter(eligible)}
function tagPreferenceScore(tag){
  return state.scores[tag]??0;
}
function categoryScore(c,cat){
  if(cat==="alignment"){
    return similarity(c.alignment,state.scores.alignment??0);
  }
  if(cat==="personality"){
    const vals=personalityAxes.map(a=>similarity(c.personality[a],state.scores[a]??0));
    const tags=c.personality.tags||[];
    const tagVals=tags.length?tags.map(t=>tagSimilarity(t)):vals;
    const tagPart=tags.length?avg(tagVals):null;
    const axisPart=avg(vals);
    return tagPart===null?axisPart:axisPart*.7+tagPart*.3;
  }
  if(cat==="relationships") return tagCategoryScore(c.relationships||[]);
  if(cat==="likes") return tagCategoryScore(c.likesTags||[]);
  return appearanceCategoryScore(c);
}
function tagSimilarity(tag){
  const pref=state.scores[tag]??0;
  return similarity(5,pref);
}
function tagCategoryScore(tags){
  if(!tags.length)return 50;
  return avg(tags.map(t=>tagSimilarity(t)));
}
function appearanceCategoryScore(c){
  const vals=[];
  for(const f of appearanceFields){
    const tags=c.appearance[f]||[];
    if(!tags.length) continue;
    vals.push(avg(tags.map(t=>tagSimilarity(t))));
  }
  return vals.length?avg(vals):50;
}
function similarity(charVal,userVal){
  const d=Math.abs(charVal-userVal);
  return (1-d/10)*100;
}
function totalScore(c){
  let total=0;
  for(const [cat,w] of Object.entries(CAT_WEIGHT)) total+=categoryScore(c,cat)*w;
  return total;
}
function ranked(){
  return candidates().map(c=>({...c,score:totalScore(c)})).sort((a,b)=>b.score-a.score);
}
function questionTags(q){return q.targetTags||[]}
function recentTagPenalty(q){
  const tags=new Set(questionTags(q));
  const recent=state.history.slice(-5);
  let p=1;
  if(recent.some(x=>x.id===q.id)) return 0;
  for(const h of recent){
    if(questionTags(h).some(t=>tags.has(t))) p*=h===state.history.at(-1)?0.05:0.1;
  }
  return p;
}
function categoryPenalty(q){
  const recent=state.history.slice(-5).map(x=>x.category);
  if(recent[recent.length-1]===q.category)return .25;
  if(recent.includes(q.category))return .5;
  return 1;
}
function discriminatingBoost(q){
  const r=ranked().slice(0,5);
  if(r.length<2)return 1;
  const tags=q.targetTags||[];
  if(!tags.length)return 1;
  let values=r.map(c=>tags.map(t=>getTagValue(c,t)).reduce((a,v)=>a+(v??0),0));
  const mean=avg(values), spread=avg(values.map(v=>Math.abs(v-mean)));
  return 1+Math.min(spread/5,1.5);
}
function pickQuestion(){
  let pool=state.questions.filter(q=>!state.asked.has(q.id));
  if(!pool.length){state.asked.clear(); pool=state.questions.slice();}
  const weighted=pool.map(q=>({...q,w:recentTagPenalty(q)*categoryPenalty(q)*discriminatingBoost(q)}));
  const total=weighted.reduce((a,q)=>a+q.w,0);
  let x=Math.random()*total;
  for(const q of weighted){x-=q.w;if(x<=0)return q;}
  return weighted.at(-1);
}
function backgroundFor(q){
  const cond=q.background||null;
  let pool=candidates().filter(c=>{
    if(!cond) return (q.targetTags||[]).some(t=>getTagValue(c,t)!==null);
    const field=cond.category;
    if(field==="alignment")return true;
    const vals=c.appearance?.[field]||c.personality?.tags||c.relationships||c.likesTags||[];
    return (cond.tags||[]).some(t=>vals.includes(t));
  });
  if(!pool.length)return null;
  return pool[Math.floor(Math.random()*pool.length)];
}
function nextQuestion(){
  const q=pickQuestion(); state.current=q; state.asked.add(q.id);
  state.history.push(q);
  render();
}
function answer(ans){
  const q=state.current;
  state.answers.push({q:q.id,answer:ans});
  applyEffects(q,ans);
  nextQuestion();
}
function reset(){
  state.answers=[];state.asked=new Set();state.history=[];state.scores={};state.current=null;
}
function render(){
  const app=document.getElementById("app");
  app.innerHTML=`<div class="app-shell"><main class="screen">${screenHTML()}</main></div>`;
  bind();
}
function screenHTML(){
  if(state.screen==="genre")return `<div class="brand">オススメキャラ診断</div><section class="panel"><h1 class="title">ジャンルを選んでください</h1><p class="muted">まずは見た目のジャンルから選ぼう！あとから質問で好みを絞っていきます。</p><div class="genre-grid">${[
    ["all","すべて"],["humanoid","人型"],["stick","棒人間"],["other","その他"]
  ].map(([v,t])=>`<button class="choice" data-genre="${v}">${t}</button>`).join("")}</div></section>`;
  if(state.screen==="question")return questionHTML();
  if(state.screen==="result")return resultHTML();
  if(state.screen==="detail")return detailHTML();
  return "";
}
function questionHTML(){
  const q=state.current||pickQuestion(); if(!state.current)state.current=q;
  const bg=backgroundFor(q);
  return `<div class="brand">オススメキャラ診断</div><section class="panel">
    <div class="progress">質問 ${state.answers.length+1}　／　候補 ${candidates().length}人</div>
    <div class="question-wrap"><div class="ghost">${bg?`<img src="${esc(imgFor(bg,"bust"))}" alt="">`:""}</div>
    <div class="question-content"><p class="question">${esc(templateText(q))}</p>
    <div class="answers"><div class="answer-grid">${ANSWERS.map(([v,t])=>`<button class="choice" data-answer="${v}">${t}</button>`).join("")}</div></div></div></div>
    <div class="actions"><button class="secondary" id="show-log">現在の候補を見る</button></div>
  </section>`;
}
function resultHTML(){
  const r=ranked();const top=r[0];
  return `<div class="brand">診断結果</div><section class="panel">
    <div class="result-top"><div class="winner-art">${top&&imgFor(top,"fullbody")?`<img src="${esc(imgFor(top,"fullbody"))}" alt="">`:""}</div>
    <div class="result-info"><div class="muted">あなたにオススメのキャラ</div><h1 class="title">${esc(top?.name||"該当なし")}</h1><div class="muted">${esc(top?.reading||"")}</div><div class="percent">${top?Math.round(top.score):0}%</div><p>${esc(top?.profile?.description||"")}</p>
    <div class="actions">${top?`<button class="primary" id="detail">詳細を見る</button>`:""}<button class="secondary" id="continue">診断を続ける</button><button class="secondary" id="restart">もう一度診断する</button></div></div></div>
    <h2 class="title" style="margin-top:28px">その他のおすすめ</h2><div class="rank-list">${r.slice(1,6).map(c=>`<div class="rank"><img src="${esc(imgFor(c,"bust"))}" alt=""><div><strong>${esc(c.name)}</strong><div class="muted">${esc(c.reading)}</div></div><div class="p">${Math.round(c.score)}%</div></div>`).join("")}</div>
  </section>`;
}
function detailHTML(){
  const top=ranked()[0]; if(!top)return "";
  const chips=[...new Set([...(top.appearance.hair||[]),...(top.appearance.face||[]),...(top.appearance.eyes||[]),...(top.appearance.clothing||[]),...(top.appearance.color||[]),...(top.personality.tags||[])])];
  return `<div class="brand">キャラクター詳細</div><section class="panel"><div class="detail"><div class="detail-art">${imgFor(top,"fullbody")?`<img src="${esc(imgFor(top,"fullbody"))}" alt="">`:""}</div><div class="profile"><h1 class="title">${esc(top.name)}</h1><p class="muted">${esc(top.reading)}</p><dl><dt>性別</dt><dd>${esc(top.profile.gender)}</dd><dt>身長</dt><dd>${esc(top.profile.height)}</dd><dt>年齢</dt><dd>${esc(top.profile.age)}</dd><dt>好き</dt><dd>${esc(top.profile.likes.join("、"))}</dd><dt>苦手</dt><dd>${esc(top.profile.dislikes.join("、"))}</dd><dt>一人称</dt><dd>${esc(top.profile.firstPerson)}</dd><dt>二人称</dt><dd>${esc(top.profile.secondPerson.join("、"))}</dd></dl><h2 class="title" style="margin-top:24px">特徴</h2><div class="chips">${chips.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div><h2 class="title" style="margin-top:24px">プロフィール</h2><p>${esc(top.profile.description)}</p><div class="actions"><button class="secondary" id="back-result">結果に戻る</button><button class="secondary" id="restart">もう一度診断する</button></div></div></div></section>`;
}
function bind(){
  document.querySelectorAll("[data-genre]").forEach(b=>b.onclick=()=>{state.genre=b.dataset.genre;state.screen="question";reset();nextQuestion();});
  document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>answer(b.dataset.answer));
  const detail=document.getElementById("detail");if(detail)detail.onclick=()=>{state.screen="detail";render()};
  const cont=document.getElementById("continue");if(cont)cont.onclick=()=>{state.screen="question";nextQuestion()};
  document.querySelectorAll("#restart").forEach(b=>b.onclick=()=>{reset();state.screen="genre";render()});
  const back=document.getElementById("back-result");if(back)back.onclick=()=>{state.screen="result";render()};
  const log=document.getElementById("show-log");if(log)log.onclick=()=>{state.screen="result";render()};
}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
init();
