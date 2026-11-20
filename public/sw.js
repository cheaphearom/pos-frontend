// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/*
 * Service worker: lets the POS open and run without internet.
 * - App files (/assets/*, hashed names): ALL of them are downloaded when a new version installs (the build writes
 *   the list below), so every screen opens offline, even one not used since the update. Cache-first after that.
 * - Everything else (pages, logos, manifest): network first, so a change shows on a normal refresh;
 *   the cached copy is used only when offline.
 * - Cached files are found by address only (ignoreVary): servers mark them "Vary" (Origin, Accept-Encoding),
 *   which would otherwise make a saved file not match the page's request.
 * - API calls (/api) are never cached; the POS keeps its own offline data in IndexedDB.
 */
// Both filled in by the build (vite.config.ts, pos-sw-precache); a new build = a new cache, old ones are deleted.
const BUILD = 'dev';
const ASSETS = [];
const CACHE = 'pos-shell-' + BUILD;
const SHELL = ['/', '/index.html', '/favicon.svg', '/favicon_logo.svg', '/manifest.webmanifest'];

// The new version takes over only once every file is saved, so the till is never left half-updated offline.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([...SHELL, ...ASSETS].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/docs') || url.pathname === '/health') return; // API addresses: never through the offline cache

  if (req.mode === 'navigate') {
    // Always try the network so updates arrive; offline → cached app shell.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html', { ignoreVary: true })),
    );
    return;
  }

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Other files (logos, manifest…) keep their names when they change: network first, cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || Response.error())),
  );
});
