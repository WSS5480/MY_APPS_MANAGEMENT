/* 360 MEDICAL - SURGICAL CASE TRACKER
 * Small Node server for the case tracker: PIN logins (COO/admin + each rep),
 * a document store (Postgres when DATABASE_URL is set, otherwise a JSON file),
 * per-rep data scoping on the server, and an admin page. */
'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ENV_ADMIN_PIN = String(process.env.ADMIN_PIN || '360360');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

/* ---------------- storage: everything lives in memory, written through to Postgres or a file ---------------- */
const docs = new Map();          // path -> data
let version = 1;
let pool = null;
let dbMode = 'file';

async function initStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const cs = process.env.DATABASE_URL;
    pool = new Pool({ connectionString: cs, ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(cs) ? false : { rejectUnauthorized: false }, max: 4 });
    await pool.query(`CREATE TABLE IF NOT EXISTS sct360_docs (path TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const r = await pool.query('SELECT path, data FROM sct360_docs');
    r.rows.forEach(row => docs.set(row.path, row.data));
    dbMode = 'postgres';
  } else if (fs.existsSync(DATA_FILE)) {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.keys(j).forEach(k => docs.set(k, j[k]));
  }
  seed();
}
let fileTimer = null;
function persist(p) {
  version++;
  if (pool) {
    const d = docs.get(p);
    const q = d === undefined
      ? pool.query('DELETE FROM sct360_docs WHERE path=$1', [p])
      : pool.query('INSERT INTO sct360_docs(path,data,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()', [p, JSON.stringify(d)]);
    return q.catch(e => { console.error('db write failed', p, e.message); throw e; });
  }
  clearTimeout(fileTimer);
  fileTimer = setTimeout(() => { fs.writeFile(DATA_FILE, JSON.stringify(Object.fromEntries(docs)), () => {}); }, 300);
  return Promise.resolve();
}
async function put(p, d) { docs.set(p, d); await persist(p); }
async function del(p) { docs.delete(p); await persist(p); }

const pin6 = () => String(crypto.randomInt(100000, 1000000));
function seed() {
  if (!docs.has('config/quotas')) {
    const rows = [
      { rep: 'Brandon', role: 'Sales Rep', territory: 'Brandon', metric: 'Revenue', quota: 20000, counts: 'New only', product_filter: '', carry: true, draw: 3000, comm_rate: 0.15, comm_floor: 20000, pay_kind: 'draw', pay_amount: 3000, sim_quota: null },
      { rep: 'Felipe', role: 'Sales Rep', territory: 'Felipe', metric: 'Revenue', quota: 20000, counts: 'New only', product_filter: '', carry: true, draw: 3000, comm_rate: 0.10, comm_floor: 20000, pay_kind: 'draw', pay_amount: 3000, sim_quota: null },
      { rep: 'Abraham', role: 'Senior Rep', territory: 'Abraham', metric: 'Revenue', quota: 35000, counts: 'All', product_filter: '', carry: false, draw: null, comm_rate: 0.10, comm_floor: 35000, pay_kind: 'salary', pay_amount: 5417, sim_quota: null },
      { rep: 'Preston', role: 'Specialist', territory: 'Preston', metric: 'Revenue', quota: null, counts: 'All', product_filter: 'Skeletal Dynamics', carry: false, draw: null, comm_rate: 0.12, comm_floor: 0, pay_kind: 'salary', pay_amount: 6000, sim_quota: 2 }
    ];
    docs.set('config/quotas', { rows, updated_at: new Date().toISOString() }); persist('config/quotas');
  }
  if (!docs.has('_auth/pins')) {
    const reps = {};
    (docs.get('config/quotas').rows || []).filter(r => r.role !== 'Team').forEach(r => { reps[r.rep] = { pin: pin6(), v: 1, active: true }; });
    docs.set('_auth/pins', { reps }); persist('_auth/pins');
  }
}
const quotaRows = () => ((docs.get('config/quotas') || {}).rows || []);
const pins = () => (docs.get('_auth/pins') || { reps: {} });
const adminPin = () => String((docs.get('_auth/admin') || {}).pin || ENV_ADMIN_PIN);
const adminV = () => Number((docs.get('_auth/admin') || {}).v || 1);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------------- sessions ---------------- */
function sign(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); }
function unsign(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [b, s] = tok.split('.');
  const want = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
function session(req) {
  const s = unsign(cookies(req).sct_session);
  if (!s) return null;
  if (s.role === 'owner') return s.v === adminV() ? s : null;
  const p = pins().reps[s.rep];
  if (!p || p.active === false || p.v !== s.v) return null;
  if (!quotaRows().some(r => r.rep === s.rep && r.role !== 'Team')) return null;
  return s;
}
function setSession(res, obj) {
  const days = 30;
  res.setHeader('Set-Cookie', `sct_session=${encodeURIComponent(sign(Object.assign({}, obj, { exp: Date.now() + days * 864e5 })))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${PROD ? '; Secure' : ''}`);
}
const uidOf = s => s.role === 'owner' ? 'owner' : 'rep-' + slug(s.rep);

/* login throttle */
const tries = new Map();
function throttled(ip) { const t = tries.get(ip) || { n: 0, at: Date.now() }; if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); } tries.set(ip, t); return t; }

/* ---------------- what each user may see / write ---------------- */
const COLS = ['cases', 'targets', 'simlab'];
function visible(s) {
  const out = {};
  if (s.role === 'owner') {
    for (const [p, d] of docs) if (!p.startsWith('_auth/')) out[p] = d;
    return out;
  }
  for (const [p, d] of docs) {
    const col = p.split('/')[0];
    if (COLS.includes(col) && p.split('/').length === 2 && d && d.rep === s.rep) out[p] = d;
  }
  out['config/quotas'] = { rows: quotaRows().filter(r => r.rep === s.rep && r.role !== 'Team') };
  out[`data/users/${uidOf(s)}/profile`] = { rep: s.rep };
  return out;
}
function clean(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const o = {};
  Object.keys(d).slice(0, 60).forEach(k => { const v = d[k]; if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = typeof v === 'string' ? v.slice(0, 4000) : v; else if (typeof v === 'object') o[k] = JSON.parse(JSON.stringify(v)); });
  return o;
}

/* ---------------- app ---------------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Robots-Tag', 'noindex'); next(); });

const pub = path.join(__dirname, 'public');
const page = f => (req, res) => res.sendFile(path.join(pub, f));
const needPage = role => (req, res, next) => { const s = session(req); if (!s) return res.redirect('/login?next=' + encodeURIComponent(req.path)); if (role === 'owner' && s.role !== 'owner') return res.redirect('/'); req.s = s; next(); };

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/login', page('login.html'));
app.get('/', needPage(), page('tracker.html'));
app.get('/admin', needPage('owner'), page('admin.html'));
app.get('/download', page('download.html'));
app.get(['/logo.png', '/shim.js', '/app.css', '/sw.js', '/favicon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'], (req, res) => { if (req.path === '/sw.js') res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(pub, req.path)); });
app.get('/manifest.webmanifest', (req, res) => { res.type('application/manifest+json'); res.sendFile(path.join(pub, 'manifest.webmanifest')); });

app.get('/api/login-options', (req, res) => {
  const p = pins().reps;
  res.json({ reps: quotaRows().filter(r => r.role !== 'Team' && p[r.rep] && p[r.rep].active !== false).map(r => r.rep) });
});
app.post('/api/login', (req, res) => {
  const t = throttled(req.ip);
  if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const who = String(req.body.who || ''), pin = String(req.body.pin || '').trim();
  if (who === '__owner__') {
    if (pin && pin === adminPin()) { tries.delete(req.ip); setSession(res, { role: 'owner', v: adminV() }); return res.json({ ok: true, role: 'owner' }); }
  } else {
    const p = pins().reps[who];
    if (p && p.active !== false && pin && pin === String(p.pin) && quotaRows().some(r => r.rep === who)) { tries.delete(req.ip); setSession(res, { role: 'rep', rep: who, v: p.v }); return res.json({ ok: true, role: 'rep' }); }
  }
  t.n++;
  res.status(401).json({ error: 'Wrong PIN.' });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', `sct_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${PROD ? '; Secure' : ''}`); res.json({ ok: true }); });

const needApi = role => (req, res, next) => { const s = session(req); if (!s) return res.status(401).json({ error: 'Sign in again.' }); if (role === 'owner' && s.role !== 'owner') return res.status(403).json({ error: 'Admin only.' }); req.s = s; next(); };

app.get('/api/me', needApi(), (req, res) => res.json({ role: req.s.role, rep: req.s.rep || null, uid: uidOf(req.s), db: dbMode }));
app.get('/api/sync', needApi(), (req, res) => {
  if (Number(req.query.v) === version) return res.json({ v: version, unchanged: true });
  res.json({ v: version, docs: visible(req.s) });
});

app.post('/api/doc', needApi(), async (req, res) => {
  const s = req.s, op = req.body.op, p = String(req.body.path || '');
  const parts = p.split('/');
  if (!['set', 'update', 'delete'].includes(op) || parts.some(x => !x || !/^[A-Za-z0-9_\-]{1,64}$/.test(x))) return res.status(400).json({ code: 'invalid_argument', error: 'Bad request' });
  const col = parts[0];
  const prev = docs.get(p);
  try {
    if (COLS.includes(col) && parts.length === 2) {
      if (s.role !== 'owner' && prev && prev.rep !== s.rep) return res.status(403).json({ code: 'permission_denied', error: 'Not your record' });
      if (op === 'delete') { await del(p); return res.json({ ok: true }); }
      if (op === 'update' && !prev) return res.status(404).json({ code: 'not_found' });
      let next = op === 'update' ? Object.assign({}, prev, clean(req.body.data)) : clean(req.body.data);
      if (s.role !== 'owner') next.rep = s.rep;
      if (!prev && !next.created_by) next.created_by = uidOf(s);
      await put(p, next); return res.json({ ok: true, data: next });
    }
    if (p === 'config/quotas' && s.role === 'owner' && op !== 'delete') {
      const d = clean(req.body.data); const rows = Array.isArray(d.rows) ? d.rows.map(clean) : quotaRows();
      await put(p, { rows, updated_at: new Date().toISOString() }); return res.json({ ok: true });
    }
    if (col === 'coonotes' && parts.length === 2 && s.role === 'owner') {
      if (op === 'delete') await del(p); else await put(p, op === 'update' ? Object.assign({}, prev, clean(req.body.data)) : clean(req.body.data));
      return res.json({ ok: true });
    }
    if (col === 'data' && parts[1] === 'users') return res.json({ ok: true }); // profile is set by the login
    return res.status(403).json({ code: 'permission_denied', error: 'Not allowed' });
  } catch (e) { return res.status(500).json({ code: 'unavailable', error: 'Could not save' }); }
});

/* ---------------- admin ---------------- */
app.get('/api/admin/state', needApi('owner'), (req, res) => {
  const p = pins().reps, counts = {};
  for (const [k, d] of docs) { const c = k.split('/')[0]; if (COLS.includes(c)) { const r = d.rep || '(none)'; counts[r] = counts[r] || { cases: 0, targets: 0, simlab: 0, last: '' }; counts[r][c]++; if (c === 'cases' && (d.date || '') > counts[r].last) counts[r].last = d.date || ''; } }
  res.json({ rows: quotaRows().map(r => Object.assign({}, r, { pin: p[r.rep] ? p[r.rep].pin : null, active: p[r.rep] ? p[r.rep].active !== false : r.role === 'Team' ? null : false })), counts, db: dbMode, adminPinIsDefault: !docs.has('_auth/admin') && !process.env.ADMIN_PIN, url: (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`) });
});
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
app.post('/api/admin/reps', needApi('owner'), async (req, res) => {
  const inRows = Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!inRows) return res.status(400).json({ error: 'No rows' });
  const names = new Set(), rows = [];
  for (const r of inRows) {
    const rep = String(r.rep || '').trim().slice(0, 60);
    if (!rep) return res.status(400).json({ error: 'Every row needs a name.' });
    if (names.has(rep.toLowerCase())) return res.status(400).json({ error: `"${rep}" is listed twice.` });
    names.add(rep.toLowerCase());
    const team = r.role === 'Team';
    rows.push({ rep, role: team ? 'Team' : String(r.role || 'Sales Rep').slice(0, 40), territory: String(r.territory || rep).slice(0, 60), metric: r.metric === 'Cases' ? 'Cases' : 'Revenue', quota: num(r.quota), counts: ['New only', 'Legacy only'].includes(r.counts) ? r.counts : 'All', product_filter: String(r.product_filter || '').slice(0, 80), carry: !!r.carry, draw: r.pay_kind === 'draw' ? num(r.pay_amount) : null, comm_rate: num(r.comm_rate) != null ? num(r.comm_rate) / 100 : null, comm_floor: num(r.comm_floor), pay_kind: team ? null : (r.pay_kind === 'draw' ? 'draw' : r.pay_kind === 'salary' ? 'salary' : null), pay_amount: team ? null : num(r.pay_amount), sim_quota: num(r.sim_quota) });
  }
  const p = JSON.parse(JSON.stringify(pins()));
  rows.filter(r => r.role !== 'Team').forEach(r => { if (!p.reps[r.rep]) p.reps[r.rep] = { pin: pin6(), v: 1, active: true }; });
  inRows.forEach(r => { const rep = String(r.rep || '').trim(); if (p.reps[rep] && typeof r.active === 'boolean' && p.reps[rep].active !== r.active) { p.reps[rep].active = r.active; p.reps[rep].v++; } });
  Object.keys(p.reps).forEach(k => { if (!rows.some(r => r.rep === k && r.role !== 'Team')) delete p.reps[k]; });
  await put('config/quotas', { rows, updated_at: new Date().toISOString() });
  await put('_auth/pins', p);
  res.json({ ok: true });
});
app.post('/api/admin/rename', needApi('owner'), async (req, res) => {
  const from = String(req.body.from || ''), to = String(req.body.to || '').trim().slice(0, 60);
  if (!from || !to) return res.status(400).json({ error: 'Need both names' });
  if (quotaRows().some(r => r.rep.toLowerCase() === to.toLowerCase() && r.rep !== from)) return res.status(400).json({ error: `"${to}" already exists.` });
  const rows = quotaRows().map(r => r.rep === from ? Object.assign({}, r, { rep: to, territory: r.territory === from ? to : r.territory }) : (r.territory === from ? Object.assign({}, r, { territory: to }) : r));
  let moved = 0;
  for (const [k, d] of [...docs]) if (COLS.includes(k.split('/')[0]) && d.rep === from) { await put(k, Object.assign({}, d, { rep: to })); moved++; }
  const p = JSON.parse(JSON.stringify(pins())); if (p.reps[from]) { p.reps[to] = p.reps[from]; delete p.reps[from]; }
  for (const [k, d] of [...docs]) if (k.startsWith('coonotes/') && d.reps && d.reps[from] != null) { const reps = Object.assign({}, d.reps); reps[to] = reps[from]; delete reps[from]; await put(k, Object.assign({}, d, { reps })); }
  await put('config/quotas', { rows, updated_at: new Date().toISOString() });
  await put('_auth/pins', p);
  res.json({ ok: true, moved });
});
app.post('/api/admin/reset-pin', needApi('owner'), async (req, res) => {
  const rep = String(req.body.rep || ''), want = String(req.body.pin || '').trim();
  const p = JSON.parse(JSON.stringify(pins()));
  if (!p.reps[rep]) return res.status(404).json({ error: 'No such rep' });
  if (want && !/^\d{4,8}$/.test(want)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits.' });
  p.reps[rep].pin = want || pin6(); p.reps[rep].v++;
  await put('_auth/pins', p);
  res.json({ ok: true, pin: p.reps[rep].pin });
});
app.post('/api/admin/admin-pin', needApi('owner'), async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{6,10}$/.test(pin)) return res.status(400).json({ error: 'Admin PIN must be 6 to 10 digits.' });
  const v = adminV() + 1;
  await put('_auth/admin', { pin, v });
  setSession(res, { role: 'owner', v });
  res.json({ ok: true });
});
app.get('/api/admin/backup', needApi('owner'), (req, res) => {
  const out = {}; for (const [k, d] of docs) if (!k.startsWith('_auth/')) out[k] = d;
  res.setHeader('Content-Disposition', `attachment; filename="360-medical-tracker-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ app: '360-medical-surgical-case-tracker', exported_at: new Date().toISOString(), docs: out });
});
app.post('/api/admin/restore', needApi('owner'), async (req, res) => {
  const inc = req.body && req.body.docs;
  if (!inc || typeof inc !== 'object') return res.status(400).json({ error: 'That file is not a tracker backup.' });
  let n = 0;
  for (const k of Object.keys(inc)) {
    const parts = k.split('/');
    if (k.startsWith('_auth/') || !((COLS.includes(parts[0]) && parts.length === 2) || k === 'config/quotas' || (parts[0] === 'coonotes' && parts.length === 2))) continue;
    await put(k, inc[k]); n++;
  }
  const p = JSON.parse(JSON.stringify(pins()));
  quotaRows().filter(r => r.role !== 'Team').forEach(r => { if (!p.reps[r.rep]) p.reps[r.rep] = { pin: pin6(), v: 1, active: true }; });
  await put('_auth/pins', p);
  res.json({ ok: true, restored: n });
});

initStore().then(() => app.listen(PORT, () => console.log(`360 Medical tracker on :${PORT} (storage: ${dbMode})`)))
  .catch(e => { console.error('startup failed', e); process.exit(1); });
