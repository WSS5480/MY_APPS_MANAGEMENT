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
function seedProducts() {
  if (docs.has('_seed/products')) return;
  const dir = path.join(__dirname, 'seed');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8')); } catch (e) { console.error('no product seed', e.message); }
  list.forEach((p, i) => {
    const id = 'seed' + String(i + 1).padStart(2, '0');
    const photos = [];
    if (p.photo) {
      try {
        const b64 = fs.readFileSync(path.join(dir, 'products', p.photo)).toString('base64');
        const img = 'img' + id; docs.set('_img/' + img, { type: 'image/jpeg', b64, product: id }); persist('_img/' + img); photos.push(img);
      } catch (e) {}
    }
    const doc = { name: p.name, manufacturer: p.manufacturer || '', section: p.section || '', category: p.category || '', description: p.description || '', highlights: p.highlights || [], indications: '', sizes: '', badges: p.badges || [], codes: p.codes || '', case_names: p.case_names || [], talking_points: '', links: [], photos, available: true, sort: (i + 1) * 10, source: '360 Medical Product Portfolio, Q4 2026', updated_at: new Date().toISOString() };
    docs.set('products/' + id, doc); persist('products/' + id);
  });
  docs.set('_seed/products', { at: new Date().toISOString(), count: list.length }); persist('_seed/products');
}
function seed() {
  seedProducts();
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
const COLS = ['cases', 'targets', 'simlab', 'visits', 'prefcards', 'credentials'];
const SHARED_CONFIG = ['config/pricebook', 'config/settings', 'config/closed'];
function visible(s) {
  const out = {};
  if (s.role === 'owner') {
    for (const [p, d] of docs) if (p[0] !== '_') out[p] = d;
    return out;
  }
  for (const [p, d] of docs) {
    const col = p.split('/')[0];
    if (COLS.includes(col) && p.split('/').length === 2 && d && d.rep === s.rep) out[p] = d;
  }
  for (const [p, d] of docs) if (p.startsWith('products/') || p.startsWith('facilities/')) out[p] = d;
  SHARED_CONFIG.forEach(k => { if (docs.has(k)) out[k] = docs.get(k); });
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
app.get('/products', needPage(), page('products.html'));
app.get('/img/:id', (req, res) => {
  const s = session(req);
  if (!s) return res.status(401).end();
  const d = docs.get('_img/' + req.params.id);
  if (!d) return res.status(404).end();
  if (d.rep && s.role !== 'owner' && d.rep !== s.rep) return res.status(403).end();
  res.setHeader('Content-Type', d.type || 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(d.b64, 'base64'));
});
app.get(['/logo.png', '/shim.js', '/plus.js', '/plus.css', '/visitcal.js', '/app.css', '/sw.js', '/favicon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'], (req, res) => { if (req.path === '/sw.js') res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(pub, req.path)); });
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
  sweepVisits();
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
      if (op === 'update' && !prev) return res.status(404).json({ code: 'not_found' });
      let next = op === 'delete' ? null : op === 'update' ? Object.assign({}, prev, clean(req.body.data)) : clean(req.body.data);
      if (next && s.role !== 'owner') next.rep = s.rep;
      if (next && !prev && !next.created_by) next.created_by = uidOf(s);
      if (col === 'visits') {
        sweepVisits();
        const pv = docs.get(p);
        if (next) {
          delete next.check; delete next.check_attempts;
          if (pv && pv.check) { next.check = pv.check; next.check_attempts = pv.check_attempts; ['date', 'time', 'duration', 'facility', 'target_id'].forEach(f => { if (pv[f] !== undefined) next[f] = pv[f]; }); }
          if (pv && pv.status === 'planned' && next.status === 'cancelled' && s.role !== 'owner' && visitWindow(pv).start <= Date.now()) return res.status(409).json({ code: 'failed_precondition', error: 'This visit has already started, so it cannot be cancelled. Check in, or ask the COO.' });
        } else if (pv && pv.check && s.role !== 'owner') return res.status(403).json({ code: 'permission_denied', error: 'A visit with a check-in record cannot be deleted.' });
      }
      if (col === 'cases') {
        const lock = closedMonth(prev && prev.date) || closedMonth(next && next.date);
        if (lock) return res.status(423).json({ code: 'failed_precondition', error: monthLabel(lock) + ' is closed. Ask the COO to reopen it to make changes.' });
      }
      if (op === 'delete') { await del(p); } else await put(p, next);
      if (col === 'cases') await audit(parts[1], s, op, prev, next);
      return res.json(next ? { ok: true, data: next } : { ok: true });
    }
    if (SHARED_CONFIG.includes(p) && s.role === 'owner' && op !== 'delete') {
      await put(p, Object.assign(clean(req.body.data), { updated_at: new Date().toISOString() })); return res.json({ ok: true });
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
  for (const [k, d] of docs) { const c = k.split('/')[0]; if (COLS.includes(c)) { const r = d.rep || '(none)'; counts[r] = counts[r] || { cases: 0, targets: 0, simlab: 0, visits: 0, prefcards: 0, credentials: 0, last: '' }; counts[r][c]++; if (c === 'cases' && (d.date || '') > counts[r].last) counts[r].last = d.date || ''; } }
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
  if (!/^\d{4,10}$/.test(pin)) return res.status(400).json({ error: 'Admin PIN must be 4 to 10 digits.' });
  const v = adminV() + 1;
  await put('_auth/admin', { pin, v });
  setSession(res, { role: 'owner', v });
  res.json({ ok: true });
});
app.get('/api/admin/backup', needApi('owner'), (req, res) => {
  const out = {}; for (const [k, d] of docs) if (!k.startsWith('_auth/') && !k.startsWith('_seed/') && !k.startsWith('_push/')) out[k] = d;
  res.setHeader('Content-Disposition', `attachment; filename="360-medical-tracker-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ app: '360-medical-surgical-case-tracker', exported_at: new Date().toISOString(), docs: out });
});
app.post('/api/admin/restore', needApi('owner'), async (req, res) => {
  const inc = req.body && req.body.docs;
  if (!inc || typeof inc !== 'object') return res.status(400).json({ error: 'That file is not a tracker backup.' });
  let n = 0;
  for (const k of Object.keys(inc)) {
    const parts = k.split('/');
    if (k.startsWith('_auth/') || !((COLS.includes(parts[0]) && parts.length === 2) || k === 'config/quotas' || SHARED_CONFIG.includes(k) || k.startsWith('_audit/') || ((parts[0] === 'coonotes' || parts[0] === 'products' || parts[0] === 'facilities' || parts[0] === '_img') && parts.length === 2))) continue;
    await put(k, inc[k]); n++;
  }
  const p = JSON.parse(JSON.stringify(pins()));
  quotaRows().filter(r => r.role !== 'Team').forEach(r => { if (!p.reps[r.rep]) p.reps[r.rep] = { pin: pin6(), v: 1, active: true }; });
  await put('_auth/pins', p);
  res.json({ ok: true, restored: n });
});

/* ---------------- products (admin) ---------------- */
const strList = v => (Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map(x => String(x).trim()).filter(Boolean).slice(0, 40).map(x => x.slice(0, 300));
function productFrom(b, prev) {
  const links = (Array.isArray(b.links) ? b.links : []).map(l => ({ label: String(l.label || '').slice(0, 80), url: String(l.url || '').trim().slice(0, 500) })).filter(l => /^https?:\/\//i.test(l.url)).slice(0, 10);
  const photos = (Array.isArray(b.photos) ? b.photos : []).map(String).filter(id => docs.has('_img/' + id)).slice(0, 12);
  return Object.assign({}, prev || {}, {
    name: String(b.name || '').trim().slice(0, 120), manufacturer: String(b.manufacturer || '').trim().slice(0, 120),
    section: String(b.section || '').trim().slice(0, 80), category: String(b.category || '').trim().slice(0, 80),
    description: String(b.description || '').slice(0, 3000), highlights: strList(b.highlights).map(x => x.replace(/^[-•*]\s*/, '')),
    indications: String(b.indications || '').slice(0, 3000), sizes: String(b.sizes || '').slice(0, 3000),
    badges: strList(b.badges), codes: String(b.codes || '').slice(0, 200), case_names: strList(b.case_names),
    talking_points: String(b.talking_points || '').slice(0, 4000), links, photos, udi_dis: strList(b.udi_dis).map(x => x.replace(/[^0-9A-Za-z]/g, '')).filter(Boolean),
    available: b.available !== false, sort: num(b.sort) != null ? num(b.sort) : (prev && prev.sort) || 9999, updated_at: new Date().toISOString()
  });
}
app.post('/api/admin/images', needApi('owner'), async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  if (!m) return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
  if (m[2].length > 4.2e6) return res.status(400).json({ error: 'Photo is too large.' });
  const id = 'img' + crypto.randomBytes(9).toString('hex');
  await put('_img/' + id, { type: m[1], b64: m[2] });
  res.json({ ok: true, id });
});
app.post('/api/admin/products', needApi('owner'), async (req, res) => {
  const b = req.body || {}, id = b.id && /^[A-Za-z0-9_-]{1,40}$/.test(b.id) ? b.id : 'p' + crypto.randomBytes(8).toString('hex');
  const prev = docs.get('products/' + id);
  const next = productFrom(b, prev);
  if (!next.name) return res.status(400).json({ error: 'Product name is required.' });
  if (!prev && num(b.sort) == null) next.sort = Math.max(0, ...[...docs].filter(([k]) => k.startsWith('products/')).map(([, d]) => d.sort || 0)) + 10;
  // photos removed from this product are deleted for good
  if (prev) for (const old of prev.photos || []) if (!next.photos.includes(old)) await del('_img/' + old);
  await put('products/' + id, next);
  res.json({ ok: true, id, product: next });
});
app.post('/api/admin/products/:id/available', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id, prev = docs.get(k);
  if (!prev) return res.status(404).json({ error: 'No such product' });
  await put(k, Object.assign({}, prev, { available: !!req.body.available, updated_at: new Date().toISOString() }));
  res.json({ ok: true });
});
app.post('/api/admin/products/order', needApi('owner'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (let i = 0; i < ids.length; i++) { const k = 'products/' + ids[i], d = docs.get(k); if (d && d.sort !== (i + 1) * 10) await put(k, Object.assign({}, d, { sort: (i + 1) * 10 })); }
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id, prev = docs.get(k);
  if (!prev) return res.status(404).json({ error: 'No such product' });
  for (const img of prev.photos || []) await del('_img/' + img);
  await del(k);
  res.json({ ok: true });
});
app.delete('/api/admin/images/:id', needApi('owner'), async (req, res) => {
  const k = '_img/' + req.params.id; const inUse = [...docs].some(([p, d]) => p.startsWith('products/') && (d.photos || []).includes(req.params.id));
  if (!inUse && docs.has(k)) await del(k);
  res.json({ ok: true });
});

/* ---------------- month close + audit trail ---------------- */
function closedMonth(date) { const m = String(date || '').slice(0, 7); const c = (docs.get('config/closed') || {}).months || {}; return /^\d{4}-\d{2}$/.test(m) && c[m] ? m : null; }
function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
const AUDIT_SKIP = ['updated_at', 'created_at', 'created_by'];
async function audit(caseId, s, op, prev, next) {
  const k = '_audit/' + caseId, a = Object.assign({ entries: [] }, docs.get(k) || {});
  const changes = {}, keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach(f => {
    if (AUDIT_SKIP.includes(f)) return;
    const o = prev ? prev[f] : undefined, n = next ? next[f] : undefined;
    if (JSON.stringify(o === undefined ? null : o) !== JSON.stringify(n === undefined ? null : n)) changes[f] = [o === undefined ? null : o, n === undefined ? null : n];
  });
  if (!Object.keys(changes).length && op !== 'delete') return;
  const by = s.role === 'owner' ? 'COO' : s.rep, at = new Date().toISOString(), kind = !prev ? 'created' : op === 'delete' ? 'deleted' : 'changed';
  const entries = (a.entries || []).slice(), last = entries[entries.length - 1];
  // typing autosaves every second or so: fold rapid edits by the same person into one entry
  if (last && kind === 'changed' && last.op !== 'deleted' && last.by === by && Date.now() - Date.parse(last.at) < 10 * 60e3) {
    Object.keys(changes).forEach(f => { last.changes[f] = [last.changes[f] ? last.changes[f][0] : changes[f][0], changes[f][1]]; if (JSON.stringify(last.changes[f][0]) === JSON.stringify(last.changes[f][1]) && last.op !== 'created') delete last.changes[f]; });
    last.at = at;
  } else entries.push({ at, by, op: kind, changes: kind === 'created' ? {} : changes });
  a.entries = entries.slice(-300); a.rep = (next || prev || {}).rep || a.rep || '';
  await put(k, a);
}
app.get('/api/audit/:id', needApi(), (req, res) => {
  const a = docs.get('_audit/' + req.params.id), c = docs.get('cases/' + req.params.id);
  const rep = (c && c.rep) || (a && a.rep);
  if (req.s.role !== 'owner' && rep !== req.s.rep) return res.status(403).json({ error: 'Not your case' });
  res.json({ entries: (a && a.entries) || [] });
});

/* ---------------- attachments (PO / sticker sheet photos) ---------------- */
app.post('/api/upload', needApi(), async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  if (!m) return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
  if (m[2].length > 4.2e6) return res.status(400).json({ error: 'Photo is too large.' });
  const id = 'att' + crypto.randomBytes(9).toString('hex');
  await put('_img/' + id, { type: m[1], b64: m[2], rep: req.s.role === 'owner' ? (String(req.body.rep || '') || null) : req.s.rep, by: uidOf(req.s), at: new Date().toISOString() });
  res.json({ ok: true, id });
});
app.delete('/api/upload/:id', needApi(), async (req, res) => {
  const k = '_img/' + req.params.id, d = docs.get(k);
  if (!d || !/^att/.test(req.params.id)) return res.json({ ok: true });
  if (req.s.role !== 'owner' && d.rep !== req.s.rep) return res.status(403).json({ error: 'Not yours' });
  await del(k); res.json({ ok: true });
});

/* ---------------- calendar feed (subscribe from a phone calendar) ---------------- */
function calToken(s) { return sign({ cal: 1, role: s.role, rep: s.rep || null, v: s.v, exp: Date.now() + 5 * 365 * 864e5 }); }
function calSession(tok) {
  const s = unsign(tok); if (!s || !s.cal) return null;
  if (s.role === 'owner') return s.v === adminV() ? s : null;
  const p = pins().reps[s.rep]; return p && p.active !== false && p.v === s.v ? s : null;
}
app.get('/api/cal-link', needApi(), (req, res) => {
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.json({ url: base + '/cal/' + calToken(req.s) + '.ics' });
});
const icsEsc = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = d => d.replace(/-/g, '');
app.get('/cal/:tok', (req, res) => {
  const s = calSession(String(req.params.tok).replace(/\.ics$/, ''));
  if (!s) return res.status(404).send('Calendar link expired. Get a new one from the tracker.');
  const today = new Date(), lo = new Date(today - 45 * 864e5).toISOString().slice(0, 10), hi = new Date(+today + 180 * 864e5).toISOString().slice(0, 10);
  const mine = d => s.role === 'owner' || d.rep === s.rep;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//360 Medical//Surgical Case Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEsc(s.role === 'owner' ? '360 Medical cases (team)' : '360 Medical cases · ' + s.rep), 'X-WR-TIMEZONE:America/Chicago', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ev = (uid, date, time, mins, summary, desc) => {
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@360medical-tracker', 'DTSTAMP:' + stamp);
    if (time && /^\d{2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(':').map(Number), end = h * 60 + m + mins;
      lines.push('DTSTART;TZID=America/Chicago:' + icsDate(date) + 'T' + time.replace(':', '') + '00', 'DTEND;TZID=America/Chicago:' + icsDate(date) + 'T' + String(Math.min(23, Math.floor(end / 60))).padStart(2, '0') + String(end >= 1440 ? 59 : end % 60).padStart(2, '0') + '00');
    } else {
      const nd = new Date(Date.parse(date + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
      lines.push('DTSTART;VALUE=DATE:' + icsDate(date), 'DTEND;VALUE=DATE:' + icsDate(nd));
    }
    lines.push('SUMMARY:' + icsEsc(summary)); if (desc) lines.push('DESCRIPTION:' + icsEsc(desc)); lines.push('END:VEVENT');
  };
  for (const [k, d] of docs) {
    const col = k.split('/')[0];
    if (!d || !mine(d) || !d.date && !d.next_date && !d.expires) continue;
    if (col === 'cases' && d.date >= lo && d.date <= hi && String(d.status).toLowerCase() !== 'cancelled')
      ev(k.replace('/', '-'), d.date, d.time, 90, 'Case: ' + (d.surgeon || 'Surgeon TBD') + (d.product ? ' · ' + d.product : '') + (d.facility ? ' @ ' + d.facility : ''), [s.role === 'owner' ? 'Rep: ' + d.rep : '', 'Status: ' + (d.status || ''), d.service_line ? 'Service line: ' + d.service_line : ''].filter(Boolean).join('\n'));
    if (col === 'visits' && d.next_date && d.next_date >= lo && d.next_date <= hi)
      ev(k.replace('/', '-') + '-next', d.next_date, null, 0, 'Next step: ' + (d.surgeon || '') + (d.next_step ? ' · ' + d.next_step : ''), s.role === 'owner' ? 'Rep: ' + d.rep : '');
    if (col === 'credentials' && d.expires && d.expires >= lo && d.expires <= hi)
      ev(k.replace('/', '-'), d.expires, null, 0, 'Credential expires: ' + (d.facility || '') + (d.system ? ' (' + d.system + ')' : ''), s.role === 'owner' ? 'Rep: ' + d.rep : 'Renew before this date to keep OR access.');
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.map(l => l.length > 74 ? l.match(/.{1,74}/g).join('\r\n ') : l).join('\r\n') + '\r\n');
});

/* ---------------- UDI lookup (FDA AccessGUDID) ---------------- */
const udiCache = new Map();
app.get('/api/udi/:di', needApi(), async (req, res) => {
  const di = String(req.params.di || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 30);
  if (!di) return res.status(400).json({ error: 'No device identifier' });
  const local = [...docs].find(([k, d]) => k.startsWith('products/') && (d.udi_dis || []).includes(di));
  if (local) return res.json({ found: true, di, product_id: local[0].slice(9), brand: local[1].name, company: local[1].manufacturer, source: 'catalog' });
  if (udiCache.has(di)) return res.json(udiCache.get(di));
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://accessgudid.nlm.nih.gov/api/v3/devices/lookup.json?di=' + encodeURIComponent(di), { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) { const out = { found: false, di }; udiCache.set(di, out); return res.json(out); }
    const j = await r.json(), dv = (j.gudid && j.gudid.device) || {};
    const out = { found: !!dv.brandName || !!dv.companyName, di, brand: dv.brandName || '', company: dv.companyName || '', model: dv.versionModelNumber || '', description: dv.deviceDescription || '', source: 'FDA AccessGUDID' };
    udiCache.set(di, out); res.json(out);
  } catch (e) { res.json({ found: false, di, error: 'The FDA lookup did not answer. Pick the product by hand.' }); }
});

/* ---------------- push notifications + weekly digest ---------------- */
let webpush = null; try { webpush = require('web-push'); } catch (e) { console.log('web-push not installed; notifications off'); }
function vapid() {
  if (!webpush) return null;
  let v = docs.get('_auth/vapid');
  if (!v) { v = webpush.generateVAPIDKeys(); docs.set('_auth/vapid', v); persist('_auth/vapid'); }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://www.360medical.net', v.publicKey, v.privateKey);
  return v;
}
const subKey = endpoint => '_push/' + crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
app.get('/api/push/key', needApi(), (req, res) => { const v = vapid(); const mine = [...docs].filter(([k, d]) => k.startsWith('_push/') && d.uid === uidOf(req.s)).length; res.json({ enabled: !!v, key: v ? v.publicKey : null, devices: mine }); });
app.post('/api/push/subscribe', needApi(), async (req, res) => {
  const sub = req.body && req.body.sub;
  if (!sub || !/^https:\/\//.test(String(sub.endpoint || '')) || !sub.keys) return res.status(400).json({ error: 'Bad subscription' });
  await put(subKey(sub.endpoint), { uid: uidOf(req.s), role: req.s.role, rep: req.s.rep || null, v: req.s.v, sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh || ''), auth: String(sub.keys.auth || '') } }, at: new Date().toISOString() });
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', needApi(), async (req, res) => { const k = subKey(req.body && req.body.endpoint); if (docs.has(k)) await del(k); res.json({ ok: true }); });

const chiDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function bizDays(ym) { const [y, m] = ym.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = []; for (let d = 1; d <= n; d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w && w < 6) out.push(ym + '-' + String(d).padStart(2, '0')); } return out; }
const isDone = st => { const s = String(st || '').toLowerCase(); return s !== 'scheduled' && s !== 'cancelled'; };
const fmt$ = v => '$' + Math.round(v).toLocaleString('en-US');
function allCases() { return [...docs].filter(([k]) => k.startsWith('cases/')).map(([, d]) => d).filter(c => c && c.date && c.rep); }
function rowActual(row, ym, cases) {
  const terr = {}; quotaRows().forEach(r => { if (r.role !== 'Team') terr[r.rep] = r.territory; });
  return cases.filter(c => c.date.slice(0, 7) === ym && isDone(c.status)).filter(c => {
    const who = row.role === 'Team' ? terr[c.rep] === row.territory : c.rep === row.rep;
    const type = row.counts === 'New only' ? c.surgeon_type === 'New' : row.counts === 'Legacy only' ? c.surgeon_type === 'Legacy' : true;
    const prod = !row.product_filter || String(c.product || '').toLowerCase().includes(row.product_filter.toLowerCase());
    return who && type && prod;
  }).reduce((t, c) => t + (row.metric === 'Cases' ? 1 : (c.net_sales || 0)), 0);
}
function rowTarget(row, ym, cases) {
  if (!row.quota) return null;
  if (!row.carry) return row.quota;
  const [y, m] = ym.split('-').map(Number), q0 = Math.floor((m - 1) / 3) * 3 + 1; let carry = 0;
  for (let mm = q0; mm < m; mm++) { const k = y + '-' + String(mm).padStart(2, '0'); carry = Math.max(0, row.quota + carry - rowActual(row, k, cases)); }
  return row.quota + carry;
}
function settings() { return Object.assign({ po_alert_days: 3, invoice_alert_days: 7, stuck_step_days: 30, cred_warn_days: 30 }, docs.get('config/settings') || {}); }
function repDigest(rep, today) {
  const cases = allCases(), ym = today.slice(0, 7), row = quotaRows().find(r => r.rep === rep && r.role !== 'Team'), st = settings();
  const parts = [];
  if (row) {
    const days = bizDays(ym), left = days.filter(d => d >= today).length, actual = rowActual(row, ym, cases), target = rowTarget(row, ym, cases);
    const v = n => row.metric === 'Cases' ? Math.round(n * 10) / 10 + ' cases' : fmt$(n);
    if (target) { const gap = Math.max(0, target - actual); parts.push(v(actual) + ' of ' + v(target) + ' (' + Math.round(actual / target * 100) + '%)' + (gap > 0 && left ? ' · need ' + v(gap / left) + '/day' : gap === 0 ? ' · target hit' : '')); }
    else parts.push(v(actual) + ' so far this month');
  }
  const mine = cases.filter(c => c.rep === rep);
  const noPO = mine.filter(c => String(c.status) === 'Completed' && c.date <= addDays(today, -st.po_alert_days)).length;
  const stale = mine.filter(c => String(c.status) === 'Scheduled' && c.date < today).length;
  const creds = [...docs].filter(([k, d]) => k.startsWith('credentials/') && d.rep === rep && d.expires && d.expires <= addDays(today, st.cred_warn_days)).length;
  const visits = [...docs].filter(([k, d]) => k.startsWith('visits/') && d.rep === rep).map(([, d]) => d);
  const due = visits.filter(v => v.next_date && v.next_date <= addDays(today, 6) && !visits.some(w => w.target_id === v.target_id && w.date > v.date)).length;
  const week = mine.filter(c => c.date >= today && c.date <= addDays(today, 6) && String(c.status) !== 'Cancelled').length;
  if (week) parts.push(week + ' case' + (week === 1 ? '' : 's') + ' this week');
  if (noPO) parts.push(noPO + ' waiting on a PO');
  if (stale) parts.push(stale + ' still marked Scheduled');
  if (due) parts.push(due + ' next step' + (due === 1 ? '' : 's') + ' due');
  if (creds) parts.push(creds + ' credential' + (creds === 1 ? '' : 's') + ' expiring');
  return { title: '360 Medical · your week', body: parts.join(' · ') || 'Nothing to flag this week.', url: '/' };
}
function teamDigest(today) {
  const cases = allCases(), ym = today.slice(0, 7), reps = quotaRows().filter(r => r.role !== 'Team'), st = settings();
  const total = cases.filter(c => c.date.slice(0, 7) === ym && isDone(c.status)).reduce((t, c) => t + (c.net_sales || 0), 0);
  const teams = quotaRows().filter(r => r.role === 'Team');
  const quota = quotaRows().filter(r => r.metric === 'Revenue' && (r.role === 'Team' || !teams.some(t => t.territory === r.territory))).reduce((t, r) => t + (r.quota || 0), 0);
  const days = bizDays(ym), gone = days.filter(d => d <= today).length / days.length;
  const behind = reps.filter(r => { const t = rowTarget(r, ym, cases); return t && rowActual(r, ym, cases) < t * gone * 0.8; }).map(r => r.rep);
  const noPO = cases.filter(c => String(c.status) === 'Completed' && c.date <= addDays(today, -st.po_alert_days)).length;
  const unpaid = cases.filter(c => String(c.status) === 'Invoiced').length;
  const parts = [fmt$(total) + (quota ? ' of ' + fmt$(quota) + ' (' + Math.round(total / quota * 100) + '%)' : ' this month')];
  if (behind.length) parts.push('behind pace: ' + behind.join(', '));
  if (noPO) parts.push(noPO + ' cases waiting on a PO');
  if (unpaid) parts.push(unpaid + ' invoiced, not yet paid');
  return { title: '360 Medical · team week', body: parts.join(' · '), url: '/' };
}
async function sendTo(d, msg) {
  if (!vapid()) return false;
  try { await webpush.sendNotification(d.sub, JSON.stringify(msg), { TTL: 86400 }); return true; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await del(subKey(d.sub.endpoint)); return false; }
}
async function sendDigests() {
  const today = chiDate(); let sent = 0;
  for (const [k, d] of [...docs]) {
    if (!k.startsWith('_push/')) continue;
    if (d.role === 'owner' ? d.v !== adminV() : !(pins().reps[d.rep] && pins().reps[d.rep].active !== false)) continue;
    if (await sendTo(d, d.role === 'owner' ? teamDigest(today) : repDigest(d.rep, today))) sent++;
  }
  await put('_auth/digest', { last: today, sent, at: new Date().toISOString() });
  return sent;
}
app.post('/api/push/test', needApi(), async (req, res) => {
  const today = chiDate(), msg = req.s.role === 'owner' ? teamDigest(today) : repDigest(req.s.rep, today);
  let n = 0; for (const [k, d] of [...docs]) if (k.startsWith('_push/') && d.uid === uidOf(req.s) && await sendTo(d, msg)) n++;
  res.json({ ok: true, sent: n, preview: msg });
});
app.get('/api/digest/preview', needApi(), (req, res) => { const today = chiDate(); res.json(req.s.role === 'owner' ? teamDigest(today) : repDigest(req.s.rep, today)); });
app.post('/api/cron/digest', async (req, res) => {
  const ok = (process.env.CRON_SECRET && req.get('x-cron-secret') === process.env.CRON_SECRET) || (session(req) || {}).role === 'owner';
  if (!ok) return res.status(403).json({ error: 'Not allowed' });
  res.json({ ok: true, sent: await sendDigests() });
});
// Monday-morning digest while the service is awake (the Render cron job wakes it up otherwise)
setInterval(() => {
  const now = new Date(), today = chiDate(now), hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(now));
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  if (dow === 1 && hour >= 8 && hour < 12 && (docs.get('_auth/digest') || {}).last !== today) sendDigests().catch(e => console.error('digest', e.message));
}, 10 * 60e3).unref();


/* ---------------- target visits: facilities, geo check-in, missed sweep ---------------- */
function chiEpoch(date, time) {
  const [y, m, d] = String(date).split('-').map(Number), [hh, mm] = String(time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = k => Number(parts.find(x => x.type === k).value);
  return guess - (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess);
}
function geoSet() { const st = docs.get('config/settings') || {}; return { early: Number(st.checkin_early_min) || 30, late: Number(st.checkin_late_min) || 30, radius: Number(st.geo_radius_m) || 400 }; }
function visitWindow(v) {
  const g = geoSet(), start = chiEpoch(v.date, v.time || '08:00'), end = start + (Number(v.duration) || 60) * 60e3;
  return { start, end, open: start - g.early * 60e3, close: end + g.late * 60e3 };
}
const lcs = v => String(v || '').trim().toLowerCase();
function facilityFor(name) { const n = lcs(name); if (!n) return null; for (const [k, d] of docs) if (k.startsWith('facilities/') && (lcs(d.name) === n || (d.aliases || []).some(a => lcs(a) === n))) return Object.assign({ id: k.slice(11) }, d); return null; }
function metersBetween(a, b, c, d) { const R = 6371000, r = x => x * Math.PI / 180, dl = r(c - a), dg = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); }
const fmtClock = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
async function notifyOwner(title, body) {
  for (const [k, d] of [...docs]) if (k.startsWith('_push/') && d.role === 'owner' && d.v === adminV()) await sendTo(d, { title, body, url: '/admin#visits' });
}
let lastSweep = 0;
function sweepVisits() {
  if (Date.now() - lastSweep < 30e3) return; lastSweep = Date.now();
  for (const [k, v] of [...docs]) {
    if (!k.startsWith('visits/') || !v || v.status !== 'planned' || v.check || !v.date || !v.time) continue;
    const w = visitWindow(v);
    if (Date.now() > w.close) {
      const check = { at: new Date().toISOString(), ok: false, missed: true, reason: 'Missed: no check-in between ' + fmtClock(w.open) + ' and ' + fmtClock(w.close) };
      docs.set(k, Object.assign({}, v, { check })); persist(k);
      notifyOwner('Visit not verified · ' + v.rep, v.rep + ' did not check in for ' + v.surgeon + (v.facility ? ' at ' + v.facility : '') + ' (' + v.date + ' ' + v.time + ').').catch(() => {});
    }
  }
}
setInterval(sweepVisits, 5 * 60e3).unref();
app.post('/api/checkin', needApi(), async (req, res) => {
  sweepVisits();
  const k = 'visits/' + String(req.body.id || ''), v = docs.get(k);
  if (!v) return res.status(404).json({ error: 'Visit not found.' });
  if (req.s.role !== 'owner' && v.rep !== req.s.rep) return res.status(403).json({ error: 'Not your visit.' });
  if (req.s.role === 'owner') return res.status(403).json({ error: 'Only the rep checks in to their own visit.' });
  if (v.status !== 'planned') return res.status(400).json({ error: 'Only planned visits can be checked in.' });
  if (v.check && v.check.ok === true) return res.json({ ok: true, check: v.check });
  if (v.check && v.check.missed) return res.status(409).json({ error: 'The check-in window for this visit has closed.', check: v.check });
  const lat = Number(req.body.lat), lng = Number(req.body.lng), acc = Math.max(0, Number(req.body.acc) || 0);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'No location received.' });
  const g = geoSet(), w = visitWindow(v), now = Date.now(), fac = facilityFor(v.facility);
  const inWindow = now >= w.open && now <= w.close;
  let ok, reason, dist = null;
  if (!fac || fac.lat == null || fac.lng == null) { ok = null; reason = 'Cannot verify: no address on file for ' + (v.facility || 'this facility') + '.'; }
  else {
    dist = metersBetween(lat, lng, fac.lat, fac.lng);
    const radius = Number(fac.radius_m) || g.radius, slack = Math.min(acc, 150);
    const near = acc <= 1500 && dist - slack <= radius;
    ok = near && inWindow;
    reason = !inWindow ? (now < w.open ? 'Too early: check-in opens at ' + fmtClock(w.open) + '.' : 'Too late: check-in closed at ' + fmtClock(w.close) + '.')
      : acc > 1500 ? 'Location too imprecise (±' + Math.round(acc) + ' m). Turn on precise location and try again.'
      : !near ? 'Not at ' + fac.name + ': ' + (dist >= 1000 ? (dist / 1609.34).toFixed(1) + ' mi' : dist + ' m') + ' away.' : 'At ' + fac.name + ' (' + dist + ' m from the address) during the visit window.';
  }
  if (!inWindow && now < w.open) return res.status(400).json({ error: reason });
  const check = { at: new Date(now).toISOString(), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, acc: Math.round(acc), dist_m: dist, ok, reason, in_window: inWindow, facility_id: fac ? fac.id : null };
  const attempts = (v.check_attempts || 0) + 1, wasBad = v.check && v.check.ok === false;
  await put(k, Object.assign({}, v, { check, check_attempts: attempts }));
  if (ok === false && !wasBad) notifyOwner('Visit check failed · ' + v.rep, v.rep + ' · ' + v.surgeon + ': ' + reason).catch(() => {});
  if (ok === null && attempts === 1) notifyOwner('Visit not verifiable · ' + v.rep, 'Add an address for ' + (v.facility || 'the facility') + ' in Admin so check-ins there can be verified.').catch(() => {});
  res.json({ ok: true, check });
});
async function geocode(q) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q), { signal: ctl.signal, headers: { 'User-Agent': '360-Medical-Case-Tracker/1.0 (' + (process.env.PUBLIC_URL || 'https://three60-medical-surgical-case-tracker.onrender.com') + ')', 'Accept-Language': 'en' } });
    const j = await r.json(); if (!Array.isArray(j) || !j[0]) return null;
    return { lat: Math.round(Number(j[0].lat) * 1e6) / 1e6, lng: Math.round(Number(j[0].lon) * 1e6) / 1e6, label: j[0].display_name };
  } catch (e) { return null; } finally { clearTimeout(t); }
}
app.get('/api/admin/geocode', needApi('owner'), async (req, res) => { const g = await geocode(String(req.query.q || '').slice(0, 300)); res.json(g ? Object.assign({ found: true }, g) : { found: false }); });
app.post('/api/admin/facilities', needApi('owner'), async (req, res) => {
  const b = req.body || {}, id = b.id && /^[A-Za-z0-9_-]{1,40}$/.test(b.id) ? b.id : 'f' + crypto.randomBytes(7).toString('hex');
  const name = String(b.name || '').trim().slice(0, 120); if (!name) return res.status(400).json({ error: 'Facility name is required.' });
  const dupe = [...docs].find(([k, d]) => k.startsWith('facilities/') && k !== 'facilities/' + id && lcs(d.name) === lcs(name));
  if (dupe) return res.status(400).json({ error: name + ' is already in the list.' });
  const address = String(b.address || '').trim().slice(0, 300);
  let lat = b.lat === '' || b.lat == null ? null : Number(b.lat), lng = b.lng === '' || b.lng == null ? null : Number(b.lng), label = null;
  if ((lat == null || lng == null || b.geocode) && address) { const g = await geocode(address); if (!g) return res.status(400).json({ error: 'Could not find that address on the map. Check it, or enter latitude and longitude.' }); lat = g.lat; lng = g.lng; label = g.label; }
  if (lat != null && (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) return res.status(400).json({ error: 'Latitude/longitude look wrong.' });
  const doc = { name, address, lat, lng, map_label: label || (docs.get('facilities/' + id) || {}).map_label || '', radius_m: num(b.radius_m) || null, aliases: strList(b.aliases), updated_at: new Date().toISOString() };
  await put('facilities/' + id, doc); res.json({ ok: true, id, facility: doc });
});
app.delete('/api/admin/facilities/:id', needApi('owner'), async (req, res) => { const k = 'facilities/' + req.params.id; if (docs.has(k)) await del(k); res.json({ ok: true }); });
app.post('/api/admin/visit-ack', needApi('owner'), async (req, res) => {
  const k = 'visits/' + String(req.body.id || ''), v = docs.get(k);
  if (!v || !v.check) return res.status(404).json({ error: 'No check-in record.' });
  await put(k, Object.assign({}, v, { check: Object.assign({}, v.check, { ack: { at: new Date().toISOString(), note: String(req.body.note || '').slice(0, 500) } }) }));
  res.json({ ok: true });
});

initStore().then(() => app.listen(PORT, () => console.log(`360 Medical tracker on :${PORT} (storage: ${dbMode})`)))
  .catch(e => { console.error('startup failed', e); process.exit(1); });
