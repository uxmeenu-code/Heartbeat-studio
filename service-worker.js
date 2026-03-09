/* ================================================================
   HeartBeat Studio — Service Worker v5
================================================================ */
'use strict';
const CACHE = 'hbs-v5';
const PRECACHE = ['./', './index.html', './styles.css', './app.js',
  './storage.js', './audioEngine.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.match(e.request).then(cached => {
    const net = fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic')
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => null);
    return cached || net || caches.match('./index.html');
  }));
});
