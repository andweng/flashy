// Minimal service worker. Present mainly so the PWA is "installable" — Chromium-based
// browsers gate the install prompt on a registered SW with a fetch handler.
// Doesn't cache anything yet; full offline support is a follow-up.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through: let the browser handle the request normally.
});
