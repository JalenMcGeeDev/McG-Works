/* Service Worker – Jalen's To-Dos */
var CACHE_NAME = 'jt-shell-v2';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  var base = self.location.pathname.replace('sw.js', '');
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll([
        base,
        base + 'index.html',
        base + 'style.css',
        base + 'app.js',
        base + 'manifest.json',
        base + 'icon.svg',
      ]);
    }).catch(function () {}) // non-fatal: still qualifies for install
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // Let Supabase API calls go through unintercepted
  if (e.request.url.includes('supabase.co')) return;

  // Network-first: always try the network, fall back to cache if offline
  e.respondWith(
    fetch(e.request).catch(function () {
      return caches.match(e.request);
    })
  );
});
