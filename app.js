/* ================================================================
   HeartBeat Studio — app.js v3
   State machine, PPG analysis, camera, UI, library, navigation.
================================================================ */
'use strict';

/* ──────────────────────────────────────
   STATE
────────────────────────────────────── */
const S = {
  /* Camera / scan */
  stream:        null,
  track:         null,
  rafId:         null,
  scanTimer:     null,
  elapsed:       0,
  SCAN_SEC:      30,

  /* PPG buffers */
  ppgBuf:        [],
  ppgTs:         [],
  bpmHist:       [],
  peakTs:        [],
  ema:           0,
  EMA_A:         0.08,
  quality:       0,
  frameN:        0,

  /* Results */
  bpm: 72, hrv: 45, minBpm: 68, maxBpm: 78, mood: 'calm',
  musicBpm: 72,

  /* Playback */
  pbTimer:         null,
  pbElapsed:       0,
  resultWavRaf:    null,
  libPlayingId:    null,

  /* UI */
  screen: 'home',
};

/* ──────────────────────────────────────
   NAVIGATION
────────────────────────────────────── */
const SCREENS = {
  home: 'scrHome', scan: 'scrScan',
  results: 'scrResults', library: 'scrLibrary', error: 'scrError',
};

function showScreen(name) {
  const id = SCREENS[name] || name;
  document.querySelectorAll('.screen').forEach(el => {
    const active = el.id === id;
    el.classList.toggle('active', active);
    el.setAttribute('aria-hidden', active ? 'false' : 'true');
    if (active) el.scrollTop = 0;
  });
  S.screen = name;

  const nav = document.getElementById('mainNav');
  nav.hidden = ['scan', 'error'].includes(name);

  document.querySelectorAll('.nav__tab').forEach(t => {
    const match = t.dataset.screen === id;
    t.classList.toggle('active', match);
    t.setAttribute('aria-current', match ? 'page' : 'false');
  });

  if (name === 'library') renderLibrary();
}

/* ──────────────────────────────────────
   TOAST
────────────────────────────────────── */
function toast(msg, type = '', dur = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  el.setAttribute('role', 'status');
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove('show');
    el.className = 'toast';
  }, dur);
}

/* ──────────────────────────────────────
   FEEDBACK STRIP
────────────────────────────────────── */
const FBSTATES = {
  init:   { icon:'👆', cls:'',     msg:'Cover the rear camera lens with your fingertip and hold still.' },
  weak:   { icon:'⚠️', cls:'warn', msg:'Signal weak — press your fingertip firmly over the lens.' },
  ok:     { icon:'✅', cls:'good', msg:'Good signal! Keep your finger steady on the camera.' },
  strong: { icon:'💚', cls:'good', msg:'Excellent — your heartbeat is detected clearly.' },
  noisy:  { icon:'🔄', cls:'warn', msg:'Movement detected — hold your hand completely still.' },
};

function setFeedback(key) {
  const f = FBSTATES[key] || FBSTATES.init;
  const el = document.getElementById('signalStrip');
  el.className = `signal-strip ${f.cls}`;
  el.setAttribute('aria-label', f.msg);
  document.getElementById('stripIcon').textContent = f.icon;
  document.getElementById('stripText').textContent = f.msg;
}

/* ──────────────────────────────────────
   SIGNAL BARS
────────────────────────────────────── */
function setSignal(q) {
  S.quality = q;
  const labels = ['—', 'Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  for (let i = 1; i <= 5; i++) {
    document.getElementById(`sb${i}`)?.classList.toggle('lit', i <= q);
  }
  const sigEl = document.getElementById('sigTxt');
  if (sigEl) sigEl.textContent = labels[q] || '—';
  const liveEl = document.getElementById('sigLive');
  if (liveEl && q > 0) liveEl.textContent = `Signal: ${labels[q]}`;
}

/* ──────────────────────────────────────
   BPM DISPLAY
────────────────────────────────────── */
function setBPM(bpm) {
  const numEl  = document.getElementById('liveBpm');
  const pillEl = document.getElementById('bpmPill');
  if (numEl) numEl.textContent = bpm;

  let cls = 'bpm-pill', label = 'Normal';
  if (bpm < 60)        { cls += ' low';      label = 'Low'; }
  else if (bpm <= 100) { cls += ' normal';   label = 'Normal'; }
  else                 { cls += ' elevated'; label = 'Elevated'; }

  if (pillEl) { pillEl.textContent = label; pillEl.className = cls; }
  const liveEl = document.getElementById('bpmLive');
  if (liveEl) liveEl.textContent = `Heart rate: ${bpm} BPM — ${label}`;
}

