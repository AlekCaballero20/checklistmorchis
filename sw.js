'use strict';

/* =============================================================================
  sw.js — Maleta · Checklist (PWA)
  - App Shell cache con rutas reales
  - Install tolerante: no rompe si un asset falla
  - Activate limpia cachés viejos
  - Navegación: network-first con fallback offline a index.html
  - App shell: cache-first
  - Runtime assets: stale-while-revalidate
  - Ignora requests no cacheables
  - Soporta SKIP_WAITING manual
============================================================================= */

const VERSION = 'v6.0.0';

const APP_SHELL_CACHE = `maleta-shell-${VERSION}`;
const RUNTIME_CACHE = `maleta-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',

  './manifest.webmanifest',
  './sw.js',

  './src/app.js',
  './src/storage.js',
  './src/state.js',
  './src/actions.js',
  './src/render.js',
  './src/ui.js',
  './src/utils.js',
  './src/fx.js',

  './styles/base.css',
  './styles/theme.css',
  './styles/components.css',
  './styles/app.css',

  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* =============================================================================
  INSTALL — precache App Shell
============================================================================= */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);

    await Promise.all(
      APP_SHELL.map(async (url) => {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn('[SW] No se pudo precachear:', url, error);
        }
      })
    );

    await self.skipWaiting();
  })());
});

/* =============================================================================
  ACTIVATE — cleanup old caches
============================================================================= */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys.map((key) => {
        if (key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE) {
          return caches.delete(key);
        }
        return Promise.resolve(false);
      })
    );

    await self.clients.claim();
  })());
});

/* =============================================================================
  HELPERS
============================================================================= */
function isGetRequest(req) {
  return req && req.method === 'GET';
}

function isHttp(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldBypassRequest(req, url) {
  if (!isGetRequest(req)) return true;
  if (!isHttp(url)) return true;
  if (!isSameOrigin(url)) return true;

  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return true;

  return false;
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return './';
  return pathname.startsWith('/') ? `.${pathname}` : pathname;
}

function isCacheableResponse(res) {
  return !!res && res.ok && (res.type === 'basic' || res.type === 'default');
}

function isAppShellRequest(url) {
  const normalized = normalizePathname(url.pathname);

  if (APP_SHELL.includes(normalized)) return true;

  if (normalized === './') return true;
  if (normalized === './index.html') return true;
  if (normalized === './manifest.webmanifest') return true;
  if (normalized === './sw.js') return true;

  if (normalized.startsWith('./src/')) return true;
  if (normalized.startsWith('./styles/')) return true;
  if (normalized.startsWith('./icons/')) return true;

  return false;
}

/* =============================================================================
  STRATEGIES
============================================================================= */
async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;

  const response = await fetch(req);

  if (isCacheableResponse(response)) {
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(req, response.clone()).catch(() => {});
  }

  return response;
}

async function networkFirstNavigation(req) {
  try {
    const response = await fetch(req);

    if (isCacheableResponse(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, response.clone()).catch(() => {});
    }

    return response;
  } catch (error) {
    const cachedNav = await caches.match(req, { ignoreSearch: true });
    if (cachedNav) return cachedNav;

    const cachedIndex =
      await caches.match('./index.html') ||
      await caches.match('/index.html') ||
      await caches.match('./');

    if (cachedIndex) return cachedIndex;

    return new Response(
      `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Sin conexión</title>
          <style>
            body {
              margin: 0;
              font-family: system-ui, sans-serif;
              background: #f7f8fc;
              color: #1f2937;
              display: grid;
              place-items: center;
              min-height: 100vh;
              padding: 24px;
            }
            .card {
              max-width: 420px;
              background: #fff;
              border-radius: 20px;
              padding: 24px;
              box-shadow: 0 10px 30px rgba(0,0,0,.08);
              text-align: center;
            }
            h1 {
              margin: 0 0 12px;
              font-size: 1.5rem;
            }
            p {
              margin: 0;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Sin conexión</h1>
            <p>La app no pudo cargar en este momento. Apenas vuelva la conexión, recárgala y seguimos con este circo.</p>
          </div>
        </body>
      </html>
      `,
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req, { ignoreSearch: false });

  const networkPromise = fetch(req)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(req, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

/* =============================================================================
  FETCH
============================================================================= */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (shouldBypassRequest(req, url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  if (isAppShellRequest(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

/* =============================================================================
  MESSAGE
============================================================================= */
self.addEventListener('message', (event) => {
  const data = event.data;

  if (data === 'SKIP_WAITING' || data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data?.type === 'PING') {
    event.source?.postMessage?.({
      type: 'PONG',
      version: VERSION
    });
  }
});