/* ============================================================
   CENTRAL & STORES — Service Worker (minimal)
   ------------------------------------------------------------
   Required for Android Chrome to show the "Install app" prompt.
   A no-op fetch handler is enough to pass the installability
   check. No caching, no offline support — just the minimum.
   ============================================================ */

self.addEventListener('install', function (event) {
  // Activate immediately, don't wait for old workers to finish
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // Take control of all open pages immediately
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler — required for Android installability
self.addEventListener('fetch', function () {
  // Pass through to network. No custom caching.
});
