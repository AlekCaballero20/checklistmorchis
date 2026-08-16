/* =============================================================================
   Maleta · sw.js
   Offline-ready, más estable y menos pegado a caché vieja
============================================================================= */

/* Subir esta versión en CADA cambio de los archivos del shell.
   Si no se sube, cleanOldCaches() no borra nada y los usuarios siguen
   viendo la versión anterior indefinidamente. */
const CACHE_NAME = 'maleta-firebase-v5';

const APP_SHELL = [
  './',
  './index.html',
  './src/app.js',
  './src/state.core.js',
  './styles/main.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ────────────────────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────────────────── */
function isHttpRequest(request) {
  return request.url.startsWith('http://') || request.url.startsWith('https://');
}

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function shouldCacheResponse(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
}

async function cleanOldCaches() {
  const keys = await caches.keys();
  const deletions = keys
    .filter(key => key !== CACHE_NAME)
    .map(key => caches.delete(key));

  await Promise.all(deletions);
}

async function networkFirstForNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request);

    if (shouldCacheResponse(fresh)) {
      cache.put('./index.html', fresh.clone());
    }

    return fresh;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'))
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (shouldCacheResponse(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  if (isNavigationRequest(request)) {
    return (await cache.match('./index.html')) || (await cache.match('./'));
  }

  throw new Error('Recurso no disponible en caché ni en red');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request);

  if (shouldCacheResponse(response)) {
    cache.put(request, response.clone());
  }

  return response;
}

/* ────────────────────────────────────────────────────────────────────────────
   INSTALL
──────────────────────────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    cacheAppShell().then(() => self.skipWaiting())
  );
});

/* ────────────────────────────────────────────────────────────────────────────
   ACTIVATE
──────────────────────────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    cleanOldCaches().then(() => self.clients.claim())
  );
});

/* ────────────────────────────────────────────────────────────────────────────
   MESSAGE
   Permite activar el SW nuevo más rápido si luego decides usar postMessage
──────────────────────────────────────────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   FETCH
──────────────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!isHttpRequest(request)) return;

  // Navegación HTML: priorizar red para evitar quedarse con index viejo
  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstForNavigation(request));
    return;
  }

  // Recursos propios de la app: responder rápido desde caché y actualizar detrás
  if (isSameOrigin(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Otros GET: conservador
  event.respondWith(cacheFirst(request));
});