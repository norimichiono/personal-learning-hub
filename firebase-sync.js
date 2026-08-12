import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwG1bWcpLqDGCQerMvUGyGWmffFGedIVrc",
  authDomain: "personal-learning-hub-24ff9.firebaseapp.com",
  projectId: "personal-learning-hub-24ff9",
  storageBucket: "personal-learning-hub-24ff9.firebasestorage.app",
  messagingSenderId: "108026625444",
  appId: "1:108026625444:web:d442688443ff1998079531"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const ui = {
  button: document.getElementById("cloudAccountBtn"),
  short: document.getElementById("cloudStatusShort"),
  overlay: document.getElementById("cloudOverlay"),
  close: document.getElementById("closeCloud"),
  status: document.getElementById("cloudStatusLong"),
  name: document.getElementById("cloudAccountName"),
  email: document.getElementById("cloudAccountEmail"),
  last: document.getElementById("cloudLastSync"),
  device: document.getElementById("cloudDevice"),
  error: document.getElementById("cloudError"),
  signIn: document.getElementById("cloudSignIn"),
  syncNow: document.getElementById("cloudSyncNow"),
  signOut: document.getElementById("cloudSignOut")
};

const DEVICE_KEY = "plh-cloud-device-id";
const LAST_SYNC_KEY = "plh-cloud-last-sync";
const MAX_CLOUD_BYTES = 850000;
let user = null;
let saveTimer = null;
let reconcileBusy = false;
let writeBusy = false;
let pendingState = null;
let lastUploadedFingerprint = "";

function deviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if(!id){
    id = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY,id);
  }
  return id;
}

function formatTime(v){
  if(!v)return "—";
  try{
    const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
    return d.toLocaleString();
  }catch{return "—"}
}

function showError(message=""){
  if(!ui.error)return;
  ui.error.hidden = !message;
  ui.error.textContent = message;
}

function setStatus(kind,label,longLabel=label){
  if(ui.button)ui.button.dataset.state = kind;
  if(ui.short)ui.short.textContent = label;
  if(ui.status)ui.status.textContent = longLabel;
}

function updateLastSync(value=null){
  const display = value ? formatTime(value) : (localStorage.getItem(LAST_SYNC_KEY) || "—");
  if(ui.last)ui.last.textContent = display;
  if(value)localStorage.setItem(LAST_SYNC_KEY,display);
}

function updateAccountUi(){
  const online = navigator.onLine;
  if(ui.name)ui.name.textContent = user?.displayName || (user ? "Google account / Googleアカウント" : "Not signed in / 未ログイン");
  if(ui.email)ui.email.textContent = user?.email || "";
  if(ui.signIn)ui.signIn.hidden = Boolean(user);
  if(ui.syncNow)ui.syncNow.hidden = !user;
  if(ui.signOut)ui.signOut.hidden = !user;
  if(ui.device)ui.device.textContent = `Local copy ready · ${deviceId().slice(0,8)} / ローカル保存あり`;
  if(!user)setStatus("signed-out","Sign in / ログイン","Signed out · local only / 未ログイン・ローカルのみ");
  else if(!online)setStatus("offline","Offline / オフライン","Offline · local changes are safe / オフライン・ローカル保存中");
}

function openCloud(){
  if(!ui.overlay)return;
  ui.overlay.hidden=false;
  document.body.classList.add("modal-open");
}
function closeCloud(){
  if(!ui.overlay)return;
  ui.overlay.hidden=true;
  document.body.classList.remove("modal-open");
}
ui.button?.addEventListener("click",openCloud);
ui.close?.addEventListener("click",closeCloud);
document.querySelectorAll("[data-close-cloud]").forEach(x=>x.addEventListener("click",closeCloud));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&ui.overlay&&!ui.overlay.hidden)closeCloud()});

function appState(){return window.PLH_APP?.getState?.() || null}
function meaningful(s){
  if(!s||typeof s!=="object")return false;
  const arrays=["completed","bookmarks","sessions","quizHistory","assessments","savedTerms"];
  if(arrays.some(k=>Array.isArray(s[k])&&s[k].length))return true;
  const maps=["attempts","mastery","notes","applications"];
  return maps.some(k=>s[k]&&typeof s[k]==="object"&&Object.keys(s[k]).length);
}
function stateTime(s){
  const n=Date.parse(s?.updatedAt||"");
  return Number.isFinite(n)?n:0;
}
function fingerprint(s){
  const text=JSON.stringify(s||{});
  let h=2166136261;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return `${text.length}:${(h>>>0).toString(16)}`;
}
function stateBytes(s){
  const text=JSON.stringify(s||{});
  try{return new TextEncoder().encode(text).length}catch{return text.length}
}
function stateRef(){return doc(db,"users",user.uid,"state","current")}

