/* ================================================================
   HeartBeat Studio — storage.js v3
   IndexedDB primary, localStorage fallback.
   All data is on-device. Zero server dependency.
================================================================ */
'use strict';

const Storage = (() => {
  const DB_NAME = 'hbs_db_v3', DB_VER = 1, STORE = 'sessions', LS_KEY = 'hbs_v3';
  let db = null, useIDB = false, _init = null;

  function init() {
    if (_init) return _init;
    _init = new Promise(res => {
      if (!window.indexedDB) { res(false); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE))
          d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess  = e => { db = e.target.result; useIDB = true; res(true); };
      req.onerror    = () => res(false);
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
  function _lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function _lsSet(a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch(e) { console.error(e); } }

  async function saveSession(s) {
    await init();
    if (useIDB) return _tx('readwrite', st => st.put(s));
    const all = _lsGet(), i = all.findIndex(x => x.id === s.id);
    i >= 0 ? all[i] = s : all.unshift(s);
    _lsSet(all); return s;
  }

  async function loadSessions() {
    await init();
    if (useIDB) return _tx('readonly', st => st.getAll()).then(a => (a||[]).sort((x,y) => y.id - x.id));
    return _lsGet();
  }

  async function deleteSession(id) {
    await init();
    if (useIDB) return _tx('readwrite', st => st.delete(id));
    _lsSet(_lsGet().filter(s => s.id !== id));
  }

  async function renameSession(id, name) {
    await init();
    if (useIDB) {
      const s = await _tx('readonly', st => st.get(id));
      if (!s) throw new Error('Not found');
      s.name = name; return _tx('readwrite', st => st.put(s));
    }
    const all = _lsGet(), s = all.find(x => x.id === id);
    if (!s) throw new Error('Not found');
    s.name = name; _lsSet(all); return s;
  }

  function buildSession({ bpm, hrv, minBpm, maxBpm, mood, tempo, name }) {
    const now = new Date(), id = now.getTime();
    const date = now.toLocaleDateString('en-CA');
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = (name||'').trim() || `Session · ${now.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${time}`;
    return { id, name: label, bpm, hrv, minBpm, maxBpm, mood, tempo, date, time };
  }

  return { init, saveSession, loadSessions, deleteSession, renameSession, buildSession };
})();

window.Storage = Storage;
