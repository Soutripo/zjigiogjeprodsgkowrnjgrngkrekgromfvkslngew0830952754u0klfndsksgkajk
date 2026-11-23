/* 運行図表・在線モニターの表示処理。ログイン成功後に index.html から読み込まれます。
   index.html からは ChichibuViewer.unlock(鍵) → ChichibuViewer.show() の順に呼ばれます。 */
(function(){
const VIEWER_CSS=`
  html,body{height:100%;margin:0}
  body{display:flex;flex-direction:column;background:#07131c;
    font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",system-ui,sans-serif}
  #frames{flex:1;position:relative;min-height:0}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
  iframe#fm{background:#07131c}
  iframe.off{visibility:hidden;pointer-events:none}
  #toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
    z-index:10;max-width:90vw;padding:9px 18px;border-radius:20px;background:rgba(20,40,56,.92);color:#fff;
    font-size:14px;font-weight:700;letter-spacing:.04em;pointer-events:none;opacity:0;transition:opacity .25s}
  #toast.on{opacity:1}
  #err{display:none;padding:12px 16px;color:#fff;background:#b2452c;font-size:13px}
#exPop,#infoPop{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
#exPop .ex-box,#infoPop .ex-box{width:min(480px,100%);max-height:86vh;overflow:auto;background:#fff;color:#1f2d3a;border:2px solid #1f77a6;border-radius:6px;box-shadow:0 6px 28px rgba(0,0,0,.45)}
#exPop .ex-head,#infoPop .ex-head{background:#1f77a6;color:#fff;font-size:18px;font-weight:700;padding:12px 16px}
#exPop .ex-sub,#infoPop .ex-sub{padding:10px 16px 2px;font-size:13px;color:#456}
#exPop .ex-item,#infoPop .ex-item{padding:10px 16px;border-bottom:1px solid #d6e3ec}
#exPop .ex-no,#infoPop .ex-no{font-size:20px;font-weight:700}
#exPop .ex-type,#infoPop .ex-type{margin-left:10px;font-size:14px;font-weight:700;color:#1f77a6}
#exPop .ex-run,#infoPop .ex-run{margin-top:2px;font-size:16px}
#exPop .ex-note,#infoPop .ex-note{margin-top:2px;font-size:13px;color:#456}
#exPop .ex-foot,#infoPop .ex-foot{padding:12px 16px;text-align:right}
#exPop button,#infoPop button{font:inherit;font-size:16px;font-weight:700;padding:8px 28px;border:1px solid #1f77a6;background:#1f77a6;color:#fff;border-radius:4px;cursor:pointer}
#infoPop{z-index:31;background:rgba(0,0,0,.6)}
#infoPop .ex-box{border-color:#b2452c}
#infoPop .ex-head{background:#b2452c}
#infoPop .ex-text{padding:12px 16px 4px;font-size:16px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
`;
/* 表示に必要な部品(CSS と #err / #frames / #toast)は、表示するときにここで作る */
function ensureDom(){
  if(!document.getElementById('viewerCss')){ const st=document.createElement('style'); st.id='viewerCss'; st.textContent=VIEWER_CSS; document.head.appendChild(st); }
  for(const id of ['err','frames','toast']){
    if(document.getElementById(id)) continue;
    const d=document.createElement('div'); d.id=id;
    if(id==='toast'){ d.setAttribute('role','status'); d.setAttribute('aria-live','polite'); }
    document.body.appendChild(d);
  }
}
/* 2つの画面はそれぞれ独立した枠(iframe)に入れてあり、表示・動作は単体のときと同じです。
   運行図表のダイヤデータを正とし、在線モニター用の形式に変換して渡します。
   臨時列車は運行図表側の「臨時列車」フォームで入力し、反映中のものが在線モニターにも出ます。 */
/* 画面の中身は暗号化されています。ログイン成功後に、GASが返す鍵でブラウザの中で復号します。 */
let SRC_DIAGRAM="", SRC_MONITOR="";
/* 暗号化データ(運転図表・在線モニター)は data/ フォルダの別ファイル。ダイヤ改正時はそちらだけ差し替える */
const DATA_FILES={d:'data/diagram.enc.json',m:'data/monitor.enc.json'};
async function loadEnc(){
  try{
    const get=async u=>{ const r=await fetch(u,{cache:'no-cache'}); if(!r.ok) throw new Error(u+' '+r.status); return r.json(); };
    const [d,m]=await Promise.all([get(DATA_FILES.d),get(DATA_FILES.m)]);
    return {d:d,m:m};
  }catch(e){ const x=new Error('図表データを読み込めません。通信状態を確認してください'); x.loadErr=true; throw x; }
}
async function decryptAll(keyBytes){
  if(!(window.crypto&&crypto.subtle)) throw new Error('この環境ではWeb Cryptoが使えません(httpsで開いてください)');
  const ENC=await loadEnc();
  const te=new TextEncoder(), pre=te.encode('chichibu-enc-v1');
  const mix=new Uint8Array(pre.length+keyBytes.length); mix.set(pre); mix.set(keyBytes,pre.length);
  const raw=new Uint8Array(await crypto.subtle.digest('SHA-256',mix));
  const k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const dec=async(o,aad)=>new TextDecoder('utf-8').decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(o.iv),additionalData:te.encode(aad)},k,b64(o.ct)));
  SRC_DIAGRAM=await dec(ENC.d,'diagram');
  SRC_MONITOR=await dec(ENC.m,'monitor');
}

