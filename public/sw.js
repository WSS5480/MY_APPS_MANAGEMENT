/* 360 Cases service worker: works offline (pages, scripts and photos cached), plus push notifications.
   Data comes live from the server; when offline the page uses the copy saved on the device. */
const V = 'v2';
const SHELL = 'sct360-shell-' + V, PAGES = 'sct360-pages-' + V, IMG = 'sct360-img-' + V, CDN = 'sct360-cdn-' + V;
const SHELL_FILES = ['/logo.png', '/shim.js', '/plus.js', '/plus.css', '/app.css', '/icon-192.png', '/icon-512.png', '/favicon.png', '/manifest.webmanifest'];
const PAGE_PATHS = ['/', '/products', '/download', '/login'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^sct360-/.test(k) && !k.endsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const offlinePage = () => new Response('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;background:#03121F;color:#EAF3F9;padding:24px"><h2>You are offline</h2><p>Open the tracker once while online on this device, and it will work offline after that.</p>', { headers: { 'Content-Type': 'text/html' } });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET') return;
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/cal/') || u.pathname.startsWith('/admin')) return;
    if (u.pathname.startsWith('/img/')) {
      e.respondWith(caches.open(IMG).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
      return;
    }
    if (req.mode === 'navigate' || PAGE_PATHS.includes(u.pathname)) {
      e.respondWith(fetch(req).then(r => { if (r.ok && !r.redirected && PAGE_PATHS.includes(u.pathname)) { const c = r.clone(); caches.open(PAGES).then(x => x.put(u.pathname, c)); } return r; })
        .catch(() => caches.open(PAGES).then(c => c.match(u.pathname)).then(r => r || offlinePage())));
      return;
    }
    e.respondWith(fetch(req).then(r => { if (r.ok && SHELL_FILES.includes(u.pathname)) { const c = r.clone(); caches.open(SHELL).then(x => x.put(req, c)); } return r; }).catch(() => caches.match(req)));
    return;
  }
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|unpkg\.com/.test(u.hostname)) {
    e.respondWith(caches.open(CDN).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }))));
  }
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: '360 Medical', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '360 Medical', { body: d.body || '', icon: '/icon-192.png', badge: '/favicon.png', data: { url: d.url || '/' }, tag: 'sct360-digest' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { const w = list.find(c => new URL(c.url).origin === location.origin); return w ? w.focus().then(c => c.navigate ? c.navigate(url) : c) : self.clients.openWindow(url); }));
});
