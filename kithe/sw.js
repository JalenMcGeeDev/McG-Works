/* Service Worker – Kithe */
var CACHE_NAME = 'kithe-shell-v1';

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
  // Let Supabase API calls go through unintercepted — always fresh, never cached
  if (e.request.url.indexOf('supabase.co') !== -1) return;

  // Network-first: always try the network and update the cache on success,
  // fall back to cache only when offline
  e.respondWith(
    fetch(e.request).then(function (response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
