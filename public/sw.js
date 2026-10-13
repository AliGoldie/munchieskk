// MunchiesKK service worker. It only exists so the browser offers "Install app".
// It never caches anything: every request goes straight to the network, so the
// app is always the latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
