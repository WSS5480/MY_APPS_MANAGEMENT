/* Installable-app service worker: app shell cached for fast start; data always comes live from the server. */
const CACHE = 'sct360-v1';
const SHELL = ['/logo.png', '/shim.js', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && SHELL.includes(u.pathname)) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || new Response('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;background:#03121F;color:#EAF3F9;padding:24px"><h2>You are offline</h2><p>The case tracker needs a connection. It will load again when you are back online.</p>', { headers: { 'Content-Type': 'text/html' } }))));
});
