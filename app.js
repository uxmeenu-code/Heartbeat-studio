/* ================================================================
   HeartBeat Studio — app.js v5
   Full rewrite integrating:
   • Free scan limit (3) + subscription gate
   • Volume control with localStorage persistence
   • Profile screen
   • Library inline-edit with Save button
   • Fixed empty-state logic
   • Mobile audio unlock on first interaction
================================================================ */
'use strict';

/* ── STATE ─────────────────────────────────────────────────── */
const S = {
  stream:null, track:null, rafId:null, scanTimer:null,
  elapsed:0, SCAN_SEC:30,
  ppgBuf:[], ppgTs:[], peakTs:[],
  ema:0, EMA_A:.08, quality:0, frameN:0,
  bpmHist:[], prevBpm:72, bpm:72, hrv:45,
  minBpm:68, maxBpm:78, mood:'balanced', musicBpm:72,
  amplitude:0, bpmTrend:'stable', lastBeatFlash:0, liveHrv:0,
  heartbeatTimeline:[], timelineTimer:null,
  pbTimer:null, pbElapsed:0,
  resultWavRaf:null, libPlayingId:null,
  evolutionTimer:null, evolutionStage:0,
  screen:'home',
  musicPaused:false,  /* user explicitly paused — don't auto-restart */
};

/* ── SCREENS ───────────────────────────────────────────────── */
function showScreen(name) {
  const prev = S.screen;

  /* ── Stop audio when navigating away ── */
  if (prev !== name) {
    /* Leaving results: stop result music completely */
    if (prev === 'results' && AudioEngine.getIsPlaying()) {
      AudioEngine.fadeOut(0.6);
      _setPlayBtn(false);
      stopPBTimer();
      _stopEvolution();
      AudioEngine.setBeatCallback(null);
      /* Reset paused flag — next time results opens it's a fresh state */
      S.musicPaused = false;
    }
    /* Leaving library: stop any library playback */
    if (prev === 'library' && S.libPlayingId !== null) {
      AudioEngine.stop();
      AudioEngine.setBeatCallback(null);
      S.libPlayingId = null;
      /* Clear playing button state in DOM */
      document.querySelectorAll('.sess-btn.playing').forEach(b => {
        b.textContent = '▶'; b.classList.remove('playing');
      });
    }
  }

  const MAP = {
    home:'scrHome', scan:'scrScan', results:'scrResults',
    library:'scrLibrary', profile:'scrProfile',
    upgrade:'scrUpgrade', error:'scrError',
  };
  const id = MAP[name] || name;
  document.querySelectorAll('.screen').forEach(el => {
    const a = el.id === id;
    el.classList.toggle('active', a);
    el.setAttribute('aria-hidden', a ? 'false' : 'true');
    if (a) el.scrollTop = 0;
  });
  S.screen = name;
  const nav = document.getElementById('mainNav');
  if (nav) nav.hidden = ['scan','error','upgrade'].includes(name);
  document.querySelectorAll('.nav__tab').forEach(t => {
    const m = t.dataset.screen === id;
    t.classList.toggle('active', m);
    t.setAttribute('aria-current', m ? 'page' : 'false');
  });
  if (name === 'library') renderLibrary();
  if (name === 'profile') _refreshProfileUI();
  if (name === 'home')    _refreshUsageBar();
}

/* ── TOAST ─────────────────────────────────────────────────── */
function toast(msg, type='', dur=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show${type ? ' '+type : ''}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, dur);
}

/* ── FEEDBACK ──────────────────────────────────────────────── */
const FB = {
  init:  { icon:'👆', cls:'',     msg:'Cover the rear camera lens with your fingertip and hold still.' },
  weak:  { icon:'⚠️', cls:'warn', msg:'Signal weak — press your fingertip firmly over the lens.' },
  ok:    { icon:'✅', cls:'good', msg:'Good signal! Keep your finger steady on the camera.' },
  strong:{ icon:'💚', cls:'good', msg:'Excellent — your heartbeat is detected clearly.' },
  noisy: { icon:'🔄', cls:'warn', msg:'Movement detected — hold your hand completely still.' },
};
function setFb(key) {
  const f = FB[key] || FB.init;
  const el = $id('sigStrip'); if (!el) return;
  el.className = `sig-strip ${f.cls}`;
  $id('stripIcon').textContent = f.icon;
  $id('stripText').textContent = f.msg;
}

/* ── SIGNAL BARS ───────────────────────────────────────────── */
function setSig(q) {
  S.quality = q;
  const L = ['—','Very Weak','Weak','Fair','Good','Strong'];
  for (let i = 1; i <= 5; i++) $id(`sb${i}`)?.classList.toggle('lit', i <= q);
  const t = $id('sigTxt'); if (t) t.textContent = L[q] || '—';
}

/* ── BPM DISPLAY ───────────────────────────────────────────── */
function setBPM(bpm) {
  const n = $id('liveBpm'), p = $id('bpmPill');
  if (n) n.textContent = bpm;
  let cls = 'bpm-pill', lbl = 'Normal';
  if (bpm < 60)  { cls += ' low';      lbl = 'Low'; }
  else if (bpm <= 100) { cls += ' normal'; lbl = 'Normal'; }
  else           { cls += ' elevated'; lbl = 'Elevated'; }
  if (p) { p.textContent = lbl; p.className = cls; }
}

