/* ================================================================
   HeartBeat Studio — audioEngine.js v3
   Lookahead Web Audio scheduler. iOS Safari safe.
   Generates BPM/HRV-adaptive music for ≥60 seconds.
================================================================ */
'use strict';

const AudioEngine = (() => {
  /* ── Scales by mood ── */
  const SCALES = {
    calm:   [261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25],
    normal: [293.66,329.63,369.99,392.00,440.00,493.88,523.25,587.33],
    stress: [220.00,246.94,261.63,293.66,329.63,369.99,415.30,440.00],
  };
  const MOOD_LABEL = { calm:'Ambient · Calm', normal:'Melodic · Balanced', stress:'Rhythmic · Intense' };
  const KEYS   = ['C','D','E♭','F','G','A','B♭'];
  const STYLES = ['Serenade','Nocturne','Elegy','Reverie','Sonata','Prelude','Étude'];

  /* ── State ── */
  let _ctx, master, echoDelay, echoFB, echoWet, lfoOsc, lfoGain;
  let ticker = null, isPlaying = false;
  let nextBeat = 0, beatIdx = 0, totalBeats = 72, duration = 60, _stopCb = null;

  function _getCtx() {
    if (!_ctx || _ctx.state === 'closed') {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) throw new Error('Web Audio not supported');
      _ctx = new C();
    }
    return _ctx;
  }

  async function resume() {
    const c = _getCtx();
    if (c.state === 'suspended') await c.resume();
    return c;
  }

  /* ── Schedule one beat at `when` ── */
  function _scheduleBeat(c, scale, noteRange, when, iv) {
    /* Bass — root, every beat */
    const bO = c.createOscillator(), bG = c.createGain();
    bO.type = 'sine'; bO.frequency.setValueAtTime(scale[0]/2, when);
    bG.gain.setValueAtTime(0, when);
    bG.gain.linearRampToValueAtTime(0.40, when + 0.012);
    bG.gain.exponentialRampToValueAtTime(0.001, when + iv*0.85);
    bO.connect(bG); bG.connect(master); bO.start(when); bO.stop(when+iv);

    /* Melody — HRV-shaped note selection */
    const ni   = Math.abs((beatIdx*2 + Math.round(Math.sin(beatIdx*0.73)*(noteRange-1)))) % scale.length;
    const freq = scale[ni];
    const mO   = c.createOscillator(), mG = c.createGain();
    mO.type = beatIdx%4===0 ? 'triangle' : 'sine';
    mO.frequency.setValueAtTime(freq, when);
    mG.gain.setValueAtTime(0, when);
    mG.gain.linearRampToValueAtTime(0.27, when + 0.05);
    mG.gain.exponentialRampToValueAtTime(0.001, when + iv*0.72);
    if (lfoGain) lfoGain.connect(mG.gain);
    mO.connect(mG); mG.connect(master);
    if (echoDelay) mG.connect(echoDelay);
    mO.start(when); mO.stop(when+iv);

    /* Harmony — 5th every 2 beats */
    if (beatIdx%2===0) {
      const hO = c.createOscillator(), hG = c.createGain();
      hO.type = 'sine'; hO.frequency.setValueAtTime(freq*1.498, when);
      hG.gain.setValueAtTime(0, when);
      hG.gain.linearRampToValueAtTime(0.08, when + 0.08);
      hG.gain.exponentialRampToValueAtTime(0.001, when + iv*0.56);
      hO.connect(hG); hG.connect(master); hO.start(when); hO.stop(when+iv);
    }

    /* Soft noise click */
    try {
      const len = Math.ceil(c.sampleRate*0.036);
      const buf = c.createBuffer(1,len,c.sampleRate);
      const ch  = buf.getChannelData(0);
      for (let i=0;i<len;i++) ch[i] = (Math.random()*2-1)*Math.exp(-i/(c.sampleRate*0.004));
      const src = c.createBufferSource(), cG = c.createGain();
      src.buffer = buf; cG.gain.setValueAtTime(beatIdx%4===0?0.06:0.018, when);
      src.connect(cG); cG.connect(master); src.start(when);
    } catch {}
  }

  /* ── Lookahead scheduler ── */
  function _run(c, scale, noteRange, iv) {
    while (nextBeat < c.currentTime + 0.26) {
      _scheduleBeat(c, scale, noteRange, nextBeat, iv);
      nextBeat += iv;
      beatIdx = (beatIdx + 1) % totalBeats;
    }
    ticker = setTimeout(() => _run(c, scale, noteRange, iv), 90);
  }

  /* ── Public: start ── */
  async function start(bpm, hrv, onStop) {
    stop();
    let c;
    try { c = await resume(); }
    catch(e) { console.error('[AudioEngine]', e); return false; }

    const B  = Math.max(40, Math.min(200, bpm||72));
    const iv = 60/B;
    const mood      = _mood(B, hrv||45);
    const scale     = SCALES[mood];
    const noteRange = Math.max(3, Math.min(8, Math.round((hrv||45)/10)));

    totalBeats = Math.ceil(60/iv);
    duration   = Math.ceil(totalBeats * iv);
    _stopCb    = onStop || null;

    /* Master gain — fade in */
    master = c.createGain();
    master.gain.setValueAtTime(0, c.currentTime);
    master.gain.linearRampToValueAtTime(0.17, c.currentTime + 0.55);
    master.connect(c.destination);

    /* Echo / delay */
    echoDelay = c.createDelay(1.2); echoFB = c.createGain(); echoWet = c.createGain();
    echoDelay.delayTime.setValueAtTime(iv*0.5, c.currentTime);
    echoFB.gain.setValueAtTime(0.18, c.currentTime);
    echoWet.gain.setValueAtTime(0.11, c.currentTime);
    echoDelay.connect(echoFB); echoFB.connect(echoDelay);
    echoDelay.connect(echoWet); echoWet.connect(master);

    /* LFO tremolo (breathing quality) */
    lfoOsc = c.createOscillator(); lfoGain = c.createGain();
    lfoOsc.frequency.setValueAtTime(B/120, c.currentTime);
    lfoGain.gain.setValueAtTime(0.022, c.currentTime);
    lfoOsc.connect(lfoGain); lfoOsc.start();

    beatIdx = 0; nextBeat = c.currentTime + 0.1;
    isPlaying = true;
    _run(c, scale, noteRange, iv);
    return true;
  }

  /* ── Public: stop (immediate) ── */
  function stop() {
    if (ticker) { clearTimeout(ticker); ticker = null; }
    [master, echoDelay, echoFB, echoWet, lfoOsc, lfoGain].forEach(n => {
      if (!n) return;
      try { n.stop && n.stop(); } catch {}
      try { n.disconnect(); } catch {}
    });
    master = echoDelay = echoFB = echoWet = lfoOsc = lfoGain = null;
    isPlaying = false;
    if (_stopCb) { _stopCb(); _stopCb = null; }
  }

  /* ── Public: fade out ── */
  function fadeOut(sec=0.7) {
    if (!master || !_ctx) { stop(); return; }
    master.gain.setValueAtTime(master.gain.value, _ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.001, _ctx.currentTime + sec);
    setTimeout(stop, (sec+0.15)*1000);
  }

  function getMeta(bpm, hrv) {
    const key   = KEYS[bpm % KEYS.length];
    const style = STYLES[Math.floor(bpm/10) % STYLES.length];
    const mood  = _mood(bpm, hrv);
    return { title:`Pulse ${style} in ${key}`, subtitle:`${bpm} BPM · ${MOOD_LABEL[mood]}`, mood };
  }

  function getDuration()  { return duration; }
  function getIsPlaying() { return isPlaying; }

  function _mood(bpm, hrv) {
    if (bpm < 65 || hrv > 55) return 'calm';
    if (bpm > 100 || hrv < 20) return 'stress';
    if (bpm >= 65 && bpm <= 85) return 'calm';
    return 'normal';
  }

  return { start, stop, fadeOut, resume, getMeta, getDuration, getIsPlaying };
})();

window.AudioEngine = AudioEngine;
