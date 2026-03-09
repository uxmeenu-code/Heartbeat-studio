/* ================================================================
   HeartBeat Studio — storage.js v5
   IndexedDB sessions + localStorage for profile/prefs/limits.
================================================================ */
'use strict';

const Storage = (() => {
  const DB_NAME = 'hbs_v3', DB_VER = 1, STORE = 'sessions', LS_KEY = 'hbs_v3_sessions';

  /* ─── localStorage key constants ─── */
  const LS_PROFILE      = 'hbs_profile';
  const LS_USAGE        = 'hbs_usage';          /* { freeScansUsed: n } */
  const LS_SUBSCRIPTION = 'hbs_subscription';   /* { status: "active"|"free" } */
  const LS_VOLUME       = 'hbs_volume';          /* { level: 0-1 } */

  let db = null, ready = false, _init = null;

  /* ─── IndexedDB init ─── */
  function init() {
    if (_init) return _init;
    _init = new Promise(resolve => {
      if (!window.indexedDB) { resolve(false); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE))
          d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = e => { db = e.target.result; ready = true; resolve(true); };
      req.onerror   = () => resolve(false);
    });
    return _init;
  }

  function _tx(mode, fn) {
    return new Promise((res, rej) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }
  function _lsGet()    { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function _lsSet(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {} }

  /* ─── Sessions ─── */
  async function saveSession(s) {
    await init();
    if (ready) return _tx('readwrite', st => st.put(s));
    const all = _lsGet(), i = all.findIndex(x => x.id === s.id);
    i >= 0 ? all[i] = s : all.unshift(s);
    _lsSet(all); return s;
  }

  async function loadSessions() {
    await init();
    if (ready) {
      const all = await _tx('readonly', st => st.getAll());
      return (all || []).sort((a, b) => b.id - a.id);
    }
    return _lsGet();
  }

  async function deleteSession(id) {
    await init();
    if (ready) return _tx('readwrite', st => st.delete(id));
    _lsSet(_lsGet().filter(s => s.id !== id));
  }

  async function renameSession(id, name) {
    await init();
    if (ready) {
      const s = await _tx('readonly', st => st.get(id));
      if (!s) throw new Error('Not found');
      s.name = name;
      return _tx('readwrite', st => st.put(s));
    }
    const all = _lsGet(), item = all.find(s => s.id === id);
    if (item) { item.name = name; _lsSet(all); return item; }
    throw new Error('Not found');
  }

  function buildSession({ bpm, hrv, minBpm, maxBpm, mood, tempo, name }) {
    const now  = new Date();
    const id   = now.getTime();
    const date = now.toLocaleDateString('en-CA');
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const finalName = (name || '').trim() ||
      `Session · ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
    return { id, name: finalName, bpm, hrv, minBpm, maxBpm, mood, tempo, date, time };
  }

  /* ─── Profile ─── */
  function getProfile() {
    try { return JSON.parse(localStorage.getItem(LS_PROFILE) || '{}'); } catch { return {}; }
  }
  function setProfile(data) {
    try { localStorage.setItem(LS_PROFILE, JSON.stringify(data)); } catch {}
  }

  /* ─── Free scan usage ─── */
  const FREE_LIMIT = 3;
  function getUsage() {
    try { return JSON.parse(localStorage.getItem(LS_USAGE) || '{"freeScansUsed":0}'); }
    catch { return { freeScansUsed: 0 }; }
  }
  function incrementUsage() {
    const u = getUsage();
    u.freeScansUsed = (u.freeScansUsed || 0) + 1;
    try { localStorage.setItem(LS_USAGE, JSON.stringify(u)); } catch {}
    return u;
  }
  function resetUsage() {
    try { localStorage.setItem(LS_USAGE, JSON.stringify({ freeScansUsed: 0 })); } catch {}
  }

  /* ─── Subscription ─── */
  function getSubscription() {
    try { return JSON.parse(localStorage.getItem(LS_SUBSCRIPTION) || '{"status":"free"}'); }
    catch { return { status: 'free' }; }
  }
  function setSubscription(status) {   /* 'active' | 'free' */
    try { localStorage.setItem(LS_SUBSCRIPTION, JSON.stringify({ status })); } catch {}
  }
  function isSubscribed() {
    return getSubscription().status === 'active';
  }

  /* ─── Volume preference ─── */
  function getVolume() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_VOLUME) || '{"level":0.8}');
      return Math.max(0, Math.min(1, v.level ?? 0.8));
    } catch { return 0.8; }
  }
  function setVolume(level) {
    const clamped = Math.max(0, Math.min(1, level));
    try { localStorage.setItem(LS_VOLUME, JSON.stringify({ level: clamped })); } catch {}
    return clamped;
  }

  /* ─── Scan gate ─── */
  function canScan() {
    if (isSubscribed()) return { allowed: true, reason: 'subscribed' };
    const u = getUsage();
    if (u.freeScansUsed < FREE_LIMIT) return { allowed: true, reason: 'free', remaining: FREE_LIMIT - u.freeScansUsed };
    return { allowed: false, reason: 'limit_reached', used: u.freeScansUsed };
  }

  return {
    init, saveSession, loadSessions, deleteSession, renameSession, buildSession,
    /* profile */
    getProfile, setProfile,
    /* usage */
    getUsage, incrementUsage, resetUsage, FREE_LIMIT,
    /* subscription */
    getSubscription, setSubscription, isSubscribed, canScan,
    /* volume */
    getVolume, setVolume,
  };
})();

window.Storage = Storage;
