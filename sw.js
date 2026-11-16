// Minimal service worker so phones offer "Install app". Always uses the network, so updates show up right away.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
