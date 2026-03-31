const CACHE_NAME = 'baby-journal-v1';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for assets
  const url = new URL(e.request.url);
  if (url.hostname === 'script.google.com') {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {headers: {'Content-Type': 'application/json'}})));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
