/* =============================================================================
   Maleta · sw.js  —  Cache-first, offline-ready
============================================================================= */

const CACHE_NAME = 'maleta-v1';

const ASSETS = [
  './',
  './index.html',
  './src/app.js',
  './styles/main.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* Instalar: pre-cachear todos los assets */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* Activar: limpiar caches viejas */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first, con fallback a red */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cachear respuestas válidas del mismo origen
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => {
      // Offline y no cacheado → responder con index.html para navegación
      if (e.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