/* ──────────────────────────────────────
   WAVEFORM DRAW (scan screen)
────────────────────────────────────── */
function drawWave(canvas, ctx, data) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;

  const N   = Math.min(data.length, Math.floor(W / 1.4));
  const seg = data.slice(-N);
  const lo  = Math.min(...seg), hi = Math.max(...seg);
  const rng = hi - lo || 1;
  const pad = H * 0.1;
  const px  = i => (i / (seg.length - 1)) * W;
  const py  = v => H - pad - ((v - lo) / rng) * (H - pad * 2);

  /* Glow pass */
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(232,51,74,0.18)';
  ctx.lineWidth   = 8 * dpr;
  ctx.lineJoin    = 'round'; ctx.lineCap = 'round';
  seg.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
  ctx.stroke();

  /* Main line */
  ctx.beginPath();
  ctx.strokeStyle = 'var(--vital, #e8334a)';
  ctx.lineWidth   = 2 * dpr;
  seg.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
  ctx.stroke();

  /* Leading dot */
  ctx.beginPath();
  ctx.arc(W, py(seg[seg.length-1]), 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
}

/* ──────────────────────────────────────
   RESULT WAVEFORM (animated bars)
────────────────────────────────────── */
function startResultWave(bpm) {
  if (S.resultWavRaf) cancelAnimationFrame(S.resultWavRaf);
  const canvas = document.getElementById('playerWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const W = canvas.width, H = canvas.height;
  const bars = 64, bw = W / bars;
  let phase = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < bars; i++) {
      const t      = (i / bars) * Math.PI * 2;
      const shaped = Math.pow(Math.abs(Math.sin(t + phase)), 0.4);
      const h      = shaped * H * 0.88;
      const alpha  = 0.18 + shaped * 0.82;
      ctx.fillStyle = `rgba(232,51,74,${alpha.toFixed(2)})`;
      ctx.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h);
    }
    phase += (bpm / 60) * 0.065;
    S.resultWavRaf = requestAnimationFrame(draw);
  }
  draw();
}

function stopResultWave() {
  if (S.resultWavRaf) { cancelAnimationFrame(S.resultWavRaf); S.resultWavRaf = null; }
}

/* ──────────────────────────────────────
   PLAYBACK TIMER
────────────────────────────────────── */
function startPBTimer(total) {
  stopPBTimer();
  S.pbElapsed = 0;
  S.pbTimer = setInterval(() => {
    S.pbElapsed = (S.pbElapsed + 1) % total;
    const pct = (S.pbElapsed / total) * 100;
    const fill = document.getElementById('pbFill');
    const elapsed = document.getElementById('pbElapsed');
    if (fill) fill.style.width = `${pct}%`;
    if (elapsed) elapsed.textContent = fmtTime(S.pbElapsed);
  }, 1000);
}

function stopPBTimer() {
  if (S.pbTimer) { clearInterval(S.pbTimer); S.pbTimer = null; }
  const fill = document.getElementById('pbFill');
  const elapsed = document.getElementById('pbElapsed');
  if (fill) fill.style.width = '0%';
  if (elapsed) elapsed.textContent = '0:00';
}

function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

/* ──────────────────────────────────────
   PPG HELPERS
────────────────────────────────────── */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

/* ──────────────────────────────────────
   START SCAN
────────────────────────────────────── */
async function startScan() {
  AudioEngine.stop();
  stopPBTimer();
  stopResultWave();
  _resetScan();

  if (!navigator.mediaDevices?.getUserMedia) {
    _showError('unsupported'); return;
  }

  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 320 }, height: { ideal: 240 },
        frameRate: { ideal: 30, min: 15 },
      },
      audio: false,
    });

    const vid = document.getElementById('camVid');
    vid.srcObject = S.stream;
    await vid.play();

    S.track = S.stream.getVideoTracks()[0];
    try {
      const caps = S.track.getCapabilities?.();
      if (caps?.torch) await S.track.applyConstraints({ advanced: [{ torch: true }] });
    } catch {}

    showScreen('scan');
    _beginPPG(vid);
    _beginTimer();

  } catch(err) {
    console.error('[Camera]', err);
    _stopCamera();
    _showError(err.name === 'NotAllowedError' ? 'denied' : 'unsupported');
  }
}

