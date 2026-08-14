(()=>{
"use strict";

const D=window.PLH_DATA;
const KEY="plh-v1-state",SNAPSHOTS_KEY="plh-v1-state-snapshots",LEGACY_SNAPSHOT_KEY="plh-v1-state-snapshot",STATE_VERSION=4;
const VALID_VIEWS=new Set(["home","learn","quiz","glossary","progress"]);

const ALL_LESSONS=D.track.chapters.flatMap((c,chapterIndex)=>c.lessons.map((l,lessonIndex)=>({
  ...l,chapterId:c.id,chapterEn:c.titleEn,chapterJa:c.titleJa,chapterIndex,lessonIndex
})));
const LESSON_BY_ID=new Map(ALL_LESSONS.map(x=>[x.id,x]));
const QUIZ_BY_ID=new Map(D.quizzes.map(x=>[x.id,x]));
const TERM_BY_ID=new Map(D.glossary.map(x=>[x.id,x]));
const CHAPTER_BY_ID=new Map(D.track.chapters.map(x=>[x.id,x]));
const CHAPTER_BY_LESSON=new Map(ALL_LESSONS.map(x=>[x.id,x.chapterId]));
const LESSONS_BY_CONCEPT=new Map();
for(const l of ALL_LESSONS){
  const q=QUIZ_BY_ID.get(l.quizId);
  if(q){
    if(!LESSONS_BY_CONCEPT.has(q.concept))LESSONS_BY_CONCEPT.set(q.concept,[]);
    LESSONS_BY_CONCEPT.get(q.concept).push(l.id);
  }
}

const base={
  view:"home",
  lesson:LESSON_BY_ID.has("gross-profit")?"gross-profit":ALL_LESSONS[0]?.id,
  completed:[],
  attempts:{},
  mastery:{},
  bookmarks:[],
  notes:{},
  applications:{},
  sessions:[],
  quizHistory:[],
  assessments:[],
  activeAssessment:null,
  recentLessons:[],
  savedTerms:[],
  termFocus:null,
  ui:{
    tocOpen:null,
    learnSearch:"",
    bookmarksOnly:false,
    progressFilter:"attention",
    progressSearch:"",
    progressTab:"overview",
    glossaryMode:"glossary",
    readingSize:"normal",
    readingWidth:"comfortable",
    managementView:false
  },
  stateVersion:STATE_VERSION,
  updatedAt:null
};

let S=load();
let activeQuiz=null,answered=false,quizSession=null,singleQuizReturnLesson=false,lastAnswerUndo=null;
let noteTimer=null,applicationTimer=null,uiSaveTimer=null;
let glossaryLimit=60;
let globalSearchItems=[],globalSearchIndex=0;

const app=document.getElementById("app");
const title=document.getElementById("pageTitle");
const subtitle=document.getElementById("pageSubtitle");
const pill=document.getElementById("reviewPill");
const sidebar=document.getElementById("sidebar");
const toast=document.getElementById("toast");
const nav=[...document.querySelectorAll(".nav-btn")];
const searchOverlay=document.getElementById("searchOverlay");
const globalSearchInput=document.getElementById("globalSearchInput");
const globalSearchResults=document.getElementById("globalSearchResults");

function clone(x){return JSON.parse(JSON.stringify(x))}
function esc(v=""){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function norm(v=""){return String(v).normalize("NFKC").toLowerCase().trim()}
function uniq(xs){return [...new Set(xs)]}
function shuffle(xs){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function todayKey(){const d=new Date(),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
function dateLabel(v){if(!v)return "—";try{return new Date(v).toLocaleString()}catch{return String(v)}}
function debounceUiSave(){clearTimeout(uiSaveTimer);uiSaveTimer=setTimeout(save,350)}

function normalizeState(raw={}){
  const src=raw&&typeof raw==="object"?raw:{};
  const migratedUi={
    ...clone(base.ui),
    ...(src.ui&&typeof src.ui==="object"?src.ui:{})
  };
  if(src.tocOpen!==undefined && (!src.ui || src.ui.tocOpen===undefined))migratedUi.tocOpen=src.tocOpen;

  const s={
    ...clone(base),
    ...src,
    ui:migratedUi
  };

  if(!VALID_VIEWS.has(s.view))s.view="home";
  if(!LESSON_BY_ID.has(s.lesson))s.lesson=base.lesson;
  if(!Array.isArray(s.completed))s.completed=[];
  if(!Array.isArray(s.bookmarks))s.bookmarks=[];
  if(!s.attempts||typeof s.attempts!=="object"||Array.isArray(s.attempts))s.attempts={};
  if(!s.mastery||typeof s.mastery!=="object"||Array.isArray(s.mastery))s.mastery={};
  if(!s.notes||typeof s.notes!=="object"||Array.isArray(s.notes))s.notes={};
  if(!s.applications||typeof s.applications!=="object"||Array.isArray(s.applications))s.applications={};
  if(!Array.isArray(s.sessions))s.sessions=[];
  if(!Array.isArray(s.quizHistory))s.quizHistory=[];
  if(!Array.isArray(s.assessments))s.assessments=[];
  if(!s.activeAssessment||typeof s.activeAssessment!=="object"||Array.isArray(s.activeAssessment))s.activeAssessment=null;
  if(!Array.isArray(s.recentLessons))s.recentLessons=[];
  if(!Array.isArray(s.savedTerms))s.savedTerms=[];
  if(s.ui.tocOpen!==null&&!Array.isArray(s.ui.tocOpen))s.ui.tocOpen=null;
  if(typeof s.ui.learnSearch!=="string")s.ui.learnSearch="";
  if(typeof s.ui.bookmarksOnly!=="boolean")s.ui.bookmarksOnly=false;
  if(typeof s.ui.progressSearch!=="string")s.ui.progressSearch="";
  if(!["attention","due","studied","strong","mastered","all"].includes(s.ui.progressFilter))s.ui.progressFilter="attention";
  if(!["overview","mastery","library","data"].includes(s.ui.progressTab))s.ui.progressTab="overview";
  if(!["glossary","formulas","frameworks"].includes(s.ui.glossaryMode))s.ui.glossaryMode="glossary";
  if(!["small","normal","large"].includes(s.ui.readingSize))s.ui.readingSize="normal";
  if(!["comfortable","wide"].includes(s.ui.readingWidth))s.ui.readingWidth="comfortable";
  if(typeof s.ui.managementView!=="boolean")s.ui.managementView=false;
  s.completed=uniq(s.completed);
  s.bookmarks=uniq(s.bookmarks);
  s.savedTerms=uniq(s.savedTerms).filter(id=>TERM_BY_ID.has(id));
  s.sessions=s.sessions.slice(-30);
  s.quizHistory=s.quizHistory.filter(x=>x&&QUIZ_BY_ID.has(x.quizId)).slice(-2000);
  s.assessments=s.assessments.filter(x=>x&&x.completedAt).slice(-50);
  s.recentLessons=s.recentLessons.filter(x=>x&&LESSON_BY_ID.has(x.id)).slice(-20);

  for(const r of Object.values(s.mastery)){
    if(!r||typeof r!=="object")continue;
    if(!Array.isArray(r.correctDates))r.correctDates=[];
    r.correctDates=uniq(r.correctDates.filter(Boolean));
  }
  return s;
}

function load(){
  try{return normalizeState(JSON.parse(localStorage.getItem(KEY)||"{}"))}
  catch{return clone(base)}
}

function snapshotList(){
  try{
    const raw=localStorage.getItem(SNAPSHOTS_KEY);
    let list=raw?JSON.parse(raw):[];
    if(!Array.isArray(list))list=[];
    if(!list.length){
      const legacy=localStorage.getItem(LEGACY_SNAPSHOT_KEY);
      if(legacy){
        try{const one=JSON.parse(legacy);if(one&&one.state)list=[one]}catch{}
      }
    }
    return list.filter(x=>x&&x.state&&x.createdAt).map(x=>({...x,state:normalizeState(x.state)})).slice(0,5);
  }catch{return []}
}

function snapshotInfo(){return snapshotList()[0]||null}

function writeSnapshot(state=S,reason="manual"){
  try{
    const payload={app:"Personal Learning Hub",formatVersion:STATE_VERSION,createdAt:new Date().toISOString(),reason,state:normalizeState(state)};
    const list=snapshotList();
    list.unshift(payload);
    localStorage.setItem(SNAPSHOTS_KEY,JSON.stringify(list.slice(0,5)));
    return true;
  }catch{return false}
}

function maybeDailySnapshot(){
  const snap=snapshotInfo();
  if(snap&&Date.now()-new Date(snap.createdAt).getTime()<24*60*60*1000)return;
  try{
    const current=localStorage.getItem(KEY);
    if(current)writeSnapshot(JSON.parse(current),"daily-auto");
  }catch{}
}

function save(){
  maybeDailySnapshot();
  S.stateVersion=STATE_VERSION;
  S.updatedAt=new Date().toISOString();
  let saved=false;
  try{localStorage.setItem(KEY,JSON.stringify(S));saved=true}
  catch{show("Could not save locally / ローカル保存に失敗しました")}
  applyReadingPrefs();
  updatePill();
  if(saved){
    try{window.dispatchEvent(new CustomEvent("plh:state-saved",{detail:{state:clone(S),updatedAt:S.updatedAt}}))}catch{}
  }
}

function storageBytes(key=KEY){
  try{return new Blob([localStorage.getItem(key)||""]).size}
  catch{return (localStorage.getItem(key)||"").length}
}
function storageLabel(key=KEY){
  const b=storageBytes(key);
  return b<1024?`${b} B`:`${(b/1024).toFixed(1)} KB`;
}
function lastSavedLabel(){return S.updatedAt?dateLabel(S.updatedAt):"Not saved yet / 未保存"}
function lastSnapshotLabel(){const x=snapshotInfo();return x?dateLabel(x.createdAt):"No snapshot yet / スナップショットなし"}

function stateHealth(){
  const issues=[];
  const badCompleted=S.completed.filter(id=>!LESSON_BY_ID.has(id));
  const badBookmarks=S.bookmarks.filter(id=>!LESSON_BY_ID.has(id));
  const badNotes=Object.keys(S.notes).filter(id=>!LESSON_BY_ID.has(id));
  const badApps=Object.keys(S.applications).filter(id=>!LESSON_BY_ID.has(id));
  const badAttempts=Object.keys(S.attempts).filter(id=>!QUIZ_BY_ID.has(id));
  const badTerms=S.savedTerms.filter(id=>!TERM_BY_ID.has(id));
  if(badCompleted.length)issues.push(`${badCompleted.length} old completion id(s)`);
  if(badBookmarks.length)issues.push(`${badBookmarks.length} old bookmark id(s)`);
  if(badNotes.length)issues.push(`${badNotes.length} old note id(s)`);
  if(badApps.length)issues.push(`${badApps.length} old application id(s)`);
  if(badAttempts.length)issues.push(`${badAttempts.length} old quiz id(s)`);
  if(badTerms.length)issues.push(`${badTerms.length} old saved-term id(s)`);
  return {ok:issues.length===0,issues};
}

function exportProgress(){
  save();
  const payload={
    app:"Personal Learning Hub",
    formatVersion:STATE_VERSION,
    exportedAt:new Date().toISOString(),
    contentStats:{lessons:ALL_LESSONS.length,glossary:D.glossary.length,quizzes:D.quizzes.length},
    state:S
  };
  downloadText(JSON.stringify(payload,null,2),`personal-learning-hub-backup-${new Date().toISOString().slice(0,10)}.json`,"application/json");
  show("Backup exported / バックアップを書き出しました");
}

function importProgress(file){
  if(!file)return;
  if(file.size>5*1024*1024){alert("Backup file is unexpectedly large. / バックアップファイルが大きすぎます。");return}
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result);
      if(parsed?.app&&parsed.app!=="Personal Learning Hub")throw new Error("Wrong application backup");
      const incoming=parsed&&parsed.state?parsed.state:parsed;
      if(!incoming||typeof incoming!=="object"||Array.isArray(incoming))throw new Error("Invalid backup");
      const recognized=["completed","attempts","mastery","lesson","notes","bookmarks"].some(k=>Object.prototype.hasOwnProperty.call(incoming,k));
      if(!recognized)throw new Error("Unrecognized backup structure");
      const normalized=normalizeState(incoming);
      if(!confirm("Replace current progress with this backup? A local recovery snapshot will be created first.\n\n現在の進捗をこのバックアップで置き換えますか？ 先に復元用スナップショットを作成します。"))return;
      writeSnapshot(S,"before-import");
      S=normalized;activeQuiz=null;answered=false;quizSession=null;
      save();renderProgress();
      show("Backup restored / バックアップを復元しました");
    }catch{
      alert("Could not read this backup file. / このバックアップファイルを読み込めませんでした。");
    }
  };
  reader.readAsText(file);
}

function restoreSnapshot(index=0){
  const list=snapshotList(),snap=list[index];
  if(!snap){show("No snapshot available / 復元できるスナップショットがありません");return}
  if(!confirm(`Restore snapshot from ${dateLabel(snap.createdAt)}?\n\n${dateLabel(snap.createdAt)} のスナップショットへ戻しますか？`))return;
  const current=clone(S);
  S=normalizeState(snap.state);
  writeSnapshot(current,"before-snapshot-restore");
  activeQuiz=null;answered=false;quizSession=null;
  save();renderProgress();show("Snapshot restored / スナップショットを復元しました");
}

function downloadText(text,filename,type="text/plain"){
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function lesson(id){return LESSON_BY_ID.get(id)||ALL_LESSONS[0]}
function quiz(id){return QUIZ_BY_ID.get(id)}
function term(id){return TERM_BY_ID.get(id)}
function currentChapter(){return CHAPTER_BY_ID.get(CHAPTER_BY_LESSON.get(S.lesson))||D.track.chapters[0]}

const LESSON_SEARCH_INDEX=new Map(ALL_LESSONS.map(l=>{
  const linked=l.glossary.map(id=>term(id)).filter(Boolean).flatMap(g=>[g.en,g.ja,...g.aliases]);
  return [l.id,norm([
    l.titleEn,l.titleJa,l.chapterEn,l.chapterJa,l.objectiveEn,l.objectiveJa,
    l.explanationEn,l.explanationJa,l.keyEn,l.keyJa,l.applicationEn,l.applicationJa,...linked
  ].join(" "))];
}));
const TERM_SEARCH_INDEX=new Map(D.glossary.map(g=>[g.id,norm([g.en,g.ja,...g.aliases,g.defEn,g.defJa,g.whyEn,g.whyJa].join(" "))]));

function setView(v){
  S.view=v;save();
  nav.forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  sidebar.classList.remove("open");
  const t={
    home:["Home / ホーム","Continue where you left off. / 前回の続きから学習できます。"],
    learn:["Learn / 学ぶ","Interactive textbook and table of contents. / 目次から進むインタラクティブ教科書。"],
    quiz:["Quiz / クイズ","Practice, understand, review. / 練習・理解・復習。"],
    glossary:["Glossary / 用語集","Terms, formulas, and management frameworks. / 用語・計算式・経営フレームワーク。"],
    progress:["Progress / 進捗","Readiness, mastery, library, and local data. / 準備度・習熟・記録・ローカル保存。"]
  };
  [title.textContent,subtitle.textContent]=t[v];
  render();
}

function openQuizHub(){
  if(quizSession?.assessment&&!quizSession.done&&!answered){S.activeAssessment=clone(quizSession)}
  activeQuiz=null;answered=false;quizSession=null;singleQuizReturnLesson=false;lastAnswerUndo=null;
  setView("quiz");
}
function resumeAssessment(){
  const draft=S.activeAssessment;
  if(!draft||!Array.isArray(draft.queue)||!draft.queue.length){S.activeAssessment=null;save();renderQuiz();return}
  quizSession=clone(draft);
  quizSession.done=false;
  if(quizSession.index>=quizSession.queue.length){S.activeAssessment=null;finishQuizSession();renderQuiz();return}
  activeQuiz=quizSession.queue[quizSession.index];answered=false;singleQuizReturnLesson=false;lastAnswerUndo=null;
  setView("quiz");
}
function abandonAssessment(){
  if(!S.activeAssessment)return;
  if(!confirm("Abandon this paused assessment? Its partial answers will not be saved as an assessment result.\n\n中断中の確認テストを破棄しますか？ 未完了の回答は確認テスト結果として保存されません。"))return;
  S.activeAssessment=null;save();renderQuiz();show("Paused assessment discarded / 中断中の確認テストを破棄しました");
}

function pct(){return Math.round(S.completed.filter(id=>LESSON_BY_ID.has(id)).length/ALL_LESSONS.length*100)||0}
function stats(){
  const a=Object.entries(S.attempts).filter(([id])=>QUIZ_BY_ID.has(id)).map(([,x])=>x);
  let total=0,correct=0;
  a.forEach(x=>{total+=x.total||0;correct+=x.correct||0});
  const history=S.quizHistory.filter(x=>QUIZ_BY_ID.has(x.quizId)&&!x.assessment);
  const recent=history.slice(-30),first=history.filter(x=>x.firstPresentation!==false);
  const accuracy=total?Math.round(correct/total*100):0;
  const recentAccuracy=recent.length?Math.round(recent.filter(x=>x.correct).length/recent.length*100):accuracy;
  const firstAccuracy=first.length?Math.round(first.filter(x=>x.correct).length/first.length*100):accuracy;
  return{total,correct,accuracy,recentAccuracy,firstAccuracy,recentCount:recent.length};
}
function applicationEvidence(concept){
  const ids=LESSONS_BY_CONCEPT.get(concept)||[];
  return ids.some(id=>{
    const a=S.applications[id];
    return a&&a.completedAt&&String(a.text||"").trim().length>=40;
  });
}
function mastery(id){
  const r=S.mastery[id]||{score:0,total:0,correct:0,next:null,correctDates:[]};
  const correctDates=uniq(Array.isArray(r.correctDates)?r.correctDates:[]);
  const applied=applicationEvidence(id);
  let en="New",ja="未学習";
  if(r.total){en="Learning";ja="学習中"}
  if((r.score||0)>=2){en="Developing";ja="発展中"}
  if((r.score||0)>=4&&(r.correct||0)>=3&&correctDates.length>=2){en="Strong";ja="定着"}
  if((r.score||0)>=6&&(r.correct||0)>=4&&correctDates.length>=2&&applied){en="Mastered";ja="習得"}
  return{...r,correctDates,applied,en,ja};
}
function due(){
  const now=Date.now();
  return Object.entries(S.mastery)
    .filter(([id,r])=>TERM_BY_ID.has(id)&&r&&r.next&&!Number.isNaN(new Date(r.next).getTime())&&new Date(r.next).getTime()<=now)
    .sort((a,b)=>new Date(a[1].next)-new Date(b[1].next))
    .map(([id])=>id);
}
function weakConcepts(){
  return D.glossary.map(g=>g.id).filter(id=>{
    const m=mastery(id);
    return m.total>0&&!["Strong","Mastered"].includes(m.en);
  });
}
function conceptHistory(id){return S.quizHistory.filter(x=>x.concept===id&&!x.assessment)}
function conceptReadiness(id){
  const m=mastery(id),hist=conceptHistory(id),recent=hist.slice(-5);
  if(!m.total&&!hist.length)return 0;
  const recentAcc=recent.length?recent.filter(x=>x.correct).length/recent.length:((m.correct||0)/Math.max(1,m.total||1));
  const accuracy=Math.max(0,Math.min(1,recentAcc));
  const strength=Math.max(0,Math.min(1,(m.score||0)/7));
  const spacing=Math.max(0,Math.min(1,m.correctDates.length/3));
  const applied=m.applied?1:0;
  let score=Math.round(accuracy*40+strength*25+spacing*15+applied*20);
  if(m.next&&new Date(m.next).getTime()<Date.now())score=Math.max(0,score-10);
  return Math.min(100,score);
}
function reviewPriority(id){
  const m=mastery(id),hist=conceptHistory(id),last=hist.at(-1);
  if(!m.total&&!hist.length)return -1;
  const next=m.next?new Date(m.next).getTime():Infinity;
  const overdueDays=Number.isFinite(next)&&next<Date.now()?Math.min(30,(Date.now()-next)/86400000):0;
  const recent=hist.slice(-3),recentWrong=recent.filter(x=>!x.correct).length;
  const lastWrong=last&&!last.correct?1:0;
  const lastAt=last?.at?new Date(last.at).getTime():0;
  const daysSince=lastAt?Math.min(30,(Date.now()-lastAt)/86400000):7;
  return (100-conceptReadiness(id))*0.55+overdueDays*2+recentWrong*10+lastWrong*12+daysSince*0.4+(m.en==="Strong"&&!m.applied?5:0);
}
function adaptiveReviewConcepts(limit=10){
  return D.glossary.map(g=>g.id)
    .map(id=>({id,priority:reviewPriority(id)}))
    .filter(x=>x.priority>=0)
    .sort((a,b)=>b.priority-a.priority)
    .slice(0,limit).map(x=>x.id);
}
function chapterLearningReadiness(c){
  const lessonIds=c.lessons.map(l=>l.id),quizIds=c.lessons.map(l=>l.quizId).filter(id=>QUIZ_BY_ID.has(id));
  const concepts=uniq(quizIds.map(id=>quiz(id)?.concept).filter(Boolean));
  const coverage=lessonIds.length?lessonIds.filter(id=>S.completed.includes(id)).length/lessonIds.length:0;
  const firstHist=S.quizHistory.filter(x=>quizIds.includes(x.quizId)&&!x.assessment&&x.firstPresentation!==false);
  const attemptedIds=firstHist.length?uniq(firstHist.map(x=>x.quizId)):quizIds.filter(id=>(S.attempts[id]?.total||0)>0);
  let recallBase=0;
  if(firstHist.length)recallBase=firstHist.filter(x=>x.correct).length/firstHist.length;
  else{const quizTotals=attemptedIds.reduce((acc,id)=>{const a=S.attempts[id];acc.t+=a.total||0;acc.c+=a.correct||0;return acc},{t:0,c:0});recallBase=quizTotals.t?quizTotals.c/quizTotals.t:0}
  const evidenceCoverage=quizIds.length?attemptedIds.length/quizIds.length:0;
  const recall=recallBase*evidenceCoverage;
  const masteryAvg=concepts.length?concepts.reduce((a,id)=>a+conceptReadiness(id),0)/concepts.length/100:0;
  const applied=lessonIds.length?lessonIds.filter(id=>{const x=S.applications[id];return x&&x.completedAt&&String(x.text||"").trim().length>=40}).length/lessonIds.length:0;
  const score=Math.round((coverage*.25+recall*.30+masteryAvg*.30+applied*.15)*100);
  return{score,coverage:Math.round(coverage*100),recall:Math.round(recall*100),mastery:Math.round(masteryAvg*100),application:Math.round(applied*100),attempted:attemptedIds.length,totalQuiz:quizIds.length};
}
function trackReadiness(){
  const rows=D.track.chapters.map(c=>({c,...chapterLearningReadiness(c)}));
  const totalLessons=rows.reduce((a,x)=>a+x.c.lessons.length,0)||1;
  const weighted=rows.reduce((a,x)=>a+x.score*x.c.lessons.length,0)/totalLessons;
  const coverage=rows.reduce((a,x)=>a+x.coverage*x.c.lessons.length,0)/totalLessons;
  const recall=rows.reduce((a,x)=>a+x.recall*x.c.lessons.length,0)/totalLessons;
  const masteryScore=rows.reduce((a,x)=>a+x.mastery*x.c.lessons.length,0)/totalLessons;
  const application=rows.reduce((a,x)=>a+x.application*x.c.lessons.length,0)/totalLessons;
  return{score:Math.round(weighted),coverage:Math.round(coverage),recall:Math.round(recall),mastery:Math.round(masteryScore),application:Math.round(application),chapters:rows};
}
function readinessLabel(score){
  if(score>=85)return["Very strong","かなり強い"];
  if(score>=70)return["Strong","強い"];
  if(score>=50)return["Developing","発展中"];
  if(score>=25)return["Foundation building","基礎構築中"];
  return["Early stage","初期段階"];
}
function knowledgeGaps(limit=5){
  return trackReadiness().chapters.slice().sort((a,b)=>a.score-b.score).slice(0,limit);
}
function recommendedLesson(){
  const current=lesson(S.lesson);
  if(current&&!S.completed.includes(current.id))return current;
  const gaps=knowledgeGaps(D.track.chapters.length);
  for(const row of gaps){
    const next=row.c.lessons.find(x=>!S.completed.includes(x.id));
    if(next)return lesson(next.id);
  }
  return ALL_LESSONS.find(x=>!S.completed.includes(x.id))||current||ALL_LESSONS[0];
}
function suggestedApplicationLesson(){
  const candidates=ALL_LESSONS.filter(l=>S.completed.includes(l.id)&&!(S.applications[l.id]?.completedAt));
  if(!candidates.length)return null;
  const reviewSet=new Set(adaptiveReviewConcepts(20));
  return candidates.find(l=>reviewSet.has(quiz(l.quizId)?.concept))||candidates[0];
}
function todayPlan(){return{lesson:recommendedLesson(),review:adaptiveReviewConcepts(10),apply:suggestedApplicationLesson()}}
function updatePill(){pill.textContent=`Review due / 復習: ${due().length}`}
function show(msg){toast.textContent=msg;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),1800)}

function markComplete(id,complete=true){
  if(complete&&!S.completed.includes(id))S.completed.push(id);
  if(!complete)S.completed=S.completed.filter(x=>x!==id);
  save();
}
function toggleBookmark(id){
  if(S.bookmarks.includes(id)){S.bookmarks=S.bookmarks.filter(x=>x!==id);show("Bookmark removed / ブックマークを解除しました")}
  else{S.bookmarks.push(id);show("Bookmarked / ブックマークしました")}
  save();
}
function toggleSavedTerm(id){
  if(S.savedTerms.includes(id)){S.savedTerms=S.savedTerms.filter(x=>x!==id);show("Saved term removed / 保存用語を解除しました")}
  else{S.savedTerms.push(id);show("Term saved / 用語を保存しました")}
  save();
}
function recordRecentLesson(id){
  S.recentLessons=S.recentLessons.filter(x=>x.id!==id);
  S.recentLessons.push({id,at:new Date().toISOString()});
  S.recentLessons=S.recentLessons.slice(-20);
}
function notesCount(){return Object.values(S.notes).filter(v=>String(v||"").trim()).length}
function applicationsCount(){return Object.values(S.applications).filter(v=>v&&v.completedAt&&String(v.text||"").trim().length>=40).length}
function applyReadingPrefs(){
  document.documentElement.dataset.readingSize=S.ui.readingSize||"normal";
  document.documentElement.dataset.readingWidth=S.ui.readingWidth||"comfortable";
}
function cycleReadingSize(delta){
  const levels=["small","normal","large"],i=levels.indexOf(S.ui.readingSize||"normal");
  S.ui.readingSize=levels[Math.max(0,Math.min(levels.length-1,i+delta))];save();renderLearn();
}
function toggleReadingWidth(){S.ui.readingWidth=S.ui.readingWidth==="wide"?"comfortable":"wide";save();renderLearn()}
function exportStudyReport(){
  const r=trackReadiness(),st=stats(),label=readinessLabel(r.score);
  const chapters=r.chapters.map((x,i)=>`<tr><td>${i+1}. ${esc(x.c.titleEn)} / ${esc(x.c.titleJa)}</td><td>${x.score}%</td><td>${x.coverage}%</td><td>${x.recall}%</td><td>${x.mastery}%</td><td>${x.application}%</td></tr>`).join("");
  const notes=Object.entries(S.notes).filter(([,v])=>String(v||"").trim()).map(([id,v])=>`<h3>${esc(lesson(id)?.titleEn||id)} / ${esc(lesson(id)?.titleJa||"")}</h3><p>${esc(v).replaceAll("\n","<br>")}</p>`).join("")||"<p>No notes yet / メモなし</p>";
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>PLH Study Report</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#222}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left}small{color:#666}</style></head><body><h1>Personal Learning Hub — Study Report / 学習レポート</h1><p><small>Generated ${esc(new Date().toLocaleString())}</small></p><h2>Learning Readiness / 学習準備度: ${r.score}% — ${label[0]} / ${label[1]}</h2><p>Completion ${pct()}% · Lifetime quiz ${st.accuracy}% · Recent quiz ${st.recentAccuracy}% · Applied practice ${applicationsCount()}</p><table><thead><tr><th>Chapter / 章</th><th>Readiness</th><th>Coverage</th><th>Recall</th><th>Mastery</th><th>Application</th></tr></thead><tbody>${chapters}</tbody></table><h2>Personal Notes / 自分のメモ</h2>${notes}</body></html>`;
  downloadText(html,`personal-learning-hub-study-report-${new Date().toISOString().slice(0,10)}.html`,"text/html");
  show("Study report exported / 学習レポートを書き出しました");
}

function render(){
  if(S.view==="learn")return renderLearn();
  if(S.view==="quiz")return renderQuiz();
  if(S.view==="glossary")return renderGlossary();
  if(S.view==="progress")return renderProgress();
  renderHome();
}

/* ---------- Home ---------- */
function renderHome(){
  const plan=todayPlan(),l=plan.lesson,st=stats(),r=trackReadiness(),label=readinessLabel(r.score),gaps=knowledgeGaps(3);
  const bookmarked=S.bookmarks.filter(id=>LESSON_BY_ID.has(id)).map(lesson);
  const reviewTerms=plan.review.slice(0,3).map(term).filter(Boolean);
  app.innerHTML=`
  <section class="paper hero readiness-hero">
    <div>
      <div class="eyebrow">Interactive Digital Textbook / インタラクティブ・デジタル教科書</div>
      <h2>Today's Learning Plan / 今日の学習プラン</h2>
      <p><strong>${esc(l.titleEn)} / ${esc(l.titleJa)}</strong><br>${esc(l.objectiveEn)}<br>${esc(l.objectiveJa)}</p>
      <div class="btn-row">
        <button class="primary" id="continue">Continue Learning / 学習を続ける</button>
        <button class="secondary" id="review">Smart Review / スマート復習</button>
        ${plan.apply?`<button class="secondary" id="applyToday">Apply / 応用する</button>`:""}
      </div>
    </div>
    <div class="readiness-panel">
      <small>Learning Readiness / 学習準備度</small>
      <div class="readiness-score">${r.score}<span>%</span></div>
      <strong>${label[0]} / ${label[1]}</strong>
      <div class="readiness-bars">
        ${[["Coverage / 学習範囲",r.coverage],["Recall / 想起",r.recall],["Mastery / 習熟",r.mastery],["Application / 応用",r.application]].map(([name,v])=>`<div><span>${name}</span><div class="progress-track thin"><div class="progress-fill" style="width:${v}%"></div></div><b>${v}%</b></div>`).join("")}
      </div>
      <p class="small">Internal learning indicator—not a job-performance score. / 学習状況の内部指標であり、職務能力の絶対評価ではありません。</p>
    </div>
  </section>

  <div class="metrics">
    <div class="metric"><small>Lessons completed / 完了レッスン</small><strong>${S.completed.filter(id=>LESSON_BY_ID.has(id)).length}</strong></div>
    <div class="metric"><small>First-attempt accuracy / 初回正答率</small><strong>${st.firstAccuracy}%</strong></div>
    <div class="metric"><small>Recent accuracy / 直近正答率</small><strong>${st.recentAccuracy}%</strong></div>
    <div class="metric"><small>Review due / 復習対象</small><strong>${due().length}</strong></div>
  </div>

  <section class="section">
    <div class="section-head"><h2>Today / 今日</h2><p>One learn + one review + one application when useful. / 学ぶ・復習する・応用するを必要に応じて1つずつ。</p></div>
    <div class="cards four">
      <div class="card"><h3>Learn / 学ぶ</h3><p>${esc(l.titleEn)} / ${esc(l.titleJa)}</p><button class="text-btn" id="openLesson">Open lesson / 開く →</button></div>
      <div class="card"><h3>Review / 復習</h3><p>${reviewTerms.length?reviewTerms.map(g=>`${esc(g.en)} / ${esc(g.ja)}`).join("<br>"):`No urgent review. / 緊急の復習なし。`}</p><button class="text-btn" id="openReview">Start adaptive review / 復習開始 →</button></div>
      <div class="card"><h3>Apply / 応用</h3><p>${plan.apply?`${esc(plan.apply.titleEn)} / ${esc(plan.apply.titleJa)}`:"No application gap yet. / 応用課題なし。"}</p>${plan.apply?`<button class="text-btn" id="openApply">Open practice / 応用へ →</button>`:`<span class="small">Complete more lessons first. / まず学習を進めてください。</span>`}</div>
      <div class="card"><h3>My Library / 自分の記録</h3><p>${bookmarked.length} bookmark(s) · ${notesCount()} note(s) · ${S.savedTerms.length} saved term(s)</p><button class="text-btn" id="openLibrary">Open library / 開く →</button></div>
    </div>
  </section>

  <section class="paper progress-section">
    <div class="section-head"><h2>Knowledge Gaps / 強化候補</h2><p>Lowest chapter-level learning readiness. / Chapter単位でLearning Readinessが低い順。</p></div>
    <div class="gap-grid">${gaps.map((x,i)=>`<button class="gap-card" data-gap-chapter="${esc(x.c.id)}"><span>Chapter ${x.c.chapterIndex??(D.track.chapters.indexOf(x.c)+1)} · ${x.score}%</span><strong>${esc(x.c.titleEn)}</strong><small>${esc(x.c.titleJa)}</small><div class="progress-track thin"><div class="progress-fill" style="width:${x.score}%"></div></div></button>`).join("")}</div>
    <div class="btn-row"><button class="secondary" id="trackAssessmentHome">Track Assessment / 総合確認</button><button class="text-btn" id="readinessDetails">Readiness details / 詳細を見る →</button></div>
  </section>`;
  document.getElementById("continue").onclick=()=>openLessonId(l.id);
  document.getElementById("openLesson").onclick=()=>openLessonId(l.id);
  document.getElementById("review").onclick=startSmartReview;
  document.getElementById("openReview").onclick=startSmartReview;
  if(document.getElementById("applyToday"))document.getElementById("applyToday").onclick=()=>openLessonId(plan.apply.id);
  if(document.getElementById("openApply"))document.getElementById("openApply").onclick=()=>openLessonId(plan.apply.id);
  document.getElementById("openLibrary").onclick=()=>{S.ui.progressTab="library";save();setView("progress")};
  document.getElementById("readinessDetails").onclick=()=>{S.ui.progressTab="overview";save();setView("progress")};
  document.getElementById("trackAssessmentHome").onclick=startTrackAssessment;
  document.querySelectorAll("[data-gap-chapter]").forEach(b=>b.onclick=()=>{
    const c=CHAPTER_BY_ID.get(b.dataset.gapChapter),next=c?.lessons.find(x=>!S.completed.includes(x.id))||c?.lessons[0];
    if(next)openLessonId(next.id);
  });
}

/* ---------- Learn ---------- */
function renderLearn(){
  const cur=lesson(S.lesson),idx=ALL_LESSONS.findIndex(x=>x.id===cur.id),prev=ALL_LESSONS[idx-1],next=ALL_LESSONS[idx+1];
  const currentChapterId=cur.chapterId;
  const openIds=new Set(Array.isArray(S.ui.tocOpen)?S.ui.tocOpen:[currentChapterId]);
  const toc=D.track.chapters.map((c,i)=>{
    const open=openIds.has(c.id),done=c.lessons.filter(l=>S.completed.includes(l.id)).length;
    return `<div class="chapter ${open?"open":""}" data-chapter-wrap="${esc(c.id)}">
      <button class="chapter-toggle" data-chapter="${esc(c.id)}" aria-expanded="${open}">
        <span class="chapter-title">${i+1}. ${esc(c.titleEn)}<br><small>${esc(c.titleJa)}</small></span>
        <span class="chapter-meta"><span>${done}/${c.lessons.length}</span><span class="chevron">⌄</span></span>
      </button>
      <div class="chapter-lessons">
        ${c.lessons.map(l=>`<button class="lesson-link ${l.id===cur.id?"active":""}" data-lesson="${esc(l.id)}">
          <span>${esc(l.titleEn)}<br><small>${esc(l.titleJa)}</small></span>
          <span class="lesson-flags">${S.bookmarks.includes(l.id)?"★":""}${S.completed.includes(l.id)?" ✓":""}</span>
        </button>`).join("")}
      </div>
    </div>`;
  }).join("");

  const note=String(S.notes[cur.id]||"");
  const application=S.applications[cur.id]||{text:"",completedAt:null};
  const appText=String(application.text||"");
  const applicationComplete=Boolean(application.completedAt&&appText.trim().length>=40);
  const q=quiz(cur.quizId),concept=q?term(q.concept):null,m=concept?mastery(concept.id):null;
  const formulaTerms=cur.glossary.map(term).filter(g=>g&&g.formula);

  app.innerHTML=`
  <div class="learn-grid">
    <aside class="paper toc">
      <div class="toc-head">
        <div><h2>Table of Contents / 目次</h2><p>${esc(D.track.titleEn)}<br>${esc(D.track.titleJa)}</p></div>
        <div class="toc-search-wrap">
          <input class="toc-search" id="lessonSearch" type="search" autocomplete="off" placeholder="Search lessons / レッスン検索" value="${esc(S.ui.learnSearch)}">
          <span class="toc-match" id="tocMatch"></span>
        </div>
        <div class="toc-actions">
          <button class="mini-btn ${S.ui.bookmarksOnly?"active":""}" id="bookmarkFilter">★ Bookmarks / 保存</button>
          <button class="mini-btn" id="collapseToc">Collapse / 閉じる</button>
          <button class="mini-btn" id="expandToc">Expand / 開く</button>
          <button class="mini-btn" id="clearLessonSearch">Clear / クリア</button>
        </div>
      </div>
      <div id="tocChapters">${toc}</div>
      <div class="empty compact" id="tocEmpty" hidden>No matching lessons / 該当レッスンなし</div>
    </aside>

    <article class="paper lesson">
      <div class="lesson-topline">
        <div>
          <div class="lesson-kicker">${esc(cur.chapterEn)} / ${esc(cur.chapterJa)}</div>
          <div class="small">Lesson ${idx+1} / ${ALL_LESSONS.length}${m?` · ${m.en} / ${m.ja}`:""}</div>
        </div>
        <div class="lesson-actions">
          <button class="secondary compact-btn ${S.ui.managementView?"active":""}" id="managementView">Executive Review / 経営前レビュー</button>
          <button class="secondary compact-btn" id="textSmaller" title="Smaller text">A−</button>
          <button class="secondary compact-btn" id="textLarger" title="Larger text">A+</button>
          <button class="secondary compact-btn" id="widthToggle">${S.ui.readingWidth==="wide"?"Comfortable width / 標準幅":"Wide / 広く"}</button>
          <button class="secondary compact-btn" id="printLesson">Print / 印刷</button>
          <button class="secondary compact-btn" id="bookmarkLesson">${S.bookmarks.includes(cur.id)?"★ Saved / 保存済み":"☆ Bookmark / 保存"}</button>
          <button class="secondary compact-btn" id="toggleComplete">${S.completed.includes(cur.id)?"✓ Completed / 完了":"Mark complete / 完了にする"}</button>
        </div>
      </div>

      <h2>${esc(cur.titleEn)}</h2>
      <div class="jp-title">${esc(cur.titleJa)}</div>

      <div class="objective"><strong>Objective / 学習目標</strong><br>${esc(cur.objectiveEn)}<br>${esc(cur.objectiveJa)}</div>

      ${S.ui.managementView?`<section class="management-review-card">
        <div class="eyebrow">Executive Review / 経営前レビュー</div>
        <div class="management-review-grid">
          <div><strong>Meaning / 意味</strong><p>${esc(cur.keyEn)}<br><span class="jp">${esc(cur.keyJa)}</span></p></div>
          <div><strong>Why management cares / なぜ経営に重要か</strong><p>${esc(cur.objectiveEn)}<br><span class="jp">${esc(cur.objectiveJa)}</span></p></div>
          <div><strong>UOH / Fusion application / 応用</strong><p>${esc(cur.applicationEn)}<br><span class="jp">${esc(cur.applicationJa)}</span></p></div>
          <div><strong>Formula / Framework / 計算・枠組み</strong><p>${formulaTerms.length?formulaTerms.map(g=>`${esc(g.en)}: ${esc(g.formula)}`).join("<br>"):cur.glossary.slice(0,4).map(id=>{const g=term(id);return g?`${esc(g.en)} / ${esc(g.ja)}`:""}).join("<br>")}</p></div>
        </div>
        <div class="owner-test"><strong>Owner Test / 自分の言葉で説明</strong><span>What does it mean? · Where does the number/evidence come from? · Why does it matter? · What could make it wrong? · What management decision does it affect?</span><span>何を意味する？ · 数字/Evidenceはどこから？ · なぜ重要？ · 何が間違いにし得る？ · どの経営判断に影響する？</span></div>
      </section>`:""}

      <section class="lesson-section"><h3>Explanation / 解説</h3><div class="bi"><div>${esc(cur.explanationEn)}</div><div class="jp">${esc(cur.explanationJa)}</div></div></section>
      <section class="lesson-section"><h3>Worked Example / 例</h3><div class="box bi"><div>${esc(cur.exampleEn)}</div><div class="jp">${esc(cur.exampleJa)}</div></div></section>
      <section class="lesson-section"><h3>Key Point / 要点</h3><div class="box key-box bi"><strong>${esc(cur.keyEn)}</strong><strong class="jp">${esc(cur.keyJa)}</strong></div></section>
      <section class="lesson-section"><h3>UOH / Fusion Application / UOH・Fusionへの応用</h3><div class="box app-box bi"><div>${esc(cur.applicationEn)}</div><div class="jp">${esc(cur.applicationJa)}</div></div></section>

      <section class="lesson-section">
        <details ${note?"open":""}>
          <summary>Personal Notes / 自分のメモ ${note?"•":""}</summary>
          <p class="small">Stored locally, searchable globally, and included in backup. / ローカル保存・全体検索対象・バックアップ対象です。</p>
          <textarea class="note-area" id="lessonNote" rows="7" placeholder="Write anything you want to remember... / 覚えておきたいことを自由に記入...">${esc(note)}</textarea>
          <div class="field-foot"><span id="noteStatus">${note?"Saved locally / 保存済み":""}</span><span>${note.length} chars</span></div>
        </details>
      </section>

      <section class="lesson-section">
        <details ${appText?"open":""}>
          <summary>Application Practice / 応用練習 ${applicationComplete?"✓":""}</summary>
          <div class="application-prompt"><strong>Prompt / 問い</strong><p>If this concept mattered in a real management discussion, what decision would it change, what evidence or number would you check, and what could make your conclusion wrong?</p><p class="jp">このConceptが実際の経営議論で重要なら、どのDecisionを変えるか、何のEvidence/Numberを確認するか、何が結論を間違いにし得るかを書いてください。</p></div>
          <p class="small">2–4 sentences is enough. One completed applied response plus repeated correct evidence across days is required for <strong>Mastered</strong>. / 2〜4文で十分。Masteredには応用回答1件＋複数日にわたる正答Evidenceが必要です。</p>
          <textarea class="note-area" id="applicationNote" rows="6" placeholder="My application / 私の応用...">${esc(appText)}</textarea>
          <div class="field-foot"><span id="applicationStatus">${applicationComplete?"Applied evidence recorded / 応用Evidence記録済み":"40+ characters then mark complete / 40文字以上で完了可能"}</span><span id="applicationCount">${appText.trim().length} chars</span></div>
          <div class="btn-row tight"><button class="secondary" id="completeApplication" ${appText.trim().length<40?"disabled":""}>${applicationComplete?"✓ Applied practice complete / 応用練習完了":"Mark applied practice complete / 応用練習を完了"}</button></div>
        </details>
      </section>

      <section class="lesson-section"><details><summary>Go Deeper / さらに深く</summary><div class="bi" style="margin-top:12px"><div>${esc(cur.deeperEn)}</div><div class="jp">${esc(cur.deeperJa)}</div></div></details></section>

      <section class="lesson-section"><h3>Linked Glossary / 関連用語</h3><div class="chips">${cur.glossary.map(id=>{const g=term(id);return g?`<button class="chip" data-term="${esc(id)}">${esc(g.en)} / ${esc(g.ja)}</button>`:""}).join("")}</div></section>

      <section class="lesson-section checkpoint-box">
        <div><h3>Checkpoint / チェック問題</h3><p class="small">One question with immediate feedback. / 1問ずつ、回答後すぐに解説。</p></div>
        <button class="primary" id="checkpoint">Start checkpoint / 問題に進む</button>
      </section>

      <div class="lesson-nav">
        <button class="secondary" id="prev" ${prev?"":"disabled"}>← Previous / 前へ</button>
        <button class="secondary" id="next" ${next?"":"disabled"}>Next / 次へ →</button>
      </div>
    </article>
  </div>`;

  document.querySelectorAll("[data-chapter]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.chapter,set=new Set(openIds);
    set.has(id)?set.delete(id):set.add(id);
    S.ui.tocOpen=[...set];save();renderLearn();
  });
  document.getElementById("collapseToc").onclick=()=>{S.ui.tocOpen=[];save();renderLearn()};
  document.getElementById("expandToc").onclick=()=>{S.ui.tocOpen=D.track.chapters.map(c=>c.id);save();renderLearn()};
  document.getElementById("clearLessonSearch").onclick=()=>{S.ui.learnSearch="";S.ui.bookmarksOnly=false;save();renderLearn()};
  document.getElementById("bookmarkFilter").onclick=()=>{S.ui.bookmarksOnly=!S.ui.bookmarksOnly;save();renderLearn()};

  const lessonSearch=document.getElementById("lessonSearch");
  lessonSearch.oninput=()=>{S.ui.learnSearch=lessonSearch.value;applyTocFilter();debounceUiSave()};
  applyTocFilter();

  document.querySelectorAll("[data-lesson]").forEach(b=>b.onclick=()=>openLessonId(b.dataset.lesson));
  document.querySelectorAll("[data-term]").forEach(b=>b.onclick=()=>openTermId(b.dataset.term));

  document.getElementById("managementView").onclick=()=>{S.ui.managementView=!S.ui.managementView;save();renderLearn()};
  document.getElementById("textSmaller").onclick=()=>cycleReadingSize(-1);
  document.getElementById("textLarger").onclick=()=>cycleReadingSize(1);
  document.getElementById("widthToggle").onclick=toggleReadingWidth;
  document.getElementById("printLesson").onclick=()=>window.print();
  document.getElementById("bookmarkLesson").onclick=()=>{toggleBookmark(cur.id);renderLearn()};
  document.getElementById("toggleComplete").onclick=()=>{markComplete(cur.id,!S.completed.includes(cur.id));renderLearn()};

  const noteEl=document.getElementById("lessonNote"),noteStatus=document.getElementById("noteStatus");
  noteEl.oninput=()=>{
    clearTimeout(noteTimer);noteStatus.textContent="Saving... / 保存中...";
    noteTimer=setTimeout(()=>{
      const v=noteEl.value;if(v.trim())S.notes[cur.id]=v;else delete S.notes[cur.id];save();noteStatus.textContent="Saved locally / 保存済み";
    },350);
  };

  const appEl=document.getElementById("applicationNote"),appStatus=document.getElementById("applicationStatus"),appCount=document.getElementById("applicationCount"),completeApp=document.getElementById("completeApplication");
  appEl.oninput=()=>{
    const len=appEl.value.trim().length;appCount.textContent=`${len} chars`;completeApp.disabled=len<40;clearTimeout(applicationTimer);
    applicationTimer=setTimeout(()=>{
      const old=S.applications[cur.id]||{};
      if(appEl.value.trim())S.applications[cur.id]={...old,text:appEl.value,updatedAt:new Date().toISOString()};else delete S.applications[cur.id];
      save();appStatus.textContent=(S.applications[cur.id]?.completedAt&&len>=40)?"Applied evidence recorded / 応用Evidence記録済み":"Draft saved / 下書き保存済み";
    },350);
  };
  completeApp.onclick=()=>{
    const text=appEl.value.trim();if(text.length<40){show("Write at least 40 characters first / 40文字以上入力してください");return}
    S.applications[cur.id]={text:appEl.value,updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
    save();renderLearn();show("Applied practice recorded / 応用練習を記録しました");
  };

  document.getElementById("checkpoint").onclick=()=>{
    activeQuiz=cur.quizId;answered=false;quizSession=null;singleQuizReturnLesson=true;setView("quiz");
  };
  if(prev)document.getElementById("prev").onclick=()=>openLessonId(prev.id);
  if(next)document.getElementById("next").onclick=()=>{markComplete(cur.id,true);openLessonId(next.id)};
}

function applyTocFilter(){
  const needle=norm(S.ui.learnSearch),bookmarksOnly=S.ui.bookmarksOnly;
  let visible=0;
  document.querySelectorAll("[data-chapter-wrap]").forEach(ch=>{
    const chapterId=ch.dataset.chapterWrap;
    const c=CHAPTER_BY_ID.get(chapterId);
    const chapterMatch=needle&&norm(`${c.titleEn} ${c.titleJa}`).includes(needle);
    let any=false;
    ch.querySelectorAll("[data-lesson]").forEach(btn=>{
      const id=btn.dataset.lesson;
      const searchMatch=!needle||chapterMatch||(LESSON_SEARCH_INDEX.get(id)||"").includes(needle);
      const bookmarkMatch=!bookmarksOnly||S.bookmarks.includes(id);
      const ok=searchMatch&&bookmarkMatch;
      btn.hidden=!ok;
      if(ok){visible++;any=true}
    });
    ch.hidden=!any;
    ch.classList.toggle("search-open",Boolean((needle||bookmarksOnly)&&any));
  });
  const match=document.getElementById("tocMatch");
  if(match)match.textContent=(S.ui.learnSearch||S.ui.bookmarksOnly)?`${visible} match${visible===1?"":"es"} / ${visible}件`:"";
  const empty=document.getElementById("tocEmpty");
  if(empty)empty.hidden=visible!==0;
}

function openLessonId(id){
  if(!LESSON_BY_ID.has(id))return;
  S.lesson=id;
  recordRecentLesson(id);
  const cid=CHAPTER_BY_LESSON.get(id);
  const set=new Set(Array.isArray(S.ui.tocOpen)?S.ui.tocOpen:[]);
  if(cid)set.add(cid);
  S.ui.tocOpen=[...set];
  save();setView("learn");
  window.scrollTo({top:0,behavior:"smooth"});
}

function openTermId(id){
  if(!TERM_BY_ID.has(id))return;
  S.termFocus=id;S.ui.glossaryMode="glossary";save();setView("glossary");
  window.scrollTo({top:0,behavior:"smooth"});
}

/* ---------- Quiz ---------- */
function quizIdsForConcepts(concepts){
  const set=new Set(concepts);
  return D.quizzes.filter(q=>set.has(q.concept)).map(q=>q.id);
}
function reviewQueue(){
  const concepts=adaptiveReviewConcepts(10),queue=quizIdsForConcepts(concepts).slice(0,10);
  return queue.length?queue:[lesson(S.lesson).quizId];
}
function missedQueue(){
  const latest=new Map();
  S.quizHistory.filter(x=>x&&QUIZ_BY_ID.has(x.quizId)&&!x.assessment).forEach(x=>latest.set(x.quizId,x));
  return [...latest.entries()].filter(([,x])=>!x.correct).map(([id])=>id);
}
function currentChapterQuizIds(){
  const c=currentChapter();
  return c.lessons.map(l=>l.quizId).filter(id=>QUIZ_BY_ID.has(id));
}
function chapterQuizIds(chapterId){
  const c=CHAPTER_BY_ID.get(chapterId);
  return c?c.lessons.map(l=>l.quizId).filter(id=>QUIZ_BY_ID.has(id)):[];
}
function balancedTrackAssessmentIds(){
  const perChapter=D.track.chapters.flatMap(c=>shuffle(chapterQuizIds(c.id)).slice(0,2));
  if(perChapter.length>=20)return perChapter.slice(0,20);
  const used=new Set(perChapter),rest=shuffle(D.quizzes.map(q=>q.id).filter(id=>!used.has(id)));
  return [...perChapter,...rest].slice(0,20);
}
function startQuizSession(mode,ids,titleEn,titleJa,opts={}){
  const baseQueue=uniq(ids.filter(id=>QUIZ_BY_ID.has(id)));
  if(!baseQueue.length){show("No questions available / 問題がありません");return}
  if(opts.assessment&&S.activeAssessment){
    if(!confirm("A paused assessment already exists. Replace it with a new assessment?\n\n中断中の確認テストがあります。新しい確認テストに置き換えますか？"))return;
    S.activeAssessment=null;
  }
  quizSession={
    id:`qs-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    mode,titleEn,titleJa,baseQueue:[...baseQueue],queue:[...baseQueue],index:0,correct:0,answers:[],retryAdded:[],startedAt:new Date().toISOString(),done:false,
    assessment:Boolean(opts.assessment),deferFeedback:Boolean(opts.deferFeedback),allowRetry:opts.allowRetry!==false,chapterId:opts.chapterId||null
  };
  activeQuiz=quizSession.queue[0];answered=false;singleQuizReturnLesson=false;lastAnswerUndo=null;
  if(quizSession.assessment)S.activeAssessment=clone(quizSession);
  setView("quiz");
}
function startSmartReview(){startQuizSession("review",reviewQueue(),"Adaptive Smart Review","適応型スマート復習")}
function startChapterAssessment(chapterId){
  const c=CHAPTER_BY_ID.get(chapterId)||currentChapter(),ids=shuffle(chapterQuizIds(c.id)).slice(0,Math.min(10,c.lessons.length));
  startQuizSession("chapter-assessment",ids,`Chapter Assessment: ${c.titleEn}`,`章末確認：${c.titleJa}`,{assessment:true,deferFeedback:true,allowRetry:false,chapterId:c.id});
}
function startTrackAssessment(){
  startQuizSession("track-assessment",balancedTrackAssessmentIds(),"Track Assessment: Fusion / Corporate Planning Preparation","総合確認：Fusion / 経営企画 Preparation",{assessment:true,deferFeedback:true,allowRetry:false});
}
function finishQuizSession(){
  if(!quizSession||quizSession.done)return;
  quizSession.done=true;activeQuiz=null;
  if(quizSession.assessment)S.activeAssessment=null;
  const lastResult=new Map();quizSession.answers.forEach(a=>lastResult.set(a.quizId,a.correct));
  const originalAnswers=quizSession.baseQueue.map(id=>quizSession.answers.find(a=>a.quizId===id)).filter(Boolean);
  const assessmentCorrect=originalAnswers.filter(a=>a.correct).length;
  const summary={
    id:quizSession.id,mode:quizSession.mode,titleEn:quizSession.titleEn,titleJa:quizSession.titleJa,
    total:quizSession.assessment?quizSession.baseQueue.length:quizSession.answers.length,
    correct:quizSession.assessment?assessmentCorrect:quizSession.answers.filter(a=>a.correct).length,
    wrongQuizIds:[...lastResult.entries()].filter(([,ok])=>!ok).map(([id])=>id),
    chapterId:quizSession.chapterId||null,assessment:quizSession.assessment,
    answers:quizSession.assessment?originalAnswers.map(a=>({quizId:a.quizId,selectedId:a.selectedId,correct:a.correct})):undefined,
    completedAt:new Date().toISOString()
  };
  S.sessions.push(summary);S.sessions=S.sessions.slice(-30);
  if(quizSession.assessment){S.assessments.push(summary);S.assessments=S.assessments.slice(-50)}
  save();
}
function nextQuestion(){
  lastAnswerUndo=null;
  if(quizSession){
    quizSession.index++;
    if(quizSession.index>=quizSession.queue.length){finishQuizSession();renderQuiz();return}
    if(quizSession.assessment)S.activeAssessment=clone(quizSession);
    activeQuiz=quizSession.queue[quizSession.index];answered=false;save();renderQuiz();window.scrollTo({top:0,behavior:"smooth"});return;
  }
  activeQuiz=null;answered=false;
  if(singleQuizReturnLesson){singleQuizReturnLesson=false;setView("learn")}else renderQuiz();
}
function renderQuiz(){
  if(quizSession&&quizSession.done)return renderQuizSummary();
  if(activeQuiz)return renderQuizQuestion();
  renderQuizHub();
}
function renderQuizHub(){
  const dueCount=due().length,weakCount=weakConcepts().length,missed=missedQueue().length,c=currentChapter();
  const latestAssessment=[...S.assessments].reverse()[0],paused=S.activeAssessment;
  app.innerHTML=`
  ${paused?`<section class="paper quiz-hub assessment-hub paused-assessment"><div class="section-head"><h2>Paused Assessment / 中断中の確認テスト</h2><p>Continue from the next unanswered question, or discard the incomplete attempt. / 次の未回答問題から再開するか、未完了テストを破棄できます。</p></div><div class="latest-assessment"><strong>${esc(paused.titleEn)} / ${esc(paused.titleJa)}</strong><span>${Math.min(paused.index+1,paused.queue.length)} / ${paused.queue.length}</span></div><div class="btn-row"><button class="primary" id="resumeAssessment">Resume / 再開</button><button class="secondary" id="abandonAssessment">Abandon / 破棄</button></div></section>`:""}
  <section class="paper quiz-hub">
    <div class="section-head"><h2>Practice / 練習</h2><p>Immediate explanations. Short sessions selected by review need. / すぐに解説。復習必要度に基づく短いセッション。</p></div>
    <div class="quiz-mode-grid">
      <button class="quiz-mode primary-mode" id="smartReview"><strong>Adaptive Smart Review / 適応型スマート復習</strong><span>${dueCount} due · ${weakCount} weak / 復習${dueCount}・弱点${weakCount}</span><small>Ranks overdue, recent mistakes, weak retention and low mastery. Up to 10 initial questions. / 期限超過・直近ミス・弱い定着・低習熟を優先。初期最大10問。</small></button>
      <button class="quiz-mode" id="chapterQuiz"><strong>Current Chapter Practice / 現在章の練習</strong><span>${esc(c.titleEn)} / ${esc(c.titleJa)}</span><small>Up to 10 random checkpoints with immediate feedback. / この章から最大10問・即時解説。</small></button>
      <button class="quiz-mode" id="missedQuiz" ${missed?"":"disabled"}><strong>Retry Missed / 間違い直し</strong><span>${missed} question(s) available / ${missed}問</span><small>Questions with prior mistakes. / 過去に間違えた問題。</small></button>
      <button class="quiz-mode" id="randomQuiz"><strong>Random 10 / ランダム10問</strong><span>Across the full track / トラック全体</span><small>Broad retrieval practice. / 広範囲の想起練習。</small></button>
    </div>
    <div class="keyboard-note"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> answer · <kbd>Enter</kbd> next</div>
  </section>

  <section class="paper quiz-hub assessment-hub">
    <div class="section-head"><h2>Assessments / 確認テスト</h2><p>No answer feedback until the end. These are cleaner measures of recall than practice mode. / 終了まで正解を表示しません。Practiceより想起力を測りやすい形式です。</p></div>
    <div class="assessment-controls">
      <label><span>Chapter Assessment / 章末確認</span><select id="assessmentChapter">${D.track.chapters.map((x,i)=>`<option value="${esc(x.id)}" ${x.id===c.id?"selected":""}>${i+1}. ${esc(x.titleEn)} / ${esc(x.titleJa)}</option>`).join("")}</select></label>
      <button class="primary" id="startChapterAssessment">Start 10-question assessment / 10問確認を開始</button>
      <button class="secondary" id="trackAssessment">Track Assessment / 総合確認（20問）</button>
    </div>
    ${latestAssessment?`<div class="latest-assessment"><small>Latest assessment / 最新確認</small><strong>${esc(latestAssessment.titleEn)} / ${esc(latestAssessment.titleJa)}</strong><span>${latestAssessment.correct}/${latestAssessment.total} · ${Math.round(latestAssessment.correct/Math.max(1,latestAssessment.total)*100)}% · ${dateLabel(latestAssessment.completedAt)}</span></div>`:""}
  </section>`;
  if(document.getElementById("resumeAssessment"))document.getElementById("resumeAssessment").onclick=resumeAssessment;
  if(document.getElementById("abandonAssessment"))document.getElementById("abandonAssessment").onclick=abandonAssessment;
  document.getElementById("smartReview").onclick=startSmartReview;
  document.getElementById("chapterQuiz").onclick=()=>startQuizSession("chapter",shuffle(currentChapterQuizIds()).slice(0,10),`Chapter Practice: ${c.titleEn}`,`章練習：${c.titleJa}`);
  if(missed)document.getElementById("missedQuiz").onclick=()=>startQuizSession("missed",shuffle(missedQueue()).slice(0,10),"Retry Missed","間違い直し");
  document.getElementById("randomQuiz").onclick=()=>startQuizSession("random",shuffle(D.quizzes.map(q=>q.id)).slice(0,10),"Random 10","ランダム10問");
  document.getElementById("startChapterAssessment").onclick=()=>startChapterAssessment(document.getElementById("assessmentChapter").value);
  document.getElementById("trackAssessment").onclick=startTrackAssessment;
}
function renderQuizQuestion(){
  const q=quiz(activeQuiz);if(!q){activeQuiz=null;return renderQuiz()}
  const g=term(q.concept),m=mastery(q.concept),assessment=Boolean(quizSession?.assessment),renderedOptions=shuffle(q.options);
  const progress=quizSession?`${quizSession.index+1} / ${quizSession.queue.length}`:"Checkpoint / チェック";
  app.innerHTML=`
  <section class="paper quiz ${assessment?"assessment-mode":""}">
    <div class="quiz-meta"><span>${esc(g?.en||q.concept)} / ${esc(g?.ja||"")}</span><span>${progress} · ${m.en} / ${m.ja}</span></div>
    ${quizSession?`<div class="session-label">${esc(quizSession.titleEn)} / ${esc(quizSession.titleJa)}${assessment?" · Assessment / 確認テスト":""}</div>`:""}
    <div class="question">${esc(q.qEn)}<span class="jp">${esc(q.qJa)}</span></div>
    <div class="answers">${renderedOptions.map((o,i)=>`<button class="answer" data-opt="${esc(o.id)}"><strong>${i+1}.</strong> ${esc(o.en)}<br><span class="small">${esc(o.ja)}</span></button>`).join("")}</div>
    <div id="feedback"></div>
    <div class="btn-row">
      <button class="secondary misclick-btn" id="undoMisclick" style="display:none">Misclick — undo / 誤操作を取り消す</button>
      <button class="secondary" id="nextQ" style="display:none">${quizSession?"Next question / 次の問題":"Finish / 終了"}</button>
      <button class="text-btn" id="backQuizHub">${assessment?"Pause assessment / 確認テストを中断":"Quiz menu / クイズメニュー"}</button>
      ${singleQuizReturnLesson?`<button class="text-btn" id="backLesson">Back to lesson / レッスンに戻る</button>`:""}
    </div>
    <div class="misclick-note" id="misclickNote" style="display:none">Use only for an accidental tap. The answer is removed completely and does not affect accuracy, mastery, review timing, or completion. / 誤タップ時のみ使用してください。回答は完全に取り消され、正答率・習熟度・復習時期・完了判定には影響しません。</div>
    <div class="keyboard-note"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> answer · <kbd>Enter</kbd> next${assessment?" · feedback at end / 解説は終了後":""}</div>
  </section>`;
  document.querySelectorAll("[data-opt]").forEach(b=>b.onclick=()=>answer(q,b.dataset.opt));
  document.getElementById("nextQ").onclick=nextQuestion;
  document.getElementById("undoMisclick").onclick=undoMisclick;
  document.getElementById("backQuizHub").onclick=openQuizHub;
  if(document.getElementById("backLesson"))document.getElementById("backLesson").onclick=()=>{activeQuiz=null;answered=false;quizSession=null;singleQuizReturnLesson=false;lastAnswerUndo=null;setView("learn")};
}
function undoMisclick(){
  if(!answered||!lastAnswerUndo||lastAnswerUndo.quizId!==activeQuiz)return;
  const snap=lastAnswerUndo;
  lastAnswerUndo=null;
  S=normalizeState(snap.state);
  quizSession=snap.quizSession?clone(snap.quizSession):null;
  activeQuiz=snap.activeQuiz;
  singleQuizReturnLesson=snap.singleQuizReturnLesson;
  answered=false;
  save();
  renderQuiz();
  show("Misclick removed — answer not counted / 誤操作を取り消しました。回答にはカウントされません");
}
function answer(q,id){
  if(answered)return;
  const chosen=q.options.find(o=>o.id===id);if(!chosen)return;
  lastAnswerUndo={
    quizId:q.id,
    state:clone(S),
    quizSession:quizSession?clone(quizSession):null,
    activeQuiz,
    singleQuizReturnLesson
  };
  answered=true;
  const assessment=Boolean(quizSession?.assessment);
  document.querySelectorAll("[data-opt]").forEach(b=>{
    const o=q.options.find(x=>x.id===b.dataset.opt);b.disabled=true;
    if(assessment){if(b.dataset.opt===id)b.classList.add("recorded");return}
    if(o.correct)b.classList.add("correct");
    if(b.dataset.opt===id&&!o.correct)b.classList.add("incorrect");
  });

  if(!assessment){
    const a=S.attempts[q.id]||{total:0,correct:0,lastCorrect:null,lastAt:null};
    a.total++;if(chosen.correct)a.correct++;a.lastCorrect=Boolean(chosen.correct);a.lastAt=new Date().toISOString();S.attempts[q.id]=a;

    const now=new Date(),r=S.mastery[q.concept]||{score:0,total:0,correct:0,next:null,correctDates:[]};
    if(!Array.isArray(r.correctDates))r.correctDates=[];r.total=(r.total||0)+1;
    if(chosen.correct){r.correct=(r.correct||0)+1;r.score=Math.min(7,(r.score||0)+1);if(!r.correctDates.includes(todayKey()))r.correctDates.push(todayKey())}
    else r.score=Math.max(0,(r.score||0)-1);
    const days=!chosen.correct?1:r.score<2?1:r.score<4?3:r.score<6?7:21,n=new Date(now);n.setDate(n.getDate()+days);r.next=n.toISOString();S.mastery[q.concept]=r;
  }

  const priorPresentation=S.quizHistory.some(x=>x.quizId===q.id&&!x.assessment);
  const firstPresentation=!assessment&&!priorPresentation;
  const hist={quizId:q.id,concept:q.concept,selectedId:id,correct:Boolean(chosen.correct),at:new Date().toISOString(),mode:quizSession?.mode||"checkpoint",sessionId:quizSession?.id||null,firstPresentation,assessment};
  S.quizHistory.push(hist);S.quizHistory=S.quizHistory.slice(-2000);

  if(quizSession){
    if(chosen.correct)quizSession.correct++;
    quizSession.answers.push({quizId:q.id,concept:q.concept,selectedId:id,correct:Boolean(chosen.correct)});
    if(!assessment&&quizSession.allowRetry&&!chosen.correct&&!quizSession.retryAdded.includes(q.id)){quizSession.retryAdded.push(q.id);quizSession.queue.push(q.id)}
    if(assessment){const draft=clone(quizSession);draft.index=Math.min(draft.queue.length,draft.index+1);S.activeAssessment=draft}
  }
  save();

  if(assessment){
    document.getElementById("feedback").innerHTML=`<div class="feedback neutral"><strong>Answer recorded / 回答を記録しました</strong><br>Correct answer and explanation will appear after the assessment. / 正解と解説はテスト終了後に表示します。</div>`;
  }else{
    document.getElementById("feedback").innerHTML=`<div class="feedback ${chosen.correct?"good":"bad"}"><strong>${chosen.correct?"Correct / 正解":"Not quite / もう一度確認"}</strong><br>${esc(chosen.whyEn)}<br>${esc(chosen.whyJa)}${mastery(q.concept).en==="Strong"&&!mastery(q.concept).applied?`<div class="small feedback-note">To reach Mastered, add applied practice in the linked lesson and build correct evidence across multiple days. / Masteredには関連レッスンの応用練習と複数日にわたる正答Evidenceが必要です。</div>`:""}</div>`;
  }
  document.getElementById("undoMisclick").style.display="inline-block";
  document.getElementById("misclickNote").style.display="block";
  document.getElementById("nextQ").style.display="inline-block";
}
function assessmentBand(p){if(p>=85)return["Strong","強い"];if(p>=70)return["Developing","発展中"];if(p>=55)return["Needs targeted review","重点復習"];return["Rebuild foundation","基礎を再構築"]}
function renderQuizSummary(){
  const s=quizSession,lastResult=new Map();s.answers.forEach(a=>lastResult.set(a.quizId,a.correct));
  const wrong=[...lastResult.entries()].filter(([,ok])=>!ok).map(([id])=>id),total=s.assessment?s.baseQueue.length:s.answers.length,correct=s.assessment?s.baseQueue.map(id=>s.answers.find(a=>a.quizId===id)).filter(a=>a?.correct).length:s.answers.filter(a=>a.correct).length;
  const accuracy=total?Math.round(correct/total*100):0,band=assessmentBand(accuracy),practiceTarget=ALL_LESSONS.find(l=>l.quizId===wrong[0])||null;
  const details=s.assessment?s.baseQueue.map(id=>{
    const q=quiz(id),a=s.answers.find(x=>x.quizId===id),chosen=q?.options.find(o=>o.id===a?.selectedId),right=q?.options.find(o=>o.correct);
    return `<div class="assessment-review-item ${a?.correct?"ok":"miss"}"><div class="assessment-review-head"><strong>${a?.correct?"✓":"×"} ${esc(q?.qEn||id)}</strong><span>${a?.correct?"Correct / 正解":"Review / 要復習"}</span></div><div class="small">${esc(q?.qJa||"")}</div><p><b>Your answer / あなたの回答:</b> ${esc(chosen?.en||"—")} / ${esc(chosen?.ja||"")}</p>${!a?.correct?`<p><b>Correct / 正解:</b> ${esc(right?.en||"")} / ${esc(right?.ja||"")}</p>`:""}<p>${esc((a?.correct?chosen:right)?.whyEn||"")}<br>${esc((a?.correct?chosen:right)?.whyJa||"")}</p></div>`;
  }).join(""):"";
  app.innerHTML=`
  <section class="paper quiz summary-card ${s.assessment?"assessment-summary":""}">
    <div class="eyebrow">${s.assessment?"Assessment complete / 確認テスト完了":"Session complete / セッション完了"}</div>
    <h2>${esc(s.titleEn)} / ${esc(s.titleJa)}</h2>
    <div class="summary-score">${correct}<span>/ ${total}</span></div>
    <p>${accuracy}% accuracy / 正答率 ${accuracy}%${s.assessment?` · <strong>${band[0]} / ${band[1]}</strong>`:""}</p>
    ${s.assessment?`<p class="small">Assessment scores measure recall on the sampled questions—not full job readiness. / このScoreはSampled Questionの想起力であり職務能力そのものではありません。</p><div class="assessment-review">${details}</div>${practiceTarget?`<div class="assessment-application-next"><strong>Recommended application / 次の応用練習</strong><span>${esc(practiceTarget.titleEn)} / ${esc(practiceTarget.titleJa)}</span><button class="text-btn" id="assessmentApplyLesson">Open lesson and apply / Lessonで応用する →</button></div>`:""}`:""}
    <div class="btn-row">
      ${!s.assessment&&wrong.length?`<button class="primary" id="retrySessionWrong">Retry ${wrong.length} missed / ${wrong.length}問やり直す</button>`:""}
      ${s.assessment&&wrong.length?`<button class="primary" id="practiceAssessmentMisses">Practice ${wrong.length} missed / 間違い${wrong.length}問を練習</button>`:""}
      <button class="secondary" id="anotherReview">Smart Review / スマート復習</button>
      <button class="secondary" id="quizHome">Quiz menu / クイズメニュー</button>
    </div>
  </section>`;
  if(document.getElementById("retrySessionWrong"))document.getElementById("retrySessionWrong").onclick=()=>startQuizSession("retry-session",wrong,"Retry This Session","このセッションの間違い直し");
  if(document.getElementById("practiceAssessmentMisses"))document.getElementById("practiceAssessmentMisses").onclick=()=>startQuizSession("assessment-misses",wrong,"Assessment Follow-up","確認テストの復習");
  if(document.getElementById("assessmentApplyLesson"))document.getElementById("assessmentApplyLesson").onclick=()=>openLessonId(practiceTarget.id);
  document.getElementById("anotherReview").onclick=startSmartReview;
  document.getElementById("quizHome").onclick=openQuizHub;
}

/* ---------- Glossary / Reference ---------- */
const FRAMEWORK_GROUPS=[
  {en:"Financial Decision Tools",ja:"財務意思決定",ids:["unit-economics","break-even","roic","cac","ltv","payback-period","scenario-analysis","sensitivity-analysis","reverse-stress-test"]},
  {en:"Diagnosis & Evidence",ja:"診断・エビデンス",ids:["issue-tree","mece","root-cause","value-at-stake","evidence-priority","evidence-confidence"]},
  {en:"Strategy & Experiments",ja:"戦略・実験",ids:["wmbt","counterfactual","minimum-viable-commitment","time-to-evidence","value-of-information","decision-gate"]},
  {en:"Management Decisions",ja:"経営意思決定",ids:["decision-map","decision-question","decision-right","decision-date","decision-log","management-decision","decision-ask"]},
  {en:"Execution & Governance",ja:"実行・ガバナンス",ids:["30-90-180","raid-log","responsibility-matrix","weekly-operating-review","management-feedback-loop","portfolio-management","portfolio-disposition","terminal-state","transition-mechanism"]}
];
function usedLessonsForTerm(id,limit=8){return ALL_LESSONS.filter(l=>l.glossary.includes(id)).slice(0,limit)}
function glossaryTabs(){return `<div class="reference-tabs">${[["glossary","Glossary / 用語集"],["formulas","Formulas / 計算式"],["frameworks","Frameworks / フレームワーク"]].map(([id,label])=>`<button class="filter-btn ${S.ui.glossaryMode===id?"active":""}" data-glossary-mode="${id}">${label}</button>`).join("")}</div>`}
function renderGlossary(){
  const focus=S.termFocus?term(S.termFocus):null;
  if(focus)S.ui.glossaryMode="glossary";
  const initial=focus?focus.en:"";glossaryLimit=focus?20:60;
  app.innerHTML=`<section class="paper glossary-shell">
    <div class="section-head"><h2>Glossary & Reference / 用語集・参照</h2><p>Fast lookup for terms, formulas and management frameworks. / 用語・計算式・経営Frameworkをすぐ確認。</p></div>
    ${glossaryTabs()}
    <div id="referenceBody"></div>
  </section>`;
  document.querySelectorAll("[data-glossary-mode]").forEach(b=>b.onclick=()=>{S.ui.glossaryMode=b.dataset.glossaryMode;S.termFocus=null;save();renderGlossary()});
  if(S.ui.glossaryMode==="formulas")renderFormulaReference();
  else if(S.ui.glossaryMode==="frameworks")renderFrameworkReference();
  else renderGlossarySearch(initial);
  S.termFocus=null;save();
}
function renderGlossarySearch(initial=""){
  const body=document.getElementById("referenceBody");
  body.innerHTML=`<div class="search-row"><input class="search" id="search" type="search" placeholder="Search ROIC, ロイック, 投下資本利益率..." value="${esc(initial)}"><button class="secondary" id="clear">Clear / クリア</button><button class="secondary" id="savedTermsOnly">★ Saved ${S.savedTerms.length} / 保存</button></div><div class="glossary-count" id="glossaryCount"></div><div class="glossary-list" id="results"></div>`;
  const input=document.getElementById("search");
  input.oninput=()=>{glossaryLimit=60;renderTerms(input.value,false)};
  document.getElementById("clear").onclick=()=>{input.value="";glossaryLimit=60;renderTerms("",false);input.focus()};
  document.getElementById("savedTermsOnly").onclick=()=>{input.value="";glossaryLimit=200;renderTerms("",true)};
  renderTerms(input.value,false);
}
function renderTerms(q,savedOnly=false){
  const root=document.getElementById("results"),needle=norm(q);
  const items=D.glossary.filter(g=>(!savedOnly||S.savedTerms.includes(g.id))&&(!needle||(TERM_SEARCH_INDEX.get(g.id)||"").includes(needle)));
  const shown=items.slice(0,glossaryLimit);
  document.getElementById("glossaryCount").textContent=`Showing ${shown.length} of ${items.length} / ${items.length}件中${shown.length}件${savedOnly?" · Saved only / 保存のみ":""}`;
  root.innerHTML=shown.length?shown.map(g=>{
    const used=usedLessonsForTerm(g.id,6);
    return `<article class="paper glossary-entry">
      <div class="glossary-entry-head"><h3>${esc(g.en)} / ${esc(g.ja)}</h3><button class="mini-btn ${S.savedTerms.includes(g.id)?"active":""}" data-save-term="${esc(g.id)}">${S.savedTerms.includes(g.id)?"★ Saved":"☆ Save"}</button></div>
      <div class="aliases">Common usage / よく使う表現: ${esc(g.aliases.join(" · "))}</div>
      <div class="g-row"><strong>Definition / 定義</strong><div>${esc(g.defEn)}</div><div class="small">${esc(g.defJa)}</div></div>
      ${g.formula?`<div class="g-row formula-row"><strong>Formula / 計算式</strong><div>${esc(g.formula)}</div></div>`:""}
      <div class="g-row"><strong>Why it matters / なぜ重要か</strong><div>${esc(g.whyEn)}</div><div class="small">${esc(g.whyJa)}</div></div>
      <div class="g-row"><strong>UOH / Fusion Application / UOH・Fusionへの応用</strong><div>${esc(g.appEn)}</div><div class="small">${esc(g.appJa)}</div></div>
      ${g.related.length?`<div class="g-row"><strong>Related terms / 関連用語</strong><div class="chips">${g.related.map(id=>{const x=term(id);return x?`<button class="chip" data-related-term="${esc(id)}">${esc(x.en)} / ${esc(x.ja)}</button>`:""}).join("")}</div></div>`:""}
      ${used.length?`<div class="g-row"><strong>Used in lessons / 関連レッスン</strong><div class="lesson-use-list">${used.map(l=>`<button class="text-btn glossary-lesson-link" data-glossary-lesson="${esc(l.id)}">${esc(l.titleEn)} / ${esc(l.titleJa)} →</button>`).join("")}</div></div>`:""}
    </article>`;
  }).join(""):`<div class="empty">No matching term / 該当する用語がありません。</div>`;
  if(items.length>shown.length)root.insertAdjacentHTML("beforeend",`<div class="load-more"><button class="secondary" id="loadMoreTerms">Show 60 more / さらに60件</button></div>`);
  bindReferenceLinks();
  if(document.getElementById("loadMoreTerms"))document.getElementById("loadMoreTerms").onclick=()=>{glossaryLimit+=60;renderTerms(document.getElementById("search")?.value||"",savedOnly)};
}
function renderFormulaReference(){
  const body=document.getElementById("referenceBody"),all=D.glossary.filter(g=>g.formula);
  body.innerHTML=`<div class="search-row"><input class="search" id="formulaSearch" type="search" placeholder="Search formulas / 計算式を検索"><span class="reference-count">${all.length} formulas / ${all.length}計算式</span></div><div class="formula-grid" id="formulaGrid"></div>`;
  const input=document.getElementById("formulaSearch");
  const draw=()=>{
    const n=norm(input.value),items=all.filter(g=>!n||(TERM_SEARCH_INDEX.get(g.id)||"").includes(n)||norm(g.formula).includes(n));
    document.getElementById("formulaGrid").innerHTML=items.map(g=>`<article class="reference-card"><div class="reference-card-head"><strong>${esc(g.en)} / ${esc(g.ja)}</strong><button class="mini-btn ${S.savedTerms.includes(g.id)?"active":""}" data-save-term="${esc(g.id)}">${S.savedTerms.includes(g.id)?"★":"☆"}</button></div><code class="formula-display">${esc(g.formula)}</code><p>${esc(g.defEn)}<br><span class="small">${esc(g.defJa)}</span></p><div class="btn-row tight"><button class="text-btn" data-open-term="${esc(g.id)}">Open glossary / 用語を開く →</button>${usedLessonsForTerm(g.id,1).map(l=>`<button class="text-btn" data-glossary-lesson="${esc(l.id)}">Lesson / レッスン →</button>`).join("")}</div></article>`).join("")||`<div class="empty">No matching formula / 該当計算式なし</div>`;
    bindReferenceLinks();
  };
  input.oninput=draw;draw();
}
function renderFrameworkReference(){
  const body=document.getElementById("referenceBody");
  body.innerHTML=`<div class="framework-groups">${FRAMEWORK_GROUPS.map(group=>{
    const items=group.ids.map(term).filter(Boolean);
    return `<section class="framework-group"><div class="section-head"><h3>${esc(group.en)} / ${esc(group.ja)}</h3></div><div class="framework-grid">${items.map(g=>`<article class="reference-card framework-card"><div class="reference-card-head"><strong>${esc(g.en)} / ${esc(g.ja)}</strong><button class="mini-btn ${S.savedTerms.includes(g.id)?"active":""}" data-save-term="${esc(g.id)}">${S.savedTerms.includes(g.id)?"★":"☆"}</button></div><p>${esc(g.defEn)}<br><span class="small">${esc(g.defJa)}</span></p><p class="why-line"><b>Why / なぜ:</b> ${esc(g.whyEn)}<br><span class="small">${esc(g.whyJa)}</span></p><div class="btn-row tight"><button class="text-btn" data-open-term="${esc(g.id)}">Glossary / 用語 →</button>${usedLessonsForTerm(g.id,1).map(l=>`<button class="text-btn" data-glossary-lesson="${esc(l.id)}">Lesson / レッスン →</button>`).join("")}</div></article>`).join("")}</div></section>`;
  }).join("")}</div>`;
  bindReferenceLinks();
}
function bindReferenceLinks(){
  document.querySelectorAll("[data-save-term]").forEach(b=>b.onclick=()=>{toggleSavedTerm(b.dataset.saveTerm);renderGlossary()});
  document.querySelectorAll("[data-related-term],[data-open-term]").forEach(b=>b.onclick=()=>openTermId(b.dataset.relatedTerm||b.dataset.openTerm));
  document.querySelectorAll("[data-glossary-lesson]").forEach(b=>b.onclick=()=>openLessonId(b.dataset.glossaryLesson));
}

/* ---------- Progress ---------- */
function chapterStats(c){
  const r=chapterLearningReadiness(c),latest=[...S.assessments].reverse().find(x=>x.chapterId===c.id);
  return{...r,latestAssessment:latest||null};
}
function progressTabs(){return `<div class="progress-tabs">${[["overview","Overview / 概要"],["mastery","Mastery / 習熟"],["library","My Library / 自分の記録"],["data","Data & Settings / 保存・設定"]].map(([id,label])=>`<button class="filter-btn ${S.ui.progressTab===id?"active":""}" data-progress-tab="${id}">${label}</button>`).join("")}</div>`}
function renderProgress(){
  app.innerHTML=`<section class="paper progress-shell"><div class="section-head"><h2>Progress / 進捗</h2><p>Learning readiness, mastery, personal library, and local data controls. / 学習準備度・習熟・自分の記録・ローカル保存管理。</p></div>${progressTabs()}<div id="progressBody"></div></section>`;
  document.querySelectorAll("[data-progress-tab]").forEach(b=>b.onclick=()=>{S.ui.progressTab=b.dataset.progressTab;save();renderProgress()});
  if(S.ui.progressTab==="mastery")renderProgressMastery();
  else if(S.ui.progressTab==="library")renderProgressLibrary();
  else if(S.ui.progressTab==="data")renderProgressData();
  else renderProgressOverview();
}
function renderProgressOverview(){
  const body=document.getElementById("progressBody"),st=stats(),r=trackReadiness(),label=readinessLabel(r.score),gaps=knowledgeGaps(5);
  const chapterCards=D.track.chapters.map((c,i)=>{
    const cs=chapterStats(c),a=cs.latestAssessment,ass=a?Math.round(a.correct/Math.max(1,a.total)*100):null;
    return `<button class="chapter-progress-card readiness-chapter" data-progress-chapter="${esc(c.id)}"><div><small>Chapter ${i+1}</small><strong>${esc(c.titleEn)}</strong><span>${esc(c.titleJa)}</span></div><div class="readiness-line"><b>${cs.score}%</b><span>learning readiness / 学習準備度</span></div><div class="progress-track thin"><div class="progress-fill" style="width:${cs.score}%"></div></div><div class="chapter-progress-meta"><span>Coverage ${cs.coverage}% · Recall ${cs.recall}%</span><span>${ass===null?"No assessment":`Assessment ${ass}%`}</span></div></button>`;
  }).join("");
  const recentAssess=[...S.assessments].reverse().slice(0,6);
  body.innerHTML=`
    <div class="metrics progress-top-metrics"><div class="metric readiness-metric"><small>Learning Readiness / 学習準備度</small><strong>${r.score}%</strong><span>${label[0]} / ${label[1]}</span></div><div class="metric"><small>Completion / 完了</small><strong>${pct()}%</strong></div><div class="metric"><small>First-attempt accuracy / 初回正答率</small><strong>${st.firstAccuracy}%</strong></div><div class="metric"><small>Recent accuracy / 直近正答率</small><strong>${st.recentAccuracy}%</strong></div></div>
    <div class="readiness-explainer"><div><strong>How this score works / Scoreの構成</strong><span>Coverage 25% · Recall 30% · Mastery 30% · Application 15%. It is a learning-management indicator, not a promise of workplace performance. / 学習管理用の内部指標で職務能力の保証ではありません。</span></div><div class="readiness-components">${[["Coverage / 範囲",r.coverage],["Recall / 想起",r.recall],["Mastery / 習熟",r.mastery],["Application / 応用",r.application]].map(([n,v])=>`<div><span>${n}</span><div class="progress-track thin"><div class="progress-fill" style="width:${v}%"></div></div><b>${v}%</b></div>`).join("")}</div></div>
    <section class="progress-section inset"><div class="section-head"><h3>Chapter Readiness / 章別準備度</h3><p>Click a chapter to continue its next incomplete lesson. / Chapterを押して次の未完了Lessonへ。</p></div><div class="chapter-progress-grid">${chapterCards}</div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Knowledge Gaps / 強化候補</h3><p>Lowest chapter scores, with the component that is most limiting. / Scoreが低いChapterと主な弱点。</p></div><div class="gap-list">${gaps.map(x=>{const parts=[["Coverage",x.coverage],["Recall",x.recall],["Mastery",x.mastery],["Application",x.application]].sort((a,b)=>a[1]-b[1]);return `<button class="gap-row" data-gap-chapter="${esc(x.c.id)}"><span><strong>${esc(x.c.titleEn)} / ${esc(x.c.titleJa)}</strong><small>Primary gap / 主な弱点: ${parts[0][0]} ${parts[0][1]}%</small></span><b>${x.score}%</b></button>`}).join("")}</div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Assessment History / 確認テスト履歴</h3><p>Deferred-feedback assessments only. / 終了後解説のAssessmentのみ。</p></div>${recentAssess.length?`<div class="assessment-history">${recentAssess.map(a=>`<div class="recent-row"><span>${esc(a.titleEn)} / ${esc(a.titleJa)}</span><span>${a.correct}/${a.total} · ${Math.round(a.correct/Math.max(1,a.total)*100)}% · ${dateLabel(a.completedAt)}</span></div>`).join("")}</div>`:`<div class="empty compact">No assessments yet / まだAssessmentはありません。</div>`}<div class="btn-row"><button class="secondary" id="overviewTrackAssessment">Track Assessment / 総合確認</button><button class="secondary" id="overviewSmartReview">Smart Review / スマート復習</button></div></section>`;
  document.querySelectorAll("[data-progress-chapter],[data-gap-chapter]").forEach(b=>b.onclick=()=>{const c=CHAPTER_BY_ID.get(b.dataset.progressChapter||b.dataset.gapChapter),next=c?.lessons.find(x=>!S.completed.includes(x.id))||c?.lessons[0];if(next)openLessonId(next.id)});
  document.getElementById("overviewTrackAssessment").onclick=startTrackAssessment;
  document.getElementById("overviewSmartReview").onclick=startSmartReview;
}
function renderProgressMastery(){
  const body=document.getElementById("progressBody");
  body.innerHTML=`<section class="progress-section inset"><div class="section-head"><h3>Concept Mastery / 概念習熟度</h3><p>Mastered requires repeated correct evidence across multiple days plus applied practice. / Masteredには複数日の正答Evidence＋応用練習が必要です。</p></div><div class="mastery-controls"><div class="filter-row">${[["attention","Needs attention / 要復習"],["due","Due / 期限到来"],["studied","Studied / 学習済み"],["strong","Strong+ / 定着+"],["mastered","Mastered / 習得"],["all","All / 全て"]].map(([id,label])=>`<button class="filter-btn ${S.ui.progressFilter===id?"active":""}" data-progress-filter="${id}">${label}</button>`).join("")}</div><input class="search" id="progressSearch" type="search" placeholder="Filter concepts / 概念を検索" value="${esc(S.ui.progressSearch)}"><div class="small" id="masteryCount"></div></div><div class="mastery-list" id="masteryList"></div></section>`;
  document.querySelectorAll("[data-progress-filter]").forEach(b=>b.onclick=()=>{S.ui.progressFilter=b.dataset.progressFilter;save();document.querySelectorAll("[data-progress-filter]").forEach(x=>x.classList.toggle("active",x.dataset.progressFilter===S.ui.progressFilter));applyProgressFilters()});
  const progressSearch=document.getElementById("progressSearch");progressSearch.oninput=()=>{S.ui.progressSearch=progressSearch.value;applyProgressFilters();debounceUiSave()};applyProgressFilters();
}
function libraryLessonRows(ids,kind){
  const rows=ids.filter(id=>LESSON_BY_ID.has(id)).map(id=>lesson(id));
  return rows.length?rows.map(l=>`<button class="library-row" data-library-lesson="${esc(l.id)}"><span><strong>${esc(l.titleEn)} / ${esc(l.titleJa)}</strong><small>${esc(l.chapterEn)} / ${esc(l.chapterJa)}</small></span><span>${kind==="bookmark"?"★":"→"}</span></button>`).join(""):`<div class="empty compact">None yet / まだありません。</div>`;
}
function renderProgressLibrary(){
  const body=document.getElementById("progressBody"),notes=Object.entries(S.notes).filter(([id,v])=>LESSON_BY_ID.has(id)&&String(v||"").trim()),apps=Object.entries(S.applications).filter(([id,v])=>LESSON_BY_ID.has(id)&&v&&String(v.text||"").trim()),recent=[...S.recentLessons].reverse().slice(0,10),sessions=[...S.sessions].reverse().slice(0,8);
  body.innerHTML=`
    <div class="library-stats"><div><small>Bookmarks / 保存Lesson</small><strong>${S.bookmarks.length}</strong></div><div><small>Saved terms / 保存用語</small><strong>${S.savedTerms.length}</strong></div><div><small>Notes / メモ</small><strong>${notes.length}</strong></div><div><small>Applied responses / 応用回答</small><strong>${applicationsCount()}</strong></div></div>
    <section class="progress-section inset"><div class="section-head"><h3>Bookmarked Lessons / 保存レッスン</h3></div><div class="library-list">${libraryLessonRows(S.bookmarks,"bookmark")}</div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Saved Terms / 保存用語</h3></div><div class="saved-term-grid">${S.savedTerms.length?S.savedTerms.map(id=>term(id)).filter(Boolean).map(g=>`<button class="saved-term" data-library-term="${esc(g.id)}"><strong>${esc(g.en)}</strong><span>${esc(g.ja)}</span></button>`).join(""):`<div class="empty compact">Save terms from Glossary / 用語集から保存できます。</div>`}</div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Notes & Applied Practice / メモ・応用回答</h3><p>These are also searchable with Ctrl/Cmd + K. / Ctrl/Cmd + Kでも検索できます。</p></div><div class="personal-entry-list">${notes.slice(-10).reverse().map(([id,v])=>`<button class="personal-entry" data-library-lesson="${esc(id)}"><strong>Note · ${esc(lesson(id)?.titleEn||id)} / ${esc(lesson(id)?.titleJa||"")}</strong><span>${esc(String(v).slice(0,180))}${String(v).length>180?"…":""}</span></button>`).join("")}${apps.slice(-10).reverse().map(([id,v])=>`<button class="personal-entry" data-library-lesson="${esc(id)}"><strong>Application · ${esc(lesson(id)?.titleEn||id)} / ${esc(lesson(id)?.titleJa||"")}</strong><span>${esc(String(v.text||"").slice(0,180))}${String(v.text||"").length>180?"…":""}</span></button>`).join("")||(!notes.length&&!apps.length?`<div class="empty compact">No personal entries yet / 個人記録なし。</div>`:"")}</div></section>
    <section class="progress-section inset two-column-library"><div><div class="section-head"><h3>Recently Viewed / 最近見たLesson</h3></div><div class="library-list">${recent.length?recent.map(x=>`<button class="library-row" data-library-lesson="${esc(x.id)}"><span><strong>${esc(lesson(x.id)?.titleEn||x.id)} / ${esc(lesson(x.id)?.titleJa||"")}</strong><small>${dateLabel(x.at)}</small></span><span>→</span></button>`).join(""):`<div class="empty compact">No history yet / 履歴なし。</div>`}</div></div><div><div class="section-head"><h3>Recent Quiz Sessions / 最近のクイズ</h3></div>${sessions.length?`<div class="recent-sessions">${sessions.map(r=>`<div class="recent-row"><span>${esc(r.titleEn)} / ${esc(r.titleJa)}</span><span>${r.correct}/${r.total} · ${dateLabel(r.completedAt)}</span></div>`).join("")}</div>`:`<div class="empty compact">No sessions yet / セッションなし。</div>`}</div></section>`;
  document.querySelectorAll("[data-library-lesson]").forEach(b=>b.onclick=()=>openLessonId(b.dataset.libraryLesson));
  document.querySelectorAll("[data-library-term]").forEach(b=>b.onclick=()=>openTermId(b.dataset.libraryTerm));
}
function renderProgressData(){
  const body=document.getElementById("progressBody"),health=stateHealth(),snaps=snapshotList();
  body.innerHTML=`
    <section class="progress-section inset local-data"><div class="section-head"><h3>Local Data & Recovery / ローカルデータ・復元</h3><p>Content and personal state remain separate. / 教材と個人進捗は別保存。</p></div><p class="small"><strong>Learning content / 教材:</strong> <code>content.js</code><br><strong>Your state / 進捗:</strong> browser localStorage <code>${KEY}</code>.<br>Replacing app files does not normally erase progress when the same browser/profile and page location are used.</p><div class="storage-status four"><div><small>Last saved / 最終保存</small><strong>${esc(lastSavedLabel())}</strong></div><div><small>State size / 容量</small><strong>${storageLabel(KEY)}</strong></div><div><small>Snapshots / 復元点</small><strong>${snaps.length}/5</strong></div><div><small>State health / 保存状態</small><strong class="${health.ok?"health-good":"health-warn"}">${health.ok?"Healthy / 正常":`${health.issues.length} issue(s)`}</strong></div></div>${!health.ok?`<p class="small warning-box">${esc(health.issues.join(" · "))}</p>`:""}<div class="btn-row"><button class="secondary" id="exportProgress">Export backup / Backupを書き出す</button><button class="secondary" id="importProgress">Import backup / Backupを読み込む</button><button class="secondary" id="exportStudyReport">Export study report / 学習レポート</button><button class="secondary danger-lite" id="reset">Reset progress / 進捗リセット</button><input id="importFile" type="file" accept="application/json,.json" hidden></div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Recovery History / 復元履歴</h3><p>Up to five local snapshots. Clearing browser/site data can remove all local snapshots, so exported backups remain the portable safety net. / 最大5件。Browser Data削除では消えるためPortable Safety NetはExport Backupです。</p></div><div class="snapshot-list">${snaps.length?snaps.map((x,i)=>`<div class="snapshot-row"><span><strong>${dateLabel(x.createdAt)}</strong><small>${esc(x.reason||"snapshot")} · format V${x.formatVersion||"?"}</small></span><button class="secondary compact-btn" data-restore-snapshot="${i}">Restore / 復元</button></div>`).join(""):`<div class="empty compact">No snapshots yet / Snapshotなし。</div>`}</div></section>
    <section class="progress-section inset"><div class="section-head"><h3>Reading Settings / 読みやすさ</h3><p>Simple local preferences; no theme system or decorative UI. / 最小限のLocal Preferenceのみ。</p></div><div class="setting-row"><span><strong>Text size / 文字サイズ</strong><small>${esc(S.ui.readingSize)}</small></span><div class="btn-row tight"><button class="secondary compact-btn" id="settingTextDown">A−</button><button class="secondary compact-btn" id="settingTextUp">A+</button></div></div><div class="setting-row"><span><strong>Reading width / 本文幅</strong><small>${esc(S.ui.readingWidth)}</small></span><button class="secondary compact-btn" id="settingWidth">Toggle / 切替</button></div></section>`;
  document.getElementById("exportProgress").onclick=exportProgress;
  document.getElementById("importProgress").onclick=()=>document.getElementById("importFile").click();
  document.getElementById("importFile").onchange=e=>importProgress(e.target.files?.[0]);
  document.getElementById("exportStudyReport").onclick=exportStudyReport;
  document.querySelectorAll("[data-restore-snapshot]").forEach(b=>b.onclick=()=>restoreSnapshot(Number(b.dataset.restoreSnapshot)));
  document.getElementById("settingTextDown").onclick=()=>{const levels=["small","normal","large"],i=levels.indexOf(S.ui.readingSize);S.ui.readingSize=levels[Math.max(0,i-1)];save();renderProgress()};
  document.getElementById("settingTextUp").onclick=()=>{const levels=["small","normal","large"],i=levels.indexOf(S.ui.readingSize);S.ui.readingSize=levels[Math.min(levels.length-1,i+1)];save();renderProgress()};
  document.getElementById("settingWidth").onclick=()=>{S.ui.readingWidth=S.ui.readingWidth==="wide"?"comfortable":"wide";save();renderProgress()};
  document.getElementById("reset").onclick=()=>{if(!confirm("Reset all progress, notes, bookmarks, assessments and mastery? A recovery snapshot will be created first.\n\n進捗・メモ・保存・Assessment・習熟度をすべてリセットしますか？ 先に復元用Snapshotを作成します。"))return;writeSnapshot(S,"before-reset");localStorage.removeItem(KEY);S=clone(base);activeQuiz=null;answered=false;quizSession=null;save();renderProgress();show("Progress reset / 進捗をリセットしました")};
}
function applyProgressFilters(){
  const needle=norm(S.ui.progressSearch),dueSet=new Set(due());
  let items=D.glossary.filter(g=>{
    if(needle&&!TERM_SEARCH_INDEX.get(g.id)?.includes(needle))return false;
    const m=mastery(g.id);
    switch(S.ui.progressFilter){case"due":return dueSet.has(g.id);case"studied":return m.total>0;case"strong":return["Strong","Mastered"].includes(m.en);case"mastered":return m.en==="Mastered";case"all":return true;default:return dueSet.has(g.id)||(m.total>0&&!["Strong","Mastered"].includes(m.en))}
  }).sort((a,b)=>reviewPriority(b.id)-reviewPriority(a.id));
  const root=document.getElementById("masteryList"),count=document.getElementById("masteryCount");if(!root)return;
  count.textContent=`${items.length} concept(s) / ${items.length}件`;
  root.innerHTML=items.length?items.map(g=>{const m=mastery(g.id),next=m.next?new Date(m.next):null,isDue=next&&next.getTime()<=Date.now(),r=conceptReadiness(g.id);return `<button class="mastery-row mastery-button" data-mastery-term="${esc(g.id)}"><div><strong>${esc(g.en)} / ${esc(g.ja)}</strong><div class="small">${m.total?`${m.correct||0}/${m.total} correct · ${m.correctDates.length} correct day(s) · applied ${m.applied?"✓":"—"}`:"No quiz evidence yet / クイズ実績なし"}${m.next?` · ${isDue?"Due now / 復習期限":"Next "+new Date(m.next).toLocaleDateString()}`:""}</div></div><div class="mastery-side"><span class="concept-readiness">${r}%</span><div class="badge ${m.en.toLowerCase()}">${m.en} / ${m.ja}</div></div></button>`}).join(""):`<div class="empty">No concepts in this view / この条件の概念はありません。</div>`;
  document.querySelectorAll("[data-mastery-term]").forEach(b=>b.onclick=()=>openTermId(b.dataset.masteryTerm));
}

/* ---------- Global search ---------- */
function openGlobalSearch(query=""){
  searchOverlay.hidden=false;document.body.classList.add("modal-open");globalSearchInput.value=query;renderGlobalSearchResults(query);setTimeout(()=>globalSearchInput.focus(),0);
}
function closeGlobalSearch(){searchOverlay.hidden=true;document.body.classList.remove("modal-open");globalSearchItems=[];globalSearchIndex=0}
function personalSearchHits(needle){
  const hits=[];
  for(const [id,text] of Object.entries(S.notes))if(LESSON_BY_ID.has(id)&&norm(text).includes(needle))hits.push({kind:"note",id,main:`Note: ${lesson(id).titleEn} / ${lesson(id).titleJa}`,sub:String(text).slice(0,120)});
  for(const [id,a] of Object.entries(S.applications))if(LESSON_BY_ID.has(id)&&norm(a?.text||"").includes(needle))hits.push({kind:"application",id,main:`Application: ${lesson(id).titleEn} / ${lesson(id).titleJa}`,sub:String(a.text||"").slice(0,120)});
  return hits.slice(0,7);
}
function renderGlobalSearchResults(q){
  const needle=norm(q);
  if(!needle){globalSearchItems=[];globalSearchResults.innerHTML=`<div class="search-empty"><strong>Search the whole Hub / 学習ハブ全体を検索</strong><span>Lessons, glossary, personal notes, and applied responses. Try “ROIC”, “意思決定”, “CAC”, or your own note text.</span></div>`;return}
  const lessonHits=ALL_LESSONS.filter(l=>LESSON_SEARCH_INDEX.get(l.id)?.includes(needle)).slice(0,7);
  const termHits=D.glossary.filter(g=>TERM_SEARCH_INDEX.get(g.id)?.includes(needle)).slice(0,8);
  const personalHits=personalSearchHits(needle);
  globalSearchItems=[...lessonHits.map(l=>({kind:"lesson",id:l.id})),...termHits.map(g=>({kind:"term",id:g.id})),...personalHits.map(x=>({kind:x.kind,id:x.id}))];
  if(globalSearchIndex>=globalSearchItems.length)globalSearchIndex=0;
  let offset=0;
  const lessonHtml=lessonHits.length?`<div class="global-group"><div class="global-group-title">Lessons / レッスン</div>${lessonHits.map((l,i)=>globalResultButton("lesson",l.id,`${l.titleEn} / ${l.titleJa}`,`${l.chapterEn} / ${l.chapterJa}`,offset+i)).join("")}</div>`:"";offset+=lessonHits.length;
  const termHtml=termHits.length?`<div class="global-group"><div class="global-group-title">Glossary / 用語集</div>${termHits.map((g,i)=>globalResultButton("term",g.id,`${g.en} / ${g.ja}`,g.aliases.slice(0,3).join(" · "),offset+i)).join("")}</div>`:"";offset+=termHits.length;
  const personalHtml=personalHits.length?`<div class="global-group"><div class="global-group-title">My Notes & Applications / 自分の記録</div>${personalHits.map((x,i)=>globalResultButton(x.kind,x.id,x.main,x.sub,offset+i)).join("")}</div>`:"";
  globalSearchResults.innerHTML=(lessonHits.length||termHits.length||personalHits.length)?lessonHtml+termHtml+personalHtml:`<div class="search-empty"><strong>No results / 該当なし</strong><span>Try a shorter English/Japanese term, abbreviation, or phrase from your notes. / より短い用語・略語・メモ内の語句を試してください。</span></div>`;
  document.querySelectorAll("[data-global-result]").forEach(b=>b.onclick=()=>activateGlobalResult(Number(b.dataset.globalResult)));updateGlobalSelection();
}
function globalResultButton(kind,id,main,sub,index){return `<button class="global-result" data-global-result="${index}" data-kind="${kind}" data-id="${esc(id)}"><span>${esc(main)}</span><small>${esc(sub)}</small></button>`}
function updateGlobalSelection(){document.querySelectorAll("[data-global-result]").forEach((b,i)=>b.classList.toggle("selected",i===globalSearchIndex));const selected=document.querySelector(`[data-global-result="${globalSearchIndex}"]`);if(selected)selected.scrollIntoView({block:"nearest"})}
function activateGlobalResult(index=globalSearchIndex){const x=globalSearchItems[index];if(!x)return;closeGlobalSearch();if(x.kind==="term")openTermId(x.id);else openLessonId(x.id)}

/* ---------- Events / keyboard ---------- */
nav.forEach(b=>b.onclick=()=>b.dataset.view==="quiz"?openQuizHub():setView(b.dataset.view));
document.getElementById("menuBtn").onclick=()=>sidebar.classList.toggle("open");
document.getElementById("globalSearchBtn").onclick=()=>openGlobalSearch();
document.getElementById("closeSearch").onclick=closeGlobalSearch;
document.querySelectorAll("[data-close-search]").forEach(x=>x.onclick=closeGlobalSearch);
globalSearchInput.oninput=()=>{globalSearchIndex=0;renderGlobalSearchResults(globalSearchInput.value)};

document.addEventListener("keydown",e=>{
  const tag=(e.target?.tagName||"").toLowerCase(),typing=["input","textarea","select"].includes(tag);
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openGlobalSearch();return}
  if(!searchOverlay.hidden){
    if(e.key==="Escape"){e.preventDefault();closeGlobalSearch();return}
    if(e.key==="ArrowDown"&&globalSearchItems.length){e.preventDefault();globalSearchIndex=(globalSearchIndex+1)%globalSearchItems.length;updateGlobalSelection();return}
    if(e.key==="ArrowUp"&&globalSearchItems.length){e.preventDefault();globalSearchIndex=(globalSearchIndex-1+globalSearchItems.length)%globalSearchItems.length;updateGlobalSelection();return}
    if(e.key==="Enter"&&globalSearchItems.length){e.preventDefault();activateGlobalResult();return}
    return;
  }
  if(S.view==="learn"&&!typing){
    if(e.key==="["){const i=ALL_LESSONS.findIndex(x=>x.id===S.lesson),prev=ALL_LESSONS[i-1];if(prev){e.preventDefault();openLessonId(prev.id)}return}
    if(e.key==="]"){const i=ALL_LESSONS.findIndex(x=>x.id===S.lesson),next=ALL_LESSONS[i+1];if(next){e.preventDefault();openLessonId(next.id)}return}
  }
  if(S.view==="quiz"&&activeQuiz&&!typing){
    const key=e.key.toLowerCase();
    const map={"1":0,"2":1,"3":2,"a":0,"b":1,"c":2};
    if(map[key]!==undefined&&!answered){
      const q=quiz(activeQuiz),buttons=[...document.querySelectorAll("[data-opt]")],btn=buttons[map[key]];
      if(q&&btn){e.preventDefault();answer(q,btn.dataset.opt)}
    }else if((e.key==="Enter"||e.key==="ArrowRight")&&answered){
      const next=document.getElementById("nextQ");
      if(next&&next.offsetParent!==null){e.preventDefault();nextQuestion()}
    }
  }
});

nav.forEach(b=>b.classList.toggle("active",b.dataset.view===S.view));
const startTitles={
  home:["Home / ホーム","Continue where you left off. / 前回の続きから学習できます。"],
  learn:["Learn / 学ぶ","Interactive textbook and table of contents. / 目次から進むインタラクティブ教科書。"],
  quiz:["Quiz / クイズ","Practice, understand, review. / 練習・理解・復習。"],
  glossary:["Glossary / 用語集","Terms, formulas, and management frameworks. / 用語・計算式・経営フレームワーク。"],
  progress:["Progress / 進捗","Readiness, mastery, library, and local data. / 準備度・習熟・記録・ローカル保存。"]
};
window.addEventListener("beforeunload",()=>{
  try{
    const note=document.getElementById("lessonNote"),appNote=document.getElementById("applicationNote");
    if(note&&LESSON_BY_ID.has(S.lesson)){if(note.value.trim())S.notes[S.lesson]=note.value;else delete S.notes[S.lesson]}
    if(appNote&&LESSON_BY_ID.has(S.lesson)){const old=S.applications[S.lesson]||{};if(appNote.value.trim())S.applications[S.lesson]={...old,text:appNote.value,updatedAt:new Date().toISOString()}}
    S.stateVersion=STATE_VERSION;S.updatedAt=new Date().toISOString();localStorage.setItem(KEY,JSON.stringify(S));
  }catch{}
});


/* ---------- Public bridge for optional cloud sync ---------- */
window.PLH_APP={
  stateKey:KEY,
  stateVersion:STATE_VERSION,
  getState:()=>clone(S),
  getStateHealth:()=>stateHealth(),
  createSnapshot:(reason="cloud-manual")=>writeSnapshot(S,reason),
  replaceState:(raw,reason="cloud-reconcile")=>{
    try{
      writeSnapshot(S,`before-${reason}`);
      S=normalizeState(raw);
      if(!S.updatedAt)S.updatedAt=new Date().toISOString();
      activeQuiz=null;answered=false;quizSession=null;
      localStorage.setItem(KEY,JSON.stringify(S));
      applyReadingPrefs();updatePill();render();
      show("Cloud state loaded / クラウドの進捗を読み込みました");
      return true;
    }catch{return false}
  },
  showMessage:(message)=>show(message)
};

[title.textContent,subtitle.textContent]=startTitles[S.view]||startTitles.home;
save();render();

})();