function boot(){
  ensureDom();
  const frames=document.getElementById('frames');
  const fd=document.createElement('iframe'); fd.id='fd'; fd.title='運行図表';
  const fm=document.createElement('iframe'); fm.id='fm'; fm.title='在線モニター'; fm.className='off';

  /* ---- 変換: 運行図表のデータ → 在線モニターのデータ ---- */
  const TYPE_MAP={local:'普通',express:'急行',sl:'SL',freight:'貨物',extra:'貨物',seibu:'普通',empty:'普通',rinji:'普通'};
  const pad=n=>String(n).padStart(2,'0');
  function tstr(m){                       // 分(小数=秒) → "H:MM" / "H:MM:SS"
    const h=Math.floor(m/60), rest=Math.round((m-h*60)*60), mi=Math.floor(rest/60), se=rest%60;
    return h+':'+pad(mi)+(se?':'+pad(se):'');
  }
  const toSchedule=(stops,st)=>stops.map(([i,a,d,ps])=>({station:st[i].n, arr:tstr(a), dep:tstr(d), pass:!!ps}));
  /* モニターの「上」= 三峰口(影森)方面。運行図表の下りと同じ向き */
  const towardMitsumine=stops=>stops[stops.length-1][0]>stops[0][0];

  function buildSchedules(api){
    const out={weekday_up:[],weekday_down:[],holiday_up:[],holiday_down:[]};
    const base=api.effective?api.effective():api.base;      // 遅延を反映したダイヤ
    ['weekday','holiday'].forEach(dk=>{
      const cnt={};
      (base[dk]||[]).forEach(t=>{
        let id=t.no;
        if(!id){ const k=t.note||'無番'; cnt[k]=(cnt[k]||0)+1; id=k+cnt[k]; }   // 番号なし(単機など)は「単機1」のように
        const mt={ id:id, type:TYPE_MAP[t.type]||'普通', name:t.name||'', gousu:t.gou||'',
                   schedule:toSchedule(t.stops,api.stations) };
        out[dk+(towardMitsumine(t.stops)?'_up':'_down')].push(mt);
      });
    });
    return out;
  }
  window.__extrasForMonitor=function(){
    const api=fd.contentWindow&&fd.contentWindow.__chichibu; if(!api) return [];
    if(api.effectiveApplied){                              // 遅延を反映した時刻・日ごと
      return api.effectiveApplied().map(x=>({
        id:x.rec.no||('臨'+(x.n+1)), type:TYPE_MAP[x.rec.type]||'普通', name:'', gousu:'', isCustom:true, days:[x.day],
        direction:towardMitsumine(x.stops)?'up':'down', schedule:toSchedule(x.stops,api.stations)
      }));
    }
    return api.applied().map((r,k)=>({
      id:r.no||('臨'+(k+1)), type:TYPE_MAP[r.type]||'普通', name:'', gousu:'', isCustom:true, days:r.days,
      direction:towardMitsumine(r.stops)?'up':'down', schedule:toSchedule(r.stops,api.stations)
    }));
  };
  /* 在線モニターが開いた日の平日/休日を知るための窓口(判定は運行図表側) */
  window.__todayDayType=function(){ try{ return fd.contentWindow.__chichibu.todayDay(); }catch(_){ return 'weekday'; } };
  window.__bus={
    extrasChanged(){ try{ fm.contentWindow&&fm.contentWindow.dispatchEvent(new Event('extras-changed')); }catch(_){} },
    /* 遅延の入力・解除: 在線モニターの時刻を作り直して知らせる(モニターは再起動しない) */
    delaysChanged(){
      const api=fd.contentWindow&&fd.contentWindow.__chichibu; if(!api) return;
      window.__SCHEDULES=buildSchedules(api);
      try{ if(fm.contentWindow){ fm.contentWindow.dispatchEvent(new Event('delays-changed')); fm.contentWindow.dispatchEvent(new Event('extras-changed')); } }catch(_){}
    },
    /* 運行図表のダイヤ(OuDia の一時読み込み・元に戻す)が変わった: 在線モニターのデータを作り直して起動し直す */
    baseChanged(){
      const api=fd.contentWindow&&fd.contentWindow.__chichibu; if(!api) return;
      window.__SCHEDULES=buildSchedules(api);
      if(!fm.parentNode) return;                       // モニターがまだ起動前なら、起動時に新しいデータが使われる
      try{ fm.contentWindow.location.reload(); }catch(_){ fm.srcdoc=SRC_MONITOR; }
    }
  };

  /* ---- 運行情報(GAS)を親ページで5秒ごとに取得し、在線モニターへ渡す ---- */
  const INFO_URL="https://script.google.com/macros/s/AKfycbzppnJVY5L-J3podbqMBXnzwhldt8VomTCE_f1y91hfMYXH88rSo7sWrYDVz0crxDwN/exec";
  async function pollInfo(){
    try{
      const r=await fetch(INFO_URL,{cache:'no-store'});
      const data=await r.json();
      window.__trainInfo={data:data,at:Date.now()};
      try{ fm.contentWindow&&fm.contentWindow.dispatchEvent(new Event('traininfo-changed')); }catch(_){}
    }catch(err){ console.error('運行情報の取得に失敗しました:',err); }
  }
  pollInfo(); setInterval(pollInfo,5000);

  /* ---- 画面の切り替え: 4回タップ(もう一方の画面へ)/ 予備: 三本指で大きく横にスワイプ ---- */
  const NAMES={d:'運行図表',m:'在線モニター'};
  let cur='d', toastTimer=0;
  const toastEl=document.getElementById('toast');
  function toast(t,ms){
    toastEl.textContent=t; toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>toastEl.classList.remove('on'),ms||1400);
  }
  function show(which,quiet){
    cur=(which==='m')?'m':'d';
    fd.classList.toggle('off',cur!=='d'); fm.classList.toggle('off',cur!=='m');
    document.title='秩父鉄道 '+NAMES[cur];
    try{ sessionStorage.setItem('chichibuTab',cur); }catch(_){}
    if(!quiet) toast((cur==='m'?'':'◀ ')+NAMES[cur]+(cur==='m'?' ▶':''));
  }
  /* 4回タップの途中で開いてしまった時刻表・設定ウィンドウを閉じる(両方の画面を対象) */
  function closeOverlays(){
    try{ fd.contentWindow.document.querySelectorAll('dialog[open]').forEach(d=>d.close()); }catch(_){}
    try{ fm.contentWindow.document.querySelectorAll('.modal-overlay').forEach(o=>o.click()); }catch(_){}
  }
  function go(which){ if(which!==cur) show(which); else toast(which==='m'?'これ以上右はありません':'これ以上左はありません'); }

  function attachSwipe(win){
    let g=null;
    const cen=ts=>{ let x=0,y=0; for(const t of ts){ x+=t.clientX; y+=t.clientY; } return {x:x/ts.length,y:y/ts.length}; };
    win.addEventListener('touchstart',e=>{
      if(e.touches.length===3){ const c=cen(e.touches); g={x0:c.x,y0:c.y,fired:false}; }
      else if(e.touches.length>3) g=null;
    },{capture:true,passive:true});
    win.addEventListener('touchmove',e=>{
      if(!g||e.touches.length!==3) return;
      if(e.cancelable) e.preventDefault();                 // 三本指の間は、ページ側のスクロールや拡大を止める
      if(g.fired) return;
      const c=cen(e.touches), dx=c.x-g.x0, dy=c.y-g.y0, w=win.innerWidth||window.innerWidth;
      if(Math.abs(dx)>=Math.max(100,w*0.25) && Math.abs(dx)>Math.abs(dy)*1.5){
        g.fired=true; go(dx<0?'m':'d');
      }
    },{capture:true,passive:false});
    const end=e=>{ if(e.touches.length===0) g=null; };
    win.addEventListener('touchend',end,{capture:true,passive:true});
    win.addEventListener('touchcancel',end,{capture:true,passive:true});
    /* 4回タップ: 指1本で、画面のどこでもすばやく4回タップすると、もう一方の画面に切り替える。
       条件: 1回ごとに短く触れる(動かさない)/ 前のタップから 0.45 秒以内 / 4回とも近い場所 */
    const TAP={n:0,last:0,x:0,y:0,sx:0,sy:0,st:0,ok:false};
    const TAP_GAP=450, TAP_MOVE=18, TAP_HOLD=350, TAP_AREA=70;
    win.addEventListener('touchstart',e=>{
      if(e.touches.length!==1){ TAP.ok=false; TAP.n=0; return; }
      const t=e.touches[0];
      TAP.ok=true; TAP.sx=t.clientX; TAP.sy=t.clientY; TAP.st=Date.now();
      if(TAP.n>0 && (TAP.st-TAP.last>TAP_GAP || Math.hypot(t.clientX-TAP.x,t.clientY-TAP.y)>TAP_AREA)) TAP.n=0;
    },{capture:true,passive:true});
    win.addEventListener('touchmove',e=>{
      if(!TAP.ok) return;
      const t=e.touches[0]; if(!t) return;
      if(Math.hypot(t.clientX-TAP.sx,t.clientY-TAP.sy)>TAP_MOVE){ TAP.ok=false; TAP.n=0; }   // ドラッグはタップではない
    },{capture:true,passive:true});
    win.addEventListener('touchend',e=>{
      if(!TAP.ok || e.touches.length!==0) return;
      TAP.ok=false;
      const now=Date.now();
      if(now-TAP.st>TAP_HOLD){ TAP.n=0; return; }          // 長押しはタップではない
      const t=e.changedTouches[0];
      if(TAP.n===0){ TAP.x=t.clientX; TAP.y=t.clientY; }
      TAP.n++; TAP.last=now;
      if(TAP.n>=4){
        TAP.n=0;
        if(e.cancelable) e.preventDefault();               // 4回目のタップが下の画面に届かないようにする
        closeOverlays();                                   // タップの途中で開いた時刻表などを閉じる
        show(cur==='d'?'m':'d');
      }
    },{capture:true,passive:false});
    /* パソコン用の予備: Ctrl+Alt+← / → */
    win.addEventListener('keydown',e=>{
      if(e.ctrlKey&&e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){ e.preventDefault(); go(e.key==='ArrowLeft'?'d':'m'); }
    },true);
  }
  attachSwipe(window);
  /* モニターの「臨時列車」ボタンから呼ばれる: 運行図表に切り替えて入力フォームを開く */
  window.__openExtra=function(){
    show('d');
    try{ const b=fd.contentWindow.document.getElementById('b-extra'); if(b) b.click(); }catch(_){}
  };

  /* ---- 起動: 先に運行図表を読み込み、そのデータからモニターを起動 ---- */
  let started=false;
  fd.addEventListener('load',()=>{
    if(started) return; started=true;
    attachSwipe(fd.contentWindow);
    const api=fd.contentWindow.__chichibu;
    if(!api){ const e=document.getElementById('err'); e.style.display='block'; e.textContent='運行図表の読み込みに失敗しました。'; return; }
    window.__SCHEDULES=buildSchedules(api);
    fm.addEventListener('load',()=>{ try{ attachSwipe(fm.contentWindow); }catch(_){} });
    fm.srcdoc=SRC_MONITOR; frames.appendChild(fm);
    let tab='d'; try{ tab=sessionStorage.getItem('chichibuTab')||'d'; }catch(_){}
    show(tab==='m'?'m':'d',true);
    toast('どこでも4回タップすると、運行図表と在線モニターを切り替えられます',3200);
  });
  fd.srcdoc=SRC_DIAGRAM; frames.appendChild(fd);
}