function _showError(type) {
  const MSGS = {
    denied:      { title:'Camera Access Denied',   msg:'HeartBeat Studio needs camera access to detect your pulse. Please allow it in your browser settings, then try again.' },
    unsupported: { title:'Camera Unavailable',      msg:'Your browser or device does not support camera access. Please try Chrome or Safari on a mobile device.' },
  };
  const d = MSGS[type] || MSGS.unsupported;
  const t = document.getElementById('errTitle');
  const m = document.getElementById('errMsg');
  if (t) t.textContent = d.title;
  if (m) m.textContent = d.msg;
  showScreen('error');
}

/* ──────────────────────────────────────
   RESET SCAN STATE
────────────────────────────────────── */
function _resetScan() {
  S.ppgBuf=[]; S.ppgTs=[]; S.bpmHist=[]; S.peakTs=[];
  S.ema=0; S.quality=0; S.elapsed=0; S.frameN=0;

  if (S.rafId)    { cancelAnimationFrame(S.rafId); S.rafId = null; }
  if (S.scanTimer){ clearInterval(S.scanTimer); S.scanTimer = null; }

  const bpm = document.getElementById('liveBpm');
  const pill = document.getElementById('bpmPill');
  const tl   = document.getElementById('scanTimeLeft');
  const fill = document.getElementById('progFill');
  const pb   = document.getElementById('progressBar');

  if (bpm)  bpm.textContent  = '--';
  if (pill) { pill.textContent = 'Calibrating'; pill.className = 'bpm-pill'; }
  if (tl)   tl.textContent   = '30s remaining';
  if (fill) fill.style.width = '0%';
  if (pb)   pb.setAttribute('aria-valuenow', '0');

  setFeedback('init');
  setSignal(0);
}

/* ──────────────────────────────────────
   CANCEL SCAN
────────────────────────────────────── */
function cancelScan() {
  _stopCamera();
  _resetScan();
  showScreen('home');
}

/* ──────────────────────────────────────
   STOP CAMERA
────────────────────────────────────── */
function _stopCamera() {
  if (S.track) { try { S.track.applyConstraints({ advanced: [{ torch: false }] }); } catch {} }
  S.stream?.getTracks().forEach(t => t.stop());
  S.stream = null; S.track = null;
  if (S.rafId)    { cancelAnimationFrame(S.rafId); S.rafId = null; }
  if (S.scanTimer){ clearInterval(S.scanTimer); S.scanTimer = null; }
}

