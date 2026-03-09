'use strict';

/* =============================================================================
  sw.js — Maleta · Checklist (PWA) — IMPROVED v5
  - ✅ App Shell cache con rutas reales del proyecto
  - ✅ Install tolerante: no tumba todo si un asset falla
  - ✅ Activate limpia cachés viejos
  - ✅ Navegación: network-first con fallback offline a index.html
  - ✅ App shell: cache-first
  - ✅ Runtime assets: stale-while-revalidate
  - ✅ Ignora métodos no-GET y requests no-cacheables
  - ✅ Soporta SKIP_WAITING manual
============================================================================= */

/** Cambia esto cuando publiques una versión nueva */
const VERSION = 'v5.0.0';

/** Nombres de caché */
const APP_SHELL_CACHE = `maleta-shell-${VERSION}`;
const RUNTIME_CACHE = `maleta-runtime-${VERSION}`;

/**
 * App shell real del proyecto.
 * Ojo: aquí van rutas existentes, no recuerdos felices de archivos viejos.
 */
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
  './src/fx.js',
  './src/gestures.js',

  './styles/base.css',
  './styles/theme.css',
  './styles/components.css',
  './styles/animations.css',
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

    // cache.addAll() falla completo si un archivo falla.
    // Entonces mejor los metemos uno por uno. Menos dramático.
    await Promise.all(
      APP_SHELL.map(async (url) => {
        try {
          await cache.add(url);
        } catch (err) {
          // No reventamos la instalación por un asset faltante
          // porque una PWA medio útil vale más que una pureza filosófica rota.
          console.warn('[SW] No se pudo precachear:', url, err);
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
  FETCH HELPERS
============================================================================= */

function isGetRequest(req) {
  return req && req.method === 'GET';
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isHttp(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function shouldBypassRequest(req, url) {
  if (!isGetRequest(req)) return true;
  if (!isHttp(url)) return true;
  if (!isSameOrigin(url)) return true;

  // evita cosas raras del navegador
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return true;

  return false;
}

function normalizePathname(pathname) {
  return pathname.startsWith('/') ? `.${pathname}` : pathname;
}

function isAppShellRequest(url) {
  const normalized = normalizePathname(url.pathname);

  if (APP_SHELL.includes(normalized)) return true;

  // root
  if (url.pathname === '/' || url.pathname === '') return true;

  // index and static core
  if (
    normalized === './index.html' ||
    normalized === './manifest.webmanifest' ||
    normalized === './sw.js'
  ) return true;

  // src / styles / icons
  if (
    normalized.startsWith('./src/') ||
    normalized.startsWith('./styles/') ||
    normalized.startsWith('./icons/')
  ) return true;

  return false;
}

async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;

  const res = await fetch(req);
  if (isCacheableResponse(res)) {
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}

async function networkFirstNavigation(req) {
  try {
    const res = await fetch(req);

    if (isCacheableResponse(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }

    return res;
  } catch {
    const cachedNav = await caches.match(req, { ignoreSearch: true });
    if (cachedNav) return cachedNav;

    const cachedIndex =
      await caches.match('./index.html') ||
      await caches.match('/index.html') ||
      await caches.match('./');

    if (cachedIndex) return cachedIndex;

    return new Response(
      '<!doctype html><html lang="es"><meta charset="utf-8"><title>Offline</title><body><h1>Sin conexión</h1><p>La app no pudo cargar sin internet.</p></body></html>',
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
    .then(async (res) => {
      if (isCacheableResponse(res)) {
        await cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

function isCacheableResponse(res) {
  return !!res && res.ok && (res.type === 'basic' || res.type === 'default');
}

/* =============================================================================
  FETCH — routing strategies
============================================================================= */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (shouldBypassRequest(req, url)) return;

  // Navegación HTML: network-first para no quedar pegados a versiones viejas
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // App shell / módulos / estilos / íconos: cache-first
  if (isAppShellRequest(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Runtime assets mismo origen: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

/* =============================================================================
  MESSAGE — manual update trigger
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