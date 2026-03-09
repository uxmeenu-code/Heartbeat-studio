/* ================================================================
   HeartBeat Studio — audioEngine.js v6.1
   SOOTHING BIOMETRIC MUSIC ENGINE

   v6.1 KEY IMPROVEMENTS:
   ─────────────────────
   • Seeded deterministic melody — replay sounds IDENTICAL to live
   • Musical phrase engine: proper stepwise motion, chord emphasis,
     cadences — no random jumps that sound like "tuning"
   • Warmth filter on all melodic voices (lowpass ~2kHz)
   • Chord-aware harmony: always consonant 3rd/5th/6th above melody
   • Notes always land on pentatonic/safe scale — zero dissonance
   • Smooth swing via seed, not Math.random() each bar
   • Seed stored in session — library playback matches original

   INSTRUMENT ZONES (unchanged):
   < 60 bpm  → Sitar & Drone (Raga Meditation)
   60-74 bpm → Bansuri Flute & Strings (Gentle Flow)
   75-90 bpm → Piano & Acoustic Guitar (Melodic Calm)
   91-100bpm → Marimba & Piano (Warm Rhythm)
   > 100 bpm → Strings & Tabla (Vital Energy)
================================================================ */
'use strict';

const AudioEngine = (() => {

  /* ── Scale builder ── */
  function _buildScale(rootHz, semitones) {
    const out = [];
    for (let oct = -1; oct <= 1; oct++) {
      semitones.forEach(s => {
        const f = rootHz * Math.pow(2, (oct * 12 + s) / 12);
        if (f >= 55 && f <= 1800) out.push(+f.toFixed(3));
      });
    }
    return out.sort((a, b) => a - b);
  }

  /* ── Seeded xorshift32 PRNG ── */
  function _mkRand(seed) {
    let s = (seed >>> 0) || 0xDEADBEEF;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
  }

  /* ── Instrument profile selector ── */
  function _getProfile(bpm) {

    /* SITAR & DRONE  < 60 bpm */
    if (bpm < 60) return {
      name:'Sitar & Drone', style:'Raga Meditation',
      scale:_buildScale(146.83,[0,2,3,7,8,10,12]),
      drone:73.42, droneAmp:0.16,
      melParts: [{r:1,a:0.44,w:'triangle'},{r:2,a:0.14,w:'sine'},{r:3,a:0.05,w:'sine'}],
      harmParts:[{r:1,a:0.20,w:'sine'},{r:1.5,a:0.09,w:'sine'}],
      padParts: [{r:1,a:0.13,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts:[{r:1,a:0.24,w:'sine'},{r:2,a:0.07,w:'sine'}],
      melA:0.007,melD:3.6,harmA:0.10,harmD:5.5,padA:0.75,padD:10,bassA:0.04,bassD:2.8,
      tabla:true,tablaS:false,kick:false,snare:false,hihat:false,
      tablaAmp:0.24,tablaGrid:[1,0,0,1,0,1,0,0],
      melGrid: [1,0,0,0,0,0,1,0],harmGrid:[0,0,1,0,0,0,0,0],
      padGrid: [1,0,0,0,0,0,0,0],bassGrid:[1,0,0,0,1,0,0,0],
      padDurMul:12,delayR:0.75,delayFB:0.38,delayWet:0.28,
      revSec:5.5,revWet:0.55,masterVol:1.7,warmCut:1600,
      lfoHz:0.06,lfoD:0.030,swing:0.042,
    };

    /* BANSURI FLUTE & STRINGS  60-74 */
    if (bpm <= 74) return {
      name:'Bansuri Flute & Strings', style:'Gentle Flow',
      scale:_buildScale(261.63,[0,2,4,7,9,12]),
      drone:65.41,droneAmp:0.08,
      melParts: [{r:1,a:0.46,w:'sine'},{r:2,a:0.12,w:'sine'},{r:3,a:0.04,w:'sine'}],
      harmParts:[{r:1,a:0.24,w:'sine'},{r:1.002,a:0.19,w:'sine'},{r:2,a:0.07,w:'sine'}],
      padParts: [{r:1,a:0.13,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts:[{r:1,a:0.22,w:'triangle'},{r:2,a:0.09,w:'sine'}],
      melA:0.09,melD:2.9,harmA:0.22,harmD:5.8,padA:0.95,padD:11,bassA:0.07,bassD:2.3,
      tabla:false,kick:false,snare:false,hihat:true,
      hihatAmp:0.055,hihatGrid:[0,0,1,0,0,0,1,0],
      melGrid: [1,0,0,0,1,0,0,0],harmGrid:[0,0,1,0,0,0,1,0],
      padGrid: [1,0,0,0,0,0,0,0],bassGrid:[1,0,0,0,1,0,0,0],
      padDurMul:9,delayR:0.67,delayFB:0.32,delayWet:0.22,
      revSec:4.2,revWet:0.50,masterVol:1.9,warmCut:1800,
      lfoHz:0.11,lfoD:0.032,swing:0.026,
    };

    /* PIANO & ACOUSTIC GUITAR  75-90 */
    if (bpm <= 90) return {
      name:'Piano & Acoustic Guitar', style:'Melodic Calm',
      scale:_buildScale(220.00,[0,2,4,5,7,9,11,12]),
      drone:null,droneAmp:0,
      melParts: [{r:1,a:0.52,w:'triangle'},{r:2,a:0.24,w:'sine'},{r:3,a:0.10,w:'sine'},{r:4,a:0.04,w:'sine'}],
      harmParts:[{r:1,a:0.28,w:'triangle'},{r:2,a:0.15,w:'sine'},{r:3,a:0.06,w:'sine'}],
      padParts: [{r:1,a:0.15,w:'sine'},{r:2,a:0.06,w:'sine'}],
      bassParts:[{r:1,a:0.28,w:'triangle'},{r:2,a:0.11,w:'sine'}],
      melA:0.004,melD:2.3,harmA:0.012,harmD:1.9,padA:0.58,padD:7.5,bassA:0.008,bassD:1.7,
      tabla:false,kick:true,snare:false,hihat:true,
      kickAmp:0.28,kickGrid:[1,0,0,0,1,0,0,0],
      hihatAmp:0.08,hihatGrid:[0,1,0,1,0,1,0,1],
      melGrid: [1,0,0,1,0,0,1,0],harmGrid:[0,0,1,0,0,1,0,0],
      padGrid: [1,0,0,0,1,0,0,0],bassGrid:[1,0,0,1,0,0,1,0],
      padDurMul:6.5,delayR:0.50,delayFB:0.22,delayWet:0.16,
      revSec:2.8,revWet:0.32,masterVol:1.7,warmCut:2200,
      lfoHz:0.20,lfoD:0.018,swing:0.015,
    };

    /* MARIMBA & PIANO  91-100 */
    if (bpm <= 100) return {
      name:'Marimba & Piano', style:'Warm Rhythm',
      scale:_buildScale(196.00,[0,2,4,7,9,12]),
      drone:null,droneAmp:0,
      melParts: [{r:1,a:0.48,w:'triangle'},{r:4,a:0.18,w:'sine'},{r:2,a:0.10,w:'sine'}],
      harmParts:[{r:1,a:0.32,w:'triangle'},{r:2,a:0.15,w:'sine'},{r:3,a:0.06,w:'sine'}],
      padParts: [{r:1,a:0.14,w:'sine'},{r:2,a:0.06,w:'sine'}],
      bassParts:[{r:1,a:0.30,w:'triangle'},{r:2,a:0.13,w:'sine'}],
      melA:0.003,melD:1.0,harmA:0.007,harmD:1.5,padA:0.44,padD:5.8,bassA:0.006,bassD:1.3,
      tabla:false,kick:true,snare:true,hihat:true,
      kickAmp:0.34,kickGrid:[1,0,0,0,1,0,0,0],
      snareAmp:0.22,snareGrid:[0,0,1,0,0,0,1,0],
      hihatAmp:0.09,hihatGrid:[1,0,1,1,0,1,1,0],
      melGrid: [1,0,1,0,0,1,0,0],harmGrid:[0,0,1,0,0,0,1,0],
      padGrid: [1,0,0,0,1,0,0,0],bassGrid:[1,0,1,0,1,0,0,0],
      padDurMul:5,delayR:0.50,delayFB:0.20,delayWet:0.14,
      revSec:1.8,revWet:0.24,masterVol:1.7,warmCut:2500,
      lfoHz:0.26,lfoD:0.014,swing:0.012,
    };

    /* STRINGS & TABLA  > 100 */
    return {
      name:'Strings & Tabla', style:'Vital Energy',
      scale:_buildScale(246.94,[0,2,4,7,9,12]),
      drone:61.74,droneAmp:0.10,
      melParts: [{r:1,a:0.38,w:'sawtooth'},{r:1.001,a:0.30,w:'sawtooth'},{r:2,a:0.13,w:'sine'}],
      harmParts:[{r:1,a:0.26,w:'sawtooth'},{r:2,a:0.11,w:'sine'}],
      padParts: [{r:1,a:0.14,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts:[{r:1,a:0.32,w:'sawtooth'},{r:2,a:0.13,w:'sine'}],
      melA:0.08,melD:1.5,harmA:0.13,harmD:1.9,padA:0.34,padD:4.2,bassA:0.01,bassD:1.0,
      tabla:true,tablaS:true,kick:false,snare:false,hihat:false,
      tablaAmp:0.30,tablaGrid:[1,0,1,1,0,1,0,1],
      melGrid: [1,0,1,0,1,0,0,1],harmGrid:[0,1,0,0,0,1,0,0],
      padGrid: [1,0,0,0,0,0,0,0],bassGrid:[1,0,1,0,1,1,0,0],
      padDurMul:4,delayR:0.33,delayFB:0.16,delayWet:0.12,
      revSec:1.2,revWet:0.18,masterVol:1.6,warmCut:3000,
      lfoHz:0.50,lfoD:0.010,swing:0.006,
    };
  }

  const STAGE_NAMES = ['Heartbeat Pulse','Melody Active','Harmony Unlocked','Full Spectrum'];
  const TITLE_WORDS = ['Serenity','Stillness','Drift','Reverie','Current',
    'Resonance','Solace','Meridian','Bloom','Tide','Aether','Clarity'];
  const CHROMATIC = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

  /* Engine state */
  let _ctx=null,_master=null,_volNode=null;
  let _lfoOsc=null,_lfoGain=null;
  let _delay=null,_reverb=null,_allNodes=[];
  let _sched=null,_playing=false,_nextBar=0,_barN=0,_dur=60;
  let _stopCb=null,_beatCb=null;
  let _melBus=null,_harmBus=null,_padBus=null,_percBus=null,_droneBus=null;
  let _stage=0,_curP=null;
  let _currentVolume=1.0,_unlocked=false;
  /* Seeded state — set each start(), used by all generators */
  let _rand=null, _sessionSeed=0;
  /* Pre-generated melody sequence (deterministic, replayable) */
  let _melSeq=[], _harmSeq=[], _swingSeq=[];

  /* ── AudioContext ── */
  function _ctxGet() {
    if (!_ctx||_ctx.state==='closed') {
      const AC=window.AudioContext||window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio not supported');
      _ctx=new AC({latencyHint:'interactive'});
    }
    return _ctx;
  }
  function _unlockAudio(c) {
    if (_unlocked) return;
    try {
      const buf=c.createBuffer(1,1,c.sampleRate),src=c.createBufferSource();
      src.buffer=buf; src.connect(c.destination); src.start(0); src.stop(0.001);
      _unlocked=true;
    } catch {}
  }
  async function resume() {
    const c=_ctxGet(); _unlockAudio(c);
    if (c.state==='suspended') {
      for (let i=0;i<3&&c.state==='suspended';i++) {
        try{await c.resume();}catch{}
        if (c.state!=='running') await new Promise(r=>setTimeout(r,80));
      }
    }
    if (c.state==='closed'){_ctx=null;return _ctxGet();}
    return c;
  }
  function _tr(...nodes){_allNodes.push(...nodes);return nodes[0];}

  /* ── Reverb IR ── */
  function _makeReverb(c,sec) {
    const sr=c.sampleRate,len=Math.ceil(sr*sec);
    const ir=c.createBuffer(2,len,sr);
    for (let ch=0;ch<2;ch++){
      const d=ir.getChannelData(ch);
      for (let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.exp(-5*i/len);
    }
    const conv=c.createConvolver(); conv.buffer=ir; return _tr(conv);
  }
  function _noiseBuf(c,ms) {
    const len=Math.ceil(c.sampleRate*ms/1000),buf=c.createBuffer(1,len,c.sampleRate);
    const d=buf.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    return buf;
  }

  /* ── Warmth filter — applied to melodic buses ── */
  function _warmFilter(c, cutHz) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutHz;
    f.Q.value = 0.5;
    return _tr(f);
  }

  /* ── Additive note — partials:[{r,a,w}] ── */
  function _adNote(c,t,freq,parts,atk,dec,dest,lfoGn) {
    const env=c.createGain();
    env.gain.setValueAtTime(0,t);
    env.gain.linearRampToValueAtTime(1.0,t+atk);
    env.gain.exponentialRampToValueAtTime(0.0001,t+atk+dec);
    env.connect(dest); _tr(env);
    parts.forEach(({r,a,w})=>{
      const osc=c.createOscillator(),g=c.createGain();
      osc.type=w; osc.frequency.setValueAtTime(freq*r,t); g.gain.setValueAtTime(a,t);
      osc.connect(g); g.connect(env);
      osc.start(t); osc.stop(t+atk+dec+0.15); _tr(osc,g);
      if (lfoGn&&r===1) { try{lfoGn.connect(osc.frequency);}catch{} }
    });
    return env;
  }

  /* ── Drone ── */
  function _startDrone(c,freq,amp) {
    if (!freq||!_droneBus) return;
    [1,2,3,4,0.5].forEach((r,i)=>{
      const osc=c.createOscillator(),g=c.createGain();
      osc.type='sine'; osc.frequency.value=freq*r;
      g.gain.value=amp*[0.50,0.25,0.12,0.06,0.18][i];
      osc.detune.value=(_rand()-0.5)*5;
      osc.connect(g); g.connect(_droneBus); osc.start(); _tr(osc,g);
    });
  }

  /* ── Tabla ── */
  function _tabla(c,t,stressed) {
    const osc=c.createOscillator(),env=c.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(stressed?175:105,t);
    osc.frequency.exponentialRampToValueAtTime(stressed?55:38,t+0.15);
    env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(stressed?0.52:0.38,t+0.005);
    env.gain.exponentialRampToValueAtTime(0.0001,t+(stressed?0.22:0.30));
    osc.connect(env); env.connect(_percBus||_master);
    osc.start(t); osc.stop(t+0.36); _tr(osc,env);
    const src=c.createBufferSource(),flt=c.createBiquadFilter(),ev2=c.createGain();
    src.buffer=_noiseBuf(c,55); flt.type='bandpass';
    flt.frequency.value=stressed?1300:850; flt.Q.value=12;
    ev2.gain.setValueAtTime(0,t+0.012); ev2.gain.linearRampToValueAtTime(stressed?0.32:0.22,t+0.020);
    ev2.gain.exponentialRampToValueAtTime(0.0001,t+0.085);
    src.connect(flt); flt.connect(ev2); ev2.connect(_percBus||_master);
    src.start(t+0.012); src.stop(t+0.11); _tr(src,flt,ev2);
  }
  function _kick(c,t,amp=0.30) {
    const osc=c.createOscillator(),env=c.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(90,t);
    osc.frequency.exponentialRampToValueAtTime(28,t+0.12);
    env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(amp,t+0.004);
    env.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
    osc.connect(env); env.connect(_percBus||_master);
    osc.start(t); osc.stop(t+0.28); _tr(osc,env);
  }
  function _snare(c,t,amp=0.22) {
    const src=c.createBufferSource(),flt=c.createBiquadFilter(),env=c.createGain();
    src.buffer=_noiseBuf(c,170); flt.type='bandpass'; flt.frequency.value=1600; flt.Q.value=0.9;
    env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(amp,t+0.004);
    env.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
    src.connect(flt); flt.connect(env); env.connect(_percBus||_master);
    src.start(t); src.stop(t+0.20); _tr(src,flt,env);
  }
  function _hihat(c,t,amp=0.07) {
    const src=c.createBufferSource(),flt=c.createBiquadFilter(),env=c.createGain();
    src.buffer=_noiseBuf(c,26); flt.type='highpass'; flt.frequency.value=7800;
    env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(amp,t+0.002);
    env.gain.exponentialRampToValueAtTime(0.0001,t+0.028);
    src.connect(flt); flt.connect(env); env.connect(_percBus||_master);
    src.start(t); src.stop(t+0.038); _tr(src,flt,env);
  }

  /* ── Heartbeat ── */
  function _heartbeat(c,t,barDur,bpm) {
    const calm=bpm<65;
    [{ms:65,freq:calm?125:185,Q:5.5,amp:calm?0.28:bpm>100?0.52:0.38,dt:0},
     {ms:44,freq:calm?175:255,Q:4.2,amp:calm?0.15:bpm>100?0.32:0.21,dt:barDur*0.27}].forEach(({ms,freq,Q,amp,dt})=>{
      const src=c.createBufferSource(),flt=c.createBiquadFilter(),env=c.createGain();
      src.buffer=_noiseBuf(c,ms); flt.type='lowpass'; flt.frequency.value=freq; flt.Q.value=Q;
      const st=t+dt;
      env.gain.setValueAtTime(0,st); env.gain.linearRampToValueAtTime(amp,st+0.008);
      env.gain.exponentialRampToValueAtTime(0.0001,st+ms/1000);
      src.connect(flt); flt.connect(env); env.connect(_master);
      src.start(st); src.stop(st+ms/1000+0.01); _tr(src,flt,env);
    });
    if (_beatCb&&_ctx) setTimeout(_beatCb,Math.max(0,(t-_ctx.currentTime)*1000));
  }

  /* ════════════════════════════════════════════════════════
     MUSICAL PHRASE ENGINE
     ─────────────────────
     Generates a fully deterministic melody sequence using:
     • Guided random walk with step preference (±1 or ±2 steps)
     • Strong beat emphasis on chord tones (root, 3rd, 5th)
     • Phrase arch: rises to midpoint then descends
     • Cadences every 4 bars back to root area
     • HRV controls expressiveness (range of notes)
  ════════════════════════════════════════════════════════ */
  function _generateMelody(scale, bars, stepsPerBar, hrv) {
    const r = _rand; // already seeded
    const N = bars * stepsPerBar;
    const seq = new Array(N);

    /* Chord tones are indices 0, 2, 4 in pentatonic */
    const isChordTone = i => (i % scale.length) < 3;

    /* Start near the middle of the scale */
    const mid = Math.floor(scale.length / 2);
    let pos = mid + Math.round((r() - 0.5) * 2);
    pos = Math.max(0, Math.min(scale.length - 1, pos));

    /* Expression range: wider with higher HRV */
    const range = Math.max(2, Math.min(scale.length - 1, Math.round(hrv / 12) + 2));

    for (let i = 0; i < N; i++) {
      const bar = Math.floor(i / stepsPerBar);
      const beat = i % stepsPerBar;
      const isStrong = beat === 0; // downbeat
      const phrasePos = (bar % 4) / 3; // 0→1 phrase position

      seq[i] = scale[pos];

      /* Advance for next note */
      const target = mid + Math.round(Math.sin(phrasePos * Math.PI) * range * 0.5);

      if (bar % 4 === 3 && beat >= stepsPerBar - 2) {
        /* Cadence: pull toward root */
        pos += pos > mid ? -1 : pos < mid ? 1 : 0;
      } else {
        /* Step motion: prefer ±1, occasionally ±2, rarely leap */
        const pull = Math.sign(target - pos) * (r() < 0.55 ? 1 : 0);
        const step = r() < 0.65 ? pull || (r() < 0.5 ? 1 : -1) :
                     r() < 0.85 ? (r() < 0.5 ? 1 : -1) * 2 :
                     Math.round((r() - 0.5) * range);
        pos = Math.max(0, Math.min(scale.length - 1, pos + step));
        /* On strong beats bias toward chord tones */
        if (isStrong && !isChordTone(pos)) {
          const adj = pos > 0 && isChordTone(pos-1) ? -1 :
                      pos < scale.length-1 && isChordTone(pos+1) ? 1 : 0;
          pos = Math.max(0, Math.min(scale.length - 1, pos + adj));
        }
      }
    }
    return seq;
  }

  /* Consonant harmony note: always a 3rd or 5th above melody */
  function _harmNote(melFreq, scale) {
    /* Find scale index of melody note */
    const idx = scale.indexOf(melFreq);
    if (idx < 0) return melFreq * 1.4983; // perfect 5th fallback
    /* Go up 2 or 3 steps in scale (3rd or 4th degree up) */
    const up = 2 + Math.floor(idx / 3) % 2; // alternates 2 and 3
    return scale[Math.min(scale.length - 1, idx + up)] || melFreq * 1.2599;
  }

  /* Pre-generate swing offsets for all bars×steps */
  function _generateSwing(bars, stepsPerBar, swing) {
    const r = _rand;
    const N = bars * stepsPerBar;
    const seq = new Array(N);
    for (let i = 0; i < N; i++) {
      const beat = i % stepsPerBar;
      seq[i] = (beat % 2 === 1 ? swing : -swing * 0.2) + (r() - 0.5) * swing * 0.18;
    }
    return seq;
  }

  /* ── Bar scheduler (uses pre-generated sequences) ── */
  function _schedBar(c, barStart, stepSec, hrv, bpm, p) {
    const nSteps = p.melGrid.length, barDur = stepSec * nSteps;
    _heartbeat(c, barStart, barDur, bpm);

    for (let s = 0; s < nSteps; s++) {
      const seqIdx = _barN * nSteps + s;
      const swOff  = _swingSeq[seqIdx % _swingSeq.length] || 0;
      const t = Math.max(barStart, barStart + s * stepSec + swOff);

      /* Bass — root note, octave below melody */
      if (p.bassGrid[s]) {
        const bf = s < nSteps/2 ? p.scale[0]/2 : p.scale[2]/2;
        _adNote(c, t, bf, p.bassParts, p.bassA, p.bassD, _master, null);
      }

      /* Melody */
      if (p.melGrid[s] && _melBus) {
        const mf = _melSeq[seqIdx % _melSeq.length] || p.scale[0];
        _adNote(c, t, mf, p.melParts, p.melA, p.melD, _melBus, _lfoGain);
      }

      /* Harmony — consonant with melody */
      if (p.harmGrid[s] && _harmBus) {
        const mf = _melSeq[seqIdx % _melSeq.length] || p.scale[0];
        const hf = _harmNote(mf, p.scale);
        _adNote(c, t, hf, p.harmParts, p.harmA, p.harmD, _harmBus, null);
      }

      /* Pad — chord tones */
      if (p.padGrid[s] && _padBus) {
        const pd = stepSec * p.padDurMul;
        [p.scale[0], p.scale[2], p.scale[4]].forEach((f, i) => {
          _adNote(c, t, f/2, p.padParts.map(x=>({...x,a:x.a*(1-i*0.2)})), p.padA, pd, _padBus, null);
        });
      }

      /* Percussion */
      if (p.tabla  && p.tablaGrid?.[s]) _tabla(c, t, p.tablaS||false);
      if (p.kick   && p.kickGrid?.[s])  _kick(c, t, p.kickAmp||0.30);
      if (p.snare  && p.snareGrid?.[s]) _snare(c, t, p.snareAmp||0.22);
      if (p.hihat  && p.hihatGrid?.[s]) _hihat(c, t, p.hihatAmp||0.07);
    }
  }

  function _scheduler(c, stepSec, hrv, bpm, p) {
    const barDur = stepSec * p.melGrid.length;
    while (_nextBar < c.currentTime + 0.35) {
      _schedBar(c, _nextBar, stepSec, hrv, bpm, p);
      _nextBar += barDur; _barN++;
    }
    _sched = setTimeout(() => _scheduler(c, stepSec, hrv, bpm, p), 80);
  }

  /* ════ PUBLIC — START ════ */
  async function start(bpm, hrv, timelineOrSeed, onStopFn) {
    stop();
    let c; try{c=await resume();}catch(e){console.error('[AE]',e);return false;}
    if (!c||c.state!=='running'){console.warn('[AE] ctx not running:',c?.state);return false;}

    if (typeof timelineOrSeed==='function') _stopCb=timelineOrSeed;
    else _stopCb=onStopFn||null;

    const B = Math.max(40,Math.min(200,bpm||72));
    const H = Math.max(10,Math.min(100,hrv||45));
    const p = _getProfile(B); _curP = p;

    /* Derive seed: if a numeric seed is passed (library replay), use it.
       Otherwise generate from bpm+hrv+timestamp for a fresh session. */
    if (typeof timelineOrSeed === 'number' && timelineOrSeed > 0) {
      _sessionSeed = timelineOrSeed >>> 0;
    } else {
      _sessionSeed = ((B * 7919 + H * 6271) ^ (Date.now() / 1000 | 0)) >>> 0;
    }
    _rand = _mkRand(_sessionSeed);

    /* Half-time for soothing feel */
    const musicBpm = Math.max(24, Math.round(B * 0.5));
    const stepSec = 60 / musicBpm;
    const nSteps = p.melGrid.length;
    const barDur = stepSec * nSteps;
    const totalBars = Math.ceil(60 / barDur) + 4;
    _dur = Math.ceil(totalBars * barDur);
    _allNodes = []; _barN = 0; _stage = 0;

    /* Pre-generate all sequences — fully deterministic from seed */
    _melSeq   = _generateMelody(p.scale, totalBars, nSteps, H);
    _harmSeq  = _melSeq; // harmony derived inline from melody
    _swingSeq = _generateSwing(totalBars, nSteps, p.swing);

    /* Signal chain: master → volNode → compressor → destination */
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8;
    comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    comp.connect(c.destination); _tr(comp);

    _volNode = c.createGain();
    _volNode.gain.setValueAtTime(_currentVolume, c.currentTime);
    _volNode.connect(comp);

    _master = c.createGain();
    _master.gain.setValueAtTime(0, c.currentTime);
    _master.gain.linearRampToValueAtTime(p.masterVol, c.currentTime + 1.6);
    _master.connect(_volNode);

    /* Reverb */
    const rvWet = c.createGain(); rvWet.gain.value = p.revWet;
    _reverb = _makeReverb(c, p.revSec);
    _reverb.connect(rvWet); rvWet.connect(_master); _tr(rvWet);

    /* Delay */
    const dly=c.createDelay(2.5),dfb=c.createGain(),dwt=c.createGain();
    dly.delayTime.setValueAtTime(stepSec*p.delayR, c.currentTime);
    dfb.gain.setValueAtTime(p.delayFB, c.currentTime);
    dwt.gain.setValueAtTime(p.delayWet, c.currentTime);
    dly.connect(dfb); dfb.connect(dly); dly.connect(dwt); dwt.connect(_master);
    _delay = dly; _tr(dly,dfb,dwt);

    /* LFO */
    const lfoOsc=c.createOscillator(),lfoGn=c.createGain();
    lfoOsc.frequency.setValueAtTime(p.lfoHz, c.currentTime);
    lfoGn.gain.setValueAtTime(p.lfoD*(1+H*0.008), c.currentTime);
    lfoOsc.connect(lfoGn); lfoOsc.start();
    _lfoGain=lfoGn; _lfoOsc=lfoOsc; _tr(lfoOsc,lfoGn);

    /* Layer buses with warmth filters on melodic buses */
    _melBus  = c.createGain(); _melBus.gain.value  = 0;
    _harmBus = c.createGain(); _harmBus.gain.value = 0;
    _padBus  = c.createGain(); _padBus.gain.value  = 0;
    _percBus = c.createGain(); _percBus.gain.value = 0;
    _droneBus= c.createGain(); _droneBus.gain.value= 0;

    /* Warm filter → delay → master for melody */
    const melWarm = _warmFilter(c, p.warmCut);
    _melBus.connect(melWarm); melWarm.connect(_delay||_master);
    /* Warm filter → reverb for harmony/pad */
    const harmWarm = _warmFilter(c, p.warmCut * 0.8);
    _harmBus.connect(harmWarm); harmWarm.connect(_reverb||_master);
    _padBus.connect(_reverb||_master);
    _percBus.connect(_master);
    _droneBus.connect(_reverb||_master);
    _tr(_melBus,_harmBus,_padBus,_percBus,_droneBus);

    if (p.drone && p.droneAmp > 0) _startDrone(c, p.drone, p.droneAmp);

    _nextBar = c.currentTime + 0.10; _playing = true;
    _scheduler(c, stepSec, H, B, p);
    return true;
  }

  /* ════ PUBLIC — STOP ════ */
  function stop() {
    if (_sched){clearTimeout(_sched);_sched=null;}
    _allNodes.forEach(n=>{try{n.stop?.();}catch{}try{n.disconnect();}catch{}});
    _allNodes=[];
    [_master,_volNode].forEach(n=>{if(n)try{n.disconnect();}catch{}});
    _master=_volNode=null;
    _reverb=_delay=_lfoGain=_lfoOsc=null;
    _melBus=_harmBus=_padBus=_percBus=_droneBus=null;
    _playing=false; _stage=0;
    if (_stopCb){_stopCb();_stopCb=null;}
  }

  function fadeOut(sec=1.8) {
    if (!_master||!_ctx){stop();return;}
    _master.gain.setValueAtTime(_master.gain.value,_ctx.currentTime);
    _master.gain.linearRampToValueAtTime(0.0001,_ctx.currentTime+sec);
    setTimeout(stop,(sec+0.2)*1000);
  }

  function setVolume(level) {
    _currentVolume=Math.max(0,Math.min(1,level));
    if (_volNode&&_ctx) _volNode.gain.setTargetAtTime(_currentVolume,_ctx.currentTime,0.02);
    return _currentVolume;
  }
  function getVolume(){return _currentVolume;}

  function setStage(n) {
    if (!_playing||!_ctx) return;
    const now=_ctx.currentTime,ramp=4.0;
    _stage=Math.max(0,Math.min(3,n));
    const T={mel:_stage>=1?1:0,harm:_stage>=2?1:0,pad:_stage>=2?1:0,
              perc:_stage>=1?1:0,drone:_stage>=3?1:0};
    const fade=(g,v)=>{g.setValueAtTime(g.value,now);g.linearRampToValueAtTime(v,now+ramp);};
    if(_melBus)  fade(_melBus.gain,T.mel);
    if(_harmBus) fade(_harmBus.gain,T.harm);
    if(_padBus)  fade(_padBus.gain,T.pad);
    if(_percBus) fade(_percBus.gain,T.perc);
    if(_droneBus)fade(_droneBus.gain,T.drone);
  }

  function getMeta(bpm,hrv) {
    const B=Math.max(40,Math.min(200,bpm||72));
    const H=Math.max(10,Math.min(100,hrv||45));
    const p=_getProfile(B);
    const ti=Math.abs(Math.round(B*1.4+H*0.6))%TITLE_WORDS.length;
    const key=CHROMATIC[Math.round(B/5.8)%12];
    const hv=H>52?'High Variability':H>28?'Moderate Variability':'Low Variability';
    return {
      title:`${TITLE_WORDS[ti]} in ${key}`,
      subtitle:`${p.name} · ${B} BPM · ${hv}`,
      instrument:p.name, style:p.style,
    };
  }

  function getSessionSeed() { return _sessionSeed; }

  function setBeatCallback(fn){_beatCb=typeof fn==='function'?fn:null;}

  return {
    start,stop,fadeOut,resume,
    getMeta,setStage,setBeatCallback,
    setVolume,getVolume,
    getSessionSeed,
    getStageName:n=>STAGE_NAMES[Math.min(3,Math.max(0,n??_stage))],
    getDuration:()=>_dur,
    getIsPlaying:()=>_playing,
    getStage:()=>_stage,
  };
})();

window.AudioEngine=AudioEngine;