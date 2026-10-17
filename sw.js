/* ============================================================
   CENTRAL & STORES — Service Worker (minimal)
   Required for Android Chrome "Install app" prompt.
   ============================================================ */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler — required for Android installability
self.addEventListener('fetch', function () {});
