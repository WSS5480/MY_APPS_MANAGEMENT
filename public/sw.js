// Dealer System service worker: installable app; when offline, shows the last data that was loaded (read-only).
const CACHE = 'dms-shell-v4', DATA = 'dms-data-v1';
const SHELL = ['/icons/icon-192.png', '/icons/icon-512.png', '/offline.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const netFirst = (req, store) => fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(store).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req).then(m => m || Response.error()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) { if (/^\/api\/(export|media|public|sign|history|market|payroll|payplans|bank|drawer|integrations|journal|trial|audit|clock)/.test(u.pathname)) return; // sensitive or per-person data is never stored on the device e.respondWith(netFirst(r, DATA)); return; }
  if (r.mode === 'navigate') { e.respondWith(fetch(r).then(x => { if (x.ok && u.pathname === '/') caches.open(CACHE).then(c => c.put('/', x.clone())); return x; }).catch(() => caches.match('/').then(m => m || caches.match('/offline.html')))); return; }
  if (['/app.js', '/app2.js'].includes(u.pathname)) { e.respondWith(netFirst(r, CACHE)); return; }
  if (u.pathname.startsWith('/icons/')) e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
self.addEventListener('message', e => { if (e.data === 'signout') caches.delete(DATA); });