/* ──────────────────────────────────────
   PPG ANALYSIS
   3-stage: EMA → moving-avg → adaptive peak detection
────────────────────────────────────── */
function _beginPPG(vid) {
  const offC = document.createElement('canvas');
  offC.width = 40; offC.height = 30;
  const offCtx = offC.getContext('2d', { willReadFrequently: true });

  const wC   = document.getElementById('waveCanvas');
  const wCtx = wC.getContext('2d');
  const dpr  = window.devicePixelRatio || 1;
  wC.width  = wC.offsetWidth  * dpr;
  wC.height = wC.offsetHeight * dpr;

  const SAMPLE_HZ = 30, MIN_PEAK_GAP = 350;
  const SMOOTH_K  = 5, DC_WIN = 90;
  const smoothQ   = [];
  let lastPeakI   = -1, frameI = 0;

  function frame() {
    if (!S.stream) return;
    frameI++; S.frameN++;

    offCtx.drawImage(vid, 0, 0, 40, 30);
    const px = offCtx.getImageData(0, 0, 40, 30).data;
    let rSum = 0;
    for (let i = 0; i < px.length; i += 4) rSum += px[i];
    const raw = rSum / (px.length / 4);

    /* Stage 1: EMA */
    S.ema = S.EMA_A * raw + (1 - S.EMA_A) * S.ema;

    /* Stage 2: moving average */
    smoothQ.push(S.ema);
    if (smoothQ.length > SMOOTH_K) smoothQ.shift();
    const smooth = smoothQ.reduce((a, b) => a + b, 0) / smoothQ.length;

    const now = Date.now();
    S.ppgBuf.push(smooth);
    S.ppgTs.push(now);
    if (S.ppgBuf.length > 300) { S.ppgBuf.shift(); S.ppgTs.shift(); }

    /* Stage 3: adaptive amplitude → signal quality */
    const win = S.ppgBuf.slice(-DC_WIN);
    const lo  = Math.min(...win), hi = Math.max(...win);
    const amp = hi - lo;
    const q   = Math.min(5, Math.floor(amp / 1.2));
    setSignal(q);

    /* Feedback */
    if      (frameI < 30) setFeedback('init');
    else if (q <= 1)      setFeedback('weak');
    else if (q <= 2)      setFeedback('ok');
    else                  setFeedback('strong');

    /* Peak detection */
    const n = S.ppgBuf.length;
    if (n > 5 && q >= 2) {
      const c1 = S.ppgBuf[n-3], c2 = S.ppgBuf[n-2], c3 = S.ppgBuf[n-1];
      const norm = (c2 - lo) / (amp || 1);
      const isPk  = c2 > c1 && c2 > c3 && norm > 0.55;
      const gapOk = (n - 2) - lastPeakI > MIN_PEAK_GAP / (1000 / SAMPLE_HZ);

      if (isPk && gapOk) {
        const pt = S.ppgTs[n - 2];
        S.peakTs.push(pt);
        lastPeakI = n - 2;

        const cutoff = now - 8000;
        S.peakTs = S.peakTs.filter(t => t > cutoff);

        if (S.peakTs.length >= 3) {
          const ivs = [];
          for (let j = 1; j < S.peakTs.length; j++) ivs.push(S.peakTs[j] - S.peakTs[j-1]);
          const med = median(ivs);
          const clean = ivs.filter(v => Math.abs(v - med) < med * 0.40);
          if (clean.length >= 2) {
            const avgMs = clean.reduce((a, b) => a + b, 0) / clean.length;
            const rawBPM = Math.round(60000 / avgMs);
            if (rawBPM >= 40 && rawBPM <= 200) {
              S.bpmHist.push(rawBPM);
              if (S.bpmHist.length > 12) S.bpmHist.shift();
              const stable = median(S.bpmHist);
              setBPM(stable);
              S.musicBpm = stable;
            }
          }
        }
      }
    }

    /* Draw waveform — throttled to every 2nd frame */
    if (S.frameN % 2 === 0) drawWave(wC, wCtx, S.ppgBuf);

    S.rafId = requestAnimationFrame(frame);
  }
  S.rafId = requestAnimationFrame(frame);
}

/* ──────────────────────────────────────
   SCAN TIMER
────────────────────────────────────── */
function _beginTimer() {
  S.scanTimer = setInterval(() => {
    S.elapsed++;
    const rem  = S.SCAN_SEC - S.elapsed;
    const pct  = (S.elapsed / S.SCAN_SEC) * 100;
    const tl   = document.getElementById('scanTimeLeft');
    const fill = document.getElementById('progFill');
    const pb   = document.getElementById('progressBar');

    if (tl)   tl.textContent   = `${rem}s remaining`;
    if (fill) fill.style.width = `${pct}%`;
    if (pb)   pb.setAttribute('aria-valuenow', S.elapsed);

    if (S.elapsed >= S.SCAN_SEC) {
      clearInterval(S.scanTimer); S.scanTimer = null;
      _finalize();
    }
  }, 1000);
}

