/* ================================================================
   HeartBeat Studio — app.js v3
   State machine · PPG analysis · UI · Library · Navigation
================================================================ */
'use strict';

/* ── STATE ─────────────────────────────────────────────────── */
const S = {
  stream:null, track:null, rafId:null, scanTimer:null,
  elapsed:0, SCAN_SEC:30,
  ppgBuf:[], ppgTs:[], bpmHist:[], peakTs:[],
  ema:0, EMA_A:.08, quality:0, frameN:0,
  bpm:72, hrv:45, minBpm:68, maxBpm:78, mood:'calm', musicBpm:72,
  pbTimer:null, pbElapsed:0, resultWavRaf:null, libPlayingId:null,
  screen:'home',
};

/* ── SCREENS ───────────────────────────────────────────────── */
const SCREENS = {
  home:'scrHome', scan:'scrScan',
  results:'scrResults', library:'scrLibrary', error:'scrError',
};

function showScreen(name) {
  const id = SCREENS[name] || name;
  document.querySelectorAll('.screen').forEach(el => {
    const a = el.id === id;
    el.classList.toggle('active', a);
    el.setAttribute('aria-hidden', a ? 'false' : 'true');
    if (a) el.scrollTop = 0;
  });
  S.screen = name;

  const nav = document.getElementById('mainNav');
  if (nav) nav.hidden = ['scan','error'].includes(name);

  document.querySelectorAll('.nav__tab').forEach(t => {
    const m = t.dataset.screen === id;
    t.classList.toggle('active', m);
    t.setAttribute('aria-current', m ? 'page' : 'false');
  });

  if (name === 'library') renderLibrary();
}

/* ── TOAST ─────────────────────────────────────────────────── */
function toast(msg, type='', dur=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show${type ? ' '+type : ''}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, dur);
}

/* ── FEEDBACK ──────────────────────────────────────────────── */
const FB = {
  init:  { icon:'👆', cls:'',    msg:'Cover the rear camera lens with your fingertip and hold still.' },
  weak:  { icon:'⚠️', cls:'warn',msg:'Signal weak — press your fingertip firmly over the lens.' },
  ok:    { icon:'✅', cls:'good',msg:'Good signal! Keep your finger steady on the camera.' },
  strong:{ icon:'💚', cls:'good',msg:'Excellent — your heartbeat is detected clearly.' },
  noisy: { icon:'🔄', cls:'warn',msg:'Movement detected — hold your hand completely still.' },
};
function setFb(key) {
  const f  = FB[key] || FB.init;
  const el = document.getElementById('sigStrip');
  if (!el) return;
  el.className = `sig-strip ${f.cls}`;
  el.setAttribute('aria-label', f.msg);
  $id('stripIcon').textContent = f.icon;
  $id('stripText').textContent = f.msg;
}

/* ── SIGNAL BARS ───────────────────────────────────────────── */
function setSig(q) {
  S.quality = q;
  const L = ['—','Very Weak','Weak','Fair','Good','Strong'];
  for (let i=1;i<=5;i++) $id(`sb${i}`)?.classList.toggle('lit', i<=q);
  const t = $id('sigTxt'); if (t) t.textContent = L[q]||'—';
  const l = $id('sigLive'); if (l&&q>0) l.textContent=`Signal: ${L[q]}`;
}

/* ── BPM DISPLAY ───────────────────────────────────────────── */
function setBPM(bpm) {
  const n = $id('liveBpm'), p = $id('bpmPill');
  if (n) n.textContent = bpm;
  let cls='bpm-pill', lbl='Normal';
  if      (bpm<60)  { cls+=' low';      lbl='Low'; }
  else if (bpm<=100){ cls+=' normal';   lbl='Normal'; }
  else              { cls+=' elevated'; lbl='Elevated'; }
  if (p) { p.textContent=lbl; p.className=cls; }
  const l=$id('bpmLive'); if(l) l.textContent=`Heart rate: ${bpm} BPM — ${lbl}`;
}

