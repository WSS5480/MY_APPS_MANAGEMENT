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
const COLS = new Set(['projects', 'settings', 'history', 'meta']);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY, col TEXT NOT NULL, data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS docs_col ON docs(col)`);
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

const loginPage = (msg = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dev Billing — Sign in</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101626;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
form{background:#fff;border-radius:14px;padding:28px;width:min(340px,90vw);box-shadow:0 10px 40px rgba(0,0,0,.3)}h1{margin:0 0 4px;font-size:20px}p{margin:0 0 18px;color:#667085;font-size:14px}
input{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:6px;text-align:center;padding:12px;border:1px solid #cfd5de;border-radius:10px}
button{width:100%;margin-top:14px;padding:12px;border:none;border-radius:10px;background:#1f5eff;color:#fff;font-size:16px;font-weight:700;cursor:pointer}.e{color:#c62828;font-size:14px;margin-top:10px;text-align:center}</style></head>
<body><form method="post" action="/login"><h1>Dev Billing</h1><p>Stemo Enterprises — enter your PIN</p>
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required><button>Sign in</button>${msg ? `<div class="e">${msg}</div>` : ''}</form></body></html>`;

app.get('/healthz', (req, res) => res.send('ok'));
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
api.get('/export', async (req, res) => {
  const r = await pool.query('SELECT path, data FROM docs ORDER BY path');
  res.setHeader('Content-Disposition', `attachment; filename="dev-billing-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(Object.fromEntries(r.rows.map(x => [x.path, x.data])));
});
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