async function writeCloud(state,reason="auto"){
  if(!user||!navigator.onLine||!state)return false;
  const bytes=stateBytes(state);
  if(bytes>MAX_CLOUD_BYTES){
    showError(`Cloud state is too large (${Math.round(bytes/1024)} KB). Export a local backup and reduce large notes before syncing. / クラウド同期サイズが大きすぎます。`);
    setStatus("error","Sync issue / 同期エラー","Cloud state too large / クラウド保存サイズ超過");
    return false;
  }
  const fp=fingerprint(state);
  if(reason==="auto"&&fp===lastUploadedFingerprint)return true;
  if(writeBusy){
    pendingState=state;
    return true;
  }
  writeBusy=true;
  showError("");
  setStatus("saving","Saving… / 同期中","Saving to cloud… / クラウドへ保存中…");
  try{
    await setDoc(stateRef(),{
      schemaVersion:1,
      app:"Personal Learning Hub",
      state,
      clientUpdatedAt:state.updatedAt||new Date().toISOString(),
      savedAt:serverTimestamp(),
      deviceId:deviceId(),
      stateBytes:bytes
    },{merge:false});
    lastUploadedFingerprint=fp;
    updateLastSync(new Date());
    setStatus("synced","Synced / 同期済","Synced / 同期済み");
    return true;
  }catch(err){
    console.error("PLH cloud write failed",err);
    showError(`Cloud save failed: ${err?.message||err} / クラウド保存に失敗しました。ローカル保存は維持されています。`);
    setStatus("error","Sync issue / 同期エラー","Cloud save failed · local copy safe / クラウド保存失敗・ローカルは安全");
    return false;
  }finally{
    writeBusy=false;
    if(pendingState){
      const next=pendingState;
      pendingState=null;
      setTimeout(()=>writeCloud(next,"auto"),150);
    }
  }
}

function scheduleCloudWrite(state){
  if(!user)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>writeCloud(state,"auto"),900);
}

async function applyRemote(remote,reason){
  const ok=window.PLH_APP?.replaceState?.(remote,reason);
  if(ok){
    lastUploadedFingerprint=fingerprint(remote);
    setStatus("synced","Synced / 同期済","Cloud state loaded / クラウドの進捗を読み込みました");
  }
  return ok;
}

async function reconcile(reason="sign-in"){
  if(!user||!navigator.onLine||reconcileBusy)return;
  reconcileBusy=true;
  showError("");
  setStatus("saving","Syncing… / 同期中","Checking cloud and this device… / クラウドとこの端末を確認中…");
  try{
    const local=appState();
    const snap=await getDoc(stateRef());
    if(!snap.exists()){
      await writeCloud(local,"initial");
      return;
    }
    const data=snap.data()||{};
    const remote=data.state||null;
    updateLastSync(data.savedAt||data.clientUpdatedAt);
    const localUseful=meaningful(local);
    const remoteUseful=meaningful(remote);
    const localTime=stateTime(local);
    const remoteTime=stateTime(remote);

    if(remoteUseful&&!localUseful){
      await applyRemote(remote,"cloud-first-load");
    }else if(localUseful&&!remoteUseful){
      await writeCloud(local,"local-wins");
    }else if(remoteUseful&&localUseful&&remoteTime>localTime+1000){
      await applyRemote(remote,"cloud-newer");
    }else if(localTime>remoteTime+1000){
      await writeCloud(local,"local-newer");
    }else{
      lastUploadedFingerprint=fingerprint(local);
      setStatus("synced","Synced / 同期済","Synced / 同期済み");
    }
  }catch(err){
    console.error("PLH reconcile failed",err);
    showError(`Sync check failed: ${err?.message||err} / 同期確認に失敗しました。ローカル保存は維持されています。`);
    setStatus("error","Sync issue / 同期エラー","Sync check failed · local copy safe / 同期確認失敗・ローカルは安全");
  }finally{
    reconcileBusy=false;
  }
}

ui.signIn?.addEventListener("click",async()=>{
  ui.signIn.disabled=true;
  showError("");
  try{
    await signInWithPopup(auth,provider);
  }catch(err){
    if(err?.code!=="auth/popup-closed-by-user"){
      console.error("PLH sign-in failed",err);
      showError(`Google sign-in failed: ${err?.message||err}`);
    }
  }finally{
    ui.signIn.disabled=false;
  }
});
ui.signOut?.addEventListener("click",async()=>{
  try{await signOut(auth)}catch(err){showError(err?.message||String(err))}
});
ui.syncNow?.addEventListener("click",()=>reconcile("manual"));

window.addEventListener("plh:state-saved",e=>{
  if(user)scheduleCloudWrite(e.detail?.state||appState());
});
window.addEventListener("online",()=>{
  updateAccountUi();
  if(user)reconcile("online");
});
window.addEventListener("offline",updateAccountUi);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&user&&navigator.onLine)reconcile("visible");
});

try{await setPersistence(auth,browserLocalPersistence)}catch{}
onAuthStateChanged(auth,async current=>{
  user=current||null;
  updateAccountUi();
  if(user){
    setStatus("saving","Syncing… / 同期中","Signed in · checking cloud / ログイン済み・クラウド確認中");
    await reconcile("auth");
  }
});

updateLastSync();
updateAccountUi();
