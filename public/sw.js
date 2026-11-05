// Dev Billing service worker: makes the app installable; always uses the network for data.
const CACHE = 'devbill-shell-v1';
const SHELL = ['/icons/icon-192.png', '/icons/icon-512.png', '/offline.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin || r.url.includes('/api/')) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/offline.html'))); return; }
  if (r.url.includes('/icons/')) e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