/* ── BPM TREND ─────────────────────────────────────────────── */
function _computeTrend() {
  if (S.bpmHist.length < 8) return 'stable';
  const n = S.bpmHist.length;
  const diff = median(S.bpmHist.slice(n-4)) - median(S.bpmHist.slice(n-8, n-4));
  return diff >= 3 ? 'rising' : diff <= -3 ? 'falling' : 'stable';
}
function _updateTrend(trend) {
  if (trend === S.bpmTrend) return; S.bpmTrend = trend;
  const icon=$id('trendIcon'), txt=$id('trendTxt'), row=$id('trendRow'); if(!row) return;
  const MAP = { rising:['↑','Rising','trend-rising'], falling:['↓','Falling','trend-falling'], stable:['→','Stable','trend-stable'] };
  const [ic,lb,cls] = MAP[trend]||MAP.stable;
  if(icon) icon.textContent=ic; if(txt) txt.textContent=lb;
  row.className=`trend-row ${cls}`;
}

/* ── LIVE HRV ──────────────────────────────────────────────── */
function _updateLiveHRV() {
  if (S.peakTs.length < 3) return;
  const ivs = [];
  for (let j = 1; j < S.peakTs.length; j++) ivs.push(S.peakTs[j] - S.peakTs[j-1]);
  const mean = ivs.reduce((a,b)=>a+b,0) / ivs.length;
  const sd   = Math.sqrt(ivs.reduce((s,v)=>s+(v-mean)**2,0) / ivs.length);
  S.liveHrv  = Math.max(10, Math.min(100, Math.round(sd * 0.35 + 20)));
  const el   = $id('hrvLive'); if (el) el.textContent = `HRV: ${S.liveHrv}ms`;
}

/* ── BEAT FLASH ────────────────────────────────────────────── */
function _onScanBeat() {
  const now = Date.now(); if (now - S.lastBeatFlash < 300) return;
  S.lastBeatFlash = now;
  const wc = $id('waveCanvas');
  if (wc) { wc.classList.add('beat-flash'); setTimeout(()=>wc.classList.remove('beat-flash'), 280); }
  const bn = $id('liveBpm');
  if (bn) { bn.classList.add('bpm-beat'); setTimeout(()=>bn.classList.remove('bpm-beat'), 280); }
}
function _onMusicBeat() {
  const ring = $id('beatRing'); if (!ring) return;
  ring.classList.remove('flash'); void ring.offsetWidth; ring.classList.add('flash');
}

/* ── WAVEFORMS ─────────────────────────────────────────────── */
function drawWave(canvas, ctx, data) {
  const dpr=window.devicePixelRatio||1, W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H); if (data.length < 2) return;
  const N=Math.min(data.length,Math.floor(W/1.4)), seg=data.slice(-N);
  const lo=Math.min(...seg), hi=Math.max(...seg), rng=hi-lo||1, pad=H*.10;
  const px=i=>(i/(seg.length-1))*W;
  const py=v=>H-pad-((v-lo)/rng)*(H-pad*2);
  ctx.beginPath(); ctx.strokeStyle='rgba(232,51,74,.18)'; ctx.lineWidth=8*dpr;
  ctx.lineJoin='round'; ctx.lineCap='round';
  seg.forEach((v,i)=>i===0?ctx.moveTo(px(i),py(v)):ctx.lineTo(px(i),py(v)));
  ctx.stroke();
  ctx.beginPath(); ctx.strokeStyle='#e8334a'; ctx.lineWidth=2*dpr;
  seg.forEach((v,i)=>i===0?ctx.moveTo(px(i),py(v)):ctx.lineTo(px(i),py(v)));
  ctx.stroke();
  ctx.beginPath(); ctx.arc(W,py(seg[seg.length-1]),3*dpr,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
}

function startResultWave(bpm) {
  stopResultWave();
  const canvas=$id('playerWave'); if(!canvas)return;
  const ctx=canvas.getContext('2d'), dpr=window.devicePixelRatio||1;
  canvas.width=canvas.offsetWidth*dpr; canvas.height=canvas.offsetHeight*dpr;
  const W=canvas.width, H=canvas.height, bars=64, bw=W/bars; let phase=0;
  (function draw() {
    ctx.clearRect(0,0,W,H);
    for(let i=0;i<bars;i++){
      const s=Math.pow(Math.abs(Math.sin((i/bars)*Math.PI*2+phase)),.40);
      ctx.fillStyle=`rgba(232,51,74,${(.18+s*.82).toFixed(2)})`;
      ctx.fillRect(i*bw+1,(H-s*H*.88)/2,bw-2,s*H*.88);
    }
    phase+=(bpm/60)*.065; S.resultWavRaf=requestAnimationFrame(draw);
  })();
}
function stopResultWave() { if(S.resultWavRaf){cancelAnimationFrame(S.resultWavRaf);S.resultWavRaf=null;} }

