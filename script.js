const state={chars:[],questions:[],templates:{},genre:"all",answers:[],asked:new Set(),history:[],scores:{},screen:"genre",current:null,currentBg:null,questionCount:0,logs:[],blockLog:[],resultRanks:[],selectedCharacter:null};

const ANSWERS=[
  ["yes","はい"],["mostlyYes","どちらかというとはい"],["neutral","どちらともいえない"],["mostlyNo","どちらかというといいえ"],["no","いいえ"]
];
const ANSWER_LABELS=Object.fromEntries(ANSWERS);
const CAT_WEIGHT={appearance:.40,alignment:.25,personality:.20,relationships:.10,likes:.05};
const VALUE={yes:2,mostlyYes:1,neutral:0,mostlyNo:-1,no:-2};
const appearanceFields=["species","body","face","hair","eyes","clothing","color","other"];
const personalityAxes=["EI","NS","TF","PJ","AT"];

// Internal tag IDs must never be shown to the user (see 修正案:
// 詳細画面の内部ID表示をなくす). This maps every tag ID used in
// characters.json / questions.json to a Japanese display label.
const TAG_LABELS={
  human:"人間",nonhuman:"人外",humanoid:"人型人外",stick:"棒人間",
  tall:"高身長",slim:"細身",small:"小柄",cute:"かわいい",muscular:"筋肉",adult_face:"大人顔",young:"童顔",
  cool:"クール",handsome:"イケメン",bad_looking:"人相が悪い",
  blunt_bangs:"ぱっつん",long_hair:"長髪",short_hair:"短髪",hime_cut:"姫カット",
  sharp_eyes:"ツリ目",round_eyes:"丸目",droopy_eyes:"タレ目",
  glasses:"眼鏡",black_clothes:"黒い服",ribbon:"リボン",coat:"コート",earrings:"ピアス",dress:"ドレス",
  blue:"青色",white:"白色",black:"黒色",yellow:"黄色",green:"緑色",red:"赤色",pink:"ピンク色",
  scar:"傷",tail:"しっぽ",
  confident:"自信家",caring:"面倒見がいい",quiet:"物静か",reliable:"頼れる",cheerful:"元気",
  friendly:"人懐っこい",energetic:"エネルギッシュ",rough:"荒っぽい",playful:"遊び好き",kind:"優しい",intelligent:"知的",
  protective:"守ってくれる",companion:"相棒気質",wants_to_be_protected:"守られたい",teasing:"からかい好き",
  rival:"ライバル気質",partner:"パートナー気質",
  cat:"猫好き",sweets:"甘いもの好き",games:"ゲーム好き",coffee:"コーヒー好き",festival:"お祭り好き",
  gambling:"勝負事好き",bar:"酒場好き",books:"読書好き",tea:"紅茶好き"
};
function labelFor(tag){return TAG_LABELS[tag]||tag;}

