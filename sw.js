/* =============================================================================
   Maleta · sw.js
   Offline-ready, más estable y menos pegado a caché vieja
============================================================================= */

/* Subir esta versión en CADA cambio de los archivos del shell.
   Si no se sube, cleanOldCaches() no borra nada y los usuarios siguen
   viendo la versión anterior indefinidamente. */
/* Un solo número del que sale el nombre de la caché y las URLs versionadas.
   Tiene que coincidir con <meta name="app-build"> y con APP_BUILD en app.js. */
const BUILD = '8';
const CACHE_NAME = `maleta-firebase-v${BUILD}`;

/* Cuánto esperamos a la red antes de tirar de caché para un archivo de
   código. Suficiente para una conexión mala, no tanto como para dejar la app
   colgada en blanco. */
const CODE_NETWORK_TIMEOUT_MS = 3500;

const APP_SHELL = [
  './',
  './index.html',
  // Con la versión, igual que las pide el HTML: si no, guardaríamos en caché
  // una URL que nadie solicita y offline quedaría cojo.
  `./src/app.js?v=${BUILD}`,
  `./src/state.core.js?v=${BUILD}`,
  `./styles/main.css?v=${BUILD}`,
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

/* ¿Es un archivo de CÓDIGO (html, js, css)?

   Acá estaba el bug de "le doy a Comparar listas y no pasa nada": la
   navegación iba por red (HTML nuevo) pero los demás archivos salían de
   caché (app.js viejo). Resultado: un botón nuevo en el HTML sin el código
   que lo escucha. Un fallo mudo, de los peores.

   Ahora el código viaja siempre junto: todo network-first, y la caché queda
   solo como plan de emergencia cuando no hay señal. */
function isCodeRequest(request) {
  try {
    const { pathname } = new URL(request.url);
    return pathname.endsWith('/') || /\.(html|js|css)$/i.test(pathname);
  } catch {
    return false;
  }
}

function shouldCacheResponse(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  // cache: 'reload' evita la caché HTTP del navegador al poblar el shell.
  // Sin esto, un SW nuevo puede guardar archivos viejos que el navegador
  // ya tenía y dejar versiones mezcladas (p.ej. app.js viejo con un
  // módulo nuevo), que es más difícil de detectar que un fallo limpio.
  await cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })));
}

async function cleanOldCaches() {
  const keys = await caches.keys();
  const deletions = keys
    .filter(key => key !== CACHE_NAME)
    .map(key => caches.delete(key));

  await Promise.all(deletions);
}

/* Red primero, con tope de espera, y caché como respaldo.
   'no-cache' fuerza una revalidación: sin eso, la caché HTTP del navegador
   puede devolver un app.js viejo aunque el service worker sí pregunte por
   red — el mismo problema, un piso más abajo. */
async function networkFirstForCode(request) {
  const cache = await caches.open(CACHE_NAME);

  const fromNetwork = fetch(new Request(request.url, { cache: 'no-cache' }))
    .then(response => {
      if (shouldCacheResponse(response)) {
        cache.put(isNavigationRequest(request) ? './index.html' : request, response.clone());
      }
      return response;
    });

  // La red puede tardar mucho sin fallar; no dejamos la app en blanco por eso.
  const timeout = new Promise(resolve => {
    setTimeout(() => resolve(null), CODE_NETWORK_TIMEOUT_MS);
  });

  try {
    const winner = await Promise.race([fromNetwork.catch(() => null), timeout]);
    if (winner) return winner;
  } catch {
    // seguimos al respaldo
  }

  const cached =
    (await cache.match(request)) ||
    (isNavigationRequest(request)
      ? (await cache.match('./index.html')) || (await cache.match('./'))
      : null);

  if (cached) return cached;

  // Sin caché no queda otra que esperar a la red hasta donde aguante.
  return fromNetwork;
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

  /* Código (HTML, JS, CSS): siempre por red primero, así el HTML y el JS
     salen del mismo despliegue. Mezclarlos era el bug del botón mudo. */
  if (isNavigationRequest(request) || (isSameOrigin(request) && isCodeRequest(request))) {
    event.respondWith(networkFirstForCode(request));
    return;
  }

  // Lo demás propio (iconos, manifest): rápido desde caché y se actualiza detrás.
  if (isSameOrigin(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Otros GET: conservador
  event.respondWith(cacheFirst(request));
});