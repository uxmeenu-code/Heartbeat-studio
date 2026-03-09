/* ================================================================
   HeartBeat Studio — audioEngine.js v5
   GENERATIVE BIOMETRIC MUSIC ENGINE

   v5 changes:
     • Boosted master gain (×2.5 from v4 — clearly audible on mobile)
     • Separate volume GainNode between master and destination
     • setVolume(0-1) applies instantly via gain ramp
     • AudioContext resume on every user interaction
     • Proper iOS Safari unlock: silent buffer trick on first touch
     • Normalised per-layer amplitudes for balanced mix
================================================================ */
'use strict';

const AudioEngine = (() => {

  /* ════════════════════════════════════════════════════════════
     BIOMETRIC PROFILES — v5: amplitudes boosted for audibility
  ════════════════════════════════════════════════════════════ */
  const PROFILES = {
    calm: {
      scale:   [155.56,174.61,196.00,233.08,261.63,311.13,349.23,392.00,466.16,523.25],
      bassOct: [77.78,116.54],
      modeName:'Eb Pentatonic', style:'Ambient Float', moodLabel:'Deep Calm',
      bassWave:'sine',      melWave:'triangle', padWave:'sine',   harmWave:'sine',
      bassAmp:0.55, padAmp:0.38, melAmp:0.42, harmAmp:0.22,
      bassDecF:0.96, padDecF:0.99, melDecF:0.86, harmDecF:0.92, attackS:0.045,
      bassGrid:[1,0,0,0,1,0,0,0], melGrid:[1,0,1,0,0,1,0,0],
      harmGrid:[0,0,1,0,0,0,1,0], padGrid:[1,0,0,0,0,0,0,0], padDurMul:7.6,
      kick:false, snare:false, hihat:false,
      delayRatio:0.75, delayFB:0.44, delayWet:0.32,
      reverbSec:4.2, reverbWet:0.42,
      masterVol:0.38,   /* was 0.150 — boosted */
      lfoHz:0.09, lfoDepth:0.032, swingBase:0.026, swingHrvMul:0.00055,
    },
    balanced: {
      scale:   [146.83,164.81,174.61,196.00,220.00,246.94,261.63,293.66,329.63,349.23],
      bassOct: [73.42,110.00],
      modeName:'D Dorian', style:'Melodic Flow', moodLabel:'Balanced',
      bassWave:'triangle', melWave:'triangle', padWave:'sine', harmWave:'sine',
      bassAmp:0.62, padAmp:0.22, melAmp:0.46, harmAmp:0.26,
      bassDecF:0.66, padDecF:0.88, melDecF:0.60, harmDecF:0.70, attackS:0.016,
      bassGrid:[1,0,0,1,0,0,1,0], melGrid:[1,0,1,1,0,1,0,1],
      harmGrid:[0,1,0,0,1,0,0,1], padGrid:[1,0,0,0,1,0,0,0], padDurMul:3.8,
      kick:true, kickGrid:[1,0,0,0,1,0,0,0],
      snare:true, snareGrid:[0,0,1,0,0,0,1,0],
      hihat:true, hihatGrid:[1,1,0,1,1,1,0,1],
      delayRatio:0.50, delayFB:0.22, delayWet:0.16,
      reverbSec:1.7, reverbWet:0.18,
      masterVol:0.42,   /* was 0.162 */
      lfoHz:0.26, lfoDepth:0.018, swingBase:0.012, swingHrvMul:0.00025,
    },
    stressed: {
      scale:   [246.94,261.63,311.13,329.63,369.99,392.00,440.00,493.88,523.25,587.33],
      bassOct: [123.47,185.00],
      modeName:'B Phrygian', style:'Kinetic Pulse', moodLabel:'Energised',
      bassWave:'sawtooth', melWave:'sawtooth', padWave:'square', harmWave:'square',
      bassAmp:0.50, padAmp:0.18, melAmp:0.44, harmAmp:0.32,
      bassDecF:0.40, padDecF:0.48, melDecF:0.36, harmDecF:0.44, attackS:0.006,
      bassGrid:[1,0,1,0,1,1,0,1], melGrid:[1,1,0,1,1,0,1,1],
      harmGrid:[1,0,0,1,0,1,0,0], padGrid:[1,0,0,0,0,0,0,0], padDurMul:1.8,
      kick:true, kickGrid:[1,0,1,0,1,0,1,0],
      snare:true, snareGrid:[0,0,1,0,0,1,1,0],
      hihat:true, hihatGrid:[1,1,1,1,1,1,1,1],
      delayRatio:0.25, delayFB:0.12, delayWet:0.08,
      reverbSec:0.65, reverbWet:0.08,
      masterVol:0.40,   /* was 0.148 */
      lfoHz:0.68, lfoDepth:0.010, swingBase:0.004, swingHrvMul:0.00010,
    },
  };

  const TITLE_WORDS = ['Meridian','Artery','Current','Threshold','Resonance',
    'Drift','Continuum','Orbit','Flux','Tide','Pulse','Reverie'];
  const CHROMATIC   = ['C','C♯','D','Eb','E','F','F♯','G','Ab','A','Bb','B'];
  const STAGE_NAMES = ['Heartbeat Pulse','Melody Active','Harmony Unlocked','Full Spectrum'];

  /* ── Engine state ── */
  let _ctx=null, _master=null, _volNode=null;
  let _lfoGain=null, _lfoOsc=null;
  let _delay=null, _reverb=null, _allNodes=[];
  let _sched=null, _playing=false, _nextBar=0, _barN=0, _dur=60;
  let _stopCb=null, _beatCb=null;
  let _melBus=null, _harmBus=null, _padBus=null, _percBus=null;
  let _stage=0, _curMood='balanced', _curLfoDepth=0.018;
  let _currentVolume=0.8;   /* user-controlled 0-1 */
  let _unlocked=false;

  /* ── AudioContext ── */
  function _ctxGet() {
    if (!_ctx || _ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio not supported');
      _ctx = new AC({ latencyHint:'interactive' });
    }
    return _ctx;
  }

  /* iOS Safari unlock: play a silent buffer to break autoplay gate */
  function _unlockAudio(c) {
    if (_unlocked) return;
    try {
      const buf = c.createBuffer(1, 1, c.sampleRate);
      const src = c.createBufferSource();
      src.buffer = buf; src.connect(c.destination);
      src.start(0); src.stop(0.001);
      _unlocked = true;
    } catch {}
  }

  async function resume() {
    const c = _ctxGet();
    _unlockAudio(c);
    if (c.state === 'suspended') {
      try { await c.resume(); } catch {}
    }
    return c;
  }

  /* Track all nodes for cleanup */
  function _tr(...nodes) { _allNodes.push(...nodes); return nodes[0]; }

  /* ── Reverb impulse response ── */
  function _makeReverb(c, sec) {
    const sr = c.sampleRate, len = Math.ceil(sr * sec);
    const ir  = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0);
    }
    const conv = c.createConvolver(); conv.buffer = ir;
    return _tr(conv);
  }

  /* ── Noise buffer ── */
  function _noiseBuf(c, ms) {
    const len = Math.ceil(c.sampleRate * ms / 1000);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ── Tonal note ── */
  function _note(c, t, freq, wave, amp, attackS, decayFrac, interval, dest) {
    const osc = c.createOscillator(), env = c.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + attackS);
    env.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attackS + 0.01, interval * decayFrac));
    osc.connect(env); env.connect(dest);
    osc.start(t); osc.stop(t + interval + 0.05);
    _tr(osc, env); return env;
  }

  /* ── Kick ── */
  function _kick(c, t, stressed) {
    const osc = c.createOscillator(), env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(stressed ? 190 : 105, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.14);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(stressed ? 0.78 : 0.62, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (stressed ? 0.18 : 0.25));
    osc.connect(env); env.connect(_percBus || _master);
    osc.start(t); osc.stop(t + 0.30); _tr(osc, env);
  }

  /* ── Snare ── */
  function _snare(c, t, stressed) {
    const src = c.createBufferSource(), flt = c.createBiquadFilter(), env = c.createGain();
    src.buffer = _noiseBuf(c, 200); flt.type = 'bandpass';
    flt.frequency.value = stressed ? 2700 : 1700; flt.Q.value = 0.9;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(stressed ? 0.52 : 0.38, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (stressed ? 0.13 : 0.17));
    src.connect(flt); flt.connect(env); env.connect(_percBus || _master);
    src.start(t); src.stop(t + 0.22); _tr(src, flt, env);
  }

  /* ── Hi-hat ── */
  function _hihat(c, t, open, stressed) {
    const ms  = open ? 115 : 32;
    const src = c.createBufferSource(), flt = c.createBiquadFilter(), env = c.createGain();
    src.buffer = _noiseBuf(c, ms); flt.type = 'highpass';
    flt.frequency.value = stressed ? 9800 : 7200;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(open ? 0.18 : 0.11, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    src.connect(flt); flt.connect(env); env.connect(_percBus || _master);
    src.start(t); src.stop(t + ms / 1000 + 0.01); _tr(src, flt, env);
  }

  /* ── Heartbeat LUB·DUB + beat callback ── */
  function _heartbeat(c, t, barDur, mood) {
    const stressed = mood === 'stressed', calm = mood === 'calm';

    /* LUB */
    {
      const src = c.createBufferSource(), flt = c.createBiquadFilter(), env = c.createGain();
      src.buffer = _noiseBuf(c, 70); flt.type = 'lowpass';
      flt.frequency.value = stressed ? 270 : calm ? 140 : 200; flt.Q.value = 5.0;
      const amp = stressed ? 0.60 : calm ? 0.30 : 0.45;
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(amp, t + 0.009);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
      src.connect(flt); flt.connect(env); env.connect(_master);
      src.start(t); src.stop(t + 0.080); _tr(src, flt, env);
    }

    /* DUB */
    {
      const dt  = t + barDur * 0.28;
      const src = c.createBufferSource(), flt = c.createBiquadFilter(), env = c.createGain();
      src.buffer = _noiseBuf(c, 50); flt.type = 'lowpass';
      flt.frequency.value = stressed ? 360 : calm ? 200 : 270; flt.Q.value = 4.0;
      const amp = stressed ? 0.36 : calm ? 0.18 : 0.28;
      env.gain.setValueAtTime(0, dt); env.gain.linearRampToValueAtTime(amp, dt + 0.007);
      env.gain.exponentialRampToValueAtTime(0.0001, dt + 0.050);
      src.connect(flt); flt.connect(env); env.connect(_master);
      src.start(dt); src.stop(dt + 0.060); _tr(src, flt, env);
    }

    /* Beat callback */
    if (_beatCb && _ctx) {
      const delay = Math.max(0, (t - _ctx.currentTime) * 1000);
      setTimeout(_beatCb, delay);
    }
  }

  /* ── Melody note picker ── */
  function _pickNote(scale, barN, stepN, hrv) {
    const spread  = Math.max(2, Math.min(scale.length - 1, Math.round(hrv / 8)));
    const contour = Math.sin(barN * 0.37 + stepN * 0.23) * (spread * 0.55);
    const walk    = Math.round(contour + barN * 0.14 + stepN * 0.10);
    return scale[Math.abs(walk) % scale.length];
  }

  /* ── HRV swing ── */
  function _swing(stepIdx, hrv, p) {
    const base   = p.swingBase + hrv * p.swingHrvMul;
    const groove = stepIdx % 2 === 1 ? base : -base * 0.22;
    const jitter = (Math.random() - 0.5) * hrv * 0.00028;
    return groove + jitter;
  }

  /* ── Schedule one bar ── */
  function _schedBar(c, barStart, stepSec, hrv, bpm, mood) {
    const p = PROFILES[mood], stressed = mood === 'stressed';
    const nSteps = p.melGrid.length;

    _heartbeat(c, barStart, stepSec * nSteps, mood);

    for (let s = 0; s < nSteps; s++) {
      const t = Math.max(barStart, barStart + s * stepSec + _swing(s, hrv, p));

      if (p.bassGrid[s]) {
        const bf = s < nSteps / 2 ? p.bassOct[0] : p.bassOct[1];
        _note(c, t, bf, p.bassWave, p.bassAmp, p.attackS, p.bassDecF, stepSec, _master);
      }
      if (p.melGrid[s]  && _melBus) {
        const freq = _pickNote(p.scale, _barN, s, hrv);
        const melE = _note(c, t, freq, p.melWave, p.melAmp, p.attackS, p.melDecF, stepSec, _melBus);
        if (_lfoGain) { try { _lfoGain.connect(melE.gain); } catch {} }
      }
      if (p.harmGrid[s] && _harmBus) {
        const freq  = _pickNote(p.scale, _barN, s + 2, hrv);
        const ratio = s % 4 < 2 ? 1.4983 : 1.2599;
        _note(c, t, freq * ratio, p.harmWave, p.harmAmp, p.attackS * 1.8, p.harmDecF, stepSec, _harmBus);
      }
      if (p.padGrid[s]  && _padBus) {
        const padDur = stepSec * p.padDurMul;
        [p.scale[0], p.scale[2], p.scale[4]].forEach((f, i) => {
          _note(c, t, f, p.padWave, p.padAmp * (1 - i * 0.18),
            p.attackS * 5, Math.min(0.998, padDur / (padDur + 0.001)), padDur, _padBus);
        });
      }
      if (p.kick  && p.kickGrid [s]) _kick (c, t, stressed);
      if (p.snare && p.snareGrid[s]) _snare(c, t, stressed);
      if (p.hihat && p.hihatGrid[s]) _hihat(c, t, s === 4, stressed);
    }
  }

  /* ── Lookahead scheduler ── */
  function _scheduler(c, stepSec, hrv, bpm, mood) {
    const barDur = stepSec * PROFILES[mood].melGrid.length;
    while (_nextBar < c.currentTime + 0.32) {
      _schedBar(c, _nextBar, stepSec, hrv, bpm, mood);
      _nextBar += barDur; _barN++;
    }
    _sched = setTimeout(() => _scheduler(c, stepSec, hrv, bpm, mood), 90);
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — START
  ════════════════════════════════════════════════════════════ */
  async function start(bpm, hrv, timelineOrCb, onStopFn) {
    stop();
    let c;
    try { c = await resume(); } catch(e) { console.error('[AE]', e); return false; }

    if (typeof timelineOrCb === 'function') { _stopCb = timelineOrCb; }
    else if (Array.isArray(timelineOrCb))  { _stopCb = onStopFn || null; }
    else                                    { _stopCb = onStopFn || null; }

    const B    = Math.max(40, Math.min(200, bpm || 72));
    const H    = Math.max(10, Math.min(100, hrv || 45));
    const mood = _moodKey(B, H);
    const p    = PROFILES[mood];
    _curMood = mood; _curLfoDepth = p.lfoDepth;

    const stepSec    = 60 / B;
    const barDur     = stepSec * p.melGrid.length;
    const barsNeeded = Math.ceil(60 / barDur);
    _dur = Math.ceil(barsNeeded * barDur);
    _allNodes = []; _barN = 0; _stage = 0;

    /* Volume node (user-controllable) → destination */
    _volNode = c.createGain();
    _volNode.gain.setValueAtTime(_currentVolume, c.currentTime);
    _volNode.connect(c.destination);

    /* Master → volume node */
    _master = c.createGain();
    _master.gain.setValueAtTime(0, c.currentTime);
    _master.gain.linearRampToValueAtTime(p.masterVol, c.currentTime + 0.9);
    _master.connect(_volNode);

    /* Reverb */
    const rvWet = c.createGain(); rvWet.gain.value = p.reverbWet;
    _reverb = _makeReverb(c, p.reverbSec);
    _reverb.connect(rvWet); rvWet.connect(_master); _tr(rvWet);

    /* Delay */
    const dly = c.createDelay(2.0), dfb = c.createGain(), dwt = c.createGain();
    dly.delayTime.setValueAtTime(stepSec * p.delayRatio, c.currentTime);
    dfb.gain.setValueAtTime(p.delayFB, c.currentTime);
    dwt.gain.setValueAtTime(p.delayWet, c.currentTime);
    dly.connect(dfb); dfb.connect(dly); dly.connect(dwt); dwt.connect(_master);
    _delay = dly; _tr(dly, dfb, dwt);

    /* LFO */
    const lfoOsc = c.createOscillator(), lfoGn = c.createGain();
    lfoOsc.frequency.setValueAtTime(p.lfoHz, c.currentTime);
    lfoGn.gain.setValueAtTime(p.lfoDepth, c.currentTime);
    lfoOsc.connect(lfoGn); lfoOsc.start();
    _lfoGain = lfoGn; _lfoOsc = lfoOsc; _tr(lfoOsc, lfoGn);

    /* Layer buses */
    _melBus  = c.createGain(); _melBus.gain.value  = 0;
    _harmBus = c.createGain(); _harmBus.gain.value = 0;
    _padBus  = c.createGain(); _padBus.gain.value  = 0;
    _percBus = c.createGain(); _percBus.gain.value = 0;
    _melBus .connect(_delay  || _master);
    _harmBus.connect(_reverb || _master);
    _padBus .connect(_reverb || _master);
    _percBus.connect(_master);
    _tr(_melBus, _harmBus, _padBus, _percBus);

    _nextBar = c.currentTime + 0.12; _playing = true;
    _scheduler(c, stepSec, H, B, mood);
    return true;
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — STOP
  ════════════════════════════════════════════════════════════ */
  function stop() {
    if (_sched) { clearTimeout(_sched); _sched = null; }
    _allNodes.forEach(n => { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} });
    _allNodes = [];
    if (_master)  { try { _master.disconnect();  } catch {} _master  = null; }
    if (_volNode) { try { _volNode.disconnect(); } catch {} _volNode = null; }
    _reverb = _delay = _lfoGain = _lfoOsc = null;
    _melBus = _harmBus = _padBus = _percBus = null;
    _playing = false; _stage = 0;
    if (_stopCb) { _stopCb(); _stopCb = null; }
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — FADE OUT
  ════════════════════════════════════════════════════════════ */
  function fadeOut(sec = 1.4) {
    if (!_master || !_ctx) { stop(); return; }
    _master.gain.setValueAtTime(_master.gain.value, _ctx.currentTime);
    _master.gain.linearRampToValueAtTime(0.0001, _ctx.currentTime + sec);
    setTimeout(stop, (sec + 0.15) * 1000);
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — setVolume(0-1) — instant, also updates _volNode
  ════════════════════════════════════════════════════════════ */
  function setVolume(level) {
    _currentVolume = Math.max(0, Math.min(1, level));
    if (_volNode && _ctx) {
      _volNode.gain.setTargetAtTime(_currentVolume, _ctx.currentTime, 0.02);
    }
    return _currentVolume;
  }

  function getVolume() { return _currentVolume; }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — setStage(n)
  ════════════════════════════════════════════════════════════ */
  function setStage(n) {
    if (!_playing || !_ctx) return;
    const now = _ctx.currentTime, ramp = 3.5;
    _stage = Math.max(0, Math.min(3, n));
    const targets = {
      mel:  _stage >= 1 ? 1 : 0,
      harm: _stage >= 2 ? 1 : 0,
      pad:  _stage >= 2 ? 1 : 0,
      perc: _stage >= 1 ? 1 : 0,
    };
    if (_melBus)  { _melBus.gain.setValueAtTime (_melBus.gain.value,  now); _melBus.gain.linearRampToValueAtTime (targets.mel,  now + ramp); }
    if (_harmBus) { _harmBus.gain.setValueAtTime(_harmBus.gain.value, now); _harmBus.gain.linearRampToValueAtTime(targets.harm, now + ramp); }
    if (_padBus)  { _padBus.gain.setValueAtTime (_padBus.gain.value,  now); _padBus.gain.linearRampToValueAtTime (targets.pad,  now + ramp); }
    if (_percBus) { _percBus.gain.setValueAtTime(_percBus.gain.value, now); _percBus.gain.linearRampToValueAtTime(targets.perc, now + ramp); }
    if (_lfoGain) {
      const depth = _stage === 3 ? _curLfoDepth * 2.2 : _curLfoDepth;
      _lfoGain.gain.setValueAtTime(_lfoGain.gain.value, now);
      _lfoGain.gain.linearRampToValueAtTime(depth, now + ramp);
    }
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — setBeatCallback / getMeta
  ════════════════════════════════════════════════════════════ */
  function setBeatCallback(fn) { _beatCb = typeof fn === 'function' ? fn : null; }

  function getMeta(bpm, hrv) {
    const B  = Math.max(40, Math.min(200, bpm || 72));
    const H  = Math.max(10, Math.min(100, hrv || 45));
    const mood = _moodKey(B, H);
    const p  = PROFILES[mood];
    const titleIdx = Math.abs(Math.round(B * 1.3 + H * 0.7)) % TITLE_WORDS.length;
    const keyNote  = CHROMATIC[Math.round(B / 5.5) % 12];
    const hrvLabel = H > 52 ? 'High Variability' : H > 28 ? 'Moderate Variability' : 'Low Variability';
    return {
      title:     `${TITLE_WORDS[titleIdx]} in ${keyNote}`,
      subtitle:  `${B} BPM · ${p.style} · ${hrvLabel}`,
      mood, moodLabel: p.moodLabel, scaleName: p.modeName,
    };
  }

  function _moodKey(bpm, hrv) {
    if (bpm > 100 || hrv < 20) return 'stressed';
    if (bpm < 65  || hrv > 55) return 'calm';
    return 'balanced';
  }

  return {
    start, stop, fadeOut, resume,
    getMeta, setStage, setBeatCallback,
    setVolume, getVolume,
    getStageName: n  => STAGE_NAMES[Math.min(3, Math.max(0, n ?? _stage))],
    getDuration:  ()  => _dur,
    getIsPlaying: ()  => _playing,
    getStage:     ()  => _stage,
  };

})();

window.AudioEngine = AudioEngine;
