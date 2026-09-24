const CACHE_NAME = 'hopprint-v3';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './assets/hopprint-hop.svg',
  './fonts/arial-narrow-regular.woff2',
  './fonts/arial-narrow-bold.woff2',
  './fonts/unica-one-regular.woff2',
  './fonts/big-shoulders-variable.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept non-GET requests (e.g. POST to Supabase for feedback/import) —
  // those must always hit the network directly.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // SY9: leave Supabase alone. Auth and table reads must always hit the
  // network, and authenticated responses must never land in Cache Storage.
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.origin === self.location.origin) {
    // App shell: network-first so testers get updates, falling back to
    // cache so the app still opens offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
  } else {
    // Cross-origin static assets (fonts, Chart.js CDN): cache-first, refresh in background.
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