async function init(){
  try{
    const [c,q]=await Promise.all([fetch("data/characters.json"),fetch("data/questions.json")]);
    const cd=await c.json(), qd=await q.json();
    state.chars=cd.characters; state.questions=qd.questions; state.templates=qd.templates;
    render();
  }catch(e){document.getElementById("app").innerHTML=`<div class="app-shell"><div class="screen"><div class="error"><h2>データを読み込めませんでした</h2><p>${e.message}</p><p>GitHub Pages等のHTTP環境で開いてください。</p></div></div></div>`}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
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
function normalizeBreaks(s){
  // Question JSON may contain a literal "\n" (backslash + n) as an
  // author-friendly way to mark a line break; convert it into a real
  // newline so CSS white-space:pre-line renders it as a break instead
  // of showing the two characters "\n" on screen.
  return String(s??"").replace(/\\n/g,"\n");
}
function templateText(q){
  if(q.text) return normalizeBreaks(q.text);
  let t=state.templates[String(q.template)]||"";
  const replacements={word:q.word,word1:q.word1,word2:q.word2,name:q.name};
  t=t.replace(/\{(word|word1|word2|name)\}/g,(_,k)=>replacements[k]??"");
  return normalizeBreaks(t);
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
  state.currentBg=backgroundFor(q);
  render();
}
function snapshotLog(){
  const ranks=ranked();
  state.logs.push({ranks:ranks.slice(0,5),entries:state.blockLog,blockSize:state.blockLog.length});
  state.blockLog=[];
  state.resultRanks=ranks;
}
function answer(ans){
  const q=state.current;
  state.answers.push({q:q.id,answer:ans});
  state.blockLog.push({
    index:state.blockLog.length+1,
    question:templateText(q),
    answer:ANSWER_LABELS[ans]||ans,
    bgId:state.currentBg?state.currentBg.id:null
  });
  applyEffects(q,ans);
  state.questionCount++;
  if(state.questionCount % 20 === 0){ snapshotLog(); state.screen="result"; render(); return; }
  nextQuestion();
}
function reset(){
  state.answers=[];state.asked=new Set();state.history=[];state.scores={};state.current=null;state.currentBg=null;
  state.questionCount=0;state.logs=[];state.blockLog=[];state.resultRanks=[];state.selectedCharacter=null;
}
function render(){
  const app=document.getElementById("app");
  app.innerHTML=`<div class="app-shell"><main class="screen">${screenHTML()}</main></div>`;
  bind();
}
function screenHTML(){
  if(state.screen==="genre")return `<div class="brand">オススメキャラ診断</div><section class="panel"><h1 class="title">ジャンルを選んでください</h1><p class="muted">まずは見た目のジャンルから選ぼう。あとから質問で好みを絞っていきます。</p><div class="genre-grid">${[
    ["all","すべて"],["humanoid","人型"],["stick","棒人間"],["other","その他"]
  ].map(([v,t])=>`<button class="choice" data-genre="${v}">${t}</button>`).join("")}</div></section>`;
  if(state.screen==="question")return questionHTML();
  if(state.screen==="result")return resultHTML();
  if(state.screen==="detail")return detailHTML();
  return "";
}
function questionHTML(){
  const q=state.current||pickQuestion(); if(!state.current){state.current=q;state.currentBg=backgroundFor(q);}
  const bg=state.currentBg;
  return `<div class="brand">オススメキャラ診断</div><section class="panel">
    <div class="progress">質問 ${state.answers.length+1}　／　候補 ${candidates().length}人</div>
    <div class="question-wrap"><div class="ghost">${bg?`<img src="${esc(imgFor(bg,"fullbody"))}" alt="">`:""}</div>
    <div class="question-content"><p class="question">${esc(templateText(q))}</p>
    <div class="answers"><div class="answer-grid">${ANSWERS.map(([v,t])=>`<button class="choice" data-answer="${v}">${t}</button>`).join("")}</div></div></div></div>
    <div class="actions"><button class="secondary" id="show-log">現在の候補を見る</button></div>
  </section>`;
}
function featurePool(c){
  const out=[];
  for(const f of appearanceFields) for(const t of (c.appearance?.[f]||[])) out.push({label:labelFor(t),score:Math.abs(state.scores[t]??0)});
  for(const t of (c.personality?.tags||[])) out.push({label:labelFor(t),score:Math.abs(state.scores[t]??0)});
  for(const t of (c.relationships||[])) out.push({label:labelFor(t),score:Math.abs(state.scores[t]??0)});
  for(const t of (c.likesTags||[])) out.push({label:labelFor(t),score:Math.abs(state.scores[t]??0)});
  if(c.alignment!==undefined) out.push({label:c.alignment>=0?"善寄り":"悪寄り",score:Math.abs((state.scores.alignment??0)*c.alignment)});
  const seen=new Set();
  return out.sort((a,b)=>b.score-a.score).filter(x=>!seen.has(x.label)&&seen.add(x.label)).slice(0,5).map(x=>x.label);
}
function logBlockHTML(log,blockIdx){
  const total=log.blockSize||log.entries.length;
  const rankLine=log.ranks.slice(0,3).map(c=>`${esc(c.name)} ${Math.round(c.score)}%`).join(" / ");
  const entries=log.entries.map(e=>{
    const bg=e.bgId?state.chars.find(c=>c.id===e.bgId):null;
    return `<div class="log-entry">
      <div class="log-entry-top">
        <div class="log-index">${e.index}/${total}</div>
      </div>
      <div class="log-entry-body">
        ${bg?`<img class="log-bg-thumb" src="${esc(imgFor(bg,"bust"))}" alt="">`:`<div class="log-bg-thumb log-bg-thumb--empty"></div>`}
        <div class="log-entry-text">
          <div class="log-question">${esc(e.question).replace(/\n/g,"<br>")}</div>
          <div class="log-answer">▶${esc(e.answer)}</div>
        </div>
      </div>
      ${bg?`<button class="pill-btn" data-log-bg="${esc(bg.id)}">背景キャラの詳細を見る</button>`:""}
    </div>`;
  }).join("");
  return `<div class="log-block">
    <div class="log-block-head"><strong>${blockIdx+1}回目（${(blockIdx+1)*20}問まで）</strong><div class="muted">${esc(rankLine)}</div></div>
    ${entries}
  </div>`;
}
function resultHTML(){
  const r=state.resultRanks.length?state.resultRanks:ranked(),top=r[0];
  return `<div class="brand">診断結果</div><section class="panel"><div class="result-top"><div class="winner-art">${top&&imgFor(top,"fullbody")?`<img src="${esc(imgFor(top,"fullbody"))}" alt="">`:""}</div><div class="result-info"><div class="muted">あなたにオススメのキャラ</div><div class="result-reading">${esc(top?.reading||"")}</div><h1 class="title">${esc(top?.name||"該当なし")}</h1><div class="percent">${top?Math.round(top.score):0}%</div><p>${esc(top?.profile?.description||"")}</p>${top?`<div class="match-features"><strong>特に好みが一致した特徴</strong><ul>${featurePool(top).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}<div class="actions">${top?`<button class="primary" id="detail">詳細を見る</button>`:""}<button class="secondary" id="continue">診断を続ける</button><button class="secondary" id="restart">もう一度診断する</button></div></div></div><h2 class="title" style="margin-top:28px">その他のおすすめ</h2><div class="rank-list">${r.slice(1,6).map(c=>`<div class="rank clickable" data-rank-id="${esc(c.id)}"><img src="${esc(imgFor(c,"bust"))}" alt=""><div><strong>${esc(c.name)}</strong><div class="muted">${esc(c.reading)}</div></div><div class="p">${Math.round(c.score)}%</div></div>`).join("")}</div>${state.logs.length?`<h2 class="title" style="margin-top:30px">診断ログ</h2><div class="log-list">${state.logs.map((log,i)=>logBlockHTML(log,i)).join("")}</div>`:""}</section>`;
}
function detailHTML(){
  const top=state.selectedCharacter||state.resultRanks[0]||ranked()[0];if(!top)return "";
  return `<div class="brand">キャラクター詳細</div><section class="panel"><div class="detail"><div class="detail-art">${imgFor(top,"fullbody")?`<img src="${esc(imgFor(top,"fullbody"))}" alt="">`:""}</div><div class="profile"><div class="detail-reading">${esc(top.reading)}</div><h1 class="title">${esc(top.name)}</h1><dl><dt>性別</dt><dd>${esc(top.profile.gender)}</dd><dt>身長</dt><dd>${esc(top.profile.height)}</dd><dt>年齢</dt><dd>${esc(top.profile.age)}</dd><dt>好き</dt><dd>${esc(top.profile.likes.join("、"))}</dd><dt>苦手</dt><dd>${esc(top.profile.dislikes.join("、"))}</dd><dt>一人称</dt><dd>${esc(top.profile.firstPerson)}</dd><dt>二人称</dt><dd>${esc(top.profile.secondPerson.join("、"))}</dd></dl><h2 class="title" style="margin-top:24px">特に好みが一致した特徴</h2><div class="chips">${featurePool(top).map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div><h2 class="title" style="margin-top:24px">プロフィール</h2><p>${esc(top.profile.description)}</p>${top.profile.longProfile?`<h2 class="title" style="margin-top:24px">詳細プロフィール</h2><p class="long-profile">${esc(top.profile.longProfile).replace(/\n/g,"<br>")}</p>`:""}<div class="actions"><button class="secondary" id="back-result">結果に戻る</button>${top.profile.externalLink?`<a class="primary" href="${esc(top.profile.externalLink)}" target="_blank" rel="noopener">さらに詳細</a>`:""}<button class="secondary" id="restart">もう一度診断する</button></div></div></div></section>`;
}
function bind(){
  document.querySelectorAll("[data-genre]").forEach(b=>b.onclick=()=>{state.genre=b.dataset.genre;state.screen="question";reset();nextQuestion();});
  document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>answer(b.dataset.answer));
  const detail=document.getElementById("detail");if(detail)detail.onclick=()=>{state.selectedCharacter=state.resultRanks[0];state.screen="detail";render()};
  document.querySelectorAll("[data-rank-id]").forEach(b=>b.onclick=()=>{state.selectedCharacter=state.resultRanks.find(c=>c.id===b.dataset.rankId);state.screen="detail";render()});
  document.querySelectorAll("[data-log-bg]").forEach(b=>b.onclick=()=>{state.selectedCharacter=state.chars.find(c=>c.id===b.dataset.logBg);state.screen="detail";render()});
  const cont=document.getElementById("continue");if(cont)cont.onclick=()=>{state.screen="question";nextQuestion()};
  document.querySelectorAll("#restart").forEach(b=>b.onclick=()=>{reset();state.screen="genre";render()});
  const back=document.getElementById("back-result");if(back)back.onclick=()=>{state.screen="result";render()};
  const log=document.getElementById("show-log");if(log)log.onclick=()=>{state.screen="result";render()};
}