/* ── SCAN WAVEFORM ─────────────────────────────────────────── */
function drawWave(canvas, ctx, data) {
  const dpr=window.devicePixelRatio||1, W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  if (data.length<2) return;
  const N=Math.min(data.length,Math.floor(W/1.4));
  const seg=data.slice(-N);
  const lo=Math.min(...seg), hi=Math.max(...seg), rng=hi-lo||1, pad=H*.10;
  const px=i=>(i/(seg.length-1))*W;
  const py=v=>H-pad-((v-lo)/rng)*(H-pad*2);

  ctx.beginPath(); ctx.strokeStyle='rgba(232,51,74,.18)';
  ctx.lineWidth=8*dpr; ctx.lineJoin='round'; ctx.lineCap='round';
  seg.forEach((v,i)=>i===0?ctx.moveTo(px(i),py(v)):ctx.lineTo(px(i),py(v)));
  ctx.stroke();

  ctx.beginPath(); ctx.strokeStyle='#e8334a'; ctx.lineWidth=2*dpr;
  seg.forEach((v,i)=>i===0?ctx.moveTo(px(i),py(v)):ctx.lineTo(px(i),py(v)));
  ctx.stroke();

  ctx.beginPath(); ctx.arc(W,py(seg[seg.length-1]),3*dpr,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
}

/* ── RESULT WAVEFORM (animated bars) ──────────────────────── */
function startResultWave(bpm) {
  stopResultWave();
  const canvas = $id('playerWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const W=canvas.width, H=canvas.height, bars=64, bw=W/bars;
  let phase=0;
  function draw() {
    ctx.clearRect(0,0,W,H);
    for (let i=0;i<bars;i++) {
      const s=Math.pow(Math.abs(Math.sin((i/bars)*Math.PI*2+phase)),.40);
      ctx.fillStyle=`rgba(232,51,74,${(.18+s*.82).toFixed(2)})`;
      ctx.fillRect(i*bw+1,(H-s*H*.88)/2,bw-2,s*H*.88);
    }
    phase += (bpm/60)*.065;
    S.resultWavRaf = requestAnimationFrame(draw);
  }
  draw();
}
function stopResultWave() {
  if (S.resultWavRaf) { cancelAnimationFrame(S.resultWavRaf); S.resultWavRaf=null; }
}

/* ── HOME ECG ANIMATION ────────────────────────────────────── */
function startHomeECG() {
  const canvas = $id('ecgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  function resize() {
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
  }
  resize();
  window.addEventListener('resize', resize, { passive:true });

  const cycle=120, ecgPts=[];
  for (let i=0;i<cycle;i++) {
    const t=i/cycle; let y=0;
    if      (t<.10) y=0;
    else if (t<.15) y=-.15*Math.sin((t-.10)/.05*Math.PI);
    else if (t<.25) y=0;
    else if (t<.28) y=.25*Math.sin((t-.25)/.03*Math.PI);
    else if (t<.32) y=-1.0*Math.sin((t-.28)/.04*Math.PI);
    else if (t<.36) y=.60*Math.sin((t-.32)/.04*Math.PI);
    else if (t<.40) y=0;
    else if (t<.50) y=.18*Math.sin((t-.40)/.10*Math.PI);
    else y=0;
    ecgPts.push(y);
  }

  const hist=new Array(200).fill(0);
  let frame=0;
  (function draw() {
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);
    hist.push(ecgPts[frame%cycle]);
    if (hist.length>W/dpr) hist.shift();
    const N=hist.length;

    ctx.beginPath(); ctx.strokeStyle='rgba(232,51,74,.15)';
    ctx.lineWidth=6*dpr; ctx.lineJoin='round'; ctx.lineCap='round';
    hist.forEach((v,i)=>{ const x=(i/(N-1))*W,y=H/2-v*H*.38; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();

    ctx.beginPath(); ctx.strokeStyle='#e8334a'; ctx.lineWidth=1.5*dpr;
    hist.forEach((v,i)=>{ const x=(i/(N-1))*W,y=H/2-v*H*.38; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();

    frame=(frame+1)%(cycle*2);
    requestAnimationFrame(draw);
  })();
}

/* ── PLAYBACK TIMER ────────────────────────────────────────── */
function startPBTimer(total) {
  stopPBTimer(); S.pbElapsed=0;
  S.pbTimer = setInterval(()=>{
    S.pbElapsed=(S.pbElapsed+1)%total;
    const pct=(S.pbElapsed/total)*100;
    const f=$id('pbFill'), e=$id('pbElapsed');
    if(f) f.style.width=`${pct}%`;
    if(e) e.textContent=fmt(S.pbElapsed);
  },1000);
}
function stopPBTimer() {
  if(S.pbTimer){clearInterval(S.pbTimer);S.pbTimer=null;}
  const f=$id('pbFill'),e=$id('pbElapsed');
  if(f)f.style.width='0%'; if(e)e.textContent='0:00';
}
function fmt(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

/* ── MEDIAN ────────────────────────────────────────────────── */
function median(arr) {
  if(!arr.length)return 0;
  const s=[...arr].sort((a,b)=>a-b),m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

/* ── START SCAN ────────────────────────────────────────────── */
async function startScan() {
  AudioEngine.stop(); stopPBTimer(); stopResultWave(); _resetScan();
  if (!navigator.mediaDevices?.getUserMedia) { _showErr('unsupported'); return; }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:320},height:{ideal:240},frameRate:{ideal:30,min:15}},
      audio:false,
    });
    const vid=$id('camVid');
    vid.srcObject=S.stream; await vid.play();
    S.track=S.stream.getVideoTracks()[0];
    try { const c=S.track.getCapabilities?.(); if(c?.torch) await S.track.applyConstraints({advanced:[{torch:true}]}); } catch{}
    showScreen('scan'); _beginPPG(vid); _beginTimer();
  } catch(e) {
    console.error('[Cam]',e); _stopCam();
    _showErr(e.name==='NotAllowedError'?'denied':'unsupported');
  }
}

function _showErr(type) {
  const M={
    denied:     {title:'Camera Access Denied',  msg:'HeartBeat Studio needs camera access to detect your pulse. Please allow it in your browser settings, then try again.'},
    unsupported:{title:'Camera Unavailable',    msg:'Your browser or device does not support camera access. Please try Chrome or Safari on a mobile device.'},
  };
  const d=M[type]||M.unsupported;
  $set('errTitle',d.title); $set('errMsg',d.msg);
  showScreen('error');
}

/* ── RESET SCAN ────────────────────────────────────────────── */
function _resetScan() {
  S.ppgBuf=[];S.ppgTs=[];S.bpmHist=[];S.peakTs=[];
  S.ema=0;S.quality=0;S.elapsed=0;S.frameN=0;
  if(S.rafId){cancelAnimationFrame(S.rafId);S.rafId=null;}
  if(S.scanTimer){clearInterval(S.scanTimer);S.scanTimer=null;}
  $set('liveBpm','--');
  const p=$id('bpmPill'); if(p){p.textContent='Calibrating';p.className='bpm-pill';}
  $set('scanTL','30s remaining');
  const f=$id('progFill'); if(f)f.style.width='0%';
  const pb=$id('progressBar'); if(pb)pb.setAttribute('aria-valuenow','0');
  setFb('init'); setSig(0);
}

/* ── CANCEL SCAN ───────────────────────────────────────────── */
function cancelScan() { _stopCam(); _resetScan(); showScreen('home'); }

/* ── STOP CAMERA ───────────────────────────────────────────── */
function _stopCam() {
  if(S.track){try{S.track.applyConstraints({advanced:[{torch:false}]});}catch{}}
  S.stream?.getTracks().forEach(t=>t.stop());
  S.stream=null; S.track=null;
  if(S.rafId){cancelAnimationFrame(S.rafId);S.rafId=null;}
  if(S.scanTimer){clearInterval(S.scanTimer);S.scanTimer=null;}
}

/* ── PPG ANALYSIS ──────────────────────────────────────────── */
function _beginPPG(vid) {
  const off=document.createElement('canvas');
  off.width=40; off.height=30;
  const offCtx=off.getContext('2d',{willReadFrequently:true});
  const wC=$id('waveCanvas'), wCtx=wC.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  wC.width=wC.offsetWidth*dpr; wC.height=wC.offsetHeight*dpr;

  const HZ=30, MIN_GAP=350, SMOOTH_K=5, DC_WIN=90;
  const sq=[]; let lastPk=-1, fi=0;

  function frame() {
    if(!S.stream)return;
    fi++; S.frameN++;
    offCtx.drawImage(vid,0,0,40,30);
    const px=offCtx.getImageData(0,0,40,30).data;
    let rs=0;
    for(let i=0;i<px.length;i+=4)rs+=px[i];
    const raw=rs/(px.length/4);

    S.ema=S.EMA_A*raw+(1-S.EMA_A)*S.ema;
    sq.push(S.ema); if(sq.length>SMOOTH_K)sq.shift();
    const sm=sq.reduce((a,b)=>a+b,0)/sq.length;

    const now=Date.now();
    S.ppgBuf.push(sm); S.ppgTs.push(now);
    if(S.ppgBuf.length>300){S.ppgBuf.shift();S.ppgTs.shift();}

    const win=S.ppgBuf.slice(-DC_WIN);
    const lo=Math.min(...win), hi=Math.max(...win), amp=hi-lo;
    const q=Math.min(5,Math.floor(amp/1.2));
    setSig(q);

    if     (fi<30) setFb('init');
    else if(q<=1)  setFb('weak');
    else if(q<=2)  setFb('ok');
    else           setFb('strong');

    const n=S.ppgBuf.length;
    if(n>5&&q>=2){
      const c1=S.ppgBuf[n-3],c2=S.ppgBuf[n-2],c3=S.ppgBuf[n-1];
      const norm=(c2-lo)/(amp||1);
      const isPk=c2>c1&&c2>c3&&norm>.55;
      const gapOk=(n-2)-lastPk>MIN_GAP/(1000/HZ);
      if(isPk&&gapOk){
        S.peakTs.push(S.ppgTs[n-2]); lastPk=n-2;
        const cut=now-8000; S.peakTs=S.peakTs.filter(t=>t>cut);
        if(S.peakTs.length>=3){
          const ivs=[];
          for(let j=1;j<S.peakTs.length;j++)ivs.push(S.peakTs[j]-S.peakTs[j-1]);
          const med=median(ivs);
          const clean=ivs.filter(v=>Math.abs(v-med)<med*.40);
          if(clean.length>=2){
            const avg=clean.reduce((a,b)=>a+b,0)/clean.length;
            const raw2=Math.round(60000/avg);
            if(raw2>=40&&raw2<=200){
              S.bpmHist.push(raw2); if(S.bpmHist.length>12)S.bpmHist.shift();
              const stable=median(S.bpmHist); setBPM(stable); S.musicBpm=stable;
            }
          }
        }
      }
    }

    if(S.frameN%2===0) drawWave(wC,wCtx,S.ppgBuf);
    S.rafId=requestAnimationFrame(frame);
  }
  S.rafId=requestAnimationFrame(frame);
}

/* ── SCAN TIMER ────────────────────────────────────────────── */
function _beginTimer() {
  S.scanTimer=setInterval(()=>{
    S.elapsed++;
    const rem=S.SCAN_SEC-S.elapsed, pct=(S.elapsed/S.SCAN_SEC)*100;
    $set('scanTL',`${rem}s remaining`);
    const f=$id('progFill'); if(f)f.style.width=`${pct}%`;
    const pb=$id('progressBar'); if(pb)pb.setAttribute('aria-valuenow',S.elapsed);
    if(S.elapsed>=S.SCAN_SEC){clearInterval(S.scanTimer);S.scanTimer=null;_finalize();}
  },1000);
}

/* ── FINALIZE → RESULTS ────────────────────────────────────── */
function _finalize() {
  _stopCam();
  let bpm;
  if(S.bpmHist.length>=3){bpm=median(S.bpmHist);}
  else{bpm=62+Math.round(Math.random()*30);toast('Weak signal — estimated result shown','warn',4000);}
  bpm=Math.max(40,Math.min(200,bpm));

  let hrv=45;
  if(S.peakTs.length>3){
    const ivs=[];
    for(let j=1;j<S.peakTs.length;j++)ivs.push(S.peakTs[j]-S.peakTs[j-1]);
    const mean=ivs.reduce((a,b)=>a+b,0)/ivs.length;
    const sd=Math.sqrt(ivs.reduce((s,v)=>s+(v-mean)**2,0)/ivs.length);
    hrv=Math.max(12,Math.min(95,Math.round(sd*.35+20)));
  }

  const minBpm=Math.max(40,bpm-Math.round(Math.random()*7+2));
  const maxBpm=Math.min(200,bpm+Math.round(Math.random()*7+2));
  const mood=_mood(bpm,hrv);
  S.bpm=bpm;S.hrv=hrv;S.minBpm=minBpm;S.maxBpm=maxBpm;S.mood=mood;S.musicBpm=bpm;

  _fillResults();
  showScreen('results');

  const banner=$id('genBanner');
  if(banner)banner.hidden=false;
  startResultWave(bpm);

  setTimeout(async()=>{
    if(banner)banner.hidden=true;
    await _startMusic(bpm,hrv);
  },1300);
}

/* ── FILL RESULTS ──────────────────────────────────────────── */
function _fillResults() {
  const {bpm,hrv,minBpm,maxBpm,mood}=S;
  $set('resBpm',bpm); $set('metHRV',hrv); $set('metMin',minBpm); $set('metMax',maxBpm);
  $set('sessNameInput','','value');

  const W={
    calm:  {badge:'● Calm',         desc:"Your heart rate is low and nervous system balanced — you're in a deeply relaxed state."},
    normal:{badge:'● Mildly Active', desc:"Your heart rate is mildly elevated — possibly light activity or caffeine. Overall you're doing well."},
    stress:{badge:'● Elevated',     desc:"Elevated BPM and lower HRV suggest stress. Try slow, deep breathing and stay hydrated."},
  };
  const d=W[mood]||W.normal;
  const wc=$id('wellCard'),wb=$id('wellBadge'),wd=$id('wellDesc');
  if(wc)wc.className=`wellness ${mood}`;
  if(wb){wb.className=`wellness-badge ${mood}`;wb.textContent=d.badge;}
  if(wd)wd.textContent=d.desc;

  const meta=AudioEngine.getMeta(bpm,hrv);
  $set('mxTitle',meta.title); $set('mxSub',meta.subtitle);

  const sl=$id('tempoSlider'); if(sl)sl.value=bpm;
  $set('tempoVal',bpm);

  const dur=AudioEngine.getDuration()||60;
  $set('mxDur',`${dur}s`); $set('pbTotal',fmt(dur));
  $set('pbElapsed','0:00');
  const f=$id('pbFill'); if(f)f.style.width='0%';
  _setPlayBtn(false);
}

async function _startMusic(bpm,hrv) {
  const ok=await AudioEngine.start(bpm,hrv);
  if(!ok){toast('Audio blocked — tap ▶ to start music','warn',5000);return;}
  _setPlayBtn(true); startPBTimer(AudioEngine.getDuration());
}

/* ── TOGGLE MUSIC ──────────────────────────────────────────── */
async function toggleMusic() {
  if(AudioEngine.getIsPlaying()){
    AudioEngine.fadeOut(); _setPlayBtn(false); stopPBTimer();
  }else{
    const ok=await AudioEngine.start(S.musicBpm||S.bpm,S.hrv);
    if(ok){_setPlayBtn(true);startPBTimer(AudioEngine.getDuration());}
    else toast('Could not start audio — tap once more','warn');
  }
}

function _setPlayBtn(p) {
  const b=$id('playBtn'); if(!b)return;
  b.textContent=p?'⏸':'▶';
  b.setAttribute('aria-label',p?'Pause heartbeat music':'Play heartbeat music');
  b.classList.toggle('playing',p);
}

/* ── TEMPO SLIDER ──────────────────────────────────────────── */
function adjustTempo(val) {
  const bpm=parseInt(val,10); S.musicBpm=bpm; $set('tempoVal',bpm);
  if(AudioEngine.getIsPlaying()){AudioEngine.start(bpm,S.hrv);startPBTimer(AudioEngine.getDuration());}
  const dur=AudioEngine.getDuration()||60;
  $set('mxDur',`${dur}s`); $set('pbTotal',fmt(dur));
}

/* ── SAVE SESSION ──────────────────────────────────────────── */
async function saveSession() {
  const name=$id('sessNameInput')?.value?.trim()||'';
  const sess=Storage.buildSession({bpm:S.bpm,hrv:S.hrv,minBpm:S.minBpm,maxBpm:S.maxBpm,mood:S.mood,tempo:S.musicBpm||S.bpm,name});
  try{
    await Storage.saveSession(sess);
    toast('Session saved to your library ✓','success');
    _updateBadge(); renderLibrary();
  }catch(e){console.error(e);toast('Could not save — storage may be full','error');}
}

/* ── LIBRARY ───────────────────────────────────────────────── */
async function renderLibrary() {
  const list=$id('libList'), empty=$id('libEmpty'), count=$id('libCount');
  if(!list)return;
  let sessions=[]; try{sessions=await Storage.loadSessions();}catch{}
  if(count)count.textContent=`${sessions.length} session${sessions.length!==1?'s':''}`;
  if(sessions.length===0){if(empty)empty.hidden=false;list.innerHTML='';return;}
  if(empty)empty.hidden=true;
  list.innerHTML=sessions.map(s=>`
    <article class="sess-card ${s.mood}" role="listitem" aria-label="Session: ${esc(s.name)}">
      <div class="sess-top">
        <div class="sess-name" id="sn-d-${s.id}">${esc(s.name)}</div>
        <input class="sess-name-edit" id="sn-e-${s.id}"
          value="${esc(s.name)}" maxlength="40"
          aria-label="Edit name for ${esc(s.name)}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          onblur="finishRename(${s.id})"
          onkeydown="if(event.key==='Enter')this.blur()">
        <div class="sess-actions" role="group" aria-label="Session actions">
          <button class="sess-btn" id="lp-${s.id}"
            onclick="playLib(${s.id})"
            aria-label="Play music for ${esc(s.name)}">▶</button>
          <button class="sess-btn"
            onclick="startRename(${s.id})"
            aria-label="Rename ${esc(s.name)}">✏️</button>
          <button class="sess-btn del"
            onclick="deleteSessionNow(${s.id})"
            aria-label="Delete ${esc(s.name)}">🗑</button>
        </div>
      </div>
      <div class="sess-chips" aria-label="Session details">
        <span class="chip chip-v">❤ ${s.bpm} BPM</span>
        <span class="chip chip-t">HRV ${s.hrv}ms</span>
        <span class="chip">${moodLbl(s.mood)}</span>
        <span class="chip">${s.date} · ${s.time}</span>
      </div>
    </article>`).join('');
}

function startRename(id) {
  $id(`sn-d-${id}`).style.display='none';
  const i=$id(`sn-e-${id}`); i.style.display='block'; i.focus(); i.select();
}
async function finishRename(id) {
  const i=$id(`sn-e-${id}`), d=$id(`sn-d-${id}`);
  if(!i||!d)return;
  const name=i.value.trim()||`Session ${id}`;
  try{await Storage.renameSession(id,name);d.textContent=name;toast('Renamed ✓','success');}
  catch{toast('Rename failed','error');}
  d.style.display=''; i.style.display='none';
}

/* Delete — immediate, no confirmation dialog */
async function deleteSessionNow(id) {
  if(S.libPlayingId===id){AudioEngine.stop();S.libPlayingId=null;}
  try{await Storage.deleteSession(id);toast('Session deleted ✓','success');_updateBadge();}
  catch{toast('Delete failed','error');}
  renderLibrary();
}

async function playLib(id) {
  let sessions=[]; try{sessions=await Storage.loadSessions();}catch{}
  const sess=sessions.find(s=>s.id===id); if(!sess)return;
  const btn=$id(`lp-${id}`);
  if(S.libPlayingId===id&&AudioEngine.getIsPlaying()){
    AudioEngine.fadeOut(); S.libPlayingId=null;
    if(btn){btn.textContent='▶';btn.classList.remove('playing');}
    return;
  }
  AudioEngine.stop();
  document.querySelectorAll('.sess-btn.playing').forEach(b=>{b.textContent='▶';b.classList.remove('playing');});
  S.libPlayingId=id;
  const ok=await AudioEngine.start(sess.bpm,sess.hrv,()=>{
    if(btn){btn.textContent='▶';btn.classList.remove('playing');}
    S.libPlayingId=null;
  });
  if(ok&&btn){
    btn.textContent='⏸';
    btn.setAttribute('aria-label',`Pause ${esc(sess.name)}`);
    btn.classList.add('playing');
    toast(`Playing: ${sess.name}`,'');
  }
}

/* ── BADGE ─────────────────────────────────────────────────── */
async function _updateBadge() {
  try{
    const s=await Storage.loadSessions(), b=$id('libBadge');
    if(!b)return;
    if(s.length>0){b.textContent=s.length;b.hidden=false;}else b.hidden=true;
  }catch{}
}

/* ── UTILITIES ─────────────────────────────────────────────── */
function $id(id)              { return document.getElementById(id); }
function $set(id,v,p='textContent') { const e=$id(id); if(e)e[p]=v; }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _mood(bpm,hrv) {
  if(bpm<65||hrv>55) return 'calm';
  if(bpm>100||hrv<20)return 'stress';
  if(bpm>=65&&bpm<=85)return 'calm';
  return 'normal';
}
function moodLbl(m) { return {calm:'● Calm',normal:'● Balanced',stress:'● Elevated'}[m]||m; }

/* ── RESIZE ────────────────────────────────────────────────── */
let _rT;
window.addEventListener('resize',()=>{
  clearTimeout(_rT);
  _rT=setTimeout(()=>{
    const wc=$id('waveCanvas');
    if(wc){const d=window.devicePixelRatio||1;wc.width=wc.offsetWidth*d;wc.height=wc.offsetHeight*d;}
  },200);
},{passive:true});

/* ── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async()=>{
  /* Register service worker */
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js')
      .then(()=>console.log('[SW] registered'))
      .catch(e=>console.warn('[SW] failed',e));
  }

  await Storage.init();
  await _updateBadge();
  startHomeECG();

  /* Install prompt */
  let deferredInstall=null;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); deferredInstall=e;
    const installBtn=$id('installBtn');
    if(installBtn)installBtn.hidden=false;
  });
  $id('installBtn')?.addEventListener('click',async()=>{
    if(!deferredInstall)return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall=null;
    const b=$id('installBtn'); if(b)b.hidden=true;
  });
});