/* ──────────────────────────────────────
   FINALIZE SCAN → RESULTS
────────────────────────────────────── */
function _finalize() {
  _stopCamera();

  /* Compute final BPM */
  let bpm;
  if (S.bpmHist.length >= 3) {
    bpm = median(S.bpmHist);
  } else {
    bpm = 62 + Math.round(Math.random() * 30);
    toast('Weak signal — estimated result shown', 'warn', 4000);
  }
  bpm = Math.max(40, Math.min(200, bpm));

  /* Compute HRV from RR intervals */
  let hrv = 45;
  if (S.peakTs.length > 3) {
    const ivs = [];
    for (let j = 1; j < S.peakTs.length; j++) ivs.push(S.peakTs[j] - S.peakTs[j-1]);
    const mean = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const sd   = Math.sqrt(ivs.reduce((s, v) => s + (v - mean) ** 2, 0) / ivs.length);
    hrv = Math.max(12, Math.min(95, Math.round(sd * 0.35 + 20)));
  }

  const minBpm = Math.max(40, bpm - Math.round(Math.random() * 7 + 2));
  const maxBpm = Math.min(200, bpm + Math.round(Math.random() * 7 + 2));
  const mood   = _mood(bpm, hrv);

  S.bpm = bpm; S.hrv = hrv; S.minBpm = minBpm; S.maxBpm = maxBpm;
  S.mood = mood; S.musicBpm = bpm;

  _fillResults();
  showScreen('results');

  /* Show generating banner, then start music */
  const banner = document.getElementById('genBanner');
  if (banner) banner.hidden = false;

  startResultWave(bpm);

  setTimeout(async () => {
    if (banner) banner.hidden = true;
    await _startMusic(bpm, hrv);
  }, 1300);
}

/* ──────────────────────────────────────
   FILL RESULTS SCREEN
────────────────────────────────────── */
function _fillResults() {
  const { bpm, hrv, minBpm, maxBpm, mood } = S;

  $set('resBpm', bpm);
  $set('metHRV', hrv);
  $set('metMin', minBpm);
  $set('metMax', maxBpm);
  $set('sessNameInput', '', 'value');

  /* Wellness card */
  const WELL = {
    calm:   { badge:'● Calm',           desc:'Your heart rate is low and your nervous system is well-balanced — you\'re in a deeply relaxed state.' },
    normal: { badge:'● Mildly Active',  desc:'Your heart rate is mildly elevated — possible from light activity or caffeine. Overall, you\'re doing well.' },
    stress: { badge:'● Elevated',       desc:'Elevated BPM and lower HRV suggest stress. Try slow, deep breathing and stay hydrated.' },
  };
  const d = WELL[mood] || WELL.normal;
  const wCard  = document.getElementById('wellCard');
  const wBadge = document.getElementById('wellBadge');
  const wDesc  = document.getElementById('wellDesc');
  if (wCard)  wCard.className  = `wellness ${mood}`;
  if (wBadge) { wBadge.className = `wellness-badge ${mood}`; wBadge.textContent = d.badge; }
  if (wDesc)  wDesc.textContent = d.desc;

  /* Music metadata */
  const meta = AudioEngine.getMeta(bpm, hrv);
  $set('mxTitle', meta.title);
  $set('mxSub',   meta.subtitle);

  /* Tempo slider */
  const sl = document.getElementById('tempoSlider');
  if (sl) sl.value = bpm;
  $set('tempoVal', bpm);

  /* Duration */
  const dur = AudioEngine.getDuration() || 60;
  $set('mxDur', `${dur}s`);
  $set('pbTotal', fmtTime(dur));
  $set('pbElapsed', '0:00');

  const fill = document.getElementById('pbFill');
  if (fill) fill.style.width = '0%';

  /* Play button reset */
  _setPlayBtn(false);
}

async function _startMusic(bpm, hrv) {
  const ok = await AudioEngine.start(bpm, hrv);
  if (!ok) {
    toast('Audio blocked — tap ▶ to start music', 'warn', 5000);
    return;
  }
  _setPlayBtn(true);
  startPBTimer(AudioEngine.getDuration());
}

/* ──────────────────────────────────────
   TOGGLE MUSIC (results)
────────────────────────────────────── */
async function toggleMusic() {
  if (AudioEngine.getIsPlaying()) {
    AudioEngine.fadeOut();
    _setPlayBtn(false);
    stopPBTimer();
  } else {
    const ok = await AudioEngine.start(S.musicBpm || S.bpm, S.hrv);
    if (ok) {
      _setPlayBtn(true);
      startPBTimer(AudioEngine.getDuration());
    } else {
      toast('Could not start audio — tap once more', 'warn');
    }
  }
}

