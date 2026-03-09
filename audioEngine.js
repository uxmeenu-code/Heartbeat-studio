/* ================================================================
   HeartBeat Studio — audioEngine.js v6
   SOOTHING BIOMETRIC MUSIC ENGINE

   Instrument selection by BPM:
     < 60 bpm  → Sitar + Tampura drone + soft tabla  (meditative)
     60-74 bpm → Flute (Bansuri) + Strings + gentle hi-hat
     75-90 bpm → Piano + Acoustic guitar + light kick/hihat
     91-100 bpm→ Marimba + Piano + mid tempo perc
     >100 bpm  → Strings + Tampura drone + tabla

   Design goals:
     • Additive synthesis per instrument (stacked harmonics)
     • Music runs at BPM/2 — never rushed
     • Pentatonic / raga-safe scales — no dissonance
     • Rich exponential reverb, long gentle decay
     • HRV shapes vibrato depth and melodic expressiveness
     • Every session sounds different (unique instrument per BPM)
================================================================ */
'use strict';

const AudioEngine = (() => {

  /* ────────────────────────────────────────────────────────────
     Scale builder — semitone intervals from root, 3 octaves
  ──────────────────────────────────────────────────────────── */
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

  /* ────────────────────────────────────────────────────────────
     INSTRUMENT PROFILE SELECTOR  (called fresh each session)
  ──────────────────────────────────────────────────────────── */
  function _getProfile(bpm) {

    /* ── SITAR & TAMPURA DRONE  (bpm < 60) ── */
    if (bpm < 60) return {
      name: 'Sitar & Drone',
      style: 'Raga Meditation',
      scale: _buildScale(146.83, [0,2,3,7,8,10,12]), // D Bhairavi
      drone: 73.42, droneAmp: 0.16,
      melParts:  [{r:1,a:0.40,w:'triangle'},{r:2,a:0.16,w:'sine'},{r:3,a:0.07,w:'sine'}],
      harmParts: [{r:1,a:0.18,w:'sine'},{r:1.5,a:0.08,w:'sine'}],
      padParts:  [{r:1,a:0.11,w:'sine'},{r:2,a:0.04,w:'sine'}],
      bassParts: [{r:1,a:0.22,w:'sine'},{r:2,a:0.06,w:'sine'}],
      melA:0.007, melD:3.4, harmA:0.09, harmD:5.0, padA:0.7, padD:9.0, bassA:0.04, bassD:2.8,
      tabla:true, tablaS:false, kick:false, snare:false, hihat:false,
      tablaAmp:0.22, tablaGrid:[1,0,0,1,0,1,0,0],
      melGrid: [1,0,0,0,0,0,1,0], harmGrid:[0,0,1,0,0,0,0,0],
      padGrid: [1,0,0,0,0,0,0,0], bassGrid:[1,0,0,0,1,0,0,0],
      padDurMul:12, delayR:0.75,delayFB:0.38,delayWet:0.28,
      revSec:5.5,revWet:0.55, masterVol:0.44,
      lfoHz:0.06,lfoD:0.030, swing:0.042,swingH:0.0007,
    };

    /* ── BANSURI FLUTE + STRINGS  (60-74) ── */
    if (bpm <= 74) return {
      name: 'Bansuri Flute & Strings',
      style: 'Gentle Flow',
      scale: _buildScale(261.63, [0,2,4,7,9,12]), // C major pent
      drone: 65.41, droneAmp: 0.08,
      melParts:  [{r:1,a:0.44,w:'sine'},{r:2,a:0.11,w:'sine'},{r:3,a:0.03,w:'sine'}],
      harmParts: [{r:1,a:0.22,w:'sine'},{r:1.002,a:0.18,w:'sine'},{r:2,a:0.07,w:'sine'}],
      padParts:  [{r:1,a:0.12,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts: [{r:1,a:0.20,w:'triangle'},{r:2,a:0.08,w:'sine'}],
      melA:0.09, melD:2.8, harmA:0.20, harmD:5.5, padA:0.9, padD:10.0, bassA:0.07, bassD:2.2,
      tabla:false, kick:false, snare:false, hihat:true,
      hihatAmp:0.055, hihatGrid:[0,0,1,0,0,0,1,0],
      melGrid: [1,0,0,0,1,0,0,0], harmGrid:[0,0,1,0,0,0,1,0],
      padGrid: [1,0,0,0,0,0,0,0], bassGrid:[1,0,0,0,1,0,0,0],
      padDurMul:9, delayR:0.67,delayFB:0.32,delayWet:0.22,
      revSec:4.2,revWet:0.50, masterVol:0.46,
      lfoHz:0.11,lfoD:0.032, swing:0.026,swingH:0.0005,
    };

    /* ── PIANO + ACOUSTIC GUITAR  (75-90) ── */
    if (bpm <= 90) return {
      name: 'Piano & Acoustic Guitar',
      style: 'Melodic Calm',
      scale: _buildScale(220.00, [0,2,4,5,7,9,11,12]), // A major
      drone: null, droneAmp: 0,
      melParts:  [{r:1,a:0.50,w:'triangle'},{r:2,a:0.22,w:'sine'},{r:3,a:0.09,w:'sine'},{r:4,a:0.04,w:'sine'}],
      harmParts: [{r:1,a:0.26,w:'triangle'},{r:2,a:0.14,w:'sine'},{r:3,a:0.06,w:'sine'}],
      padParts:  [{r:1,a:0.14,w:'sine'},{r:2,a:0.06,w:'sine'}],
      bassParts: [{r:1,a:0.26,w:'triangle'},{r:2,a:0.10,w:'sine'}],
      melA:0.004, melD:2.2, harmA:0.011, harmD:1.8, padA:0.55, padD:7.0, bassA:0.008, bassD:1.6,
      tabla:false, kick:true, snare:false, hihat:true,
      kickAmp:0.26, kickGrid:[1,0,0,0,1,0,0,0],
      hihatAmp:0.08, hihatGrid:[0,1,0,1,0,1,0,1],
      melGrid: [1,0,0,1,0,0,1,0], harmGrid:[0,0,1,0,0,1,0,0],
      padGrid: [1,0,0,0,1,0,0,0], bassGrid:[1,0,0,1,0,0,1,0],
      padDurMul:6.5, delayR:0.50,delayFB:0.22,delayWet:0.16,
      revSec:2.8,revWet:0.32, masterVol:0.42,
      lfoHz:0.20,lfoD:0.018, swing:0.015,swingH:0.0003,
    };

    /* ── MARIMBA + PIANO  (91-100) ── */
    if (bpm <= 100) return {
      name: 'Marimba & Piano',
      style: 'Warm Rhythm',
      scale: _buildScale(196.00, [0,2,4,7,9,12]), // G pent
      drone: null, droneAmp: 0,
      melParts:  [{r:1,a:0.46,w:'triangle'},{r:4,a:0.18,w:'sine'},{r:2,a:0.10,w:'sine'}],
      harmParts: [{r:1,a:0.30,w:'triangle'},{r:2,a:0.14,w:'sine'},{r:3,a:0.06,w:'sine'}],
      padParts:  [{r:1,a:0.13,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts: [{r:1,a:0.28,w:'triangle'},{r:2,a:0.12,w:'sine'}],
      melA:0.003, melD:0.95, harmA:0.006, harmD:1.4, padA:0.42, padD:5.5, bassA:0.006, bassD:1.2,
      tabla:false, kick:true, snare:true, hihat:true,
      kickAmp:0.32, kickGrid:[1,0,0,0,1,0,0,0],
      snareAmp:0.20, snareGrid:[0,0,1,0,0,0,1,0],
      hihatAmp:0.09, hihatGrid:[1,0,1,1,0,1,1,0],
      melGrid: [1,0,1,0,0,1,0,0], harmGrid:[0,0,1,0,0,0,1,0],
      padGrid: [1,0,0,0,1,0,0,0], bassGrid:[1,0,1,0,1,0,0,0],
      padDurMul:5, delayR:0.50,delayFB:0.20,delayWet:0.14,
      revSec:1.8,revWet:0.24, masterVol:0.42,
      lfoHz:0.26,lfoD:0.014, swing:0.012,swingH:0.00025,
    };

    /* ── STRINGS + TABLA  (> 100) ── */
    return {
      name: 'Strings & Tabla',
      style: 'Vital Energy',
      scale: _buildScale(246.94, [0,2,4,7,9,12]), // B pent
      drone: 61.74, droneAmp: 0.10,
      melParts:  [{r:1,a:0.36,w:'sawtooth'},{r:1.001,a:0.28,w:'sawtooth'},{r:2,a:0.12,w:'sine'}],
      harmParts: [{r:1,a:0.24,w:'sawtooth'},{r:2,a:0.10,w:'sine'}],
      padParts:  [{r:1,a:0.13,w:'sine'},{r:2,a:0.05,w:'sine'}],
      bassParts: [{r:1,a:0.30,w:'sawtooth'},{r:2,a:0.12,w:'sine'}],
      melA:0.08, melD:1.4, harmA:0.12, harmD:1.8, padA:0.32, padD:4.0, bassA:0.01, bassD:0.9,
      tabla:true, tablaS:true, kick:false, snare:false, hihat:false,
      tablaAmp:0.28, tablaGrid:[1,0,1,1,0,1,0,1],
      melGrid: [1,0,1,0,1,0,0,1], harmGrid:[0,1,0,0,0,1,0,0],
      padGrid: [1,0,0,0,0,0,0,0], bassGrid:[1,0,1,0,1,1,0,0],
      padDurMul:4, delayR:0.33,delayFB:0.16,delayWet:0.12,
      revSec:1.2,revWet:0.18, masterVol:0.40,
      lfoHz:0.50,lfoD:0.010, swing:0.006,swingH:0.00015,
    };
  }

  /* Stage names */
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
  let _currentVolume=0.8,_unlocked=false;

  /* AudioContext */
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

  /* Reverb */
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

  /* Additive note — partials:[{r,a,w}] */
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
      osc.start(t); osc.stop(t+atk+dec+0.12); _tr(osc,g);
      if (lfoGn&&r===1) { try{lfoGn.connect(osc.frequency);}catch{} }
    });
    return env;
  }

  /* Tampura drone */
  function _startDrone(c,freq,amp) {
    if (!freq||!_droneBus) return;
    [1,2,3,4,0.5].forEach((r,i)=>{
      const osc=c.createOscillator(),g=c.createGain();
      osc.type='sine'; osc.frequency.value=freq*r;
      g.gain.value=amp*[0.50,0.25,0.12,0.06,0.18][i];
      osc.detune.value=(Math.random()-0.5)*5;
      osc.connect(g); g.connect(_droneBus); osc.start(); _tr(osc,g);
    });
  }

  /* Tabla */
  function _tabla(c,t,stressed) {
    const osc=c.createOscillator(),env=c.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(stressed?175:105,t);
    osc.frequency.exponentialRampToValueAtTime(stressed?55:38,t+0.15);
    env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(stressed?0.50:0.36,t+0.005);
    env.gain.exponentialRampToValueAtTime(0.0001,t+(stressed?0.22:0.30));
    osc.connect(env); env.connect(_percBus||_master);
    osc.start(t); osc.stop(t+0.36); _tr(osc,env);
    // dayan
    const src=c.createBufferSource(),flt=c.createBiquadFilter(),ev2=c.createGain();
    src.buffer=_noiseBuf(c,55); flt.type='bandpass';
    flt.frequency.value=stressed?1300:850; flt.Q.value=12;
    ev2.gain.setValueAtTime(0,t+0.012); ev2.gain.linearRampToValueAtTime(stressed?0.30:0.20,t+0.020);
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

  /* Heartbeat lub-dub */
  function _heartbeat(c,t,barDur,bpm) {
    const calm=bpm<65;
    [{ms:65,freq:calm?125:185,Q:5.5,amp:calm?0.28:bpm>100?0.50:0.36,dt:0},
     {ms:44,freq:calm?175:255,Q:4.2,amp:calm?0.15:bpm>100?0.30:0.20,dt:barDur*0.27}].forEach(({ms,freq,Q,amp,dt})=>{
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

  /* Melody picker */
  function _pickNote(scale,barN,stepN,hrv) {
    const spread=Math.max(2,Math.min(scale.length-2,Math.round(hrv/10)));
    const contour=Math.sin(barN*0.52+stepN*0.31)*spread*0.6;
    return scale[Math.abs(Math.round(contour+barN*0.18))%scale.length];
  }

  /* Swing */
  function _swing(s,hrv,p) {
    return (s%2===1?p.swing:-p.swing*0.2)+(Math.random()-0.5)*hrv*p.swingH;
  }

  /* Bar scheduler */
  function _schedBar(c,barStart,stepSec,hrv,bpm,p) {
    const nSteps=p.melGrid.length,barDur=stepSec*nSteps;
    _heartbeat(c,barStart,barDur,bpm);
    for (let s=0;s<nSteps;s++) {
      const t=Math.max(barStart,barStart+s*stepSec+_swing(s,hrv,p));
      if (p.bassGrid[s]) {
        const bf=s<nSteps/2?p.scale[0]/2:p.scale[2]/2;
        _adNote(c,t,bf,p.bassParts,p.bassA,p.bassD,_master,null);
      }
      if (p.melGrid[s]&&_melBus) {
        _adNote(c,t,_pickNote(p.scale,_barN,s,hrv),p.melParts,p.melA,p.melD,_melBus,_lfoGain);
      }
      if (p.harmGrid[s]&&_harmBus) {
        _adNote(c,t,_pickNote(p.scale,_barN,s+2,hrv)*1.4983,p.harmParts,p.harmA,p.harmD,_harmBus,null);
      }
      if (p.padGrid[s]&&_padBus) {
        const pd=stepSec*p.padDurMul;
        [p.scale[0],p.scale[2],p.scale[4]].forEach((f,i)=>{
          _adNote(c,t,f/2,p.padParts.map(x=>({...x,a:x.a*(1-i*0.2)})),p.padA,pd,_padBus,null);
        });
      }
      if (p.tabla&&p.tablaGrid?.[s]) _tabla(c,t,p.tablaS||false);
      if (p.kick&&p.kickGrid?.[s])   _kick(c,t,p.kickAmp||0.30);
      if (p.snare&&p.snareGrid?.[s]) _snare(c,t,p.snareAmp||0.22);
      if (p.hihat&&p.hihatGrid?.[s]) _hihat(c,t,p.hihatAmp||0.07);
    }
  }

  function _scheduler(c,stepSec,hrv,bpm,p) {
    const barDur=stepSec*p.melGrid.length;
    while (_nextBar<c.currentTime+0.35) {
      _schedBar(c,_nextBar,stepSec,hrv,bpm,p); _nextBar+=barDur; _barN++;
    }
    _sched=setTimeout(()=>_scheduler(c,stepSec,hrv,bpm,p),80);
  }

  /* ════ PUBLIC — START ════ */
  async function start(bpm,hrv,timelineOrCb,onStopFn) {
    stop();
    let c; try{c=await resume();}catch(e){console.error('[AE]',e);return false;}
    if (!c||c.state!=='running'){console.warn('[AE] ctx not running:',c?.state);return false;}

    if (typeof timelineOrCb==='function') _stopCb=timelineOrCb;
    else _stopCb=onStopFn||null;

    const B=Math.max(40,Math.min(200,bpm||72));
    const H=Math.max(10,Math.min(100,hrv||45));
    const p=_getProfile(B); _curP=p;

    /* Half-time tempo for soothing feel */
    const musicBpm=Math.max(24,Math.round(B*0.5));
    const stepSec=60/musicBpm;
    const barDur=stepSec*p.melGrid.length;
    const barsNeeded=Math.ceil(60/barDur);
    _dur=Math.ceil(barsNeeded*barDur);
    _allNodes=[]; _barN=0; _stage=0;

    _volNode=c.createGain(); _volNode.gain.setValueAtTime(_currentVolume,c.currentTime);
    _volNode.connect(c.destination);

    _master=c.createGain(); _master.gain.setValueAtTime(0,c.currentTime);
    _master.gain.linearRampToValueAtTime(p.masterVol,c.currentTime+1.6);
    _master.connect(_volNode);

    const rvWet=c.createGain(); rvWet.gain.value=p.revWet;
    _reverb=_makeReverb(c,p.revSec);
    _reverb.connect(rvWet); rvWet.connect(_master); _tr(rvWet);

    const dly=c.createDelay(2.5),dfb=c.createGain(),dwt=c.createGain();
    dly.delayTime.setValueAtTime(stepSec*p.delayR,c.currentTime);
    dfb.gain.setValueAtTime(p.delayFB,c.currentTime);
    dwt.gain.setValueAtTime(p.delayWet,c.currentTime);
    dly.connect(dfb); dfb.connect(dly); dly.connect(dwt); dwt.connect(_master);
    _delay=dly; _tr(dly,dfb,dwt);

    const lfoOsc=c.createOscillator(),lfoGn=c.createGain();
    lfoOsc.frequency.setValueAtTime(p.lfoHz,c.currentTime);
    lfoGn.gain.setValueAtTime(p.lfoD*(1+H*0.008),c.currentTime);
    lfoOsc.connect(lfoGn); lfoOsc.start();
    _lfoGain=lfoGn; _lfoOsc=lfoOsc; _tr(lfoOsc,lfoGn);

    _melBus=c.createGain(); _melBus.gain.value=0;
    _harmBus=c.createGain(); _harmBus.gain.value=0;
    _padBus=c.createGain(); _padBus.gain.value=0;
    _percBus=c.createGain(); _percBus.gain.value=0;
    _droneBus=c.createGain(); _droneBus.gain.value=0;
    _melBus.connect(_delay||_master);
    _harmBus.connect(_reverb||_master);
    _padBus.connect(_reverb||_master);
    _percBus.connect(_master);
    _droneBus.connect(_reverb||_master);
    _tr(_melBus,_harmBus,_padBus,_percBus,_droneBus);

    if (p.drone&&p.droneAmp>0) _startDrone(c,p.drone,p.droneAmp);

    _nextBar=c.currentTime+0.10; _playing=true;
    _scheduler(c,stepSec,H,B,p);
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

  /* ════ PUBLIC — FADE OUT ════ */
  function fadeOut(sec=1.8) {
    if (!_master||!_ctx){stop();return;}
    _master.gain.setValueAtTime(_master.gain.value,_ctx.currentTime);
    _master.gain.linearRampToValueAtTime(0.0001,_ctx.currentTime+sec);
    setTimeout(stop,(sec+0.2)*1000);
  }

  /* ════ PUBLIC — VOLUME ════ */
  function setVolume(level) {
    _currentVolume=Math.max(0,Math.min(1,level));
    if (_volNode&&_ctx) _volNode.gain.setTargetAtTime(_currentVolume,_ctx.currentTime,0.02);
    return _currentVolume;
  }
  function getVolume(){return _currentVolume;}

  /* ════ PUBLIC — SET STAGE ════ */
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

  /* ════ PUBLIC — getMeta ════ */
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

  function setBeatCallback(fn){_beatCb=typeof fn==='function'?fn:null;}

  return {
    start,stop,fadeOut,resume,
    getMeta,setStage,setBeatCallback,
    setVolume,getVolume,
    getStageName:n=>STAGE_NAMES[Math.min(3,Math.max(0,n??_stage))],
    getDuration:()=>_dur,
    getIsPlaying:()=>_playing,
    getStage:()=>_stage,
  };
})();

window.AudioEngine=AudioEngine;