/* ── HOME ECG ──────────────────────────────────────────────── */
function startHomeECG() {
  const canvas=$id('ecgCanvas'); if(!canvas)return;
  const ctx=canvas.getContext('2d'), dpr=window.devicePixelRatio||1;
  function resize(){ canvas.width=canvas.offsetWidth*dpr; canvas.height=canvas.offsetHeight*dpr; }
  resize(); window.addEventListener('resize',resize,{passive:true});
  const cycle=120, ecgPts=[];
  for(let i=0;i<cycle;i++){
    const t=i/cycle; let y=0;
    if(t<.10)y=0; else if(t<.15)y=-.15*Math.sin((t-.10)/.05*Math.PI);
    else if(t<.25)y=0; else if(t<.28)y=.25*Math.sin((t-.25)/.03*Math.PI);
    else if(t<.32)y=-1.0*Math.sin((t-.28)/.04*Math.PI);
    else if(t<.36)y=.60*Math.sin((t-.32)/.04*Math.PI);
    else if(t<.40)y=0; else if(t<.50)y=.18*Math.sin((t-.40)/.10*Math.PI); else y=0;
    ecgPts.push(y);
  }
  const hist=new Array(200).fill(0); let frame=0;
  (function draw(){
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);
    hist.push(ecgPts[frame%cycle]); if(hist.length>W/dpr) hist.shift();
    const N=hist.length;
    ctx.beginPath(); ctx.strokeStyle='rgba(232,51,74,.15)'; ctx.lineWidth=6*dpr;
    ctx.lineJoin='round'; ctx.lineCap='round';
    hist.forEach((v,i)=>{ const x=(i/(N-1))*W,y=H/2-v*H*.38; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();
    ctx.beginPath(); ctx.strokeStyle='#e8334a'; ctx.lineWidth=1.5*dpr;
    hist.forEach((v,i)=>{ const x=(i/(N-1))*W,y=H/2-v*H*.38; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();
    frame=(frame+1)%(cycle*2); requestAnimationFrame(draw);
  })();
}

/* ── PLAYBACK TIMER ────────────────────────────────────────── */
function startPBTimer(total) {
  stopPBTimer(); S.pbElapsed=0;
  S.pbTimer=setInterval(()=>{
    S.pbElapsed=(S.pbElapsed+1)%total;
    const f=$id('pbFill'), e=$id('pbElapsed');
    if(f)f.style.width=`${(S.pbElapsed/total)*100}%`;
    if(e)e.textContent=fmt(S.pbElapsed);
  },1000);
}
function stopPBTimer() {
  if(S.pbTimer){clearInterval(S.pbTimer);S.pbTimer=null;}
  const f=$id('pbFill'), e=$id('pbElapsed');
  if(f)f.style.width='0%'; if(e)e.textContent='0:00';
}

/* ── TIMELINE ──────────────────────────────────────────────── */
function _snapshotTimeline() {
  if(!S.bpmHist.length)return;
  const bpm=median(S.bpmHist);
  S.heartbeatTimeline.push({time:S.elapsed,bpm,hrv:S.liveHrv||45,amplitude:S.amplitude,mood:_mood(bpm,S.liveHrv||45)});
}
function _addTimelineDot(mood) {
  const strip=$id('timelineStrip'); if(!strip)return;
  const dot=document.createElement('div');
  dot.className=`tl-dot tl-${mood}`; strip.appendChild(dot);
}

/* ── EVOLUTION ─────────────────────────────────────────────── */
const STAGE_INTERVALS=[0,20000,40000,60000];
function _startEvolution() {
  _stopEvolution(); S.evolutionStage=0;
  AudioEngine.setStage(0); _updateStageBadge(0);
  STAGE_INTERVALS.forEach((ms,idx)=>{
    if(idx===0)return;
    setTimeout(()=>{ if(!AudioEngine.getIsPlaying())return; S.evolutionStage=idx; AudioEngine.setStage(idx); _updateStageBadge(idx); },ms);
  });
}
function _stopEvolution() { if(S.evolutionTimer){clearTimeout(S.evolutionTimer);S.evolutionTimer=null;} }
function _updateStageBadge(n) {
  const badge=$id('stageBadge'), txt=$id('stageTxt');
  if(!badge||!txt)return;
  badge.hidden=false; txt.textContent=AudioEngine.getStageName(n);
  badge.classList.add('stage-new'); setTimeout(()=>badge.classList.remove('stage-new'),800);
}

/* ── USAGE BAR ─────────────────────────────────────────────── */
function _refreshUsageBar() {
  const bar = $id('usageBar'), chips = $id('usageChips'), lbl = $id('usageBarLabel');
  if (!bar) return;
  if (Storage.isSubscribed()) { bar.hidden = true; return; }
  const { freeScansUsed } = Storage.getUsage();
  const limit = Storage.FREE_LIMIT;
  bar.hidden = false;
  if (chips) {
    chips.innerHTML = '';
    for (let i = 0; i < limit; i++) {
      const d = document.createElement('div');
      d.className = `usage-dot${i < freeScansUsed ? ' used' : ''}`;
      chips.appendChild(d);
    }
  }
  const remaining = Math.max(0, limit - freeScansUsed);
  if (lbl) lbl.textContent = remaining === 0 ? 'Free scans used up' : `${remaining} free scan${remaining===1?'':'s'} remaining`;
}

/* ── SCAN GATE ─────────────────────────────────────────────── */
async function startScan() {
  /* Mobile audio unlock on user gesture */
  try { await AudioEngine.resume(); } catch {}

  const gate = Storage.canScan();
  if (!gate.allowed) { showScreen('upgrade'); return; }

  AudioEngine.stop(); AudioEngine.setBeatCallback(null);
  stopPBTimer(); stopResultWave(); _resetScan();

  if (!navigator.mediaDevices?.getUserMedia) { _showErr('unsupported'); return; }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:320},height:{ideal:240},frameRate:{ideal:30,min:15}},
      audio:false,
    });
    const vid=$id('camVid');
    vid.srcObject=S.stream; await vid.play();
    S.track=S.stream.getVideoTracks()[0];
    try { const c=S.track.getCapabilities?.(); if(c?.torch)await S.track.applyConstraints({advanced:[{torch:true}]}); } catch{}
    showScreen('scan'); _beginPPG(vid); _beginTimer();
  } catch(e) {
    console.error('[Cam]',e); _stopCam();
    _showErr(e.name==='NotAllowedError'?'denied':'unsupported');
  }
}

function _showErr(type) {
  const M={
    denied:{title:'Camera Access Denied',msg:'HeartBeat Studio needs camera access. Please allow it in settings.'},
    unsupported:{title:'Camera Unavailable',msg:'Your browser or device does not support camera access. Try Chrome or Safari.'},
  };
  const d=M[type]||M.unsupported; $set('errTitle',d.title); $set('errMsg',d.msg); showScreen('error');
}