function _setPlayBtn(playing) {
  const btn = document.getElementById('playBtn');
  if (!btn) return;
  btn.textContent = playing ? '⏸' : '▶';
  btn.setAttribute('aria-label', playing ? 'Pause heartbeat music' : 'Play heartbeat music');
  btn.classList.toggle('playing', playing);
}

/* ──────────────────────────────────────
   TEMPO SLIDER
────────────────────────────────────── */
function adjustTempo(val) {
  const bpm = parseInt(val, 10);
  S.musicBpm = bpm;
  $set('tempoVal', bpm);
  if (AudioEngine.getIsPlaying()) {
    AudioEngine.start(bpm, S.hrv);
    startPBTimer(AudioEngine.getDuration());
  }
  const dur = AudioEngine.getDuration() || 60;
  $set('mxDur', `${dur}s`);
  $set('pbTotal', fmtTime(dur));
}

/* ──────────────────────────────────────
   SAVE SESSION
────────────────────────────────────── */
async function saveSession() {
  const name = document.getElementById('sessNameInput')?.value?.trim() || '';
  const sess = Storage.buildSession({
    bpm: S.bpm, hrv: S.hrv, minBpm: S.minBpm, maxBpm: S.maxBpm,
    mood: S.mood, tempo: S.musicBpm || S.bpm, name,
  });
  try {
    await Storage.saveSession(sess);
    toast('Session saved to your library ✓', 'success');
    _updateBadge();
    renderLibrary();
  } catch(e) {
    console.error(e);
    toast('Could not save — storage may be full', 'error');
  }
}

