// Retire this registration; do not cache medication-calculation pages.
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.registration.unregister());
});