/* ── RESET ─────────────────────────────────────────────────── */
function _resetScan() {
  S.ppgBuf=[];S.ppgTs=[];S.bpmHist=[];S.peakTs=[];
  S.ema=0;S.quality=0;S.elapsed=0;S.frameN=0;
  S.prevBpm=72;S.amplitude=0;S.bpmTrend='stable';S.liveHrv=0;
  S.heartbeatTimeline=[]; S.lastBeatFlash=0;
  if(S.timelineTimer){clearInterval(S.timelineTimer);S.timelineTimer=null;}
  if(S.rafId){cancelAnimationFrame(S.rafId);S.rafId=null;}
  if(S.scanTimer){clearInterval(S.scanTimer);S.scanTimer=null;}
  $set('liveBpm','--');
  const p=$id('bpmPill'); if(p){p.textContent='Calibrating';p.className='bpm-pill';}
  $set('scanTL','30s remaining');
  const f=$id('progFill'); if(f)f.style.width='0%';
  const pb=$id('progressBar'); if(pb)pb.setAttribute('aria-valuenow','0');
  setFb('init'); setSig(0);
  const strip=$id('timelineStrip'); if(strip)strip.innerHTML='';
  _updateTrend('stable');
  const hv=$id('hrvLive'); if(hv)hv.textContent='HRV: --';
}

function cancelScan() { _stopCam(); _resetScan(); showScreen('home'); }

function _stopCam() {
  if(S.track){try{S.track.applyConstraints({advanced:[{torch:false}]});}catch{}}
  S.stream?.getTracks().forEach(t=>t.stop());
  S.stream=null; S.track=null;
  if(S.rafId){cancelAnimationFrame(S.rafId);S.rafId=null;}
  if(S.scanTimer){clearInterval(S.scanTimer);S.scanTimer=null;}
  if(S.timelineTimer){clearInterval(S.timelineTimer);S.timelineTimer=null;}
}

/* ── PPG ANALYSIS ──────────────────────────────────────────── */
function _beginPPG(vid) {
  const off=document.createElement('canvas'); off.width=40; off.height=30;
  const offCtx=off.getContext('2d',{willReadFrequently:true});
  const wC=$id('waveCanvas'), wCtx=wC.getContext('2d'), dpr=window.devicePixelRatio||1;
  wC.width=wC.offsetWidth*dpr; wC.height=wC.offsetHeight*dpr;
  const HZ=30, MIN_GAP=350, SMOOTH_K=5, DC_WIN=90;
  const sq=[]; let lastPk=-1, fi=0;
  function frame() {
    if(!S.stream)return; fi++; S.frameN++;
    offCtx.drawImage(vid,0,0,40,30);
    const px=offCtx.getImageData(0,0,40,30).data; let rs=0;
    for(let i=0;i<px.length;i+=4) rs+=px[i];
    const raw=rs/(px.length/4);
    S.ema=S.EMA_A*raw+(1-S.EMA_A)*S.ema;
    sq.push(S.ema); if(sq.length>SMOOTH_K)sq.shift();
    const sm=sq.reduce((a,b)=>a+b,0)/sq.length;
    const now=Date.now();
    S.ppgBuf.push(sm); S.ppgTs.push(now);
    if(S.ppgBuf.length>300){S.ppgBuf.shift();S.ppgTs.shift();}
    const win=S.ppgBuf.slice(-DC_WIN);
    const lo=Math.min(...win), hi=Math.max(...win), amp=hi-lo;
    S.amplitude=Math.min(1,amp/8);
    const q=Math.min(5,Math.floor(amp/1.2)); setSig(q);
    if(fi<30)setFb('init'); else if(q<=1)setFb('weak'); else if(q<=2)setFb('ok'); else setFb('strong');
    const n=S.ppgBuf.length;
    if(n>5&&q>=2){
      const c1=S.ppgBuf[n-3],c2=S.ppgBuf[n-2],c3=S.ppgBuf[n-1];
      const norm=(c2-lo)/(amp||1);
      const isPk=c2>c1&&c2>c3&&norm>.55;
      const gapOk=(n-2)-lastPk>MIN_GAP/(1000/HZ);
      if(isPk&&gapOk){
        S.peakTs.push(S.ppgTs[n-2]); lastPk=n-2;
        const cut=now-8000; S.peakTs=S.peakTs.filter(t=>t>cut);
        _onScanBeat();
        if(S.peakTs.length>=3){
          const ivs=[];
          for(let j=1;j<S.peakTs.length;j++) ivs.push(S.peakTs[j]-S.peakTs[j-1]);
          const med=median(ivs), clean=ivs.filter(v=>Math.abs(v-med)<med*.40);
          if(clean.length>=2){
            const avg=clean.reduce((a,b)=>a+b,0)/clean.length;
            const rawBpm=Math.round(60000/avg);
            if(rawBpm>=40&&rawBpm<=200){
              const smoothBpm=Math.round(0.7*S.prevBpm+0.3*rawBpm); S.prevBpm=smoothBpm;
              S.bpmHist.push(smoothBpm); if(S.bpmHist.length>12)S.bpmHist.shift();
              const stable=median(S.bpmHist); setBPM(stable); S.musicBpm=stable;
              _updateTrend(_computeTrend()); _updateLiveHRV();
            }
          }
        }
      }
    }
    if(S.frameN%2===0)drawWave(wC,wCtx,S.ppgBuf);
    S.rafId=requestAnimationFrame(frame);
  }
  S.rafId=requestAnimationFrame(frame);
}

/* ── SCAN TIMER ────────────────────────────────────────────── */
function _beginTimer() {
  S.timelineTimer=setInterval(()=>{
    _snapshotTimeline();
    if(S.bpmHist.length) _addTimelineDot(_mood(median(S.bpmHist),S.liveHrv||45));
  },10000);
  S.scanTimer=setInterval(()=>{
    S.elapsed++;
    const rem=S.SCAN_SEC-S.elapsed, pct=(S.elapsed/S.SCAN_SEC)*100;
    $set('scanTL',`${rem}s remaining`);
    const f=$id('progFill'); if(f)f.style.width=`${pct}%`;
    const pb=$id('progressBar'); if(pb)pb.setAttribute('aria-valuenow',S.elapsed);
    if(S.elapsed>=S.SCAN_SEC){clearInterval(S.scanTimer);S.scanTimer=null;_finalize();}
  },1000);
}

