/* ================================================================
   HeartBeat Studio — Service Worker v3
   Cache-first with network fallback. Full offline support.
================================================================ */
'use strict';

const CACHE = 'hbs-v3-1.0.0';
const ASSETS = [
  './', './index.html', './styles.css', './app.js',
  './storage.js', './audioEngine.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        }
        return r;
      }).catch(() => null);
      return cached || net || caches.match('./index.html');
    })
  );
});