/* ===== 臨時列車の事前登録(サーバー同期) =====
   登録ページ(admin.html)でサーバー(GAS)に登録された臨時列車を、運転日の当日に自動で運行図表へ反映し、ポップアップで知らせる。
   サーバーは当日分だけを返す。開きっぱなしの画面でも、日付が変わったらすぐ取り直して入れ替える(登録の追加・取り消しも5分ごとに取り直す)。
   反映は運行図表の「反映中の臨時列車」(xList)に入れる方法で、図表・遅延計算・在線モニターは今の仕組みのまま動く。
   取り込んだ列車には srv:true の印をつけ、端末(localStorage)への保存と「書き出し」からは除く。 */
const EXTRAS_POLL_MS=5*60*1000, DATE_CHECK_MS=20*1000;
const EX={list:[],attemptDate:null,sig:null,last:0,fail:0,busy:false,ctx:null,w:null,api:null,patched:false,errShown:false};
const todayStr=()=>{ const t=new Date(), z=n=>String(n).padStart(2,'0'); return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate()); };   // 運行図表の gyToday() と同じ(端末の日付)
function exErr(msg){
  const e=document.getElementById('err'); if(!e) return;
  if(msg){ e.style.display='block'; e.textContent=msg; EX.errShown=true; }
  else if(EX.errShown){ e.style.display='none'; e.textContent=''; EX.errShown=false; }
}
async function exFetch(){
  const c=EX.ctx;
  if(!c||!c.tok||!c.url){ const x=new Error('no token'); x.net=true; throw x; }      // ログイン管理が臨時列車に未対応(通行証がない)のときは、何もしない
  const r=await fetch(c.url,{method:'POST',body:JSON.stringify({a:'extras',tok:c.tok,dev:c.dev,d:todayStr()}),redirect:'follow',cache:'no-store'});
  if(!r.ok){ const x=new Error('http '+r.status); x.net=true; throw x; }
  const res=await r.json();
  if(res&&res.tok) c.tok=res.tok;                                                    // 使うたびに通行証が延長される
  if(!res||!res.ok){ const x=new Error((res&&res.msg)||'server'); x.code=(res&&res.code)||'server'; throw x; }
  if(!Array.isArray(res.trains)) throw new Error('format');
  return res.trains;
}
/* 登録データの確認(運行図表の「読み込み」と同じ考え方)。運転予定日のないもの・壊れたものは反映しない */
function exValid(arr,api){
  const n=api.stations.length, out=[], seen=new Set();
  arr.forEach((r,k)=>{
    try{
      if(!r||typeof r!=='object'||!/^\d{4}-\d{2}-\d{2}$/.test(r.opDate||'')||!api.types[r.type]) return;
      if(!Array.isArray(r.stops)||r.stops.length<2) return;
      let prev=-1;
      for(const s of r.stops){
        if(!Array.isArray(s)||!Number.isInteger(s[0])||s[0]<0||s[0]>=n||!isFinite(s[1])||!isFinite(s[2])||s[2]<s[1]||s[1]<prev) return;
        prev=s[2];
      }
      const days=(Array.isArray(r.days)?r.days:['weekday','holiday']).filter(d=>d==='weekday'||d==='holiday'); if(!days.length) return;
      const id='srv_'+String(r.id||(r.opDate+'_'+(r.no||k))).replace(/[^A-Za-z0-9_-]/g,'_'); if(seen.has(id)) return; seen.add(id);
      out.push({id:id,origId:r.id||null,no:String(r.no||''),type:r.type,dash:r.dash||'auto',lw:r.lw||'auto',note:String(r.note||''),opDate:r.opDate,days:days,stops:r.stops.map(s=>s.slice(0,4)),savedAt:Date.now()});
    }catch(_){}
  });
  return out;
}
/* 取り込んだ列車を端末に保存・書き出ししないよう、運行図表の保存と書き出しを一度だけ包む */
function exPatch(w){
  if(EX.patched) return;
  ['xPersist','xExport','xRedraw','xRenderList','xStr'].forEach(n=>{ if(typeof w[n]!=='function') throw new Error(n+' が運行図表にありません'); });
  w.eval('xList'); w.eval('xApplied');
  ['xPersist','xExport'].forEach(name=>{
    const o=w[name];
    w[name]=function(){
      const L=w.eval('xList'), all=L.slice(); L.splice(0,L.length,...all.filter(r=>!r.srv));
      try{ return o.apply(this,arguments); } finally{ L.splice(0,L.length,...all); }
    };
  });
  EX.patched=true;
}
function exInject(w,recs){
  const L=w.eval('xList'), A=w.eval('xApplied');                 // xList は作り直されることがあるので、使うたびに取得する
  if(!L.some(r=>r.srv)&&!recs.length) return;
  for(let i=L.length-1;i>=0;i--){ if(L[i].srv){ A.delete(L[i].id); L.splice(i,1); } }
  recs.forEach(r=>{
    const mine=r.origId&&L.find(o=>!o.srv&&o.id===r.origId);
    if(mine){ A.add(mine.id); return; }                          // この端末に同じ列車が保存済みなら、それを反映(二重にしない)
    const o=w.JSON.parse(JSON.stringify(r)); o.srv=true; delete o.origId; L.push(o); A.add(o.id);
  });
  w.xRedraw();
  try{ w.xRenderList(); }catch(_){}
}
function exClose(){ const e=document.getElementById('exPop'); if(e) e.remove(); }
function exPopup(list,today){
  const api=EX.api, w=EX.w, nm=i=>(api.stations[i]||{}).n||'', tm=m=>w.xStr(m), mk=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };
  exClose();
  const el=mk('div'); el.id='exPop'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-labelledby','exPopT');
  const box=mk('div','ex-box'), h=mk('div','ex-head','本日の臨時列車'); h.id='exPopT';
  const [y,m,d]=today.split('-').map(Number);
  box.appendChild(h); box.appendChild(mk('div','ex-sub',y+'年'+m+'月'+d+'日  '+list.length+'本。運行図表と在線モニターに反映しました。'));
  list.forEach(r=>{
    const it=mk('div','ex-item'), a=r.stops[0], z=r.stops[r.stops.length-1];
    const top=mk('div'); top.appendChild(mk('span','ex-no',r.no||'番号なし')); top.appendChild(mk('span','ex-type',api.types[r.type].label)); it.appendChild(top);
    it.appendChild(mk('div','ex-run',nm(a[0])+' '+tm(a[2])+' 発 → '+nm(z[0])+' '+tm(z[1])+' 着'));
    if(r.note) it.appendChild(mk('div','ex-note','備考: '+r.note));
    box.appendChild(it);
  });
  const foot=mk('div','ex-foot'), b=mk('button',null,'閉じる'); b.type='button'; b.addEventListener('click',exClose); foot.appendChild(b); box.appendChild(foot);
  el.appendChild(box); document.body.appendChild(el); b.focus();
}
function exApply(){
  const w=EX.w, api=EX.api; if(!w||!api) return;
  const today=todayStr();
  const todays=exValid(EX.list,api).filter(r=>r.opDate===today).sort((p,q)=>p.stops[0][2]-q.stops[0][2]||p.no.localeCompare(q.no));
  const sig=today+'|'+JSON.stringify(todays.map(r=>Object.assign({},r,{savedAt:0})));   // 取り込んだ時刻は比べない(毎回変わるため)
  if(sig===EX.sig) return;                                        // 変化なし(同じ内容では、閉じたポップアップを出し直さない)
  try{ exInject(w,todays); }catch(e){ console.warn(e); exErr('臨時列車を運行図表に反映できませんでした。管理者に連絡してください'); return; }
  EX.sig=sig;
  if(todays.length) exPopup(todays,today); else exClose();
}
async function exSync(){
  if(!EX.api||!EX.ctx||EX.busy) return;
  EX.busy=true; EX.attemptDate=todayStr();
  try{ EX.list=await exFetch(); EX.last=Date.now(); EX.fail=0; exErr(''); exApply(); }
  catch(e){
    EX.last=Date.now();
    if(e&&(e.net||e instanceof TypeError)) return;                // 通信の失敗: 前回の内容のまま続ける
    if(e&&e.code==='auth'){ exErr('臨時列車の登録を取得できません。ログインし直してください'); return; }
    EX.fail++; console.warn(e); if(EX.fail>=2) exErr('臨時列車の登録データを読み込めません。管理者に連絡してください');
  }
  finally{ EX.busy=false; }
}
function exStart(){
  const fd=document.getElementById('fd'); if(!fd) return;
  const init=()=>{
    try{ const w=fd.contentWindow, api=w&&w.__chichibu; if(!api) return; exPatch(w); EX.w=w; EX.api=api; }
    catch(e){ console.warn(e); exErr('臨時列車の自動反映を開始できませんでした(運行図表の構成が変わった可能性があります)'); return; }
    exSync();
    /* 20秒ごと: 日付が変わっていたらすぐ取り直す / 5分たっていたら取り直す。取得できた内容は、そのたびに反映する */
    const tick=()=>{ exApply(); if(EX.attemptDate!==todayStr()||Date.now()-EX.last>=EXTRAS_POLL_MS) exSync(); };
    setInterval(tick,DATE_CHECK_MS);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); });
  };
  let ready=false; try{ ready=!!(fd.contentWindow&&fd.contentWindow.__chichibu); }catch(_){}
  if(ready) init(); else fd.addEventListener('load',init,{once:true});
}