/* ── FINALIZE ──────────────────────────────────────────────── */
function _finalize() {
  _stopCam();

  /* Reset paused flag — new scan always starts fresh */
  S.musicPaused = false;

  /* Increment free scan usage (subscribed users unaffected but call is safe) */
  Storage.incrementUsage();

  let bpm;
  if(S.bpmHist.length>=3){bpm=median(S.bpmHist);}
  else{bpm=62+Math.round(Math.random()*30);toast('Weak signal — estimated result shown','warn',4000);}
  bpm=Math.max(40,Math.min(200,bpm));

  let hrv=45;
  if(S.peakTs.length>3){
    const ivs=[]; for(let j=1;j<S.peakTs.length;j++) ivs.push(S.peakTs[j]-S.peakTs[j-1]);
    const mean=ivs.reduce((a,b)=>a+b,0)/ivs.length;
    const sd=Math.sqrt(ivs.reduce((s,v)=>s+(v-mean)**2,0)/ivs.length);
    hrv=Math.max(12,Math.min(95,Math.round(sd*.35+20)));
  }

  const minBpm=Math.max(40,bpm-Math.round(Math.random()*7+2));
  const maxBpm=Math.min(200,bpm+Math.round(Math.random()*7+2));
  const mood=_mood(bpm,hrv);
  S.bpm=bpm;S.hrv=hrv;S.minBpm=minBpm;S.maxBpm=maxBpm;S.mood=mood;S.musicBpm=bpm;
  _snapshotTimeline(); _fillResults(); showScreen('results');

  const banner=$id('genBanner'); if(banner)banner.hidden=false;
  startResultWave(bpm);
  /* Resume AudioContext immediately — it was unlocked on user gesture (startScan).
     We then start music right away; the generating spinner shows until audio begins. */
  _startMusic(bpm,hrv).then(()=>{
    if(banner)banner.hidden=true;
  });
}

/* ── FILL RESULTS ──────────────────────────────────────────── */
function _fillResults() {
  const {bpm,hrv,minBpm,maxBpm,mood}=S;
  $set('resBpm',bpm);$set('metHRV',hrv);$set('metMin',minBpm);$set('metMax',maxBpm);
  $set('sessNameInput','','value');
  const W={
    calm:    {badge:'● Calm',     desc:"Your heart rate is low and nervous system balanced — you're in a deeply relaxed state."},
    balanced:{badge:'● Balanced', desc:"Your heart rate is in a healthy range. You're doing well."},
    stressed:{badge:'● Elevated', desc:"Elevated BPM and lower HRV suggest stress. Try slow, deep breathing."},
  };
  const d=W[mood]||W.balanced;
  const wc=$id('wellCard'),wb=$id('wellBadge'),wd=$id('wellDesc');
  if(wc)wc.className=`wellness ${mood}`;
  if(wb){wb.className=`wellness-badge ${mood}`;wb.textContent=d.badge;}
  if(wd)wd.textContent=d.desc;
  const meta=AudioEngine.getMeta(bpm,hrv);
  $set('mxTitle',meta.title); $set('mxSub',meta.subtitle);
  /* Show zone instrument label in wellness area */
  const zl=$id('zoneLabel'); if(zl)zl.textContent=meta.style;
  const sl=$id('tempoSlider'); if(sl)sl.value=bpm; $set('tempoVal',bpm);
  const dur=AudioEngine.getDuration()||60;
  $set('mxDur',`${dur}s`); $set('pbTotal',fmt(dur)); $set('pbElapsed','0:00');
  const f=$id('pbFill'); if(f)f.style.width='0%';
  _setPlayBtn(false);
  const sb=$id('stageBadge'); if(sb)sb.hidden=true;
  const il=$id('instrLabel'); if(il)il.hidden=true; /* shown after music starts */

  /* Restore volume slider */
  const saved=Storage.getVolume();
  const vs=$id('volSlider'); if(vs)vs.value=Math.round(saved*100);
  $set('volVal',`${Math.round(saved*100)}%`);
}

/* ── START MUSIC ───────────────────────────────────────────── */
async function _startMusic(bpm,hrv) {
  /* If user explicitly paused, don't auto-restart */
  if(S.musicPaused){ _setPlayBtn(false); return; }

  /* Show spinner on play button — disabled until audio is ready */
  _setPlayBtn('generating');

  /* Always attempt to resume the AudioContext.
     It was unlocked by the user gesture in startScan/toggleMusic,
     but may have been suspended during the 30s scan. */
  try { await AudioEngine.resume(); } catch {}

  /* Apply saved volume before starting */
  AudioEngine.setVolume(Storage.getVolume());
  const ok=await AudioEngine.start(bpm,hrv,S.heartbeatTimeline);

  if(!ok){
    _setPlayBtn(false);
    toast('Audio blocked — tap ▶ to start','warn',5000);
    return;
  }
  _setPlayBtn(true);
  startPBTimer(AudioEngine.getDuration());
  AudioEngine.setBeatCallback(_onMusicBeat);
  _startEvolution();
  const il2=$id('instrLabel'); if(il2)il2.hidden=false;
}

