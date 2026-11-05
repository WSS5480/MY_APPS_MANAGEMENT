// Dev Billing server: serves the app, stores data in Postgres, PIN-protected.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 10000;
const PIN = String(process.env.APP_PIN || '');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
const COLS = new Set(['projects', 'settings', 'history', 'meta', 'customers', 'invoices', 'ledger', 'banktx', 'closes']);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY, col TEXT NOT NULL, data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS docs_col ON docs(col)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY, title TEXT, html TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// ---- auth ----
const sign = () => crypto.createHmac('sha256', SECRET).update('devbill:' + PIN).digest('hex');
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function authed(req) {
  if (SYNC_TOKEN && req.headers.authorization === 'Bearer ' + SYNC_TOKEN) return true;
  if (!PIN) return false;
  const c = cookies(req).devbill;
  return !!c && c.length === sign().length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(sign()));
}
const tries = new Map();
function limited(ip) {
  const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 15 * 60e3);
  tries.set(ip, t); return t.length >= 10;
}

const loginPage = (msg = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dev Billing — Sign in</title><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="theme-color" content="#101626">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101626;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
form{background:#fff;border-radius:14px;padding:28px;width:min(340px,90vw);box-shadow:0 10px 40px rgba(0,0,0,.3)}h1{margin:0 0 4px;font-size:20px}p{margin:0 0 18px;color:#667085;font-size:14px}
input{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:6px;text-align:center;padding:12px;border:1px solid #cfd5de;border-radius:10px}
button{width:100%;margin-top:14px;padding:12px;border:none;border-radius:10px;background:#1f5eff;color:#fff;font-size:16px;font-weight:700;cursor:pointer}.e{color:#c62828;font-size:14px;margin-top:10px;text-align:center}</style></head>
<body><form method="post" action="/login"><h1>Dev Billing</h1><p>Steve Smith — enter your PIN</p>
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required><button>Sign in</button>${msg ? `<div class="e">${msg}</div>` : ''}<a href="/download" style="display:block;text-align:center;margin-top:14px;color:#1f5eff;font-size:14px;font-weight:600;text-decoration:none">⬇ Get the app</a></form></body></html>`;

app.get('/healthz', (req, res) => res.send('ok'));
// public files for installing the app (no PIN needed)
app.get(['/manifest.webmanifest', '/sw.js', '/offline.html', '/download.html'], (req, res) => {
  if (req.path === '/sw.js') res.set('Service-Worker-Allowed', '/').set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', req.path), { headers: req.path.endsWith('webmanifest') ? { 'Content-Type': 'application/manifest+json' } : {} });
});
// public document links: anyone with the (unguessable) link can view / download the PDF, no PIN
app.get('/d/:token', async (req, res) => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(req.params.token)) return res.status(404).send('Not found');
  const r = await pool.query('SELECT html FROM shares WHERE token=$1', [req.params.token]).catch(() => ({ rows: [] }));
  if (!r.rows[0]) return res.status(404).type('html').send('<p style="font-family:sans-serif;padding:30px">This document link is no longer available.</p>');
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').type('html').send(r.rows[0].html);
});
app.get('/download', (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));
app.get('/vendor/html2pdf.js', (req, res) => res.set('Cache-Control', 'public, max-age=604800').type('js').sendFile(path.join(__dirname, 'node_modules', 'html2pdf.js', 'dist', 'html2pdf.bundle.min.js')));
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons'), { maxAge: '7d' }));
app.get('/login', (req, res) => res.type('html').send(loginPage(PIN ? '' : 'APP_PIN is not set on the server.')));
app.post('/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip;
  if (limited(ip)) return res.status(429).type('html').send(loginPage('Too many tries. Wait 15 minutes.'));
  if (PIN && String(req.body.pin || '') === PIN) {
    res.setHeader('Set-Cookie', `devbill=${sign()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`);
    return res.redirect('/');
  }
  tries.get(ip).push(Date.now());
  res.status(401).type('html').send(loginPage('Wrong PIN.'));
});
app.get('/logout', (req, res) => { res.setHeader('Set-Cookie', 'devbill=; Path=/; Max-Age=0'); res.redirect('/login'); });

// ---- data API ----
function checkPath(p) {
  const seg = String(p || '').split('/');
  if (seg.length !== 2 || !COLS.has(seg[0]) || !/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(seg[1])) return null;
  return seg;
}
const api = express.Router();
api.use((req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'auth' }));
api.get('/doc', async (req, res) => {
  const seg = checkPath(req.query.path); if (!seg) return res.status(400).json({ error: 'path' });
  const r = await pool.query('SELECT data, updated_at FROM docs WHERE path=$1', [req.query.path]);
  res.json(r.rows[0] ? { data: r.rows[0].data, updated: r.rows[0].updated_at } : { data: null });
});
api.put('/doc', async (req, res) => {
  const { path: p, data } = req.body || {}; const seg = checkPath(p);
  if (!seg || !data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'bad doc' });
  await pool.query(`INSERT INTO docs(path,col,data,updated_at) VALUES($1,$2,$3,now())
    ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [p, seg[0], data]);
  res.status(204).end();
});
api.delete('/doc', async (req, res) => {
  if (!checkPath(req.query.path)) return res.status(400).json({ error: 'path' });
  await pool.query('DELETE FROM docs WHERE path=$1', [req.query.path]); res.status(204).end();
});
api.get('/col', async (req, res) => {
  if (!COLS.has(req.query.c)) return res.status(400).json({ error: 'col' });
  const r = await pool.query('SELECT path, data, updated_at FROM docs WHERE col=$1 ORDER BY path', [req.query.c]);
  res.json(r.rows.map(x => ({ id: x.path.split('/')[1], data: x.data, updated: x.updated_at })));
});
api.post('/share', async (req, res) => {
  const { title, html } = req.body || {};
  if (typeof html !== 'string' || html.length < 50 || html.length > 1500000) return res.status(400).json({ error: 'bad doc' });
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query('INSERT INTO shares(token,title,html) VALUES($1,$2,$3)', [token, String(title || '').slice(0, 200), html]);
  const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host;
  res.json({ url: base + '/d/' + token });
});
api.get('/export', async (req, res) => {
  const r = await pool.query('SELECT path, data FROM docs ORDER BY path');
  res.setHeader('Content-Disposition', `attachment; filename="dev-billing-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(Object.fromEntries(r.rows.map(x => [x.path, x.data])));
});
// ---- company lookup (Google Places if GOOGLE_PLACES_KEY is set, else OpenStreetMap) ----
async function lookupGoogle(q) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri' },
    body: JSON.stringify({ textQuery: q, regionCode: 'US', maxResultCount: 6 }),
  });
  if (!r.ok) throw new Error('google ' + r.status);
  const j = await r.json();
  return (j.places || []).map(p => ({
    name: p.displayName && p.displayName.text || '',
    address: String(p.formattedAddress || '').replace(/, USA$/, '').replace(/, ([^,]+, [A-Z]{2} \d{5})/, '\n$1'),
    phone: p.nationalPhoneNumber || '', website: p.websiteUri || '', email: '',
  }));
}
function osmMap(x) {
  const a = x.address || {}, t = x.extratags || {}, n = x.namedetails || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.county || '';
  const line2 = [city, [a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { name: n.name || x.name || String(x.display_name || '').split(',')[0],
    address: [street, line2].filter(Boolean).join('\n'),
    phone: t.phone || t['contact:phone'] || '', website: t.website || t['contact:website'] || '',
    email: t.email || t['contact:email'] || '', lat: +x.lat, lon: +x.lon };
}
const OSM_UA = { 'User-Agent': 'DevBilling/1.0 (+https://dev-billing.onrender.com)', 'Accept-Language': 'en' };
let lastOSM = 0;
async function osm(params) {
  const wait = 1100 - (Date.now() - lastOSM); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastOSM = Date.now();
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&countrycodes=us&' + new URLSearchParams(params), { headers: OSM_UA });
  if (!r.ok) throw new Error('osm ' + r.status);
  return r.json();
}
const nearCache = new Map();
async function nearBox(near) {
  if (!near) return null;
  if (nearCache.has(near)) return nearCache.get(near);
  const j = await osm({ q: near, limit: 1 }); let box = null;
  if (j[0]) { const lat = +j[0].lat, lon = +j[0].lon; box = { s: [lon - 0.75, lat + 0.5, lon + 0.75, lat - 0.5].join(','), lat, lon }; }
  nearCache.set(near, box); return box;
}
const STOP = new Set(['the', 'and', 'of', 'llc', 'inc', 'co', 'corp', 'pllc', 'pa', 'ltd']);
const toks = q => String(q || '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
// every word you typed must appear (so "360 Medical" never matches plain "Medical")
function matches(q, x) {
  const t = toks(q); if (!t.length) return false;
  const name = ' ' + toks(x.name).join(' ') + ' ', all = name + toks(x.address + ' ' + x.website).join(' ') + ' ';
  const has = (hay, w) => hay.includes(' ' + w + ' ') || (w.length > 3 && hay.includes(w));
  return t.every(w => has(all, w)) && t.some(w => has(name, w));
}
async function lookupOSM(q, near) {
  const out = [], seen = new Set();
  const add = (rows, local) => rows.map(osmMap).forEach(x => { const k = x.name + '|' + x.address; if (!seen.has(k) && matches(q, x)) { seen.add(k); out.push({ ...x, local }); } });
  const box = await nearBox(near).catch(() => null);
  if (box) add(await osm({ q, limit: 15, viewbox: box.s, bounded: 1 }), true);
  if (out.length < 3 && near) add(await osm({ q: q + ', ' + near, limit: 10 }), true);
  if (out.length < 3) add(await osm({ q, limit: 20 }), false);
  if (box) { const d = x => x.lat ? Math.hypot(x.lat - box.lat, (x.lon - box.lon) * Math.cos(box.lat * Math.PI / 180)) : 9; out.sort((a, b) => (b.local - a.local) || d(a) - d(b)); }
  return out.slice(0, 8).map(({ lat, lon, ...x }) => x);
}
api.get('/lookup', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120), near = String(req.query.near || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ results: [] });
  try {
    if (process.env.GOOGLE_PLACES_KEY) {
      const g = await lookupGoogle(near ? `${q} near ${near}` : q);
      return res.json({ source: 'Google Places', results: g.map(x => ({ ...x, local: !!near && toks(x.address).join(' ').includes(toks(near)[0] || '~') })) });
    }
    res.json({ source: 'OpenStreetMap', near, results: await lookupOSM(q, near) });
  } catch (e) { res.status(502).json({ error: String(e.message || e), results: [] }); }
});
module.exports.matches = matches;
module.exports.osmMap = osmMap;

app.use('/api', (req, res, next) => api(req, res, err => err ? res.status(500).json({ error: String(err.message || err) }) : next()));

// ---- app ----
const html = () => {
  const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const shim = fs.readFileSync(path.join(__dirname, 'public', 'shim.js'), 'utf8');
  return page.replace('<script>', `<script>${shim}</script>\n<script>`);
};
app.get('/', (req, res) => authed(req) ? res.type('html').set('Cache-Control', 'no-store').send(html()) : res.redirect('/login'));
app.use((req, res) => res.redirect('/'));

init().then(() => app.listen(PORT, () => console.log('Dev Billing on ' + PORT)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