/* ===== 運行情報のポップアップ =====
   boot() が5秒ごとに取得して window.__trainInfo に入れる運行情報(GAS)を見て、遅延・運休などの運行情報があるときは、
   臨時列車と同じように、開いたときにポップアップで知らせる。在線モニターの「⚠ 運行情報」が出る条件(status が "delay")と同じ。
   追加の通信はしない。同じ内容では出し直さず、内容(text)が変わったときだけ出し直す。運行情報がなくなったら閉じる。 */
const IN={at:0,sig:null};
function infoClose(){ const e=document.getElementById('infoPop'); if(e) e.remove(); }
function infoFmt(v){
  if(v==null||v==='') return '';
  const d=new Date(v);
  if(typeof v==='string'&&!isNaN(d.getTime())&&/\d{4}/.test(v)) return (d.getMonth()+1)+'月'+d.getDate()+'日 '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  return String(v);
}
function infoPopup(text,last){
  const mk=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };
  infoClose();
  const el=mk('div'); el.id='infoPop'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-labelledby','infoPopT');
  const box=mk('div','ex-box'), h=mk('div','ex-head','⚠ 運行情報'); h.id='infoPopT'; box.appendChild(h);
  const upd=infoFmt(last); if(upd) box.appendChild(mk('div','ex-sub','更新: '+upd));
  box.appendChild(mk('div','ex-text',text||'運行情報があります(内容を取得できませんでした)'));
  const foot=mk('div','ex-foot'), b=mk('button',null,'閉じる'); b.type='button'; b.addEventListener('click',infoClose); foot.appendChild(b); box.appendChild(foot);
  el.appendChild(box); document.body.appendChild(el); b.focus();
}
function infoWatch(){
  let p; try{ p=window.__trainInfo; }catch(_){ return; }
  if(!p||!p.data||p.at===IN.at) return;                           // 新しく取得された結果だけを見る
  IN.at=p.at;
  const d=p.data, delay=d.status==='delay', text=String(d.text==null?'':d.text).trim();
  const sig=delay?('delay|'+text):'normal';
  if(sig===IN.sig) return;                                        // 同じ内容では出し直さない(5秒ごとの取得でも)
  IN.sig=sig;
  if(delay) infoPopup(text,d.lastUpdate); else infoClose();
}
function infoStart(){ infoWatch(); setInterval(infoWatch,1000); }

/* unlock(鍵, {url:ログイン管理のURL, tok:通行証, dev:端末ID}) → show() の順に index.html から呼ばれる */
window.ChichibuViewer={unlock:function(key,ctx){ EX.ctx=ctx||null; return decryptAll(key); },show:function(){ boot(); exStart(); infoStart(); }};
})();