/* ── TOGGLE MUSIC ──────────────────────────────────────────── */
async function toggleMusic() {
  try { await AudioEngine.resume(); } catch {}
  if(AudioEngine.getIsPlaying()){
    /* User hit pause — mark as explicitly paused and stop */
    S.musicPaused = true;
    AudioEngine.stop();           /* immediate stop — not fadeOut */
    _setPlayBtn(false);
    stopPBTimer();
    AudioEngine.setBeatCallback(null);
    _stopEvolution();
  } else {
    /* User hit play — restart music */
    S.musicPaused = false;
    _setPlayBtn('generating');
    AudioEngine.setVolume(Storage.getVolume());
    const ok=await AudioEngine.start(S.musicBpm||S.bpm,S.hrv,S.heartbeatTimeline);
    if(ok){
      _setPlayBtn(true);
      startPBTimer(AudioEngine.getDuration());
      AudioEngine.setBeatCallback(_onMusicBeat);
      _startEvolution();
    } else {
      _setPlayBtn(false);
      toast('Could not start audio — tap once more','warn');
    }
  }
}
function _setPlayBtn(state) {
  const b=$id("playBtn"); if(!b)return;
  if(state==="generating"){
    b.textContent="";
    b.setAttribute("aria-label","Generating musicu2026");
    b.classList.remove("playing");
    b.classList.add("generating");
    b.disabled=true;
  } else {
    b.classList.remove("generating");
    b.disabled=false;
    b.textContent=state?"⏸":"▶";
    b.setAttribute("aria-label",state?"Pause music":"Play music");
    b.classList.toggle("playing",!!state);
  }
}

/* ── TEMPO ─────────────────────────────────────────────────── */
function adjustTempo(val) {
  const bpm=parseInt(val,10); S.musicBpm=bpm; $set('tempoVal',bpm);
  if(AudioEngine.getIsPlaying()){
    AudioEngine.start(bpm,S.hrv,S.heartbeatTimeline);
    AudioEngine.setBeatCallback(_onMusicBeat); _startEvolution();
    startPBTimer(AudioEngine.getDuration());
  }
  const dur=AudioEngine.getDuration()||60;
  $set('mxDur',`${dur}s`); $set('pbTotal',fmt(dur));
  $set('mxSub',AudioEngine.getMeta(bpm,S.hrv).subtitle);
}

/* ── VOLUME ────────────────────────────────────────────────── */
function adjustVolume(val) {
  const pct  = parseInt(val, 10);
  const level = pct / 100;
  Storage.setVolume(level);
  AudioEngine.setVolume(level);
  $set('volVal', `${pct}%`);
}

/* ── SAVE SESSION ──────────────────────────────────────────── */
async function saveSession() {
  const name=$id('sessNameInput')?.value?.trim()||'';
  const musicSeed=AudioEngine.getSessionSeed();
  const sess=Storage.buildSession({bpm:S.bpm,hrv:S.hrv,minBpm:S.minBpm,maxBpm:S.maxBpm,mood:S.mood,tempo:S.musicBpm||S.bpm,name,musicSeed});
  try{
    await Storage.saveSession(sess);
    toast('Session saved ✓','success'); _updateBadge(); renderLibrary();
  }catch(e){console.error(e);toast('Could not save — storage may be full','error');}
}

/* ── LIBRARY ───────────────────────────────────────────────── */
async function renderLibrary() {
  const list=$id('libList'), empty=$id('libEmpty'), count=$id('libCount');
  if(!list)return;
  let sessions=[]; try{sessions=await Storage.loadSessions();}catch{}
  if(count)count.textContent=`${sessions.length} session${sessions.length!==1?'s':''}`;
  /* Unambiguously control visibility — never rely solely on [hidden] */
  const hasData = sessions.length > 0;
  if(empty){
    empty.hidden = hasData;
    empty.style.display = hasData ? 'none' : 'flex';
    empty.style.setProperty('display', hasData ? 'none' : 'flex', 'important');
  }
  list.style.display = hasData ? '' : 'none';
  if(!hasData){ list.innerHTML=''; return; }
  list.innerHTML=sessions.map(s=>`
    <article class="sess-card ${s.mood}" role="listitem" aria-label="Session: ${esc(s.name)}">
      <div class="sess-top">
        <div class="sess-name" id="sn-d-${s.id}">${esc(s.name)}</div>
        <input class="sess-name-edit" id="sn-e-${s.id}"
          value="${esc(s.name)}" maxlength="40"
          aria-label="Edit name for ${esc(s.name)}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          onkeydown="if(event.key==='Enter')saveRename(${s.id})">
        <div class="sess-actions" role="group">
          <button class="sess-btn" id="lp-${s.id}" onclick="playLib(${s.id})" aria-label="Play">▶</button>
          <button class="sess-btn" id="edit-${s.id}" onclick="startRename(${s.id})" aria-label="Edit">✏️</button>
          <button class="sess-save-btn" id="save-${s.id}" onclick="saveRename(${s.id})">Save</button>
          <button class="sess-btn del" onclick="deleteSessionNow(${s.id})" aria-label="Delete">🗑</button>
        </div>
      </div>
      <div class="sess-chips">
        <span class="chip chip-v">❤ ${s.bpm} BPM</span>
        <span class="chip chip-t">HRV ${s.hrv}ms</span>
        <span class="chip">${moodLbl(s.mood)}</span>
        <span class="chip">${s.date} · ${s.time}</span>
      </div>
    </article>`).join('');
}