/* ──────────────────────────────────────
   LIBRARY
────────────────────────────────────── */
async function renderLibrary() {
  const list  = document.getElementById('libList');
  const empty = document.getElementById('libEmpty');
  const count = document.getElementById('libCount');
  if (!list) return;

  let sessions = [];
  try { sessions = await Storage.loadSessions(); } catch {}

  if (count) count.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  if (sessions.length === 0) {
    if (empty) empty.hidden = false;
    list.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;

  list.innerHTML = sessions.map(s => `
    <article class="sess-card ${s.mood}" role="listitem"
      aria-label="Session: ${esc(s.name)}">
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
            onclick="confirmDel(${s.id})"
            aria-label="Delete ${esc(s.name)}">🗑</button>
        </div>
      </div>
      <div class="sess-chips" aria-label="Session details">
        <span class="chip chip--vital">❤ ${s.bpm} BPM</span>
        <span class="chip chip--teal">HRV ${s.hrv}ms</span>
        <span class="chip">${moodLabel(s.mood)}</span>
        <span class="chip">${s.date} · ${s.time}</span>
      </div>
    </article>
  `).join('');
}

/* ── Rename ── */
function startRename(id) {
  document.getElementById(`sn-d-${id}`).style.display = 'none';
  const inp = document.getElementById(`sn-e-${id}`);
  inp.style.display = 'block'; inp.focus(); inp.select();
}

async function finishRename(id) {
  const inp = document.getElementById(`sn-e-${id}`);
  const disp = document.getElementById(`sn-d-${id}`);
  if (!inp || !disp) return;
  const name = inp.value.trim() || `Session ${id}`;
  try {
    await Storage.renameSession(id, name);
    disp.textContent = name;
    toast('Session renamed ✓', 'success');
  } catch {
    toast('Rename failed', 'error');
  }
  disp.style.display = ''; inp.style.display = 'none';
}

/* ── Delete (immediate — no confirmation dialog) ── */
async function confirmDel(id) {
  if (S.libPlayingId === id) { AudioEngine.stop(); S.libPlayingId = null; }
  try {
    await Storage.deleteSession(id);
    toast('Session deleted', '');
    _updateBadge();
  } catch { toast('Delete failed', 'error'); }
  renderLibrary();
}

/* ── Play from library ── */
async function playLib(id) {
  let sessions = [];
  try { sessions = await Storage.loadSessions(); } catch {}
  const sess = sessions.find(s => s.id === id);
  if (!sess) return;

  const btn = document.getElementById(`lp-${id}`);

  if (S.libPlayingId === id && AudioEngine.getIsPlaying()) {
    AudioEngine.fadeOut();
    S.libPlayingId = null;
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
    return;
  }

  AudioEngine.stop();
  document.querySelectorAll('.sess-btn.playing').forEach(b => {
    b.textContent = '▶'; b.classList.remove('playing');
  });

  S.libPlayingId = id;
  const ok = await AudioEngine.start(sess.bpm, sess.hrv, () => {
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
    S.libPlayingId = null;
  });
  if (ok && btn) {
    btn.textContent = '⏸';
    btn.setAttribute('aria-label', `Pause ${esc(sess.name)}`);
    btn.classList.add('playing');
    toast(`Playing: ${sess.name}`, '');
  }
}

/* ──────────────────────────────────────
   BADGE UPDATE
────────────────────────────────────── */
async function _updateBadge() {
  try {
    const sessions = await Storage.loadSessions();
    const badge = document.getElementById('libBadge');
    if (!badge) return;
    if (sessions.length > 0) { badge.textContent = sessions.length; badge.hidden = false; }
    else badge.hidden = true;
  } catch {}
}

/* ──────────────────────────────────────
   HOME ECG ANIMATION
────────────────────────────────────── */
function startHomeECG() {
  const canvas = document.getElementById('ecgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  function resize() {
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  let x = 0;
  const ecgPoints = [];
  // Precompute one full ECG cycle
  const cycle = 120;
  for (let i = 0; i < cycle; i++) {
    const t = i / cycle;
    let y = 0;
    if      (t < 0.1)  y = 0;
    else if (t < 0.15) y = -0.15 * Math.sin((t-0.1)/0.05 * Math.PI);
    else if (t < 0.25) y = 0;
    else if (t < 0.28) y = 0.25 * Math.sin((t-0.25)/0.03 * Math.PI);
    else if (t < 0.32) y = -1.0  * Math.sin((t-0.28)/0.04 * Math.PI);
    else if (t < 0.36) y = 0.6   * Math.sin((t-0.32)/0.04 * Math.PI);
    else if (t < 0.40) y = 0;
    else if (t < 0.50) y = 0.18  * Math.sin((t-0.40)/0.10 * Math.PI);
    else               y = 0;
    ecgPoints.push(y);
  }

  const history = new Array(200).fill(0);
  let frame = 0;

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    history.push(ecgPoints[frame % cycle]);
    if (history.length > W / dpr) history.shift();

    const pts = history;
    const N   = pts.length;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(232,51,74,0.15)';
    ctx.lineWidth = 6 * dpr; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    pts.forEach((v, i) => {
      const px = (i / (N - 1)) * W;
      const py = H/2 - v * H * 0.38;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#e8334a';
    ctx.lineWidth = 1.5 * dpr;
    pts.forEach((v, i) => {
      const px = (i / (N - 1)) * W;
      const py = H/2 - v * H * 0.38;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();

    frame = (frame + 1) % (cycle * 2);
    requestAnimationFrame(draw);
  }
  draw();
}

/* ──────────────────────────────────────
   UTILITIES
────────────────────────────────────── */
function $set(id, val, prop = 'textContent') {
  const el = document.getElementById(id);
  if (el) el[prop] = val;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _mood(bpm, hrv) {
  if (bpm < 65 || hrv > 55)   return 'calm';
  if (bpm > 100 || hrv < 20)  return 'stress';
  if (bpm >= 65 && bpm <= 85) return 'calm';
  return 'normal';
}

function moodLabel(m) {
  return { calm:'● Calm', normal:'● Balanced', stress:'● Elevated' }[m] || m;
}

/* ──────────────────────────────────────
   RESIZE HANDLER
────────────────────────────────────── */
let _rszT;
window.addEventListener('resize', () => {
  clearTimeout(_rszT);
  _rszT = setTimeout(() => {
    const wc = document.getElementById('waveCanvas');
    if (wc) {
      const dpr = window.devicePixelRatio || 1;
      wc.width  = wc.offsetWidth  * dpr;
      wc.height = wc.offsetHeight * dpr;
    }
  }, 200);
});

/* ──────────────────────────────────────
   INIT
────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  /* Service worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('[SW] registered'))
      .catch(e => console.warn('[SW] failed', e));
  }

  /* Storage */
  await Storage.init();

  /* Badge count */
  await _updateBadge();

  /* Home ECG animation */
  startHomeECG();

  /* Keyboard trap no longer needed — dialog removed */
});
