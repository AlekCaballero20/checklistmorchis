'use strict';

/* =============================================================================
  sw.js — Maleta · Checklist (PWA)
  Offline-first + App Shell Cache + Runtime Cache (PRO)
============================================================================= */

/** Versiona bien para updates */
const VERSION = 'v2.0.0';

/** Cachés separados = orden mental */
const APP_SHELL_CACHE = `maleta-shell-${VERSION}`;
const RUNTIME_CACHE   = `maleta-runtime-${VERSION}`;

/** Archivos esenciales (App Shell) */
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* =============================================================================
  INSTALL — precache App Shell
============================================================================= */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* =============================================================================
  ACTIVATE — cleanup old caches
============================================================================= */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* =============================================================================
  FETCH — Offline-first strategy
  - App shell: cache-first
  - Runtime: stale-while-revalidate
============================================================================= */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  /** Solo GET. Nada de cachear POST o cosas raras */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /** Solo manejar mismo origen (no extensiones ni trackers) */
  if (url.origin !== self.location.origin) return;

  /** HTML navigation → siempre intenta cache + fallback */
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then((cached) => cached || fetch(req))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /** Cache-first para App Shell */
  if (APP_SHELL.includes(url.pathname) || APP_SHELL.includes(`.${url.pathname}`)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  /** Runtime cache: stale-while-revalidate */
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          // Guarda copia en runtime cache
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);

      // Devuelve cache rápido, actualiza en background
      return cached || networkFetch;
    })
  );
});

/* =============================================================================
  OPTIONAL — Manual update trigger
  (por si luego haces botón "Actualizar app")
============================================================================= */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