function startRename(id) {
  $id(`sn-d-${id}`).style.display='none';
  $id(`edit-${id}`).style.display='none';
  const i=$id(`sn-e-${id}`); i.style.display='block'; i.focus(); i.select();
  const s=$id(`save-${id}`); if(s)s.style.display='flex';
}
async function saveRename(id) {
  const input=$id(`sn-e-${id}`), display=$id(`sn-d-${id}`);
  const editBtn=$id(`edit-${id}`), saveBtn=$id(`save-${id}`);
  if(!input||!display)return;
  const name=input.value.trim()||`Session ${id}`;
  try{ await Storage.renameSession(id,name); display.textContent=name; toast('Renamed ✓','success'); }
  catch{ toast('Rename failed','error'); }
  display.style.display=''; input.style.display='none';
  if(editBtn)editBtn.style.display=''; if(saveBtn)saveBtn.style.display='none';
}
async function deleteSessionNow(id) {
  if(S.libPlayingId===id){AudioEngine.stop();AudioEngine.setBeatCallback(null);S.libPlayingId=null;}
  try{await Storage.deleteSession(id);toast('Session deleted ✓','success');_updateBadge();}
  catch{toast('Delete failed','error');}
  renderLibrary();
}
async function playLib(id) {
  let sessions=[]; try{sessions=await Storage.loadSessions();}catch{}
  const sess=sessions.find(s=>s.id===id); if(!sess)return;
  const btn=$id(`lp-${id}`);
  if(S.libPlayingId===id&&AudioEngine.getIsPlaying()){
    AudioEngine.fadeOut(); AudioEngine.setBeatCallback(null); S.libPlayingId=null;
    if(btn){btn.textContent='▶';btn.classList.remove('playing');}return;
  }
  AudioEngine.stop(); AudioEngine.setBeatCallback(null);
  document.querySelectorAll('.sess-btn.playing').forEach(b=>{b.textContent='▶';b.classList.remove('playing');});
  S.libPlayingId=id;
  try { await AudioEngine.resume(); } catch {}
  AudioEngine.setVolume(Storage.getVolume());
  const ok=await AudioEngine.start(sess.bpm,sess.hrv,sess.musicSeed||0,()=>{
    if(btn){btn.textContent='▶';btn.classList.remove('playing');}
    AudioEngine.setBeatCallback(null); S.libPlayingId=null;
  });
  if(ok&&btn){btn.textContent='⏸';btn.setAttribute('aria-label',`Pause`);btn.classList.add('playing');toast(`Playing: ${sess.name}`);}
}
async function _updateBadge() {
  try{
    const s=await Storage.loadSessions(),b=$id('libBadge'); if(!b)return;
    if(s.length>0){b.textContent=s.length;b.hidden=false;}else b.hidden=true;
  }catch{}
}

/* ── PROFILE — view/edit mode ──────────────────────────────── */
function enterProfileEdit() {
  /* Populate edit fields from storage before showing */
  const data = Storage.getProfile();
  const ni=$id('profName');   if(ni) ni.value  = data.name   || '';
  const ai=$id('profAge');    if(ai) ai.value   = data.age    || '';
  const gi=$id('profGender'); if(gi) gi.value   = data.gender || '';
  if(data.goal) selectGoal(data.goal);
  /* Switch modes */
  const vm=$id('profViewMode'), em=$id('profEditMode'), eb=$id('profEditBtn');
  if(vm) vm.hidden=true;
  if(em) em.hidden=false;
  if(eb) eb.hidden=true;
}
function cancelProfileEdit() {
  const vm=$id('profViewMode'), em=$id('profEditMode'), eb=$id('profEditBtn');
  if(vm) vm.hidden=false;
  if(em) em.hidden=true;
  if(eb) eb.hidden=false;
}
function saveProfile() {
  const name   = ($id('profName')?.value  || '').trim();
  const age    = ($id('profAge')?.value   || '').trim();
  const gender = $id('profGender')?.value || '';
  const goal   = document.querySelector('.goal-btn[aria-checked="true"]')?.dataset.goal || '';
  Storage.setProfile({name, age, gender, goal});
  /* Switch back to view mode first, then refresh */
  cancelProfileEdit();
  _refreshProfileUI();
  toast('Profile saved ✓', 'success');
}
function selectGoal(goal) {
  document.querySelectorAll('.goal-btn').forEach(btn =>
    btn.setAttribute('aria-checked', btn.dataset.goal === goal ? 'true' : 'false'));
}
async function _refreshProfileUI() {
  const data = Storage.getProfile();
  const name = data.name || '';

  /* Avatar letter */
  const al=$id('profAvatarLetter');
  if(al) al.textContent = name.trim() ? name.trim()[0].toUpperCase() : '?';

  /* ── VIEW mode: populate info card ── */
  const GOAL_LABELS = { relaxation:'🧘 Relaxation', fitness:'🏃 Fitness', stress:'🧠 Stress Monitoring', sleep:'🌙 Sleep Improvement' };
  const GENDER_LABELS = { male:'Male', female:'Female', nonbinary:'Non-binary', other:'Other', '':'—' };
  const hasAny = name || data.age || data.gender || data.goal;

  const emptyDiv = $id('profInfoEmpty'), rowsDiv = $id('profInfoRows');
  if(emptyDiv) emptyDiv.hidden = !!hasAny;
  if(rowsDiv)  rowsDiv.hidden  = !hasAny;

  if(hasAny) {
    /* Name row */
    const piName=$id('piName'), piNameVal=$id('piNameVal');
    if(piName)   { piName.hidden = !name;    if(piNameVal) piNameVal.textContent = name || '—'; }
    /* Age row */
    const piAge=$id('piAge'), piAgeVal=$id('piAgeVal');
    if(piAge)    { piAge.hidden = !data.age; if(piAgeVal) piAgeVal.textContent = data.age || '—'; }
    /* Gender row */
    const piGender=$id('piGender'), piGenderVal=$id('piGenderVal');
    if(piGender) { piGender.hidden = !data.gender; if(piGenderVal) piGenderVal.textContent = GENDER_LABELS[data.gender]||'—'; }
    /* Goal row */
    const piGoal=$id('piGoal'), piGoalVal=$id('piGoalVal');
    if(piGoal)   { piGoal.hidden = !data.goal; if(piGoalVal) piGoalVal.textContent = GOAL_LABELS[data.goal]||'—'; }
  }

  /* Stats */
  let sessions=[]; try{sessions=await Storage.loadSessions();}catch{}
  const count=sessions.length;
  const avgBpm=count?Math.round(sessions.reduce((s,x)=>s+(x.bpm||0),0)/count):null;
  const today=new Date();
  const toDay=d=>{const dt=new Date(d);return`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;};
  const dates=new Set(sessions.map(s=>toDay(s.date+' '+(s.time||''))));
  let streak=0;
  for(let i=0;i<365;i++){const d=new Date(today);d.setDate(d.getDate()-i);if(dates.has(toDay(d)))streak++;else if(i>0)break;}
  const ss=$id('profStatSessions'); if(ss) ss.textContent=count;
  const sb=$id('profStatAvgBpm');   if(sb) sb.textContent=avgBpm||'--';
  const st=$id('profStatStreak');   if(st) st.textContent=streak;

  /* ── Stress Index ── */
  /* Computed from avg HRV and avg BPM across all sessions.
     Lower HRV + higher BPM → higher stress. Range 0-100. */
  const stressBadge=$id('stressBadge'), stressBarFill=$id('stressBarFill'), stressDesc=$id('stressDesc');
  if (count > 0 && stressBadge) {
    const avgHrv = sessions.reduce((a,s)=>a+(s.hrv||45),0)/count;
    const avgBpm = sessions.reduce((a,s)=>a+(s.bpm||72),0)/count;
    /* Normalize: HRV 10-90ms (inverted), BPM 50-120 */
    const hrvScore = Math.max(0,Math.min(100, (1-(avgHrv-10)/80)*100 ));
    const bpmScore = Math.max(0,Math.min(100, ((avgBpm-50)/70)*100 ));
    const stressIdx = Math.round(hrvScore*0.65 + bpmScore*0.35);
    const si = Math.max(0,Math.min(100,stressIdx));
    stressBadge.textContent = si < 30 ? `${si} — Low` : si < 60 ? `${si} — Moderate` : `${si} — High`;
    stressBadge.className = 'stress-badge ' + (si < 30 ? 'low' : si < 60 ? 'moderate' : 'high');
    if(stressBarFill) stressBarFill.style.width = si+'%';
    if(stressDesc){
      if(si < 30) stressDesc.textContent = 'Your HRV and heart rate suggest a relaxed, well-recovered state.';
      else if(si < 60) stressDesc.textContent = 'Moderate stress detected. Your body is in an alert but balanced state.';
      else stressDesc.textContent = 'Elevated stress markers. Try slow breathing or a meditation session.';
    }
  } else if (stressBadge) {
    stressBadge.textContent = '—';
    if(stressDesc) stressDesc.textContent = 'Complete a scan to see your stress index.';
  }

  /* Subscription state */
  const sub=Storage.isSubscribed();
  const pill=$id('subPill'), desc=$id('subDesc'), card=$id('subCard');
  if(sub){
    if(pill){pill.textContent='Premium';pill.className='sub-pill premium';}
    if(desc) desc.textContent='You have unlimited access to all HeartBeat Studio features.';
    if(card){const btn=card.querySelector('.btn-upgrade');if(btn)btn.hidden=true;}
  } else {
    const{freeScansUsed}=Storage.getUsage();
    if(pill){pill.textContent='Free Plan';pill.className='sub-pill';}
    if(desc) desc.textContent=`${freeScansUsed}/${Storage.FREE_LIMIT} free scans used. Upgrade for unlimited access.`;
  }
}

/* ── SUBSCRIPTION ──────────────────────────────────────────── */
function upgradeSubscription() { showScreen('upgrade'); }
function activateSubscription() {
  Storage.setSubscription('active');
  toast('Premium activated! Unlimited scans unlocked 🎉','success',4000);
  showScreen('home'); _refreshUsageBar();
}

/* ── FORMAT / UTILS ────────────────────────────────────────── */
function fmt(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function median(arr) {
  if(!arr.length)return 0;
  const s=[...arr].sort((a,b)=>a-b),m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}
function $id(id)             { return document.getElementById(id); }
function $set(id,v,p='textContent') { const e=$id(id);if(e)e[p]=v; }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _mood(bpm,hrv) {
  if(bpm<65||hrv>55)return'calm';
  if(bpm>100||hrv<20)return'stressed';
  return'balanced';
}
function moodLbl(m) {
  return{calm:'● Calm',balanced:'● Balanced',normal:'● Balanced',stressed:'● Elevated',stress:'● Elevated'}[m]||m;
}

/* ── RESIZE ────────────────────────────────────────────────── */
let _rT;
window.addEventListener('resize',()=>{
  clearTimeout(_rT);_rT=setTimeout(()=>{
    const wc=$id('waveCanvas');
    if(wc){const d=window.devicePixelRatio||1;wc.width=wc.offsetWidth*d;wc.height=wc.offsetHeight*d;}
  },200);
},{passive:true});

/* ── MOBILE AUDIO UNLOCK ───────────────────────────────────── */
/* Resume AudioContext on any user touch (handles iOS autoplay restriction) */
['touchstart','touchend','mousedown','keydown'].forEach(ev=>{
  document.addEventListener(ev,()=>{ try{AudioEngine.resume();}catch{} },{once:true,passive:true});
});

/* ── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded',async()=>{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js')
      .then(()=>console.log('[SW] registered'))
      .catch(e=>console.warn('[SW]',e));
  }
  await Storage.init();
  await _updateBadge();
  startHomeECG();
  _refreshUsageBar();
  /* Pre-load library state so empty/sessions are correct before user visits */
  renderLibrary();

  /* Restore volume */
  const savedVol=Storage.getVolume();
  AudioEngine.setVolume(savedVol);

  let deferredInstall=null;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); deferredInstall=e;
    const b=$id('installBtn'); if(b)b.hidden=false;
  });
  $id('installBtn')?.addEventListener('click',async()=>{
    if(!deferredInstall)return;
    deferredInstall.prompt(); await deferredInstall.userChoice;
    deferredInstall=null; const b=$id('installBtn');if(b)b.hidden=true;
  });
});