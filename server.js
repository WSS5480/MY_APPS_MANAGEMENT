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
// linked to the store: the session cookie must travel inside the store's window (a different site), so SameSite=None; Secure
const COOKIE_ATTRS = () => (process.env.HUB_URL && process.env.HUB_SECRET) ? 'SameSite=None; Secure' : `SameSite=Lax${PROD ? '; Secure' : ''}`;

/* ---------------- storage: everything lives in memory, written through to Postgres or a file ---------------- */
const docs = new Map();          // path -> data
let version = 1;
let pool = null;
let dbMode = 'file';

async function initStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const cs = process.env.DATABASE_URL;
    pool = new Pool({ connectionString: cs, ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(cs) || /@[^.:/]+(:\d+)?\//.test(cs) ? false : { rejectUnauthorized: false }, max: 4 });
    await pool.query(`CREATE TABLE IF NOT EXISTS sct360_docs (path TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const r = await pool.query('SELECT path, data FROM sct360_docs');
    r.rows.forEach(row => docs.set(row.path, row.data));
    dbMode = 'postgres';
  } else if (fs.existsSync(DATA_FILE)) {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.keys(j).forEach(k => docs.set(k, j[k]));
  }
  await fileInit();
  seed();
  await seedVideos().catch(e => console.error('video seed', e.message));
  await seedSpins().catch(e => console.error('spin seed', e.message));
  await seedVideoLinks().catch(e => console.error('video link seed', e.message));
  await seedStabilityPhotos().catch(e => console.error('photo seed', e.message));
}
/* large files (videos) live outside the in-memory docs: Postgres bytea, or a folder next to the data file */
const FILE_DIR = path.join(path.dirname(DATA_FILE), 'sct360-files');
async function fileInit() {
  if (pool) await pool.query('CREATE TABLE IF NOT EXISTS sct360_files (id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  else fs.mkdirSync(FILE_DIR, { recursive: true });
}
async function filePut(id, type, buf, name) {
  if (pool) await pool.query('INSERT INTO sct360_files(id,type,size,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,size=EXCLUDED.size,data=EXCLUDED.data', [id, type, buf.length, buf]);
  else fs.writeFileSync(path.join(FILE_DIR, id), buf);
  await put('_file/' + id, { type, size: buf.length, name: name || '', at: new Date().toISOString() });
}
async function fileRange(id, start, len) {
  if (pool) { const r = await pool.query('SELECT substring(data from $2 for $3) AS d FROM sct360_files WHERE id=$1', [id, start + 1, len]); return r.rows[0] ? r.rows[0].d : null; }
  const fp = path.join(FILE_DIR, id); if (!fs.existsSync(fp)) return null;
  const fd = fs.openSync(fp, 'r'), b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, start); fs.closeSync(fd); return b.subarray(0, n);
}
async function fileDel(id) {
  if (pool) await pool.query('DELETE FROM sct360_files WHERE id=$1', [id]); else { try { fs.unlinkSync(path.join(FILE_DIR, id)); } catch (e) {} }
  if (docs.has('_file/' + id)) await del('_file/' + id);
}
const SEED_VIDEOS = [
  { key: '_seed/videos', file: 'amniosurge-asg', match: /amniosurge.*asg/i, vid: 'vidseedasg', name: 'AmnioSurge-Utilization-Video-MK-0062.mp4', title: 'AmnioSurge ASG utilization video', duration: 89 },
  { key: '_seed/video-hemoblast', file: 'hemoblast', match: /hemoblast/i, vid: 'vidseedhemo', name: 'HEMOBLAST-homepage.mp4', title: 'HEMOBLAST Bellows overview', duration: 11 },
];
async function seedVideos(only) {
  const dir = path.join(__dirname, 'seed', 'videos');
  for (const v of SEED_VIDEOS) {
    if (!only && docs.has(v.key)) continue;
    const vp = path.join(dir, v.file + '.mp4');
    const entry = [...docs].find(([k, d]) => k.startsWith('products/') && (!only || only.has(k)) && v.match.test(d.name || ''));
    if (!entry || !fs.existsSync(vp)) continue;
    const poster = 'img' + v.vid;
    await filePut(v.vid, 'video/mp4', fs.readFileSync(vp), v.name);
    const pj = path.join(dir, v.file + '.jpg'); if (fs.existsSync(pj)) await put('_img/' + poster, { type: 'image/jpeg', b64: fs.readFileSync(pj).toString('base64'), product: entry[0].slice(9) });
    const prod = Object.assign({}, docs.get(entry[0]));
    prod.videos = (prod.videos || []).filter(x => x.id !== v.vid).concat([{ id: v.vid, title: v.title, poster: fs.existsSync(pj) ? poster : null, type: 'video/mp4', size: docs.get('_file/' + v.vid).size, duration: v.duration }]);
    await put(entry[0], prod);
    await put(v.key, { at: new Date().toISOString() });
  }
}
/* 360-degree drag-to-rotate views: frames packed back to back as JPEGs in one file */
const SEED_SPINS = [
  { key: '_seed/spin-skeletal', file: 'skeletal-dynamics', match: d => /skeletal dynamics/i.test(d.manufacturer || ''), id: 'spinseedsd', title: '360° construct rotation' },
];
async function seedSpins(only) {
  const dir = path.join(__dirname, 'seed', 'spins');
  for (const s of SEED_SPINS) {
    if (!only && docs.has(s.key)) continue;
    const bin = path.join(dir, s.file + '.bin'), meta = path.join(dir, s.file + '.json');
    const entry = [...docs].find(([k, d]) => k.startsWith('products/') && (!only || only.has(k)) && s.match(d));
    if (!entry || !fs.existsSync(bin) || !fs.existsSync(meta)) continue;
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    await filePut(s.id, 'application/octet-stream', fs.readFileSync(bin), s.file + '.bin');
    const poster = 'img' + s.id, pj = path.join(dir, s.file + '.jpg');
    if (fs.existsSync(pj)) await put('_img/' + poster, { type: 'image/jpeg', b64: fs.readFileSync(pj).toString('base64'), product: entry[0].slice(9) });
    const prod = Object.assign({}, docs.get(entry[0]));
    prod.spin = { id: s.id, title: s.title, poster: fs.existsSync(pj) ? poster : null, frames: m.frames, w: m.w, h: m.h, start: m.start || 0 };
    await put(entry[0], prod);
    await put(s.key, { at: new Date().toISOString() });
  }
}
async function dropSpin(prod) {
  if (!prod || !prod.spin) return;
  await fileDel(prod.spin.id); if (prod.spin.poster && docs.has('_img/' + prod.spin.poster)) await del('_img/' + prod.spin.poster);
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
function brochureList() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'products.json'), 'utf8')); } catch (e) { console.error('no product seed', e.message); return []; }
}
function seedProducts(onlyIdx) {
  if (!onlyIdx && docs.has('_seed/products')) return;
  const dir = path.join(__dirname, 'seed');
  const list = brochureList();
  list.forEach((p, i) => {
    if (onlyIdx && !onlyIdx.has(i)) return;
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
  if (onlyIdx) return;
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
const IDLE_MS = (Number(process.env.IDLE_MIN) || 10) * 60e3;
const lastActive = new Map();
function session(req) {
  const s = unsign(cookies(req).sct_session);
  if (!s) return null;
  if (s.dev === 'computer' && s.sid) {
    const t = lastActive.get(s.sid);
    if (t === undefined) lastActive.set(s.sid, Date.now());
    else if (Date.now() - t > IDLE_MS) return null;
  }
  if (s.role === 'owner' && s.mgr) { const m = mgrs()[s.mgr]; return m && m.active !== false && m.v === s.v ? s : null; }
  if (s.role === 'owner' && s.hub) { // signed in through the store (one login): still listed there as an active admin/manager?
    if (hubPeople.ok && s.hubId && !hubPeople.list.some(u => u.id === s.hubId && u.active !== false && u.role !== 'rep')) return null; // only trust a list we actually fetched
    return s;
  }
  if (s.role === 'owner') return s.v === adminV() && !pinOff() ? s : null;
  const p = pins().reps[s.rep];
  if (!p || p.active === false) return null;
  if (s.hub) return quotaRows().some(r => r.rep === s.rep && r.role !== 'Team') ? s : null;
  if (s.acct) { const a = mgrs()[s.acct]; if (!a || a.active === false || a.v !== s.v || a.kind !== 'rep' || a.rep !== s.rep) return null; }
  else if (p.v !== s.v || repAcct(s.rep)) return null;
  if (!quotaRows().some(r => r.rep === s.rep && r.role !== 'Team')) return null;
  return s;
}
const repAcct = rep => Object.values(mgrs()).find(a => a.kind === 'rep' && a.rep === rep && a.totp_on && a.active !== false);
function acctSession(rec) { return rec.kind === 'rep' ? { role: 'rep', rep: rec.rep, acct: rec.id, v: rec.v } : { role: 'owner', mgr: rec.id, v: rec.v }; }
const acctOf = s => mgrs()[s.mgr || s.acct];
/* ---------------- login activity (admin): every sign-in, plus when each person was last using the app ---------------- */
const seenBy = new Map(); let seenDirty = false;
const loginKey = (o) => o.role === 'rep' ? 'rep:' + o.rep : o.mgr ? 'mgr:' + o.mgr : o.hubId ? 'hub:' + o.hubId : 'coo';
function logLogin(o, dev) {
  try {
    const log = docs.get('_log/logins') || { events: [], seen: {} };
    const how = o.hub ? 'Store login' : o.acct ? 'Email + 2-step' : o.mgr ? 'Manager login' : 'PIN';
    log.events.unshift({ at: new Date().toISOString(), key: loginKey(o), who: whoName(o), role: o.role === 'rep' ? 'Rep' : o.mgr || o.hubStaff ? 'Manager' : 'Admin', dev, how });
    log.events = log.events.slice(0, 3000); log.seen = Object.assign({}, log.seen, { [loginKey(o)]: new Date().toISOString() });
    put('_log/logins', log).catch(() => {});
  } catch (e) {}
}
function markSeen(s) { if (!s) return; const k = loginKey(s), now = Date.now(), t = seenBy.get(k); if (!t || now - t > 60e3) { seenBy.set(k, now); seenDirty = true; } }
setInterval(() => { if (!seenDirty) return; seenDirty = false; const log = docs.get('_log/logins') || { events: [], seen: {} }; const seen = Object.assign({}, log.seen); for (const [k, t] of seenBy) seen[k] = new Date(Math.max(t, Date.parse(seen[k] || 0) || 0)).toISOString(); put('_log/logins', Object.assign({}, log, { seen })).catch(() => {}); }, 5 * 60e3).unref();
function setSession(res, obj, dev) {
  dev = dev === 'phone' ? 'phone' : 'computer';
  const days = dev === 'phone' ? 30 : 1, sid = crypto.randomBytes(9).toString('base64url');
  for (const [id, t] of lastActive) if (Date.now() - t > 2 * 864e5) lastActive.delete(id);
  for (const [ip, t] of tries) if (Date.now() - t.at > 60 * 60e3) tries.delete(ip);
  lastActive.set(sid, Date.now());
  logLogin(obj, dev);
  res.setHeader('Set-Cookie', `sct_session=${encodeURIComponent(sign(Object.assign({}, obj, { sid, dev, exp: Date.now() + days * 864e5 })))}; Path=/; HttpOnly; ${COOKIE_ATTRS()}; Max-Age=${days * 86400}`);
}
const uidOf = s => s.role === 'owner' ? (s.mgr ? 'mgr-' + s.mgr : 'owner') : 'rep-' + slug(s.rep);
const mgrs = () => (docs.get('_auth/managers') || {}).m || {};
async function saveMgrs(m) { await put('_auth/managers', { m }); }
const pinOff = () => !!(docs.get('_auth/admin') || {}).pin_disabled;
const isSuper = s => s && s.role === 'owner' && !s.hubStaff && (!s.mgr || !!(mgrs()[s.mgr] || {}).can_manage); // store managers are managers here too, not super-admins
const whoName = s => s.role === 'owner' ? (s.mgr ? ((mgrs()[s.mgr] || {}).name || 'Manager') : (s.hubName || 'COO')) : s.rep;

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
    // a rep whose access is off is hidden from every report: their plan row stays on the server (kept on save below), not in the COO's views
    const pp = pins().reps; out['config/quotas'] = Object.assign({}, docs.get('config/quotas') || {}, { rows: quotaRows().filter(r => r.role === 'Team' || (pp[r.rep] || {}).active !== false) });
    return out;
  }
  for (const [p, d] of docs) {
    const col = p.split('/')[0];
    if (COLS.includes(col) && p.split('/').length === 2 && d && d.rep === s.rep) out[p] = d;
  }
  for (const [p, d] of docs) if (p.startsWith('products/') || p.startsWith('facilities/') || p.startsWith('surgeons/')) out[p] = d;
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
app.use((req, res, next) => { const hub = String(process.env.HUB_URL || '').replace(/\/$/, ''); if (hub && process.env.HUB_SECRET) res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${hub}`); else res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Robots-Tag', 'noindex'); next(); });

const pub = path.join(__dirname, 'public');
const page = f => (req, res) => res.sendFile(path.join(pub, f));
const needPage = role => (req, res, next) => { const s = session(req); if (!s) return res.redirect('/login?next=' + encodeURIComponent(req.path)); if (role === 'owner' && s.role !== 'owner') return res.redirect('/'); if (s.sid) lastActive.set(s.sid, Date.now()); req.s = s; next(); };

app.get('/healthz', (req, res) => res.json({ ok: true }));
const BUILD = process.env.RENDER_GIT_COMMIT || String(Date.now());
const PKG_VERSION = require('./package.json').version;
const UPDATED_AT = (() => { try { return fs.statSync(path.join(__dirname, 'server.js')).mtime.toISOString(); } catch (e) { return new Date().toISOString(); } })();
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ build: BUILD, version: PKG_VERSION, updated: UPDATED_AT }); });
app.get('/login', page('login.html'));
app.get('/', needPage(), page('tracker.html'));
app.get('/admin', needPage('owner'), page('admin.html'));
app.get('/download', page('download.html'));
app.get('/admin/download', page('download-admin.html'));
app.get('/download-admin', (req, res) => res.redirect(301, '/admin/download'));
app.get('/setup', page('setup.html'));
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
app.get('/media/:id', async (req, res) => {
  if (!session(req)) return res.status(401).end();
  const id = String(req.params.id).replace(/[^A-Za-z0-9_-]/g, ''), meta = docs.get('_file/' + id);
  if (!meta) return res.status(404).end();
  const size = meta.size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', meta.type || 'video/mp4'); res.setHeader('Cache-Control', 'private, max-age=86400');
  try {
    if (m) {
      let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : Math.min(start + 4 * 1024 * 1024 - 1, size - 1);
      if (start >= size || start > end) { res.setHeader('Content-Range', 'bytes */' + size); return res.status(416).end(); }
      const buf = await fileRange(id, start, end - start + 1); if (!buf) return res.status(404).end();
      res.status(206); res.setHeader('Content-Range', `bytes ${start}-${start + buf.length - 1}/${size}`); res.setHeader('Content-Length', buf.length); return res.end(buf);
    }
    const buf = await fileRange(id, 0, size); if (!buf) return res.status(404).end();
    res.setHeader('Content-Length', buf.length); res.end(buf);
  } catch (e) { res.status(500).end(); }
});
app.get(['/logo.png', '/logo-dark.png', '/collapse.js', '/d3.min.js', '/shim.js', '/plus.js', '/plus.css', '/addr.js', '/wcu.js', '/leader.js', '/import.js', '/logins.js', '/admin-pages.js', '/admin-dash.js', '/exec.js', '/replist.js', '/visitcal.js', '/idle.js', '/zoom.js', '/spin.js', '/install.js', '/ptr.js', '/update.js', '/webauthn.js', '/qrious.min.js', '/app.css', '/theme-360.css', '/icon-admin-192.png', '/icon-admin-512.png', '/icon-admin-maskable-512.png', '/apple-touch-icon-admin.png', '/sw.js', '/favicon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'], (req, res) => { if (req.path === '/sw.js') res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(pub, req.path)); });
app.get('/manifest.webmanifest', (req, res) => { res.type('application/manifest+json'); res.sendFile(path.join(pub, 'manifest.webmanifest')); });
app.get('/admin.webmanifest', (req, res) => { res.type('application/manifest+json'); res.sendFile(path.join(pub, 'admin.webmanifest')); });


/* ---------------- the hub: the peptide store admin is the one login for both apps ----------------
   HUB_URL = the store's address, HUB_SECRET = the same shared secret set on the store. People ticked "Case tracker" in the
   store's Team logins show up here as reps/managers; sign-in from the store lands here through /sso; the store's email
   setup (Microsoft 365 app + COO address) is used for approval emails. Everything still works without the link. */
const HUB_URL = String(process.env.HUB_URL || '').replace(/\/$/, '');
const HUB_SECRET = String(process.env.HUB_SECRET || '').trim();
const hubLinked = () => !!(HUB_URL && HUB_SECRET);
const hubSign = obj => { const body = Buffer.from(JSON.stringify(obj)).toString('base64url'); return body + '.' + crypto.createHmac('sha256', HUB_SECRET).update(body).digest('base64url'); };
function hubVerify(token) {
  if (!HUB_SECRET) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || '')); if (!m) return null;
  const sig = crypto.createHmac('sha256', HUB_SECRET).update(m[1]).digest('base64url');
  if (sig.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2]))) return null;
  try { const o = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return o.exp && o.exp > Date.now() ? o : null; } catch (e) { return null; }
}
const hubAuth = (req, res, next) => { const t = /^Hub (.+)$/.exec(req.headers.authorization || ''); if (!HUB_SECRET || !t || !(hubVerify(t[1]) || {}).svc) return res.status(401).json({ error: 'Hub signature missing or wrong' }); next(); };
async function hubCall(pathname, opts = {}) {
  if (!hubLinked()) throw new Error('not linked');
  const r = await fetch(HUB_URL + pathname, Object.assign({ headers: Object.assign({ Authorization: 'Hub ' + hubSign({ svc: true, exp: Date.now() + 120000 }), 'Content-Type': 'application/json' }, opts.headers || {}), signal: AbortSignal.timeout(10000) }, opts));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('hub answered ' + r.status));
  return j;
}
// people from the store: cached a minute; reps get a plan row + a PIN record here so the rest of the app treats them as its own
let hubPeople = { at: 0, list: [], ok: false };
async function syncPeople(force) {
  if (!hubLinked()) return hubPeople.list;
  if (!force && Date.now() - hubPeople.at < 60000) return hubPeople.list;
  let people;
  try { people = (await hubCall('/api/hub/people')).people || []; } catch (e) { console.error('Hub people sync: ' + e.message); hubPeople.at = Date.now() - 30000; hubPeople.ok = false; return hubPeople.list; } // retry in 30 s, don't hang every login meanwhile
  hubPeople = { at: Date.now(), list: people, ok: true };
  const p = pins(), rows = quotaRows().slice(); let pinsChanged = false, rowsChanged = false;
  for (const u of people.filter(x => x.role === 'rep')) {
    const name = String(u.name || '').trim(); if (!name) continue;
    const lower = name.toLowerCase();
    let key = Object.keys(p.reps).find(k => p.reps[k].hub === u.id) || Object.keys(p.reps).find(k => k.trim().toLowerCase() === lower);
    if (key && key !== name) { // renamed in the store (or different capitalisation): follow it everywhere
      p.reps[name] = p.reps[key]; delete p.reps[key]; pinsChanged = true;
      rows.forEach(r => { if (r.rep === key) r.rep = name; }); rowsChanged = true;
      for (const [k, d] of [...docs]) if (/^(cases|visits|targets|coonotes)\//.test(k) && d && d.rep === key) { docs.set(k, Object.assign({}, d, { rep: name })); persist(k); }
      key = name;
    }
    const cur = p.reps[name], storeActive = u.active !== false;
    if (!cur) { p.reps[name] = { pin: '', v: 1, active: storeActive, hubActive: storeActive, hub: u.id, email: u.email }; pinsChanged = true; }
    else {
      const changes = {};
      if (cur.hub !== u.id) changes.hub = u.id;
      if (cur.email !== u.email) changes.email = u.email;
      if (cur.hubActive !== storeActive) { changes.hubActive = storeActive; changes.active = storeActive; } // only a store-side change flips access
      if (Object.keys(changes).length) { Object.assign(cur, changes); pinsChanged = true; }
    }
    if (!rows.some(r => r.rep === name && r.role !== 'Team')) { rows.push({ rep: name, role: 'Sales Rep', territory: name, metric: 'Revenue', quota: null, counts: 'All', product_filter: '', carry: false, draw: null, comm_rate: null, comm_floor: 0, pay_kind: '', pay_amount: null, hub: u.id }); rowsChanged = true; }
  }
  // a rep whose Case tracker box was unticked in the store is switched off here (their records stay)
  for (const [name, rec] of Object.entries(p.reps)) if (rec.hub && rec.hubActive !== false && !people.some(u => u.role === 'rep' && u.id === rec.hub && u.active !== false)) { rec.active = false; rec.hubActive = false; pinsChanged = true; }
  // Team logins is the roster: a rep deleted there (or an old tracker-only rep with no login) leaves the tracker's rep list.
  // Their cases, visits and notes stay on record. Skipped if the store sent nobody (a bad sync must never empty the list).
  if (people.length) {
    // a person with a login who sells under a plan stays too, even if their login is an admin/manager (e.g. an operations director with a quota)
    const live = new Set(people.filter(u => u.role === 'rep').map(u => u.id)), names = new Set(people.filter(u => u.active !== false).map(u => String(u.name || '').trim().toLowerCase()));
    const gone = (name, rec) => rec && rec.hub ? !live.has(rec.hub) : !names.has(String(name).trim().toLowerCase());
    const PLAN = ['role', 'territory', 'metric', 'quota', 'counts', 'product_filter', 'carry', 'draw', 'comm_rate', 'comm_floor', 'pay_kind', 'pay_amount', 'sim_quota'];
    for (const r of rows.filter(x => x.role !== 'Team' && gone(x.rep, p.reps[x.rep]))) { // an old plan carries over to the same person's login when that row has none yet
      const first = String(r.rep).trim().toLowerCase();
      const to = rows.find(x => x !== r && x.role !== 'Team' && !gone(x.rep, p.reps[x.rep]) && x.comm_rate == null && !x.quota && String(x.rep).trim().toLowerCase().split(/\s+/)[0] === first);
      if (to && r.comm_rate != null) { PLAN.forEach(k => { if (k === 'territory') return; to[k] = r[k]; }); rowsChanged = true; }
    }
    for (const name of Object.keys(p.reps)) if (gone(name, p.reps[name])) { delete p.reps[name]; pinsChanged = true; }
    const keep = rows.filter(x => x.role === 'Team' || !gone(x.rep, p.reps[x.rep]));
    if (keep.length !== rows.length) { rows.length = 0; rows.push(...keep); rowsChanged = true; }
  }
  if (pinsChanged) await put('_auth/pins', p);
  if (rowsChanged) await put('config/quotas', Object.assign({}, docs.get('config/quotas') || {}, { rows }));
  return people;
}
const hubPerson = (name) => hubPeople.list.find(u => u.role === 'rep' && String(u.name).trim().toLowerCase() === String(name).trim().toLowerCase());
// single sign-on landing: the store hands a signed 2-minute token with who this is
app.get(['/sso', '/admin/sso'], async (req, res) => { // /admin/sso keeps the installed Admin app inside its scope
  const t = hubVerify(req.query.t);
  const next = /^\/(?![\/\\])[A-Za-z0-9/_#?=&%.-]*$/.test(String(req.query.next || '')) ? String(req.query.next) : '/';
  if (!t || !t.sso) return res.redirect('/login?next=' + encodeURIComponent(next) + '&err=sso');
  await syncPeople(true).catch(() => {});
  const dev = /iPhone|iPad|Android|Mobile/i.test(req.headers['user-agent'] || '') ? 'phone' : 'computer';
  if (!t.apps || !t.apps.tracker) return res.redirect('/login?err=noaccess');
  if (t.role === 'owner' || t.role === 'staff') { setSession(res, { role: 'owner', hub: t.email, hubId: t.id, hubName: t.name, hubStaff: t.role === 'staff', v: adminV() }, dev); return res.redirect(next); } // '/' = the tracker (COO view), '/admin' = Admin
  const name = String(t.name || '').trim();
  if (!t.apps || !t.apps.tracker || !pins().reps[name]) return res.redirect('/login?err=noaccess');
  setSession(res, { role: 'rep', rep: name, hub: t.email, v: pins().reps[name].v }, dev);
  res.redirect(next.startsWith('/admin') ? '/' : next);
});
// what the store asks this app for
app.get('/api/hub/reps', hubAuth, (req, res) => {
  const p = pins().reps;
  res.json({ reps: quotaRows().filter(r => r.role !== 'Team').map(r => ({ rep: r.rep, role: r.role, pin: p[r.rep] ? String(p[r.rep].pin || '') : '', active: !(p[r.rep] && p[r.rep].active === false), hub: p[r.rep] ? p[r.rep].hub || null : null })) });
});
// Surgical commission per rep for a month (same plan math as the tracker's scorecard): rate × (sales − floor), the floor rises by any
// carried shortfall; quarter to date, month-end at today's pace, estimated pay (draw/base + commission) and the cases behind it.
function surgicalComm(r, ym, cases) {
  const actual = rowActual(r, ym, cases), target = rowTarget(r, ym, cases), carried = r.carry && target && r.quota ? target - r.quota : 0;
  const rate = Number(r.comm_rate) || 0, floorBase = Number(r.comm_floor) || 0, floor = floorBase + (rate ? carried : 0);
  const commission = rate ? Math.round(Math.max(0, actual - floor) * rate) : 0;
  const today = chiDate(), days = bizDays(ym), elapsed = days.filter((d) => d <= today).length;
  const projected = ym === today.slice(0, 7) && elapsed ? Math.round(actual / elapsed * days.length) : ym < today.slice(0, 7) ? Math.round(actual) : null;
  const comm_proj = rate && projected != null ? Math.round(Math.max(0, projected - floor) * rate) : null;
  return { actual, target, carried, rate, floorBase, floor, commission, projected, comm_proj };
}
app.get('/api/hub/commissions', hubAuth, (req, res) => {
  const ym = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : chiDate().slice(0, 7);
  const cases = allCases(), [y, m] = ym.split('-').map(Number), q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const pp = pins().reps;
  const reps = quotaRows().filter(r => r.role !== 'Team' && (!pp[r.rep] || pp[r.rep].active !== false)).map(r => {
    const c = surgicalComm(r, ym, cases);
    let qtd = 0; for (let mm = q0; mm <= m; mm++) qtd += surgicalComm(r, y + '-' + String(mm).padStart(2, '0'), cases).commission;
    const mine = cases.filter(x => x.rep === r.rep && x.date.slice(0, 7) === ym && String(x.status || '').toLowerCase() !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date));
    const counts = (x) => isDone(x.status) && (r.counts === 'New only' ? x.surgeon_type === 'New' : r.counts === 'Legacy only' ? x.surgeon_type === 'Legacy' : true) && prodMatch(r.product_filter, x.product);
    const payKind = r.pay_kind === 'draw' ? 'Draw' : r.pay_kind === 'salary' ? 'Base salary' : r.draw && !r.pay_kind ? 'Draw' : '', pay = Number(r.pay_amount) || Number(r.draw) || null;
    return { rep: r.rep, role: r.role, metric: r.metric, counts: r.counts || 'All', product_filter: r.product_filter || '', actual: Math.round(c.actual), quota: r.quota, target: c.target, carried: c.carried,
      cases: mine.filter(isDoneCase).length, comm_rate: Math.round(c.rate * 10000) / 100, comm_floor_base: c.floorBase, comm_floor: c.floor, commission: c.commission, projected: c.projected, comm_proj: c.comm_proj, comm_qtd: qtd,
      pay_type: payKind, pay_amount: pay, est_pay: pay || c.rate ? (pay || 0) + c.commission : null, hub: (pins().reps[r.rep] || {}).hub || null,
      case_list: mine.slice(0, 200).map(x => ({ date: x.date, surgeon: x.surgeon || '', facility: x.facility || '', product: x.product || '', units: x.units || null, net_sales: Math.round(x.net_sales || 0), status: x.status || '', surgeon_type: x.surgeon_type || '', counts: counts(x) })) };
  });
  res.json({ month: ym, quarter: 'Q' + Math.ceil(m / 3), reps, total: reps.reduce((t, r) => t + r.commission, 0), sales: reps.reduce((t, r) => t + (r.metric === 'Cases' ? 0 : r.actual), 0) });
});
const isDoneCase = (x) => isDone(x.status);
app.post('/api/hub/sync', hubAuth, async (req, res) => { await syncPeople(true).catch(() => {}); res.json({ ok: true, people: hubPeople.list.length }); });
// the hub's Setup page: approval emails on/off for this app, a test send, and previews
app.get('/api/hub/settings', hubAuth, async (req, res) => { await refreshHubMail(); const c = mailCfg(); res.json({ mailOn: c.on !== false, info: mail.info(c), to: c.to || '', viaHub: !!c.viaHub, publicUrl: process.env.PUBLIC_URL || '' }); });
app.put('/api/hub/settings', hubAuth, async (req, res) => {
  const b = req.body || {}, prev = docs.get('config/mail') || {};
  if (b.mailOn !== undefined) await put('config/mail', Object.assign({}, prev, { on: !!b.mailOn, updated_at: new Date().toISOString() }));
  res.json({ ok: true, mailOn: (docs.get('config/mail') || {}).on !== false });
});
app.post('/api/hub/mail-test', hubAuth, async (req, res) => {
  const sample = { name: 'Valley Baptist Medical Center', address: '2101 Pease St, Harlingen, TX 78550', map_label: '2101 Pease St, Harlingen, TX 78550', lat: 26.1836, lng: -97.7118, created_at: new Date().toISOString() };
  const r = await emailApproval('facility', 'test', sample, String((req.body || {}).by || 'Admin') + ' (test)', process.env.PUBLIC_URL || HUB_URL);
  if (!r.ok) return res.status(400).json({ error: r.error === 'off' ? 'Approval emails are turned off.' : r.error });
  res.json({ ok: true, to: mailCfg().to || '' });
});
// email previews for the hub's Setup page: the link carries a short signed token instead of a tracker session
app.get('/hub/mail-preview', (req, res) => {
  const t = hubVerify(req.query.t); if (!t || !t.preview) return res.status(401).type('text').send('This preview link has expired. Open it again from the Setup page.');
  const kind = req.query.kind === 'surgeon' ? 'surgeon' : 'facility';
  const sample = kind === 'facility' ? { name: 'Valley Baptist Medical Center', address: '2101 Pease St, Harlingen, TX 78550', map_label: '2101 Pease St, Harlingen, TX 78550', lat: 26.1836, lng: -97.7118, created_at: new Date().toISOString() }
    : { name: 'Dr. Maria Salinas', specialty: 'Orthopedic surgery', facility: 'Valley Baptist Medical Center', created_at: new Date().toISOString() };
  res.type('html').send(approvalEmail({ kind, doc: sample, id: 'preview', by: 'Brandon', base: baseUrl(req) }).html);
});
// the other direction: someone signed in here goes to the store's admin pages (Team logins, Setup, Apps, My account) with this login
// the switch, kept inside this app's own address: a full-window frame of the store admin / rep app (signed in through the frame)
app.get(['/store', '/admin/store'], (req, res) => {
  const next = /^\/(?![\/\\])[A-Za-z0-9/_#?=&%.-]*$/.test(String(req.query.next || '')) ? String(req.query.next) : '/admin';
  if (!hubLinked()) return res.redirect('/');
  const s = session(req); if (!s) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  let email = s.hub || '';
  if (!email && s.role === 'owner' && s.mgr) email = (mgrs()[s.mgr] || {}).email || '';
  if (!email && s.role === 'rep') email = ((pins().reps[s.rep] || {}).email) || (repAcct(s.rep) || {}).email || '';
  const token = hubSign({ sso: true, email, name: whoName(s), role: s.role === 'owner' ? (s.hubStaff || s.mgr ? 'staff' : 'owner') : 'rep', coo: s.role === 'owner' && !s.hub && !s.mgr && !s.hubStaff, exp: Date.now() + 120000 });
  const src = HUB_URL + (next.startsWith('/rep') ? '/rep/sso' : next.startsWith('/admin') ? '/admin/sso' : '/sso') + '?t=' + encodeURIComponent(token) + '&next=' + encodeURIComponent(next) + '&framed=1';
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>360 Peptides</title>
<link rel="manifest" href="${req.path.startsWith('/admin') ? '/admin.webmanifest' : '/manifest.webmanifest'}"><meta name="theme-color" content="#0f1b33">
<style>html,body{margin:0;height:100%;background:#0f1b33}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe src="${esc(src)}" title="Peptide store" allow="camera"></iframe></body></html>`);
});
app.get(['/go/store', '/admin/go/store'], (req, res) => {
  const next = /^\/(?![\/\\])[A-Za-z0-9/_#?=&%.-]*$/.test(String(req.query.next || '')) ? String(req.query.next) : '/admin';
  if (!hubLinked()) return res.redirect(HUB_URL ? HUB_URL + next : '/');
  const s = session(req); if (!s) return res.redirect('/login?next=' + encodeURIComponent('/go/store?next=' + next));
  let email = s.hub || '';
  if (!email && s.role === 'owner' && s.mgr) email = (mgrs()[s.mgr] || {}).email || '';
  if (!email && s.role === 'rep') email = ((pins().reps[s.rep] || {}).email) || (repAcct(s.rep) || {}).email || '';
  const token = hubSign({ sso: true, email, name: whoName(s), role: s.role === 'owner' ? (s.hubStaff || s.mgr ? 'staff' : 'owner') : 'rep', coo: s.role === 'owner' && !s.hub && !s.mgr && !s.hubStaff, exp: Date.now() + 120000 });
  res.redirect(HUB_URL + (next.startsWith('/rep') ? '/rep/sso' : next.startsWith('/admin') ? '/admin/sso' : '/sso') + '?t=' + encodeURIComponent(token) + '&next=' + encodeURIComponent(next));
});
app.get('/api/hub/ping', hubAuth, (req, res) => res.json({ ok: true, app: 'case-tracker' }));
// the store's Team logins removing a tracker-only rep (one that was never a store login): row + PIN go, their logged cases stay
app.post('/api/hub/rep-remove', hubAuth, async (req, res) => {
  const rep = String((req.body || {}).rep || '').trim(); if (!rep) return res.status(400).json({ error: 'Which rep?' });
  const p = JSON.parse(JSON.stringify(pins()));
  if (p.reps[rep] && p.reps[rep].hub) return res.status(400).json({ error: rep + ' is a store login — delete it under Team logins.' });
  const rows = quotaRows().filter(r => !(r.rep === rep && r.role !== 'Team'));
  if (rows.length === quotaRows().length && !p.reps[rep]) return res.status(404).json({ error: 'No such rep in the tracker.' });
  delete p.reps[rep];
  await put('config/quotas', Object.assign({}, docs.get('config/quotas') || {}, { rows, updated_at: new Date().toISOString() }));
  await put('_auth/pins', p);
  res.json({ ok: true });
});
app.get('/api/login-options', async (req, res) => {
  await syncPeople().catch(() => {});
  const p = pins().reps;
  // admins and managers from the store (Team logins) sign in here by name + their PIN too
  const admins = hubLinked() ? hubPeople.list.filter(u => u.role !== 'rep' && u.active !== false && u.apps && u.apps.tracker).map((u, i, all) => ({ id: u.id, name: all.some(o => o !== u && String(o.name).trim().toLowerCase() === String(u.name).trim().toLowerCase()) ? `${u.name} (${u.email})` : u.name, role: u.role === 'owner' ? 'Admin' : 'Manager' })) : [];
  res.json({ reps: quotaRows().filter(r => r.role !== 'Team' && p[r.rep] && p[r.rep].active !== false && !repAcct(r.rep)).map(r => r.rep), admins, pin_login: !pinOff(), managers: Object.values(mgrs()).some(m => m.active !== false && m.totp_on), hub: hubLinked() ? HUB_URL : '' });
});
app.post('/api/login', async (req, res) => {
  await syncPeople().catch(() => {});
  const t = throttled(req.ip);
  if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const who = String(req.body.who || ''), pin = String(req.body.pin || '').trim();
  if (who === '__owner__') {
    if (pinOff()) return res.status(403).json({ error: 'The COO PIN sign-in is turned off. Sign in with your manager account.' });
    if (pin && pin === adminPin()) { tries.delete(req.ip); setSession(res, { role: 'owner', v: adminV() }, req.body.dev); return res.json({ ok: true, role: 'owner' }); }
  } else if (/^hub:\d+$/.test(who)) {
    // an admin / manager from the store, by their store PIN
    const id = Number(who.slice(4)), u = hubPeople.list.find(x => x.id === id && x.role !== 'rep' && x.active !== false);
    if (u && pin && hubLinked()) {
      try { const r = await hubCall('/api/hub/check-pin', { method: 'POST', body: JSON.stringify({ id, pin }) }); if (r.ok) { tries.delete(req.ip); setSession(res, { role: 'owner', hub: u.email, hubId: u.id, hubName: u.name, hubStaff: u.role !== 'owner', v: adminV() }, req.body.dev); return res.json({ ok: true, role: 'owner' }); } } catch (e) {}
    }
  } else {
    const p = pins().reps[who];
    if (repAcct(who)) return res.status(403).json({ error: who + ' signs in with email now. Use the Email sign-in tab.' });
    if (p && p.active !== false && pin && p.pin && pin === String(p.pin) && quotaRows().some(r => r.rep === who)) { tries.delete(req.ip); setSession(res, { role: 'rep', rep: who, v: p.v }, req.body.dev); return res.json({ ok: true, role: 'rep' }); }
    // the one PIN from the store: checked there
    if (p && p.active !== false && p.hub && pin && hubLinked()) {
      try { const r = await hubCall('/api/hub/check-pin', { method: 'POST', body: JSON.stringify({ id: p.hub, pin }) }); if (r.ok) { tries.delete(req.ip); setSession(res, { role: 'rep', rep: who, hub: r.user && r.user.email, v: p.v }, req.body.dev); return res.json({ ok: true, role: 'rep' }); } } catch (e) {}
    }
  }
  t.n++;
  res.status(401).json({ error: 'Wrong PIN.' });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', `sct_session=; Path=/; HttpOnly; ${COOKIE_ATTRS()}; Max-Age=0`); res.json({ ok: true }); });

const needApi = role => (req, res, next) => {
  const s = session(req); if (!s) return res.status(401).json({ error: 'Sign in again.' });
  if (role === 'owner' && s.role !== 'owner') return res.status(403).json({ error: 'Admin only.' });
  if (role === 'super' && !isSuper(s)) return res.status(403).json({ error: 'Only the account owner can manage managers.' });
  if (req.method !== 'GET' && s.sid) lastActive.set(s.sid, Date.now());
  markSeen(s); req.s = s; next();
};

// can this person use the peptide store? (reps: their Team logins row; store managers: theirs; the COO PIN: yes, as the store's admin)
const storeOk = (s) => { if (!hubLinked()) return false; if (s.role === 'rep') { const u = hubPerson(s.rep); return !!(u && u.apps && u.apps.store !== false); } if (s.hubStaff || s.hub) { const u = hubPeople.list.find(x => x.id === s.hubId); return !u || !u.apps || u.apps.store !== false; } return !s.mgr; };
app.get('/api/me', needApi(), (req, res) => res.json({ hub: hubLinked() && storeOk(req.s) ? HUB_URL : '', hubStaff: !!req.s.hubStaff, viaHub: !!req.s.hub, role: req.s.role, rep: req.s.rep || null, uid: uidOf(req.s), db: dbMode, name: whoName(req.s), manager: !!req.s.mgr, account: !!(req.s.mgr || req.s.acct), super: isSuper(req.s), dev: req.s.dev || 'computer', idle_min: req.s.dev === 'computer' ? IDLE_MS / 60e3 : null }));
app.post('/api/activity', needApi(), (req, res) => res.json({ ok: true }));
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
      if (col === 'cases' && next) { // the invoice only changes through submit / review; reps reach Invoiced or Paid only once the COO approves the invoice
        if (prev && prev.invoice) next.invoice = prev.invoice; else delete next.invoice;
        const ok = next.invoice && next.invoice.status === 'approved';
        if (s.role !== 'owner' && ['Invoiced', 'Paid'].includes(next.status) && !ok && (!prev || prev.status !== next.status)) return res.status(409).json({ code: 'failed_precondition', error: 'Add the invoice to this case. It moves to Invoiced once the COO approves it.' });
      }
      if (col === 'cases') {
        const lock = closedMonth(prev && prev.date) || closedMonth(next && next.date);
        if (lock) return res.status(423).json({ code: 'failed_precondition', error: monthLabel(lock) + ' is closed. Ask the COO to reopen it to make changes.' });
      }
      if (op === 'delete') { await del(p); } else await put(p, next);
      if (col === 'cases') await audit(parts[1], s, op, prev, next);
      if (col === 'visits' && next && !prev && s.role === 'owner' && next.rep && next.status === 'planned') notifyRep(next.rep, 'New visit assigned', 'The COO scheduled ' + (next.surgeon || 'a visit') + (next.facility ? ' at ' + next.facility : '') + ' on ' + next.date + (next.time ? ' at ' + next.time : '') + '.').catch(() => {});
      if (next && !prev && ['targets', 'prefcards', 'credentials', 'visits'].includes(col)) {
        if (next.facility) await ensureFacility(next.facility, '', s);
        if (next.surgeon && col !== 'visits' && col !== 'credentials') await ensureSurgeon(next.surgeon, next.facility || '', '', s);
      }
      return res.json(next ? { ok: true, data: next } : { ok: true });
    }
    if (SHARED_CONFIG.includes(p) && s.role === 'owner' && op !== 'delete') {
      await put(p, Object.assign(clean(req.body.data), { updated_at: new Date().toISOString() })); return res.json({ ok: true });
    }
    if (p === 'config/quotas' && s.role === 'owner' && op !== 'delete') {
      const d = clean(req.body.data); const rows = Array.isArray(d.rows) ? d.rows.map(clean) : quotaRows();
      const pp = pins().reps; quotaRows().forEach(r => { if (r.role !== 'Team' && (pp[r.rep] || {}).active === false && !rows.some(x => x.rep === r.rep)) rows.push(r); }); // inactive reps aren't sent to the COO's screen: keep their rows
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
app.get('/api/admin/state', needApi('owner'), async (req, res) => {
  await syncPeople().catch(() => {});
  const p = pins().reps, counts = {};
  for (const [k, d] of docs) { const c = k.split('/')[0]; if (COLS.includes(c)) { const r = d.rep || '(none)'; counts[r] = counts[r] || { cases: 0, targets: 0, simlab: 0, visits: 0, prefcards: 0, credentials: 0, last: '' }; counts[r][c]++; if (c === 'cases' && (d.date || '') > counts[r].last) counts[r].last = d.date || ''; } }
  res.json({ linked: hubLinked(), rows: quotaRows().map(r => { const ac = Object.values(mgrs()).find(a => a.kind === 'rep' && a.rep === r.rep); return Object.assign({}, r, { hub: (p[r.rep] && p[r.rep].hub) || r.hub || null, pin: p[r.rep] ? p[r.rep].pin : null, active: p[r.rep] ? p[r.rep].active !== false : r.role === 'Team' ? null : false, account: ac ? (ac.totp_on ? 'active' : 'pending') : null }); }), counts, db: dbMode, adminPinIsDefault: !docs.has('_auth/admin') && !process.env.ADMIN_PIN, url: (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`) });
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
  // reps that come from the store's Team logins can't be dropped here: their row (quota, plan) and PIN record stay, or the next sync would re-add them blank
  if (hubLinked()) for (const old of quotaRows()) if (old.role !== 'Team' && p.reps[old.rep] && p.reps[old.rep].hub && p.reps[old.rep].hubActive !== false && !rows.some(r => r.rep === old.rep)) rows.push(old);
  rows.filter(r => r.role !== 'Team').forEach(r => { if (!p.reps[r.rep]) p.reps[r.rep] = { pin: pin6(), v: 1, active: true }; });
  inRows.forEach(r => { const rep = String(r.rep || '').trim(); if (p.reps[rep] && typeof r.active === 'boolean' && p.reps[rep].active !== r.active && !(hubLinked() && p.reps[rep].hub)) { p.reps[rep].active = r.active; p.reps[rep].v++; } });
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
  const am = Object.assign({}, mgrs()); let amc = false; Object.keys(am).forEach(k => { if (am[k].kind === 'rep' && am[k].rep === from) { am[k] = Object.assign({}, am[k], { rep: to }); amc = true; } }); if (amc) await saveMgrs(am);
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
app.post('/api/admin/admin-pin', needApi('super'), async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,10}$/.test(pin)) return res.status(400).json({ error: 'Admin PIN must be 4 to 10 digits.' });
  const v = adminV() + 1;
  await put('_auth/admin', Object.assign({}, docs.get('_auth/admin') || {}, { pin, v }));
  if (!req.s.mgr) setSession(res, { role: 'owner', v }, req.s.dev);
  res.json({ ok: true });
});
/* ---------------- historical case import (COO) ----------------
   Rows come from a spreadsheet the admin page has already parsed and mapped to our fields. A dry run reports what would happen;
   the real run writes the cases (closed months included — this is the COO loading history) and tags them with a batch id so the
   whole batch can be undone. Duplicates (same date, rep, surgeon, product and amount) are skipped. */
const IMP_STATUS = { scheduled: 'Scheduled', completed: 'Completed', complete: 'Completed', done: 'Completed', 'po received': 'PO received', po: 'PO received', invoiced: 'Invoiced', billed: 'Invoiced', paid: 'Paid', closed: 'Paid', cancelled: 'Cancelled', canceled: 'Cancelled' };
function impDate(v) {
  const t = String(v == null ? '' : v).trim(); if (!t) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t)) { const [y, m, d] = t.slice(0, 10).split('-').map(Number); return okDate(y, m, d); }
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return okDate(y, +m[1], +m[2]); }
  if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 864e5); return d.toISOString().slice(0, 10); } // Excel serial day
  const d = new Date(t); return isNaN(d) ? null : d.toISOString().slice(0, 10);
  function okDate(y, mo, da) { const d = new Date(Date.UTC(y, mo - 1, da)); return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && y > 1990 && y < 2100 ? d.toISOString().slice(0, 10) : null; }
}
const impMoney = (v) => { const t = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (t === '') return null; const neg = /^\(.*\)$/.test(t); const n = Number(t.replace(/[()]/g, '')); return isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : NaN; };
const impKey = (c) => [c.date, lcs(c.rep), lcs(c.surgeon), lcs(c.product), Math.round((Number(c.net_sales) || 0) * 100)].join('|');
app.post('/api/admin/import-cases', needApi('owner'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 20000) : [], dry = req.body?.dry !== false;
  const roster = quotaRows().filter((r) => r.role !== 'Team').map((r) => r.rep), aliases = req.body?.repMap && typeof req.body.repMap === 'object' ? req.body.repMap : {};
  const findRep = (n) => { const t = String(n || '').trim(); if (!t) return ''; if (aliases[t]) return String(aliases[t]); const l = t.toLowerCase();
    return roster.find((r) => r.toLowerCase() === l) || roster.find((r) => r.toLowerCase().split(/\s+/)[0] === l.split(/\s+/)[0] && (l.split(/\s+/).length === 1 || r.toLowerCase().split(/\s+/).slice(-1)[0] === l.split(/\s+/).slice(-1)[0])) || t; };
  // duplicates = already in the tracker (two identical rows in the same file are two cases, e.g. two units on one day); rows with an id from an export match by that id
  const seen = new Set(), seenSrc = new Set(); for (const [k, d] of docs) if (k.startsWith('cases/') && d && d.date) { seen.add(impKey(d)); if (d.src_id) seenSrc.add(d.src_id); }
  const batch = 'imp-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '-' + crypto.randomBytes(2).toString('hex');
  const out = { ok: 0, dup: 0, bad: 0, errors: [], unknownReps: {}, months: {}, sales: 0, sample: [] }, good = [];
  rows.forEach((r, i) => {
    const line = i + 2, why = [];
    const date = impDate(r.date); if (!date) why.push('date "' + String(r.date || '').slice(0, 20) + '" not understood');
    const rep = findRep(r.rep); if (!rep) why.push('no rep');
    const ns = impMoney(r.net_sales); if (Number.isNaN(ns)) why.push('amount "' + String(r.net_sales).slice(0, 20) + '" not a number');
    const units = r.units === undefined || r.units === null || String(r.units).trim() === '' ? 1 : Number(String(r.units).replace(/,/g, ''));
    if (!isFinite(units) || units < 0) why.push('units not a number');
    if (why.length) { out.bad++; if (out.errors.length < 50) out.errors.push({ line, why: why.join('; ') }); return; }
    const stRaw = String(r.status || '').trim().toLowerCase(), status = IMP_STATUS[stRaw] || (stRaw ? String(r.status).trim().slice(0, 30) : 'Completed');
    const ty = String(r.surgeon_type || '').trim().toLowerCase(), surgeon_type = /^l|^e/.test(ty) ? 'Legacy' : 'New';
    const c = { date, rep, surgeon: String(r.surgeon || '').trim().slice(0, 120), facility: String(r.facility || '').trim().slice(0, 160), service_line: String(r.service_line || '').trim().slice(0, 60),
      product: String(r.product || '').trim().slice(0, 160), units: units || 1, net_sales: ns, surgeon_type, status, po: String(r.po || '').trim().slice(0, 60), lot: String(r.lot || '').trim().slice(0, 60),
      notes: String(r.notes || '').trim().slice(0, 1000), time: '', created_by: uidOf(req.s), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), imported: batch };
    const src = String(r.src_id || r._id || '').trim().slice(0, 60); if (src) c.src_id = src;
    if (src ? seenSrc.has(src) : seen.has(impKey(c))) { out.dup++; return; } if (src) seenSrc.add(src);
    if (!roster.includes(rep)) out.unknownReps[rep] = (out.unknownReps[rep] || 0) + 1;
    out.ok++; out.sales += Number(ns) || 0; out.months[date.slice(0, 7)] = (out.months[date.slice(0, 7)] || 0) + 1; if (out.sample.length < 8) out.sample.push(c); good.push(c);
  });
  out.sales = Math.round(out.sales * 100) / 100;
  if (dry) return res.json(Object.assign({ dry: true }, out));
  for (const c of good) await put('cases/' + crypto.randomBytes(10).toString('hex'), c);
  const log = docs.get('config/imports') || { batches: [] };
  log.batches.unshift({ id: batch, at: new Date().toISOString(), by: whoName(req.s), cases: good.length, sales: out.sales, first: Object.keys(out.months).sort()[0] || '', last: Object.keys(out.months).sort().pop() || '', file: String(req.body?.file || '').slice(0, 120) });
  log.batches = log.batches.slice(0, 50); await put('config/imports', log);
  res.json(Object.assign({ dry: false, batch }, out));
});
app.get('/api/admin/import-cases', needApi('owner'), (req, res) => res.json({ batches: (docs.get('config/imports') || { batches: [] }).batches, roster: quotaRows().filter((r) => r.role !== 'Team').map((r) => r.rep) }));
app.delete('/api/admin/import-cases/:batch', needApi('owner'), async (req, res) => {
  const id = String(req.params.batch); let n = 0;
  for (const [k, d] of [...docs]) if (k.startsWith('cases/') && d && d.imported === id) { await del(k); n++; }
  const log = docs.get('config/imports') || { batches: [] }; log.batches = log.batches.map((b) => (b.id === id ? Object.assign({}, b, { undone: new Date().toISOString(), removed: n }) : b)); await put('config/imports', log);
  res.json({ ok: true, removed: n });
});
app.get('/api/admin/logins', needApi('owner'), (req, res) => {
  const log = docs.get('_log/logins') || { events: [], seen: {} }, now = Date.now(), seen = Object.assign({}, log.seen);
  for (const [k, t] of seenBy) seen[k] = new Date(Math.max(t, Date.parse(seen[k] || 0) || 0)).toISOString();
  const people = {};
  const add = (key, who, role) => people[key] || (people[key] = { key, who, role, last_login: null, last_seen: seen[key] || null, d7: 0, d30: 0, phone: 0, computer: 0, events: [] });
  quotaRows().filter((r) => r.role !== 'Team' && (pins().reps[r.rep] || {}).active !== false).forEach((r) => add('rep:' + r.rep, r.rep, 'Rep'));
  const offReps = new Set(Object.entries(pins().reps).filter(([, v]) => v.active === false).map(([k]) => 'rep:' + k)); // access off = hidden from reports
  for (const e of log.events) {
    if (offReps.has(e.key)) continue;
    const p = add(e.key, e.who, e.role), age = now - Date.parse(e.at);
    if (!p.last_login) p.last_login = e.at; if (age <= 7 * 864e5) p.d7++; if (age <= 30 * 864e5) { p.d30++; p[e.dev === 'phone' ? 'phone' : 'computer']++; }
    if (p.events.length < 25) p.events.push({ at: e.at, dev: e.dev, how: e.how });
  }
  res.json({ people: Object.values(people), since: log.events.length ? log.events[log.events.length - 1].at : null });
});
/* ---------------- admin dashboard: sales WTD / MTD against target, margin, rep activity ---------------- */
const costMap = () => { const m = {}; ((docs.get('config/costs') || {}).rows || []).forEach((r) => { if (r.product && r.cost != null) m[lcs(r.product)] = Number(r.cost); }); return m; };
app.get('/api/admin/costs', needApi('owner'), (req, res) => {
  const cm = costMap(), names = new Set();
  for (const [k, d] of docs) {
    if (k.startsWith('cases/') && d && d.product) names.add(String(d.product).trim());
    if (k.startsWith('products/') && d) (d.case_names && d.case_names.length ? d.case_names : [d.name]).forEach((n) => n && names.add(String(n).trim()));
  }
  ((docs.get('config/pricebook') || {}).rows || []).forEach((r) => r.product && names.add(String(r.product).trim()));
  const used = {}; for (const [k, d] of docs) if (k.startsWith('cases/') && d && d.product) used[lcs(d.product)] = (used[lcs(d.product)] || 0) + 1;
  const seen = new Set(), rows = [];
  [...names].sort((a, b) => (used[lcs(b)] || 0) - (used[lcs(a)] || 0) || a.localeCompare(b)).forEach((n) => { if (seen.has(lcs(n))) return; seen.add(lcs(n)); rows.push({ product: n, cost: cm[lcs(n)] ?? null, cases: used[lcs(n)] || 0 }); });
  res.json({ rows });
});
app.put('/api/admin/costs', needApi('owner'), async (req, res) => {
  const cur = costMap();
  (Array.isArray(req.body?.rows) ? req.body.rows : []).forEach((r) => { const k = lcs(r.product); if (!k) return; const c = r.cost === '' || r.cost == null ? null : Number(String(r.cost).replace(/[$,]/g, '')); if (c == null || !isFinite(c) || c < 0) delete cur[k]; else cur[k] = Math.round(c * 100) / 100; });
  const names = {}; (Array.isArray(req.body?.rows) ? req.body.rows : []).forEach((r) => { if (r.product) names[lcs(r.product)] = String(r.product).trim().slice(0, 160); });
  const prevRows = (docs.get('config/costs') || {}).rows || []; prevRows.forEach((r) => { if (!names[lcs(r.product)]) names[lcs(r.product)] = r.product; });
  await put('config/costs', { rows: Object.keys(cur).map((k) => ({ product: names[k] || k, cost: cur[k] })), updated_at: new Date().toISOString() });
  res.json({ ok: true });
});
app.get('/api/admin/dashboard', needApi('owner'), (req, res) => {
  const today = chiDate(), ym = today.slice(0, 7), wk = mondayOf(today), cases = allCases(), cm = costMap();
  const days = bizDays(ym), elapsed = days.filter((d) => d <= today).length, wkDays = days.filter((d) => d >= wk && d <= today).length;
  const log = docs.get('_log/logins') || { seen: {} }, seen = Object.assign({}, log.seen); for (const [k, t] of seenBy) seen[k] = new Date(Math.max(t, Date.parse(seen[k] || 0) || 0)).toISOString();
  const costOf = (c) => { const u = cm[lcs(c.product)]; return u == null ? null : u * (Number(c.units) || 1); };
  const pp = pins().reps, visits = [...docs].filter(([k]) => k.startsWith('visits/')).map(([, d]) => d);
  const reps = quotaRows().filter((r) => r.role !== 'Team' && (pp[r.rep] || {}).active !== false).map((r) => {
    const mine = cases.filter((c) => c.rep === r.rep && isDone(c.status));
    const mtd = mine.filter((c) => c.date.slice(0, 7) === ym && c.date <= today), wtd = mtd.filter((c) => c.date >= wk);
    const sum = (l) => l.reduce((t, c) => t + (Number(c.net_sales) || 0), 0);
    const target = rowTarget(r, ym, cases), actual = rowActual(r, ym, cases);
    const costed = mtd.filter((c) => costOf(c) != null), cost = costed.reduce((t, c) => t + costOf(c), 0), costedSales = sum(costed);
    const wkV = visits.filter((v) => v.rep === r.rep && v.date >= wk && v.date <= today);
    const wcu = docs.get(wcuKey(r.rep, wk));
    const last = mine.concat(cases.filter((c) => c.rep === r.rep && !isDone(c.status))).map((c) => c.date).filter((d) => d <= today).sort().pop() || null;
    return { rep: r.rep, metric: r.metric, counts: r.counts || 'All', wtd: Math.round(sum(wtd)), mtd: Math.round(sum(mtd)), wtd_count: rowActual(Object.assign({}, r, { metric: 'Cases' }), ym, cases.filter((c) => c.date >= wk)), quota_actual: Math.round(actual), target, wtd_target: target ? Math.round(target * wkDays / days.length) : null,
      pace: target ? Math.round(target * elapsed / days.length) : null, projected: elapsed ? Math.round(actual / elapsed * days.length) : 0,
      cases_wtd: wtd.length, cases_mtd: mtd.length, cost: Math.round(cost), costed_sales: Math.round(costedSales), uncosted: mtd.length - costed.length,
      visits_wtd: wkV.filter((v) => v.status !== 'planned' && v.status !== 'cancelled').length, visits_planned: wkV.filter((v) => v.status === 'planned').length,
      wcu: wcu && wcu.status === 'sent' ? (wcu.late ? 'late' : 'sent') : (Date.now() > wcuDueAt(wk).getTime() ? 'missing' : 'due'),
      last_case: last, last_active: seen['rep:' + r.rep] || null };
  });
  const T = (k) => reps.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  // company target: Team quotas, plus the dollar targets of reps whose territory has no Team quota (case-count targets aren't dollars)
  const teams = quotaRows().filter((r) => r.role === 'Team' && r.metric !== 'Cases' && r.quota), teamTerr = new Set(teams.map((r) => lcs(r.territory)));
  const coTarget = teams.reduce((t, r) => t + (rowTarget(r, ym, cases) || 0), 0) + reps.filter((r) => r.metric !== 'Cases' && !teamTerr.has(lcs((quotaRows().find((q) => q.rep === r.rep) || {}).territory))).reduce((t, r) => t + (r.target || 0), 0);
  const allMtd = cases.filter((c) => isDone(c.status) && c.date.slice(0, 7) === ym && c.date <= today);
  const feed = [];
  cases.filter((c) => c.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12).forEach((c) => feed.push({ at: c.created_at, rep: c.rep, what: 'Logged a case' + (c.surgeon ? ' · ' + c.surgeon : '') + (c.net_sales ? ' · ' + fmt$(c.net_sales) : '') }));
  visits.filter((v) => v.check && v.check.at).sort((a, b) => String(b.check.at).localeCompare(String(a.check.at))).slice(0, 10).forEach((v) => feed.push({ at: v.check.at, rep: v.rep, what: (v.check.ok ? 'Checked in' : 'Check-in not verified') + ' · ' + (v.surgeon || '') + (v.facility ? ' @ ' + v.facility : '') }));
  cases.filter((c) => c.invoice && c.invoice.submitted_at).forEach((c) => feed.push({ at: c.invoice.submitted_at, rep: c.rep, what: 'Invoice ' + c.invoice.number + ' · ' + fmt$(c.invoice.amount) + ' (' + c.invoice.status + ')' }));
  (log.events || []).slice(0, 10).filter((e) => e.role === 'Rep').forEach((e) => feed.push({ at: e.at, rep: e.who, what: 'Signed in · ' + (e.dev === 'phone' ? 'phone' : 'computer') }));
  { const off = new Set(Object.keys(pp).filter((k) => pp[k].active === false)); for (let i = feed.length - 1; i >= 0; i--) if (off.has(feed[i].rep)) feed.splice(i, 1); } // access off = hidden from reports
  feed.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const pendingInv = cases.filter((c) => c.invoice && c.invoice.status === 'pending').length;
  const approvals = { invoices: cases.filter((c) => c.invoice && c.invoice.status === 'pending').map((c) => ({ rep: c.rep, number: c.invoice.number, amount: c.invoice.amount, at: c.invoice.submitted_at })),
    facilities: [...docs].filter(([k, d]) => k.startsWith('facilities/') && d && d.approved === false).map(([, d]) => ({ name: d.name, by: d.added_by || '', address: d.address || '' })),
    surgeons: [...docs].filter(([k, d]) => k.startsWith('surgeons/') && d && d.approved === false).map(([, d]) => ({ name: d.name, by: d.added_by || '', facility: d.facility || '' })) };
  res.json({ today, week: wk, month: ym, biz: { elapsed, total: days.length, week: wkDays }, reps,
    totals: { wtd: T('wtd'), mtd: Math.round(allMtd.reduce((t, c) => t + (Number(c.net_sales) || 0), 0)), target: coTarget, wtd_target: coTarget ? Math.round(coTarget * wkDays / days.length) : 0, pace: coTarget ? Math.round(coTarget * elapsed / days.length) : 0, projected: T('projected'), cases_mtd: allMtd.length, cases_wtd: T('cases_wtd'),
      cost: T('cost'), costed_sales: T('costed_sales'), uncosted: T('uncosted'), visits_wtd: T('visits_wtd') },
    pending_invoices: pendingInv, approvals, feed: feed.slice(0, 20) });
});
// Executive sales summary (admin Dashboard, live): company KPIs, rep ranking and performance cards, team total, product mix from invoices,
// what needs attention, and compensation estimates. Same figures as the one-page Team View PDF.
app.get('/api/admin/exec', needApi('owner'), (req, res) => {
  const today = chiDate(), ym = today.slice(0, 7), [Y, M] = ym.split('-').map(Number), q0 = Math.floor((M - 1) / 3) * 3 + 1, qn = Math.ceil(M / 3);
  const qMonths = [0, 1, 2].map((i) => Y + '-' + String(q0 + i).padStart(2, '0')), qStart = qMonths[0] + '-01';
  const cases = allCases(), done = cases.filter((c) => isDone(c.status) && c.date <= today), pp = pins().reps;
  const days = bizDays(ym), elapsed = days.filter((d) => d <= today).length, left = days.length - elapsed;
  const sum = (l) => l.reduce((t, c) => t + (Number(c.net_sales) || 0), 0);
  const sKey = (v) => lcs(v).replace(/^dr\.?\s*/, '').replace(/[^a-z]/g, '');
  const mon = done.filter((c) => c.date.slice(0, 7) === ym), qtr = done.filter((c) => c.date >= qStart && qMonths.includes(c.date.slice(0, 7)));
  const isNew = (c) => c.surgeon_type === 'New';
  const newWon = (list) => new Set(list.filter((c) => isNew(c) && c.surgeon).map((c) => c.rep + '|' + sKey(c.surgeon))).size;
  const targets = [...docs].filter(([k, d]) => k.startsWith('targets/') && d && d.rep && d.surgeon).map(([, d]) => d);
  const tWon = (t) => done.some((c) => c.rep === t.rep && sKey(c.surgeon) === sKey(t.surgeon));
  const rowsQ = quotaRows(), reps0 = rowsQ.filter((r) => r.role !== 'Team' && (pp[r.rep] || {}).active !== false);
  const teams = rowsQ.filter((r) => r.role === 'Team' && r.metric !== 'Cases' && r.quota), teamTerr = new Set(teams.map((r) => lcs(r.territory)));
  const dollarReps = reps0.filter((r) => r.metric !== 'Cases' && !teamTerr.has(lcs(r.territory)));
  const coTarget = teams.reduce((t, r) => t + (rowTarget(r, ym, cases) || 0), 0) + dollarReps.reduce((t, r) => t + (rowTarget(r, ym, cases) || 0), 0);
  const coBase = teams.reduce((t, r) => t + (Number(r.quota) || 0), 0) + dollarReps.reduce((t, r) => t + (Number(r.quota) || 0), 0);
  const top = (list, f) => { const m = {}; list.forEach((c) => { const k = f(c); if (k) m[k] = (m[k] || 0) + 1; }); const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return e ? { name: e[0], n: e[1] } : null; };
  const runRate = (a) => (elapsed ? Math.round(a / elapsed * days.length) : 0);
  const reps = reps0.map((r) => {
    const mine = mon.filter((c) => c.rep === r.rep), mineQ = qtr.filter((c) => c.rep === r.rep), cnt = r.metric === 'Cases';
    const actual = rowActual(r, ym, cases), target = rowTarget(r, ym, cases);
    let qtd = 0; qMonths.filter((k) => k <= ym).forEach((k) => { qtd += rowActual(r, k, cases); });
    const tg = targets.filter((t) => t.rep === r.rep), c = surgicalComm(r, ym, cases), pay = Number(r.pay_amount) || Number(r.draw) || 0;
    return { rep: r.rep, role: r.role || '', territory: r.territory || '', metric: cnt ? 'Cases' : 'Sales', counts: r.counts || 'All', actual: Math.round(actual), target: target || null,
      pct: target ? Math.round(actual / target * 1000) / 10 : null, run_rate: runRate(actual), needed_day: target ? Math.max(0, Math.round((target - actual) / Math.max(1, left))) : null,
      behind: !!target && runRate(actual) < target, cases: mine.length, sales: Math.round(sum(mine)), new_cases: mine.filter(isNew).length, new_surgeons_q: newWon(mineQ), qtd: Math.round(qtd),
      targets: tg.length, targets_won: tg.filter(tWon).length, top_surgeon: top(mine, (x) => x.surgeon), top_product: top(mine, (x) => x.product), carry: !!r.carry,
      comm: { commission: c.commission, guaranteed: pay || null, est_pay: pay || c.rate ? pay + c.commission : null, rate: c.rate } };
  }).sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.sales - a.sales);
  reps.forEach((r, i) => { r.rank = i + 1; });
  const teamCards = teams.map((r) => { const a = rowActual(r, ym, cases), t = rowTarget(r, ym, cases); return { name: r.rep || r.territory, territory: r.territory, actual: Math.round(a), target: t, pct: t ? Math.round(a / t * 1000) / 10 : null }; });
  const mtd = Math.round(sum(mon)), qtdAll = Math.round(sum(qtr));
  // product mix: approved invoices on this month's cases (the amount on the invoice, the product on the case)
  const inv = cases.filter((c) => c.date.slice(0, 7) === ym && c.invoice && c.invoice.status === 'approved'), mix = {};
  inv.forEach((c) => { const k = c.product || 'Other'; mix[k] = mix[k] || { product: k, amount: 0, n: 0 }; mix[k].amount += Number(c.invoice.amount) || 0; mix[k].n++; });
  // what needs attention
  const att = [], mName = new Date(ym + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }), nextName = new Date(Date.UTC(Y, M, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  reps.filter((r) => r.metric === 'Sales' && r.target && r.run_rate < r.target).sort((a, b) => (b.target - b.run_rate) - (a.target - a.run_rate)).forEach((r) => att.push({ tone: 'warn', text: `At today's run rate ${r.rep} finishes ${mName} ${fmt$(r.target - r.run_rate)} short.` + (r.carry && M % 3 ? ` That shortfall carries into ${nextName} on top of the quota.` : '') }));
  reps.filter((r) => r.metric === 'Cases' && r.target && r.run_rate < r.target).forEach((r) => att.push({ tone: 'warn', text: `At today's run rate ${r.rep} finishes ${mName} at ${r.run_rate} of ${r.target} cases.` }));
  reps.filter((r) => !r.cases).forEach((r) => att.push({ tone: 'warn', text: `${r.rep} has not logged any completed cases this month.` }));
  const since = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const bySur = {}; done.filter((c) => c.surgeon && c.date >= since(90)).forEach((c) => { const k = sKey(c.surgeon); (bySur[k] = bySur[k] || []).push(c); });
  Object.values(bySur).filter((l) => l.length >= 2).map((l) => l.sort((a, b) => b.date.localeCompare(a.date))[0]).filter((c) => c.date < since(21)).slice(0, 4)
    .forEach((c) => att.push({ tone: 'warn', text: `${c.surgeon} has gone quiet: no case since ${new Date(c.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} (last covered by ${c.rep}).` }));
  reps.filter((r) => r.targets - r.targets_won > 0).forEach((r) => att.push({ tone: 'info', text: `${r.rep} has ${r.targets - r.targets_won} target surgeon${r.targets - r.targets_won === 1 ? '' : 's'} without a first case.` }));
  res.json({ today, month: ym, quarter: 'Q' + qn + ' ' + Y, biz: { elapsed, total: days.length, left },
    company: { mtd, target: coTarget, pct: coTarget ? Math.round(mtd / coTarget * 1000) / 10 : null, run_rate: runRate(mtd), to_go: Math.max(0, coTarget - mtd), behind: !!coTarget && runRate(mtd) < coTarget,
      qtd: qtdAll, q_target: coBase * 3, new_surgeons_q: newWon(qtr), targets: targets.length, targets_won: targets.filter(tWon).length,
      cases: mon.length, surgeons: new Set(mon.map((c) => sKey(c.surgeon)).filter(Boolean)).size, new_cases: mon.filter(isNew).length, new_share: mtd ? Math.round(sum(mon.filter(isNew)) / mtd * 100) : 0,
      needed_day: coTarget ? Math.max(0, Math.round((coTarget - mtd) / Math.max(1, left))) : null },
    reps, teams: teamCards, mix: Object.values(mix).sort((a, b) => b.amount - a.amount).map((m) => Object.assign(m, { amount: Math.round(m.amount) })),
    mix_missing: mon.filter((c) => !(c.invoice && c.invoice.status === 'approved')).length, attention: att.slice(0, 10) });
});
// Leaderboard (every signed-in rep and the COO): reps ranked by % to their own quota this month, with month-to-date sales
app.get('/api/leaderboard', needApi(), (req, res) => {
  const today = chiDate(), ym = today.slice(0, 7), cases = allCases(), days = bizDays(ym), elapsed = days.filter((d) => d <= today).length, pp = pins().reps;
  const reps = quotaRows().filter((r) => r.role !== 'Team' && (pp[r.rep] || {}).active !== false).map((r) => {
    const mtd = cases.filter((c) => c.rep === r.rep && isDone(c.status) && c.date.slice(0, 7) === ym && c.date <= today);
    const target = rowTarget(r, ym, cases), actual = rowActual(r, ym, cases);
    return { rep: r.rep, metric: r.metric === 'Cases' ? 'Cases' : 'Sales', sales: Math.round(mtd.reduce((t, c) => t + (Number(c.net_sales) || 0), 0)), cases: mtd.length,
      actual: Math.round(actual), target: target || null, pct: target ? Math.round(actual / target * 1000) / 10 : null };
  }).sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.sales - a.sales);
  reps.forEach((r, i) => { r.rank = i + 1; });
  res.json({ month: ym, pace: days.length ? Math.round(elapsed / days.length * 1000) / 10 : 0, biz: { elapsed, total: days.length }, me: req.s.rep || null, reps });
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
    if (k.startsWith('_auth/') || !((COLS.includes(parts[0]) && parts.length === 2) || k === 'config/quotas' || SHARED_CONFIG.includes(k) || k.startsWith('_audit/') || ((parts[0] === 'coonotes' || parts[0] === 'products' || parts[0] === 'facilities' || parts[0] === 'surgeons' || parts[0] === '_img') && parts.length === 2))) continue;
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
  const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  if (!m) return res.status(400).json({ error: 'That file is not a photo (JPG, PNG, WebP) or a PDF.' });
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
  for (const v of prev.videos || []) { await fileDel(v.id); if (v.poster && docs.has('_img/' + v.poster)) await del('_img/' + v.poster); }
  await dropSpin(prev);
  await del(k);
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id/spin', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id, prev = docs.get(k);
  if (!prev) return res.status(404).json({ error: 'No such product' });
  const next = Object.assign({}, prev); delete next.spin; await put(k, next); await dropSpin(prev);
  res.json({ ok: true });
});
/* put back brochure products that were removed, with their photos, videos and 360 views */
const normName = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function missingBrochure() {
  const have = new Set([...docs].filter(([k]) => k.startsWith('products/')).map(([, d]) => normName(d.name)));
  return brochureList().map((p, i) => ({ i, name: p.name, manufacturer: p.manufacturer || '' })).filter(x => !have.has(normName(x.name)) && !docs.has('products/seed' + String(x.i + 1).padStart(2, '0')));
}
app.get('/api/admin/products/brochure-missing', needApi('owner'), (req, res) => res.json({ missing: missingBrochure() }));
app.post('/api/admin/products/restore-brochure', needApi('owner'), async (req, res) => {
  const want = Array.isArray(req.body.names) ? new Set(req.body.names.map(normName)) : null;
  const miss = missingBrochure().filter(x => !want || want.has(normName(x.name)));
  if (!miss.length) return res.json({ ok: true, restored: [] });
  seedProducts(new Set(miss.map(x => x.i)));
  const only = new Set(miss.map(x => 'products/seed' + String(x.i + 1).padStart(2, '0')));
  await seedVideos(only).catch(e => console.error('restore video', e.message));
  await seedSpins(only).catch(e => console.error('restore spin', e.message));
  await seedVideoLinks(only).catch(e => console.error('restore link', e.message));
  await seedStabilityPhotos(only).catch(e => console.error('restore photos', e.message));
  res.json({ ok: true, restored: miss.map(x => x.name) });
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
  const by = whoName(s), at = new Date().toISOString(), kind = !prev ? 'created' : op === 'delete' ? 'deleted' : 'changed';
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

/* ---------------- case invoices: the rep attaches the invoice (photo or PDF) with its details; it waits for the COO ---------------- */
const invPublic = (c, id) => ({ id, rep: c.rep, date: c.date, surgeon: c.surgeon || '', facility: c.facility || '', product: c.product || '', status: c.status, net_sales: c.net_sales, invoice: c.invoice });
app.post('/api/cases/:id/invoice', needApi(), async (req, res) => {
  const k = 'cases/' + req.params.id, c = docs.get(k); if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (req.s.role !== 'owner' && c.rep !== req.s.rep) return res.status(403).json({ error: 'Not your case.' });
  if (closedMonth(c.date)) return res.status(423).json({ error: monthLabel(closedMonth(c.date)) + ' is closed. Ask the COO to reopen it.' });
  if (c.invoice && c.invoice.status === 'approved' && req.s.role !== 'owner') return res.status(409).json({ error: 'This invoice is already approved. Ask the COO to change it.' });
  const b = req.body || {}, amount = Number(String(b.amount ?? '').replace(/[$,\s]/g, ''));
  const files = (Array.isArray(b.files) ? b.files : []).map(String).filter((id) => /^att[0-9a-f]+$/.test(id) && docs.has('_img/' + id)).slice(0, 10);
  const why = [];
  if (!String(b.number || '').trim()) why.push('the invoice number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) why.push('the invoice date');
  if (!isFinite(amount) || amount <= 0) why.push('the invoice amount');
  if (!files.length) why.push('a photo or PDF of the invoice');
  if (why.length) return res.status(400).json({ error: 'Add ' + why.join(', ') + '.' });
  const owner = req.s.role === 'owner', now = new Date().toISOString(), prev = c;
  const inv = { number: String(b.number).trim().slice(0, 60), date: String(b.date), amount: Math.round(amount * 100) / 100, po: String(b.po || '').trim().slice(0, 60),
    bill_to: String(b.bill_to || '').trim().slice(0, 160), terms: String(b.terms || '').trim().slice(0, 40), notes: String(b.notes || '').trim().slice(0, 1000), files,
    status: owner ? 'approved' : 'pending', submitted_at: now, submitted_by: whoName(req.s), history: ((c.invoice && c.invoice.history) || []).concat([{ at: now, by: whoName(req.s), what: owner ? 'Added and approved' : (c.invoice ? 'Sent again for approval' : 'Sent for approval') }]).slice(-20) };
  if (owner) Object.assign(inv, { reviewed_at: now, reviewed_by: whoName(req.s) });
  const next = Object.assign({}, c, { invoice: inv, updated_at: now }, owner ? { net_sales: inv.amount, po: inv.po || c.po, invoice_no: inv.number, status: c.status === 'Paid' ? 'Paid' : 'Invoiced' } : {});
  await put(k, next); await audit(req.params.id, req.s, 'update', prev, next).catch(() => {});
  if (!owner) notifyOwner('Invoice to approve · ' + c.rep, `${c.rep} added invoice ${inv.number} for ${fmt$(inv.amount)}${c.surgeon ? ' (' + c.surgeon + ')' : ''}.`).catch(() => {});
  res.json({ ok: true, case: invPublic(next, req.params.id) });
});
app.post('/api/cases/:id/invoice/review', needApi('owner'), async (req, res) => {
  const k = 'cases/' + req.params.id, c = docs.get(k); if (!c || !c.invoice) return res.status(404).json({ error: 'No invoice on this case.' });
  const approve = req.body?.approve === true, reason = String(req.body?.reason || '').trim().slice(0, 500), now = new Date().toISOString();
  if (!approve && !reason) return res.status(400).json({ error: 'Say what needs fixing so the rep can resend it.' });
  if (closedMonth(c.date)) return res.status(423).json({ error: monthLabel(closedMonth(c.date)) + ' is closed. Reopen it first.' });
  const inv = Object.assign({}, c.invoice, { status: approve ? 'approved' : 'rejected', reviewed_at: now, reviewed_by: whoName(req.s), reason: approve ? '' : reason,
    history: (c.invoice.history || []).concat([{ at: now, by: whoName(req.s), what: approve ? 'Approved' : 'Sent back: ' + reason }]).slice(-20) });
  const next = Object.assign({}, c, { invoice: inv, updated_at: now }, approve ? { net_sales: inv.amount, po: inv.po || c.po, invoice_no: inv.number, status: c.status === 'Paid' ? 'Paid' : 'Invoiced' } : {});
  await put(k, next); await audit(req.params.id, req.s, 'update', c, next).catch(() => {});
  notifyRep(c.rep, approve ? 'Invoice approved' : 'Invoice needs a fix', approve ? `Invoice ${inv.number} (${fmt$(inv.amount)}) is approved; the case is now Invoiced.` : `Invoice ${inv.number}: ${reason}`).catch(() => {});
  res.json({ ok: true, case: invPublic(next, req.params.id) });
});
app.get('/api/invoices', needApi(), (req, res) => { // pending first; reps get their own
  const out = [];
  for (const [k, d] of docs) if (k.startsWith('cases/') && d && d.invoice && (req.s.role === 'owner' || d.rep === req.s.rep)) out.push(invPublic(d, k.slice(6)));
  out.sort((a, b) => (a.invoice.status === 'pending' ? 0 : 1) - (b.invoice.status === 'pending' ? 0 : 1) || String(b.invoice.submitted_at).localeCompare(String(a.invoice.submitted_at)));
  res.json({ invoices: out.slice(0, 300), pending: out.filter((x) => x.invoice.status === 'pending').length });
});

/* ---------------- calendar feed (subscribe from a phone calendar) ---------------- */
function calToken(s) { return sign({ cal: 1, role: s.role, rep: s.rep || null, mgr: s.mgr || null, acct: s.acct || null, v: s.v, exp: Date.now() + 5 * 365 * 864e5 }); }
function calSession(tok) {
  const s = unsign(tok); if (!s || !s.cal) return null;
  if (s.role === 'owner' && s.mgr) { const m = mgrs()[s.mgr]; return m && m.active !== false && m.v === s.v ? s : null; }
  if (s.role === 'owner') return s.v === adminV() ? s : null;
  const p = pins().reps[s.rep]; if (!p || p.active === false) return null;
  if (s.acct) { const a = mgrs()[s.acct]; return a && a.active !== false && a.v === s.v ? s : null; }
  return p.v === s.v ? s : null;
}
/* ---------------- Weekly Clinical Update (WCU) ----------------
   Built from the rep's activity for the week (cases, visits, targets, plans); the rep reviews, edits and sends it to the COO.
   Due every Thursday by 5:00 PM Central for the week (Monday–Friday). Stored as wcu/<rep>|<monday>. */
const WCU_STEPS = ['Not started', '1 Discovery', '2 Observe', '3 Debrief', '4 360 Experience', '5 Case commitment', '6 Outcomes & QTi'];
const wAdd = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(iso + 'T12:00:00Z'), w = d.getUTCDay(); return wAdd(iso, w === 0 ? -6 : 1 - w); };
const wcuKey = (rep, wk) => 'wcu/' + String(rep).replace(/[\/|]/g, '-') + '|' + wk;
const chiNowParts = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value])); return { wd: p.weekday, h: Number(p.hour) % 24, m: Number(p.minute) }; };
const wcuDueAt = (wk) => { // Thursday 5:00 PM Central as an instant
  const thu = wAdd(wk, 3), probe = new Date(thu + 'T17:00:00Z');
  const off = (new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })) - new Date(probe.toLocaleString('en-US', { timeZone: 'America/Chicago' }))) / 36e5;
  return new Date(Date.parse(thu + 'T17:00:00Z') + off * 36e5);
};
const DAYN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const niceDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
function wcuBuild(rep, wk) {
  const end = wAdd(wk, 4), nextWk = wAdd(wk, 7), nextEnd = wAdd(wk, 11), all = [...docs];
  const of = (col) => all.filter(([k, d]) => k.startsWith(col + '/') && d && d.rep === rep).map(([k, d]) => Object.assign({ id: k.split('/')[1] }, d));
  const cases = of('cases'), visits = of('visits'), targets = of('targets'), prefs = of('prefcards');
  const live = (c) => String(c.status || '').toLowerCase() !== 'cancelled';
  const done = (c) => /completed|po received|invoiced|paid/i.test(c.status || '');
  const week = cases.filter((c) => live(c) && c.date >= wk && c.date <= end).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const caseLine = (c) => [c.surgeon || 'Surgeon TBD', [c.product, c.units ? '×' + c.units : ''].filter(Boolean).join(' '), c.facility ? '@ ' + c.facility : ''].filter(Boolean).join(' · ');
  const days = DAYN.map((name, i) => ({ day: name, date: wAdd(wk, i), cases: week.filter((c) => c.date === wAdd(wk, i)).map(caseLine) }));
  // Top wins: the visits the rep flagged as a win (⭐ on the visit), in date order
  const winVisits = visits.filter((v) => v.win === true && v.date >= wk && v.date <= end && v.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date));
  const wins = winVisits.map((v) => `On ${niceDay(v.date)}, I met with ${v.surgeon || 'a surgeon'}${v.facility ? ` at ${v.facility}` : ''}${v.notes ? `: ${v.notes}` : ''}${v.step_to > (v.step_from || 0) ? ` (moved to ${WCU_STEPS[v.step_to] || 'step ' + v.step_to})` : ''}.`);
  const win_ids = winVisits.map((v) => v.id);
  const nextCases = cases.filter((c) => live(c) && c.date >= nextWk && c.date <= nextEnd);
  const dir = all.filter(([k]) => k.startsWith('surgeons/')).map(([, d]) => d);
  const spec = (n) => { const k = lcs(n).replace(/^dr\.?\s*/, ''); const d = dir.find((x) => lcs(x.name).replace(/^dr\.?\s*/, '') === k); return d ? d.specialty || '' : ''; };
  const productsFor = (n) => { const p = prefs.find((x) => lcs(x.surgeon) === lcs(n)); if (p && p.products && p.products.length) return p.products.join(', ');
    const used = cases.filter((c) => lcs(c.surgeon) === lcs(n) && c.product).map((c) => c.product); return [...new Set(used)].slice(0, 3).join(', '); };
  const nextStepFor = (t) => { const v = visits.filter((x) => x.target_id === t.id || lcs(x.surgeon) === lcs(t.surgeon)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    return (v && v.next_step) || (t.step ? `At ${WCU_STEPS[t.step] || 'step ' + t.step}` : 'First visit'); };
  const pod = targets.map((t) => ({ surgeon: t.surgeon || '', hospital: t.facility || '', specialty: spec(t.surgeon), products: productsFor(t.surgeon), next: nextStepFor(t) }));
  const plan = DAYN.map((name, i) => { const d = wAdd(nextWk, i), items = [];
    visits.filter((v) => v.date === d && v.status !== 'cancelled').forEach((v) => items.push(`${v.time ? v.time + ' · ' : ''}${v.type || 'Visit'} with ${v.surgeon || 'target surgeon'}${v.facility ? ` at ${v.facility}` : ''}${v.purpose ? ` — ${v.purpose}` : ''}`));
    visits.filter((v) => v.next_date === d && v.next_step).forEach((v) => items.push(`Follow up with ${v.surgeon || 'surgeon'}: ${v.next_step}`));
    nextCases.filter((c) => c.date === d).forEach((c) => items.push(`Support case: ${caseLine(c)}`));
    return { day: name, date: d, items }; });
  return { rep, week: wk, status: 'draft', wins, win_ids, cases_count: week.length, days, projected: nextCases.length, pod, plan, notes: '', built_at: new Date().toISOString() };
}
const wcuState = (doc, wk) => { const due = wcuDueAt(wk), sent = doc && doc.status === 'sent';
  return { due: due.toISOString(), sent: !!sent, sent_at: sent ? doc.sent_at : null, late: sent ? !!doc.late : Date.now() > due.getTime() }; };
const wcuClean = (b, base) => { const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x || '').trim().slice(0, 600)).filter(Boolean).slice(0, 40);
  return Object.assign({}, base, {
    wins: lines(b.wins), projected: Math.max(0, Math.min(999, parseInt(b.projected, 10) || 0)), notes: String(b.notes || '').slice(0, 4000),
    pod: (Array.isArray(b.pod) ? b.pod : []).slice(0, 40).map((r) => ({ surgeon: String(r.surgeon || '').slice(0, 120), hospital: String(r.hospital || '').slice(0, 120), specialty: String(r.specialty || '').slice(0, 80), products: String(r.products || '').slice(0, 200), next: String(r.next || '').slice(0, 400) })).filter((r) => r.surgeon || r.next),
    plan: DAYN.map((name, i) => { const p = (Array.isArray(b.plan) ? b.plan : []).find((x) => x && x.day === name) || {}; return { day: name, date: base.plan ? (base.plan[i] || {}).date : '', items: lines(p.items) }; }),
    updated_at: new Date().toISOString() }); };
const wcuRepOf = (req) => (req.s.role === 'rep' ? req.s.rep : String(req.query.rep || req.body?.rep || ''));
app.get('/api/wcu', needApi(), (req, res) => {
  const rep = wcuRepOf(req); if (!rep) return res.status(400).json({ error: 'Which rep?' });
  const wk = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? mondayOf(req.query.week) : mondayOf(chiDate());
  const saved = docs.get(wcuKey(rep, wk)), fresh = wcuBuild(rep, wk);
  let report = saved || fresh;
  if (saved && saved.status !== 'sent') { // a draft picks up visits flagged as wins since it was saved
    const had = new Set(saved.win_ids || []), add = fresh.win_ids.map((id, i) => [id, fresh.wins[i]]).filter(([id]) => !had.has(id));
    if (add.length) report = Object.assign({}, saved, { wins: (saved.wins || []).concat(add.map((x) => x[1])), win_ids: [...had, ...add.map((x) => x[0])] });
  }
  res.json({ report, saved: !!saved, fresh, state: wcuState(saved, wk), week: wk, rep });
});
app.put('/api/wcu', needApi(), async (req, res) => {
  if (req.s.role !== 'rep') return res.status(403).json({ error: 'Reps write their own weekly update.' });
  const rep = req.s.rep, wk = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.week || '')) ? req.body.week : chiDate()), k = wcuKey(rep, wk);
  const prev = docs.get(k) || wcuBuild(rep, wk), fresh = wcuBuild(rep, wk);
  const doc = wcuClean(req.body || {}, Object.assign({}, prev, { days: fresh.days, cases_count: fresh.cases_count, plan: prev.plan || fresh.plan }));
  doc.win_ids = [...new Set([...(prev.win_ids || []), ...(Array.isArray(req.body?.win_ids) ? req.body.win_ids.map(String).slice(0, 200) : [])])];
  if (prev.status === 'sent') { doc.status = 'sent'; doc.edited_after_send = true; }
  await put(k, doc); res.json({ ok: true, report: doc, state: wcuState(doc, wk) });
});
function wcuHtml(r, base) {
  const e = (v) => esc(String(v ?? '')), li = (a) => (a && a.length ? `<ul style="margin:6px 0 0 18px;padding:0">${a.map((x) => `<li style="margin:3px 0">${e(x)}</li>`).join('')}</ul>` : '<p style="color:#777;margin:6px 0">—</p>');
  const wkLabel = new Date(r.week + 'T12:00:00Z').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'UTC' });
  const h = (t) => `<h3 style="font:700 15px Arial,sans-serif;margin:18px 0 4px;border-bottom:2px solid #0f1b33;padding-bottom:3px">${t}</h3>`;
  return `<div style="font:14px/1.45 Arial,sans-serif;color:#111;max-width:760px">
  <h2 style="margin:0 0 2px;font:800 20px Arial,sans-serif">WCU · Weekly Clinical Update · ${e(r.rep)}</h2><div style="color:#555">Week of ${wkLabel}${r.sent_at ? ` · sent ${new Date(r.sent_at).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })}${r.late ? ' <b style="color:#b42318">(late)</b>' : ''}` : ''}</div>
  ${h('Top Wins for the Week')}${li(r.wins)}
  ${h(`Cases This Week: ${r.cases_count}`)}
  ${h(`Projected Cases Next Week: ${r.projected}`)}
  ${h('Pod Surgeon Targets')}<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr>${['Surgeon Name', 'Hospital', 'Specialty', 'Product/Products', 'Next Step'].map((x) => `<th style="text-align:left;font:600 12px Arial;color:#444;border-bottom:1px solid #ccc;padding:4px">${x}</th>`).join('')}</tr>
    ${(r.pod || []).map((p) => `<tr>${[p.surgeon, p.hospital, p.specialty, p.products, p.next].map((x) => `<td style="padding:4px;border-bottom:1px solid #eee;vertical-align:top">${e(x)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5" style="color:#999;padding:4px">—</td></tr>'}</table>
  ${h('Next Week Plan')}${(r.plan || []).map((d) => `<div style="margin-top:8px"><b>${e(d.day)}:</b>${li(d.items)}</div>`).join('')}
  ${h('Comments/Additional Notes')}<div style="white-space:pre-line">${e(r.notes) || '<span style="color:#999">—</span>'}</div>
  ${base ? `<p style="margin-top:22px"><a href="${e(base)}/#sec-wcu" style="background:#0f1b33;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open in the tracker</a></p>` : ''}</div>`;
}
app.post('/api/wcu/send', needApi(), async (req, res) => {
  if (req.s.role !== 'rep') return res.status(403).json({ error: 'Reps send their own weekly update.' });
  const rep = req.s.rep, wk = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.week || '')) ? req.body.week : chiDate()), k = wcuKey(rep, wk);
  const prev = docs.get(k) || wcuBuild(rep, wk), fresh = wcuBuild(rep, wk);
  const doc = wcuClean(req.body || {}, Object.assign({}, prev, { days: fresh.days, cases_count: fresh.cases_count }));
  if (!doc.wins.length) return res.status(400).json({ error: 'Add at least one win for the week before sending.' });
  const first = prev.status !== 'sent';
  Object.assign(doc, { status: 'sent', sent_at: new Date().toISOString(), late: first ? Date.now() > wcuDueAt(wk).getTime() : !!prev.late, resent: !first });
  await put(k, doc);
  // in-app: the COO sees it under Weekly Clinical Updates (and gets an app notification); no email
  notifyOwner(`WCU · ${rep}${doc.late ? ' (late)' : ''}`, `${rep} sent the WCU for the week of ${wk}.`).catch(() => {});
  res.json({ ok: true, report: doc, state: wcuState(doc, wk) });
});
// the COO: every rep's update for a week, with on-time / late / missing
app.get('/api/wcu/list', needApi('owner'), (req, res) => {
  const wk = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? mondayOf(req.query.week) : mondayOf(chiDate());
  const p = pins().reps;
  const reps = quotaRows().filter((r) => r.role !== 'Team' && p[r.rep] && p[r.rep].active !== false).map((r) => r.rep);
  res.json({ week: wk, due: wcuDueAt(wk).toISOString(), reps: reps.map((rep) => { const d = docs.get(wcuKey(rep, wk)); return Object.assign({ rep, report: d && d.status === 'sent' ? d : null, draft: !!(d && d.status !== 'sent') }, wcuState(d, wk)); }) });
});
app.get('/api/wcu/history', needApi(), (req, res) => { // archive: every week since the first update, newest first
  const now = mondayOf(chiDate()); let first = now;
  for (const k of docs.keys()) if (k.startsWith('wcu/')) { const wk = k.split('|')[1]; if (wk && wk < first) first = wk; }
  const weeks = []; for (let w = now; w >= first && weeks.length < 52; w = wAdd(w, -7)) weeks.push(w);
  const p = pins().reps;
  const reps = req.s.role === 'rep' ? [req.s.rep] : quotaRows().filter((r) => r.role !== 'Team' && p[r.rep] && p[r.rep].active !== false).map((r) => r.rep);
  const rows = reps.map((rep) => {
    const wk = weeks.map((w) => { const d = docs.get(wcuKey(rep, w)), st = wcuState(d, w); return { week: w, sent: st.sent, late: st.late, sent_at: st.sent_at, open: !st.sent && !st.late, cases: d && d.status === 'sent' ? d.cases_count : null }; });
    const closed = wk.filter((x) => x.sent || x.late);
    return { rep, weeks: wk, on_time: wk.filter((x) => x.sent && !x.late).length, late: wk.filter((x) => x.sent && x.late).length, missing: wk.filter((x) => !x.sent && x.late).length, rate: closed.length ? Math.round(100 * wk.filter((x) => x.sent && !x.late).length / closed.length) : null };
  });
  res.json({ weeks, reps: rows });
});
app.get('/api/wcu/view', needApi(), (req, res) => { // printable page
  const rep = wcuRepOf(req), wk = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? req.query.week : chiDate());
  const d = docs.get(wcuKey(rep, wk)) || wcuBuild(rep, wk);
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WCU · ${esc(rep)}</title><style>body{margin:24px;background:#fff}@media print{.np{display:none}}</style></head><body><p class="np"><button onclick="print()">Print / save as PDF</button></p>${wcuHtml(d, '')}</body></html>`);
});
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
  const ev = (uid, date, time, mins, summary, desc, alarmMin, where) => {
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@360medical-tracker', 'DTSTAMP:' + stamp);
    if (time && /^\d{2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(':').map(Number), end = h * 60 + m + mins;
      lines.push('DTSTART;TZID=America/Chicago:' + icsDate(date) + 'T' + time.replace(':', '') + '00', 'DTEND;TZID=America/Chicago:' + icsDate(date) + 'T' + String(Math.min(23, Math.floor(end / 60))).padStart(2, '0') + String(end >= 1440 ? 59 : end % 60).padStart(2, '0') + '00');
    } else {
      const nd = new Date(Date.parse(date + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
      lines.push('DTSTART;VALUE=DATE:' + icsDate(date), 'DTEND;VALUE=DATE:' + icsDate(nd));
    }
    lines.push('SUMMARY:' + icsEsc(summary)); if (desc) lines.push('DESCRIPTION:' + icsEsc(desc)); if (where) lines.push('LOCATION:' + icsEsc(where));
    if (alarmMin != null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(summary), 'TRIGGER:-PT' + alarmMin + 'M', 'END:VALARM');
    lines.push('END:VEVENT');
  };
  for (const [k, d] of docs) {
    const col = k.split('/')[0];
    if (!d || !mine(d) || !d.date && !d.next_date && !d.expires) continue;
    if (col === 'cases' && d.date >= lo && d.date <= hi && String(d.status).toLowerCase() !== 'cancelled')
      ev(k.replace('/', '-'), d.date, d.time, 90, 'Case: ' + (d.surgeon || 'Surgeon TBD') + (d.product ? ' · ' + d.product : '') + (d.facility ? ' @ ' + d.facility : ''), [s.role === 'owner' ? 'Rep: ' + d.rep : '', 'Status: ' + (d.status || ''), d.service_line ? 'Service line: ' + d.service_line : ''].filter(Boolean).join('\n'));
    if (col === 'visits' && d.date && d.date >= lo && d.date <= hi && d.status !== 'cancelled') {
      const fac = facilityFor(d.facility), g = geoSet(), st = d.check ? (d.check.ok === true ? (d.check.left_at ? 'Left early' : 'Verified at facility') : d.check.ok === null ? "Can't verify (no address)" : d.check.missed ? 'Missed check-in' : 'Not verified') : 'Planned';
      ev(k.replace('/', '-') + '-visit', d.date, d.time, Number(d.duration) || 60, 'Visit: ' + (d.surgeon || 'Target surgeon') + (d.facility ? ' @ ' + d.facility : ''),
        [s.role === 'owner' ? 'Rep: ' + d.rep : '', d.type ? 'Type: ' + d.type : '', d.purpose ? 'Purpose: ' + d.purpose : '', d.time ? 'Check in from the 360 Cases app between ' + g.early + ' min before and ' + g.late + ' min after the visit.' : '', 'Status: ' + st].filter(Boolean).join('\n'),
        d.status === 'planned' && !d.check && d.time ? g.early : null, fac && fac.address ? fac.address : (d.facility || ''));
    }
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
    if (udiCache.size > 500) udiCache.delete(udiCache.keys().next().value);
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
  await put(subKey(sub.endpoint), { uid: uidOf(req.s), role: req.s.role, rep: req.s.rep || null, mgr: req.s.mgr || null, v: req.s.v, sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh || ''), auth: String(sub.keys.auth || '') } }, at: new Date().toISOString() });
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', needApi(), async (req, res) => { const k = subKey(req.body && req.body.endpoint); if (docs.has(k)) await del(k); res.json({ ok: true }); });

const chiDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function bizDays(ym) { const [y, m] = ym.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = []; for (let d = 1; d <= n; d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w && w < 6) out.push(ym + '-' + String(d).padStart(2, '0')); } return out; }
const isDone = st => { const s = String(st || '').toLowerCase(); return s !== 'scheduled' && s !== 'cancelled'; };
const fmt$ = v => '$' + Math.round(v).toLocaleString('en-US');
function allCases() { return [...docs].filter(([k]) => k.startsWith('cases/')).map(([, d]) => d).filter(c => c && c.date && c.rep); }
// a product filter can list several names: "Skeletal Dynamics|Geminus|KinematX" counts any of them
const prodMatch = (filter, product) => { const f = String(filter || '').trim(); if (!f) return true; const p = String(product || '').toLowerCase(); return f.split('|').map((x) => x.trim().toLowerCase()).filter(Boolean).some((x) => p.includes(x)); };
function rowActual(row, ym, cases) {
  const terr = {}; quotaRows().forEach(r => { if (r.role !== 'Team') terr[r.rep] = r.territory; });
  return cases.filter(c => c.date.slice(0, 7) === ym && isDone(c.status)).filter(c => {
    const who = row.role === 'Team' ? terr[c.rep] === row.territory : c.rep === row.rep;
    const type = row.counts === 'New only' ? c.surgeon_type === 'New' : row.counts === 'Legacy only' ? c.surgeon_type === 'Legacy' : true;
    const prod = prodMatch(row.product_filter, c.product);
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
  const cases = allCases(), ym = today.slice(0, 7), reps = quotaRows().filter(r => r.role !== 'Team' && (pins().reps[r.rep] || {}).active !== false), st = settings();
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
function subValid(d) {
  if (d.role === 'owner') { if (d.mgr) { const m = mgrs()[d.mgr]; return !!m && m.active !== false && m.v === d.v; } return d.v === adminV() && !pinOff(); }
  return !!(pins().reps[d.rep] && pins().reps[d.rep].active !== false);
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
    if (!subValid(d)) continue;
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
function geoSet() {
  const st = docs.get('config/settings') || {};
  // geofence switches (Admin → Visit geofencing); everything defaults to on
  return { early: Number(st.checkin_early_min) || 30, late: Number(st.checkin_late_min) || 30, radius: Number(st.geo_radius_m) || 400,
    on: st.geo_on !== false, remind: st.geo_remind !== false, alertMissed: st.geo_alert_missed !== false, alertLeft: st.geo_alert_left !== false, leaveGraceMin: Number(st.geo_leave_grace_min) || 0, leaveFactor: Number(st.geo_leave_factor) || 1.5, maxAccM: Number(st.geo_max_acc_m) || 1500 };
}
function visitWindow(v) {
  const g = geoSet(), start = chiEpoch(v.date, v.time || '08:00'), end = start + (Number(v.duration) || 60) * 60e3;
  return { start, end, open: start - g.early * 60e3, close: end + g.late * 60e3 };
}
const lcs = v => String(v || '').trim().toLowerCase();
function facilityFor(name) { const n = lcs(name); if (!n) return null; for (const [k, d] of docs) if (k.startsWith('facilities/') && (lcs(d.name) === n || (d.aliases || []).some(a => lcs(a) === n))) return Object.assign({ id: k.slice(11) }, d); return null; }
function metersBetween(a, b, c, d) { const R = 6371000, r = x => x * Math.PI / 180, dl = r(c - a), dg = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); }
const fmtClock = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
async function notifyOwner(title, body) {
  for (const [k, d] of [...docs]) if (k.startsWith('_push/') && d.role === 'owner' && subValid(d)) await sendTo(d, { title, body, url: '/admin#visits' });
}
async function notifyRep(rep, title, body) {
  for (const [k, d] of [...docs]) if (k.startsWith('_push/') && d.role === 'rep' && d.rep === rep) await sendTo(d, { title, body, url: '/' });
}
let lastSweep = 0;
function sweepVisits() {
  if (Date.now() - lastSweep < 30e3) return; lastSweep = Date.now();
  for (const [k, v] of [...docs]) {
    if (!k.startsWith('visits/') || !v || v.status !== 'planned' || v.check || !v.date || !v.time) continue;
    const w = visitWindow(v);
    const g = geoSet(); if (!g.on) continue;
    if (!v.reminded && Date.now() >= w.open && Date.now() <= w.close) {
      docs.set(k, Object.assign({}, v, { reminded: new Date().toISOString() })); persist(k);
      if (g.remind) notifyRep(v.rep, 'Check-in open · ' + (v.surgeon || 'visit'), (v.facility ? v.facility + ': ' : '') + 'open the app when you arrive and it checks you in. Window closes ' + fmtClock(w.close) + '.').catch(() => {});
      continue;
    }
    if (Date.now() > w.close) {
      const check = { at: new Date().toISOString(), ok: false, missed: true, reason: 'Missed: no check-in between ' + fmtClock(w.open) + ' and ' + fmtClock(w.close) };
      docs.set(k, Object.assign({}, v, { check })); persist(k);
      if (g.alertMissed) notifyOwner('Visit not verified · ' + v.rep, v.rep + ' did not check in for ' + v.surgeon + (v.facility ? ' at ' + v.facility : '') + ' (' + v.date + ' ' + v.time + ').').catch(() => {});
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
  else if (fac.approved === false) { ok = null; reason = 'Cannot verify yet: the address for ' + fac.name + ' was added by a rep and is waiting for COO approval.'; dist = metersBetween(lat, lng, fac.lat, fac.lng); }
  else {
    dist = metersBetween(lat, lng, fac.lat, fac.lng);
    const radius = Number(fac.radius_m) || g.radius, slack = Math.min(acc, 150);
    const near = acc <= g.maxAccM && dist - slack <= radius;
    ok = !g.on ? inWindow : near && inWindow;
    reason = !inWindow ? (now < w.open ? 'Too early: check-in opens at ' + fmtClock(w.open) + '.' : 'Too late: check-in closed at ' + fmtClock(w.close) + '.')
      : !g.on ? 'Checked in (location check is turned off).'
      : acc > g.maxAccM ? 'Location too imprecise (±' + Math.round(acc) + ' m). Turn on precise location and try again.'
      : !near ? 'Not at ' + fac.name + ': ' + (dist >= 1000 ? (dist / 1609.34).toFixed(1) + ' mi' : dist + ' m') + ' away.' : 'At ' + fac.name + ' (' + dist + ' m from the address) during the visit window.';
  }
  if (!inWindow && now < w.open) return res.status(400).json({ error: reason });
  const check = { at: new Date(now).toISOString(), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, acc: Math.round(acc), dist_m: dist, ok, reason: ok === true && req.body.auto ? reason.replace(/^At /, 'Auto check-in: arrived at ') : reason, in_window: inWindow, facility_id: fac ? fac.id : null, auto: !!req.body.auto };
  const attempts = (v.check_attempts || 0) + 1, wasBad = v.check && v.check.ok === false;
  await put(k, Object.assign({}, v, { check, check_attempts: attempts }));
  if (ok === false && !wasBad) notifyOwner('Visit check failed · ' + v.rep, v.rep + ' · ' + v.surgeon + ': ' + reason).catch(() => {});
  if (ok === null && attempts === 1) notifyOwner('Visit not verifiable · ' + v.rep, 'Add an address for ' + (v.facility || 'the facility') + ' in Admin so check-ins there can be verified.').catch(() => {});
  res.json({ ok: true, check });
});
/* geofence: the app (while open during a verified visit) reports when the rep leaves the facility before the visit ends */
app.post('/api/visit-left', needApi(), async (req, res) => {
  const k = 'visits/' + String(req.body.id || ''), v = docs.get(k);
  if (!v) return res.status(404).json({ error: 'Visit not found.' });
  if (req.s.role === 'owner' || v.rep !== req.s.rep) return res.status(403).json({ error: 'Not your visit.' });
  if (!v.check || v.check.ok !== true) return res.status(400).json({ error: 'Visit is not checked in.' });
  if (v.check.left_at) return res.json({ ok: true, check: v.check });
  const lat = Number(req.body.lat), lng = Number(req.body.lng), acc = Math.max(0, Number(req.body.acc) || 0);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'No location received.' });
  const fac = facilityFor(v.facility), w = visitWindow(v), now = Date.now();
  if (!fac || fac.lat == null) return res.status(400).json({ error: 'No facility location.' });
  const g = geoSet(); if (!g.on) return res.json({ ok: true, check: v.check, still_here: true });
  if (now >= w.end - g.leaveGraceMin * 60e3) return res.json({ ok: true, check: v.check, after_end: true });
  const radius = Number(fac.radius_m) || g.radius, dist = metersBetween(lat, lng, fac.lat, fac.lng);
  if (acc > g.maxAccM || dist - Math.min(acc, 150) <= radius * g.leaveFactor) return res.json({ ok: true, check: v.check, still_here: true });
  const mins = Math.round((w.end - now) / 60e3);
  const check = Object.assign({}, v.check, { left_at: new Date(now).toISOString(), left_dist_m: dist, left_early_min: mins, reason: v.check.reason + ' · Left at ' + fmtClock(now) + ', ' + mins + ' min before the visit ended.' });
  await put(k, Object.assign({}, v, { check }));
  if (g.alertLeft) notifyOwner('Left visit early · ' + v.rep, v.rep + ' left ' + (fac.name || v.facility) + ' at ' + fmtClock(now) + ', ' + mins + ' min before the ' + (v.surgeon || '') + ' visit ended.').catch(() => {});
  res.json({ ok: true, check });
});
app.post('/api/cron/sweep', (req, res) => {
  const ok = (process.env.CRON_SECRET && req.get('x-cron-secret') === process.env.CRON_SECRET) || (session(req) || {}).role === 'owner';
  if (!ok) return res.status(403).json({ error: 'forbidden' });
  lastSweep = 0; sweepVisits(); res.json({ ok: true });
});
async function geocode(q) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q), { signal: ctl.signal, headers: { 'User-Agent': '360-Medical-Case-Tracker/1.0 (' + (process.env.PUBLIC_URL || 'https://three60-medical-surgical-case-tracker.onrender.com') + ')', 'Accept-Language': 'en' } });
    const j = await r.json(); if (!Array.isArray(j) || !j[0]) return null;
    return { lat: Math.round(Number(j[0].lat) * 1e6) / 1e6, lng: Math.round(Number(j[0].lon) * 1e6) / 1e6, label: j[0].display_name };
  } catch (e) { return null; } finally { clearTimeout(t); }
}
// address lookup as you type (OpenStreetMap's Photon, US only): street, city, state, ZIP + coordinates
const US_STATE = { alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE','district of columbia':'DC',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY' };
const sugCache = new Map();
// where to bias the lookup: the caller's location if the phone shared it, else the middle of the facilities already on the map
function suggestBias(req) {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (isFinite(lat) && isFinite(lng) && lat && lng) return { lat, lng };
  const pts = [...docs].filter(([k, d]) => k.startsWith('facilities/') && d.lat != null && d.lng != null).map(([, d]) => d);
  if (!pts.length) return null;
  return { lat: pts.reduce((t, d) => t + Number(d.lat), 0) / pts.length, lng: pts.reduce((t, d) => t + Number(d.lng), 0) / pts.length };
}
const STREET_NOISE = new Set(['st', 'street', 'rd', 'road', 'dr', 'drive', 'ave', 'avenue', 'blvd', 'boulevard', 'ln', 'lane', 'ct', 'court', 'hwy', 'highway', 'pkwy', 'parkway', 'n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'suite', 'ste', 'tx', 'texas']);
const km = (a, b) => { const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371; };
async function photonSuggest(q, bias, signal) {
  const r = await fetch('https://photon.komoot.io/api/?limit=8&lang=en&bbox=-125,24,-66,50' + (bias ? `&lat=${bias.lat}&lon=${bias.lng}&zoom=11&location_bias_scale=0.6` : '') + '&q=' + encodeURIComponent(q), { signal, headers: { 'User-Agent': '360-Medical-Case-Tracker/1.0' } });
  const j = await r.json(); const out = [];
  for (const f of (j.features || [])) {
    const p = f.properties || {}, g = (f.geometry || {}).coordinates || [];
    if (p.countrycode && p.countrycode !== 'US') continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ') || (p.type === 'house' || p.type === 'street' ? '' : p.name || '');
    if (!street) continue;
    const st = (p.state && (US_STATE[String(p.state).toLowerCase()] || (String(p.state).length === 2 ? String(p.state).toUpperCase() : ''))) || '';
    out.push({ name: p.name && p.name !== street ? p.name : '', street, city: p.city || p.town || p.village || p.district || p.county || '', state: st, zip: p.postcode || '', lat: Number(g[1]), lng: Number(g[0]) });
  }
  return out;
}
async function nominatimSuggest(q, bias, signal) {
  const box = bias ? `&viewbox=${bias.lng - 1.5},${bias.lat + 1.2},${bias.lng + 1.5},${bias.lat - 1.2}&bounded=0` : '';
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=us&dedupe=1' + box + '&q=' + encodeURIComponent(q), { signal, headers: { 'User-Agent': '360-Medical-Case-Tracker/1.0 (' + (process.env.PUBLIC_URL || 'https://three60-medical-surgical-case-tracker.onrender.com') + ')', 'Accept-Language': 'en' } });
  const j = await r.json(); const out = [];
  for (const it of (Array.isArray(j) ? j : [])) {
    const a = it.address || {}; const street = [a.house_number, a.road].filter(Boolean).join(' ') || (a.amenity || a.building || a.shop || a.office || '');
    if (!street) continue;
    const st = a.state ? (US_STATE[String(a.state).toLowerCase()] || '') : '';
    out.push({ name: it.name || a.amenity || a.hospital || a.building || a.office || '', street, city: a.city || a.town || a.village || a.hamlet || a.county || '', state: st, zip: a.postcode || '', lat: Number(it.lat), lng: Number(it.lon) });
  }
  return out;
}
app.get('/api/address-suggest', needApi(), async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 160), place = req.query.kind === 'place'; if (q.length < (place ? 3 : 4)) return res.json({ items: [] });
  const bias = suggestBias(req), key = (place ? 'P|' : '') + q.toLowerCase() + '|' + (bias ? bias.lat.toFixed(1) + ',' + bias.lng.toFixed(1) : '');
  if (sugCache.has(key)) return res.json({ items: sugCache.get(key) });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const [a, b] = await Promise.all([photonSuggest(q, bias, ctl.signal).catch(() => []), nominatimSuggest(q, bias, ctl.signal).catch(() => [])]);
    // keep only results that actually contain the words typed (the lookups are fuzzy and like to swap the street name)
    const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !/^\d+$/.test(w) && !STREET_NOISE.has(w));
    const num = (q.match(/^\s*(\d+)/) || [])[1];
    const seen = new Set(), items = [];
    for (const it of a.concat(b)) {
      if (!isFinite(it.lat) || !isFinite(it.lng)) continue;
      if (place && !it.name) continue; // looking a place up by its name: it has to have one
      const hay = (place ? [it.name, it.city] : num ? [it.name, it.street] : [it.name, it.street, it.city, it.zip]).join(' ').toLowerCase(); // "800 sunset dr" must match the street itself, not a city called Sunset
      if (!words.every(w => hay.includes(w))) continue;
      if (!place && num && /^\d/.test(it.street) && !it.street.startsWith(num + ' ')) continue;
      const k = [place ? it.name : '', it.street, it.city, it.state, it.zip].join('|').toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      items.push({ name: it.name, street: it.street, city: it.city, state: it.state, zip: it.zip, lat: Math.round(it.lat * 1e6) / 1e6, lng: Math.round(it.lng * 1e6) / 1e6, d: bias ? km(bias, it) : 0 });
    }
    items.sort((x, y) => x.d - y.d); items.forEach(i => delete i.d);
    const top = items.slice(0, 6);
    if (sugCache.size > 500) sugCache.clear(); sugCache.set(key, top);
    res.json({ items: top });
  } catch (e) { res.json({ items: [], error: 'lookup unavailable' }); } finally { clearTimeout(t); }
});
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
  const doc = { name, address, lat, lng, map_label: label || (docs.get('facilities/' + id) || {}).map_label || '', radius_m: num(b.radius_m) || null, aliases: strList(b.aliases), approved: true, added_by: (docs.get('facilities/' + id) || {}).added_by || 'COO', created_at: (docs.get('facilities/' + id) || {}).created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
  await put('facilities/' + id, doc); res.json({ ok: true, id, facility: doc });
});
app.delete('/api/admin/facilities/:id', needApi('owner'), async (req, res) => { const k = 'facilities/' + req.params.id; if (docs.has(k)) await del(k); res.json({ ok: true }); });
app.post('/api/admin/visit-ack', needApi('owner'), async (req, res) => {
  const k = 'visits/' + String(req.body.id || ''), v = docs.get(k);
  if (!v || !v.check) return res.status(404).json({ error: 'No check-in record.' });
  await put(k, Object.assign({}, v, { check: Object.assign({}, v.check, { ack: { at: new Date().toISOString(), note: String(req.body.note || '').slice(0, 500) } }) }));
  res.json({ ok: true });
});


/* ---------------- shared directory: surgeons + facilities (reps can add, COO manages) ---------------- */
const nameKey = v => String(v || '').toLowerCase().replace(/\bdr\.?\s*/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const byName = s => whoName(s);
function findDir(col, name) { const k = nameKey(name); if (!k) return null; for (const [p, d] of docs) if (p.startsWith(col + '/') && (nameKey(d.name) === k || (d.aliases || []).some(a => nameKey(a) === k))) return Object.assign({ id: p.slice(col.length + 1) }, d); return null; }
async function ensureFacility(name, address, s, picked) {
  name = String(name || '').trim().slice(0, 120); if (!name || nameKey(name).length < 2) return null;
  const hit = findDir('facilities', name); if (hit) return hit;
  const id = 'f' + crypto.randomBytes(7).toString('hex');
  let lat = null, lng = null, label = '';
  address = String(address || '').trim().slice(0, 300);
  if (address) { const g = picked || await geocode(address); if (g) { lat = g.lat; lng = g.lng; label = g.label; } }
  const doc = { name, address, lat, lng, map_label: label, radius_m: null, aliases: [], approved: s.role === 'owner', added_by: byName(s), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await put('facilities/' + id, doc);
  if (s.role !== 'owner') {
    notifyOwner('Facility to approve', byName(s) + ' added ' + name + (address ? ' (' + address + ')' : '') + '. Approve it in Admin → Facilities.').catch(() => {});
    emailApproval('facility', id, doc, byName(s), s.base || process.env.PUBLIC_URL || '').catch(() => {});
  }
  return Object.assign({ id }, doc);
}
async function ensureSurgeon(name, facility, specialty, s) {
  name = String(name || '').trim().slice(0, 120); if (!name || nameKey(name).length < 2) return null;
  const hit = findDir('surgeons', name); if (hit) return hit;
  const id = 's' + crypto.randomBytes(7).toString('hex');
  const doc = { name, facility: String(facility || '').trim().slice(0, 120), specialty: String(specialty || '').trim().slice(0, 80), phone: '', notes: '', approved: s.role === 'owner', added_by: byName(s), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await put('surgeons/' + id, doc);
  if (s.role !== 'owner') {
    notifyOwner('Surgeon to approve', byName(s) + ' added ' + name + ' to the directory. Approve it in Admin → Surgeons.').catch(() => {});
    emailApproval('surgeon', id, doc, byName(s), s.base || process.env.PUBLIC_URL || '').catch(() => {});
  }
  return Object.assign({ id }, doc);
}
/* ---------------- approval emails: a rep adds a facility or surgeon → the COO gets an email with a one-click Approve link ---------------- */
const mail = require('./server/mail');
let hubMail = { at: 0, cfg: null };
const mailCfg = () => Object.assign({}, docs.get('config/mail') || {}, hubMail.cfg && hubMail.cfg.tenant && hubMail.cfg.client && hubMail.cfg.secret ? { tenant: hubMail.cfg.tenant, client: hubMail.cfg.client, secret: hubMail.cfg.secret, mailbox: hubMail.cfg.mailbox || (docs.get('config/mail') || {}).mailbox, from: hubMail.cfg.from || (docs.get('config/mail') || {}).from, to: hubMail.cfg.to || (docs.get('config/mail') || {}).to, viaHub: true } : {});
async function refreshHubMail() { if (!hubLinked() || Date.now() - hubMail.at < 300000) return; try { hubMail = { at: Date.now(), cfg: await hubCall('/api/hub/mail') }; } catch (e) { hubMail.at = Date.now() - 240000; } }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const APPROVE_DAYS = 14;
function approveToken(kind, id) {
  const exp = Date.now() + APPROVE_DAYS * 864e5;
  const body = `${kind}.${id}.${exp}`;
  return body + '.' + crypto.createHmac('sha256', SECRET).update('approve:' + body).digest('hex').slice(0, 40);
}
function readApproveToken(t) {
  const m = /^(facility|surgeon)\.([A-Za-z0-9_-]{1,40})\.(\d+)\.([0-9a-f]{40})$/.exec(String(t || ''));
  if (!m) return null;
  const body = `${m[1]}.${m[2]}.${m[3]}`;
  const sig = crypto.createHmac('sha256', SECRET).update('approve:' + body).digest('hex').slice(0, 40);
  if (sig.length !== m[4].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[4]))) return null;
  if (Number(m[3]) < Date.now()) return { expired: true, kind: m[1], id: m[2] };
  return { kind: m[1], id: m[2] };
}
const NAVY = '#0f1b33', BLUE = '#0b4d96', TEAL = '#0097b2', INK = '#121c2f', INK2 = '#5d6879', LINE = '#e2e7ee', GROUND = '#f3f5f8', FONT = "'Poppins','Segoe UI',Arial,sans-serif";
const when = (d) => new Date(d || Date.now()).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
// The email itself: the same card style as the peptide store's emails (navy header with the logo, facts, two buttons).
function approvalEmail({ kind, doc, id, by, base }) {
  const isFac = kind === 'facility';
  const title = isFac ? `New facility: ${doc.name}` : `New surgeon: ${doc.name}`;
  const approveUrl = `${base}/approve?t=${encodeURIComponent(approveToken(kind, id))}`;
  const adminUrl = `${base}/admin#${isFac ? 'facilities' : 'surgeons'}`;
  const mapUrl = isFac && doc.lat != null ? `https://www.openstreetmap.org/?mlat=${doc.lat}&mlon=${doc.lng}#map=17/${doc.lat}/${doc.lng}` : '';
  const facts = isFac
    ? [['Facility', doc.name], ['Address', doc.address || '(no address given)'], ['On the map', doc.lat != null ? `${doc.map_label || doc.address}` : 'Not found on the map — check the address'], ['Added by', by], ['When', when(doc.updated_at || doc.created_at)]]
    : [['Surgeon', doc.name], ['Specialty', doc.specialty || '—'], ['Facility', doc.facility || '—'], ['Added by', by], ['When', when(doc.created_at)]];
  const row = (l, v) => `<tr><td style="padding:6px 16px 6px 0;font:600 12px/1.4 ${FONT};color:${INK2};text-transform:uppercase;letter-spacing:.08em;vertical-align:top;white-space:nowrap">${esc(l)}</td><td style="padding:6px 0;font:600 15px/1.45 ${FONT};color:${INK};vertical-align:top">${esc(v)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${GROUND}">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(by)} added ${esc(doc.name)} — approve it with one tap.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td style="background:${NAVY};padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td align="left"><img src="${esc(base)}/logo.png" alt="360 Medical" height="36" style="display:block;height:36px;width:auto;border:0"></td>
    <td align="right" style="font:700 11px/1.3 ${FONT};color:#8fc6ff;text-transform:uppercase;letter-spacing:.12em">Surgical Case Tracker</td></tr></table></td></tr>
  <tr><td style="padding:28px 28px 6px">
    <div style="font:700 12px/1.4 ${FONT};color:${BLUE};text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Approval needed</div>
    <h1 style="margin:0 0 10px;font:800 24px/1.2 ${FONT};color:${INK}">${esc(title)} &nbsp;<span style="display:inline-block;vertical-align:middle;padding:5px 12px;border-radius:999px;background:#fff1cc;color:#6b4b00;font:700 11px/1.3 ${FONT};text-transform:uppercase;letter-spacing:.06em">Pending</span></h1>
    <p style="margin:0;font:15px/1.55 ${FONT};color:${INK}">${esc(by)} added ${isFac ? 'a facility' : 'a surgeon'} to the shared directory. ${isFac ? 'Until you approve the address, check-ins at this facility can\'t turn green.' : 'Approve to confirm it belongs in the directory every rep picks from.'}</p>
  </td></tr>
  <tr><td style="padding:12px 28px 4px"><table role="presentation" cellpadding="0" cellspacing="0">${facts.map(([l, v]) => row(l, v)).join('')}</table></td></tr>
  <tr><td style="padding:22px 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="background:${NAVY};border-radius:8px"><a href="${esc(approveUrl)}" style="display:inline-block;padding:13px 24px;font:700 15px/1 ${FONT};color:#ffffff;text-decoration:none">Approve ${isFac ? 'facility' : 'surgeon'}</a></td>
    <td style="width:10px"></td>
    <td style="border:1px solid #c9d1dc;border-radius:8px"><a href="${esc(adminUrl)}" style="display:inline-block;padding:12px 20px;font:600 15px/1 ${FONT};color:${NAVY};text-decoration:none">Open in Admin</a></td>
    ${mapUrl ? `<td style="width:10px"></td><td style="border:1px solid #c9d1dc;border-radius:8px"><a href="${esc(mapUrl)}" style="display:inline-block;padding:12px 20px;font:600 15px/1 ${FONT};color:${NAVY};text-decoration:none">See map</a></td>` : ''}
  </tr></table></td></tr>
  <tr><td style="padding:14px 28px 26px;font:13px/1.55 ${FONT};color:${INK2}">The Approve link works once, for ${APPROVE_DAYS} days, without signing in. To change or remove the entry, use Admin → ${isFac ? 'Facilities' : 'Surgeons'}.</td></tr>
  <tr><td style="padding:16px 28px;font:12px/1.5 ${FONT};color:${INK2};background:${GROUND};border-top:1px solid ${LINE}">Sent by the 360 Medical Surgical Case Tracker to the COO address under Admin → Approval emails. Confidential: internal sales data.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', `${by} added ${isFac ? 'a facility' : 'a surgeon'} to the shared directory.`, '', ...facts.map(([l, v]) => `${l}: ${v}`), '', `Approve: ${approveUrl}`, `Open in Admin: ${adminUrl}`, mapUrl ? `Map: ${mapUrl}` : ''].filter((x) => x !== '').join('\n');
  return { subject: `Approve ${isFac ? 'facility' : 'surgeon'}: ${doc.name} (added by ${by})`, html, text };
}
async function emailApproval(kind, id, doc, by, base) {
  await refreshHubMail();
  const cfg = mailCfg();
  if (cfg.on === false) return { ok: false, error: 'off' };
  const to = cfg.to || process.env.COO_EMAIL || '';
  const m = approvalEmail({ kind, doc, id, by, base });
  const r = await mail.send(cfg, { to, subject: m.subject, html: m.html, text: m.text });
  console.log(`Approval email (${kind} ${doc.name}, by ${by}) → ${to || '(no address)'}: ${r.ok ? 'sent' : 'FAILED: ' + r.error}`);
  return r;
}
// one-click approve from the email (signed link, no sign-in)
app.get('/approve', (req, res) => {
  const t = readApproveToken(req.query.t);
  const base = baseUrl(req);
  const pageHtml = (title, body, ok) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/theme-360.css"></head>
<body><div class="wrap"><header class="head"><img class="logo" src="/logo.png" alt="360 Medical"><div class="headtxt"><h1>Surgical Case Tracker</h1><span class="conf">Directory approval</span></div></header>
<section class="card" style="max-width:34rem"><h2>${esc(title)}</h2><p class="note" style="margin:8px 0 14px">${body}</p><div class="tools"><a class="btn primary" href="${esc(base)}/admin">Open Admin</a>${ok ? '' : `<a class="btn" href="${esc(base)}/login">Sign in</a>`}</div></section></div></body></html>`;
  res.set('Cache-Control', 'no-store');
  if (!t) return res.status(400).send(pageHtml("That link isn't valid", 'It may have been copied incompletely. Open Admin and approve the entry there.', false));
  if (t.expired) return res.status(410).send(pageHtml('That link has expired', `Approve links work for ${APPROVE_DAYS} days. Open Admin and approve the entry there.`, false));
  const col = t.kind === 'facility' ? 'facilities' : 'surgeons', k = col + '/' + t.id, d = docs.get(k);
  if (!d) return res.status(404).send(pageHtml('Already gone', `That ${t.kind} is no longer in the directory (someone may have removed it).`, true));
  if (d.approved === true) return res.send(pageHtml(`${esc(d.name)} is already approved`, 'Nothing more to do.', true));
  put(k, Object.assign({}, d, { approved: true, approved_at: new Date().toISOString(), approved_by: 'email link' })).then(() => {
    res.send(pageHtml(`${esc(d.name)} approved`, t.kind === 'facility' ? 'The address is confirmed, so check-ins at this facility can verify from now on.' : 'The surgeon is confirmed in the shared directory.', true));
  }).catch(() => res.status(500).send(pageHtml('Could not save', 'Try again in a moment, or approve it in Admin.', false)));
});
app.get('/api/admin/mail', needApi('owner'), async (req, res) => { await refreshHubMail(); const c = mailCfg(); res.json({ viaHub: !!c.viaHub, hub: hubLinked() ? HUB_URL : '', on: c.on !== false, to: c.to || process.env.COO_EMAIL || '', tenant: c.tenant || process.env.GRAPH_TENANT || '', client: c.client || process.env.GRAPH_CLIENT || '', secretSet: !!(c.secret || process.env.GRAPH_SECRET), mailbox: c.mailbox || '', from: c.from || process.env.MAIL_FROM || '', info: mail.info(c) }); });
app.post('/api/admin/mail', needApi('owner'), async (req, res) => {
  const b = req.body || {}, prev = docs.get('config/mail') || {}; // the local doc only: the store's secret must not be copied in
  const str = (v, n) => String(v || '').trim().slice(0, n);
  const to = str(b.to, 160); if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "The COO email address doesn't look right." });
  const doc = { on: b.on !== false, to, tenant: str(b.tenant, 120), client: str(b.client, 120), mailbox: str(b.mailbox, 160), from: str(b.from, 200), secret: str(b.secret, 300) || prev.secret || '', updated_at: new Date().toISOString() };
  if (doc.from && !/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(doc.from) && !/^[^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(doc.from)) return res.status(400).json({ error: 'The From address should look like "360 Medical <no-reply@360medical.net>" or just the address.' });
  await put('config/mail', doc);
  res.json({ ok: true, info: mail.info(doc) });
});
app.post('/api/admin/mail/clear', needApi('owner'), async (req, res) => { await del('config/mail'); res.json({ ok: true }); });
app.post('/api/admin/mail/test', needApi('owner'), async (req, res) => {
  const sample = { name: 'Valley Baptist Medical Center', address: '2101 Pease St, Harlingen, TX 78550', map_label: '2101 Pease St, Harlingen, TX 78550', lat: 26.1836, lng: -97.7118, created_at: new Date().toISOString() };
  const r = await emailApproval('facility', 'test', sample, whoName(req.s) + ' (test)', baseUrl(req));
  if (!r.ok) return res.status(400).json({ error: r.error === 'off' ? 'Approval emails are turned off.' : r.error });
  res.json({ ok: true, to: mailCfg().to || process.env.COO_EMAIL || '' });
});
app.get('/api/admin/mail/preview', needApi('owner'), (req, res) => {
  const kind = req.query.kind === 'surgeon' ? 'surgeon' : 'facility';
  const sample = kind === 'facility' ? { name: 'Valley Baptist Medical Center', address: '2101 Pease St, Harlingen, TX 78550', map_label: '2101 Pease St, Harlingen, TX 78550', lat: 26.1836, lng: -97.7118, created_at: new Date().toISOString() }
    : { name: 'Dr. Maria Salinas', specialty: 'Orthopedic surgery', facility: 'Valley Baptist Medical Center', created_at: new Date().toISOString() };
  res.type('html').send(approvalEmail({ kind, doc: sample, id: 'preview', by: 'Brandon', base: baseUrl(req) }).html);
});
app.post('/api/admin/surgeons/:id/approve', needApi('owner'), async (req, res) => {
  const k = 'surgeons/' + req.params.id, d = docs.get(k); if (!d) return res.status(404).json({ error: 'No such surgeon' });
  await put(k, Object.assign({}, d, { approved: true, approved_at: new Date().toISOString(), approved_by: whoName(req.s) })); res.json({ ok: true });
});

app.post('/api/directory/surgeon', needApi(), async (req, res) => {
  const b = req.body || {}; if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Surgeon name is required.' });
  req.s.base = baseUrl(req);
  const existed = findDir('surgeons', b.name);
  const d = existed || await ensureSurgeon(b.name, b.facility, b.specialty, req.s);
  if (b.facility) await ensureFacility(b.facility, '', req.s);
  res.json({ ok: true, existed: !!existed, surgeon: d });
});
app.post('/api/directory/facility', needApi(), async (req, res) => {
  const b = req.body || {}; if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Facility name is required.' });
  req.s.base = baseUrl(req);
  const existed = findDir('facilities', b.name), address = String(b.address || '').trim().slice(0, 300);
  const pickedLat = Number(b.lat), pickedLng = Number(b.lng), picked = address && isFinite(pickedLat) && isFinite(pickedLng) && Math.abs(pickedLat) <= 90 && Math.abs(pickedLng) <= 180 && b.lat !== '' && b.lat != null ? { lat: Math.round(pickedLat * 1e6) / 1e6, lng: Math.round(pickedLng * 1e6) / 1e6, label: address } : null;
  if (existed && address && existed.lat == null) {
    // fill in the missing address on a facility that's already in the list
    const g = picked || await geocode(address);
    if (!g) return res.status(400).json({ error: 'Could not find that address on the map. Check the street, city and ZIP.' });
    const k = 'facilities/' + existed.id, doc = Object.assign({}, docs.get(k), { address, lat: g.lat, lng: g.lng, map_label: g.label, approved: req.s.role === 'owner', address_by: byName(req.s), updated_at: new Date().toISOString() });
    await put(k, doc);
    if (req.s.role !== 'owner') {
      notifyOwner('Facility address to approve', byName(req.s) + ' added the address for ' + doc.name + '. Approve it in Admin → Facilities.').catch(() => {});
      emailApproval('facility', existed.id, doc, byName(req.s), baseUrl(req)).catch(() => {});
    }
    return res.json({ ok: true, existed: true, updated: true, facility: Object.assign({ id: existed.id }, doc) });
  }
  const d = existed || await ensureFacility(b.name, address, req.s, picked);
  if (!existed && d && address && d.lat == null) return res.json({ ok: true, existed: false, facility: d, not_found: true });
  res.json({ ok: true, existed: !!existed, facility: d });
});
app.post('/api/admin/surgeons', needApi('owner'), async (req, res) => {
  const b = req.body || {}, id = b.id && /^[A-Za-z0-9_-]{1,40}$/.test(b.id) ? b.id : 's' + crypto.randomBytes(7).toString('hex');
  const name = String(b.name || '').trim().slice(0, 120); if (!name) return res.status(400).json({ error: 'Surgeon name is required.' });
  const dupe = findDir('surgeons', name); if (dupe && dupe.id !== id) return res.status(400).json({ error: name + ' is already in the directory.' });
  const prev = docs.get('surgeons/' + id) || {};
  const doc = Object.assign({}, prev, { name, specialty: String(b.specialty || '').trim().slice(0, 80), facility: String(b.facility || '').trim().slice(0, 120), phone: String(b.phone || '').trim().slice(0, 40), notes: String(b.notes || '').slice(0, 1000), approved: true, added_by: prev.added_by || 'COO', created_at: prev.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
  await put('surgeons/' + id, doc);
  if (doc.facility) await ensureFacility(doc.facility, '', req.s);
  res.json({ ok: true, id, surgeon: doc });
});
app.delete('/api/admin/surgeons/:id', needApi('owner'), async (req, res) => { const k = 'surgeons/' + req.params.id; if (docs.has(k)) await del(k); res.json({ ok: true }); });
app.post('/api/admin/facilities/:id/approve', needApi('owner'), async (req, res) => {
  const k = 'facilities/' + req.params.id, d = docs.get(k); if (!d) return res.status(404).json({ error: 'No such facility' });
  await put(k, Object.assign({}, d, { approved: true, approved_at: new Date().toISOString() })); res.json({ ok: true });
});


/* ---------------- manager accounts: password + authenticator app, passkeys (Face ID / Touch ID) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(str) { let bits = 0, val = 0; const out = []; for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = ((val << 5) | B32.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(key, counter) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); }
function totpCheck(secret, code, lastStep) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6 || !secret) return null;
  const key = b32dec(secret), step = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) { const st = step + d; if (lastStep != null && st <= lastStep) continue; if (crypto.timingSafeEqual(Buffer.from(hotp(key, st)), Buffer.from(code))) return st; }
  return null;
}
function hashPw(pw) { const salt = crypto.randomBytes(16); return 'scrypt$' + salt.toString('base64') + '$' + crypto.scryptSync(String(pw), salt, 64).toString('base64'); }
function checkPw(pw, stored) { if (!stored) return false; const [, salt, h] = stored.split('$'); const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 64); return crypto.timingSafeEqual(got, Buffer.from(h, 'base64')); }
const tokHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const pubMgr = m => ({ id: m.id, kind: m.kind || 'manager', rep: m.rep || null, name: m.name, email: m.email, can_manage: m.kind !== 'rep' && !!m.can_manage, active: m.active !== false, totp_on: !!m.totp_on, pending: !m.totp_on, passkeys: (m.passkeys || []).map(p => ({ id: p.id.slice(0, 10), label: p.label, at: p.at, last: p.last })), last_login: m.last_login || null, created_at: m.created_at, created_by: m.created_by || '' });
function baseUrl(req) { return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
function newSetup(m, req) { const t = crypto.randomBytes(24).toString('base64url'); m.setup_hash = tokHash(t); m.setup_exp = Date.now() + 7 * 864e5; m.setup_secret = null; return baseUrl(req) + '/setup#t=' + t; }

app.get('/api/admin/managers', needApi('owner'), (req, res) => res.json({ managers: Object.values(mgrs()).map(pubMgr), pin_login: !pinOff(), me: req.s.mgr || null, super: isSuper(req.s) }));
app.post('/api/admin/managers', needApi('super'), async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80), email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a name and a valid email.' });
  const m = Object.assign({}, mgrs()), kind = req.body.kind === 'rep' ? 'rep' : 'manager', repName = String(req.body.rep || '');
  if (Object.values(m).some(x => x.email === email)) return res.status(400).json({ error: email + ' already has an account.' });
  if (kind === 'rep') {
    if (!quotaRows().some(r => r.rep === repName && r.role !== 'Team')) return res.status(400).json({ error: 'Pick which rep this account belongs to.' });
    if (Object.values(m).some(x => x.kind === 'rep' && x.rep === repName)) return res.status(400).json({ error: repName + ' already has an email account. Use Reset sign-in on it instead.' });
  }
  const id = crypto.randomBytes(6).toString('hex'), rec = { id, kind, rep: kind === 'rep' ? repName : null, name, email, can_manage: kind === 'manager' && !!req.body.can_manage, active: true, v: 1, passkeys: [], created_at: new Date().toISOString(), created_by: whoName(req.s) };
  const link = newSetup(rec, req); m[id] = rec; await saveMgrs(m);
  res.json({ ok: true, manager: pubMgr(rec), setup_url: link });
});
app.post('/api/admin/managers/:id', needApi('super'), async (req, res) => {
  const m = Object.assign({}, mgrs()), rec = m[req.params.id]; if (!rec) return res.status(404).json({ error: 'No such manager.' });
  if (req.s.mgr === rec.id && (req.body.active === false || req.body.can_manage === false)) return res.status(400).json({ error: 'You cannot turn off your own access.' });
  const next = Object.assign({}, rec);
  if (typeof req.body.name === 'string' && req.body.name.trim()) next.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body.can_manage === 'boolean' && rec.kind !== 'rep') next.can_manage = req.body.can_manage;
  if (typeof req.body.active === 'boolean' && req.body.active !== (rec.active !== false)) { next.active = req.body.active; next.v++; }
  m[rec.id] = next; await saveMgrs(m); res.json({ ok: true, manager: pubMgr(next) });
});
app.post('/api/admin/managers/:id/reset', needApi('super'), async (req, res) => {
  const m = Object.assign({}, mgrs()), rec = m[req.params.id]; if (!rec) return res.status(404).json({ error: 'No such manager.' });
  const next = Object.assign({}, rec, { pw: null, totp_secret: null, totp_on: false, totp_last: null, passkeys: [], v: rec.v + 1 });
  const link = newSetup(next, req); m[rec.id] = next; await saveMgrs(m);
  res.json({ ok: true, setup_url: link, manager: pubMgr(next) });
});
app.delete('/api/admin/managers/:id', needApi('super'), async (req, res) => {
  if (req.s.mgr === req.params.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const m = Object.assign({}, mgrs()); delete m[req.params.id]; await saveMgrs(m); res.json({ ok: true });
});
app.post('/api/admin/pin-login', needApi('super'), async (req, res) => {
  const off = req.body.enabled === false;
  if (off) {
    if (!req.s.mgr) return res.status(400).json({ error: 'Sign in with your own manager account first, then turn off the PIN, so you are not locked out.' });
    if (!Object.values(mgrs()).some(x => x.kind !== 'rep' && x.active !== false && x.can_manage && x.totp_on)) return res.status(400).json({ error: 'Set up at least one manager who can manage managers first.' });
  }
  await put('_auth/admin', Object.assign({}, docs.get('_auth/admin') || { pin: ENV_ADMIN_PIN, v: adminV() }, { pin: adminPin(), v: adminV() + (off ? 1 : 0), pin_disabled: off }));
  res.json({ ok: true, pin_login: !off });
});

/* setup link: set password + connect authenticator app */
function setupRec(token) { const h = tokHash(token || ''); return Object.values(mgrs()).find(m => m.setup_hash && m.setup_hash === h && m.setup_exp > Date.now()); }
app.post('/api/setup/info', async (req, res) => {
  const rec = setupRec(req.body.token); if (!rec) return res.status(400).json({ error: 'This setup link has expired or was already used. Ask for a new one.' });
  const m = Object.assign({}, mgrs()), r = Object.assign({}, rec);
  if (!r.setup_secret) { r.setup_secret = b32enc(crypto.randomBytes(20)); m[r.id] = r; await saveMgrs(m); }
  const label = encodeURIComponent('360 Medical:' + r.email);
  res.json({ name: r.name, email: r.email, secret: r.setup_secret, otpauth: 'otpauth://totp/' + label + '?secret=' + r.setup_secret + '&issuer=' + encodeURIComponent('360 Medical') + '&algorithm=SHA1&digits=6&period=30' });
});
app.post('/api/setup/finish', async (req, res) => {
  const t = throttled(req.ip); if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  const rec = setupRec(req.body.token); if (!rec) return res.status(400).json({ error: 'This setup link has expired. Ask for a new one.' });
  const pw = String(req.body.password || '');
  if (pw.length < 10) return res.status(400).json({ error: 'Use a password of at least 10 characters.' });
  const step = null; // no authenticator app any more: the password is enough
  const m = Object.assign({}, mgrs()), r = Object.assign({}, rec, { pw: hashPw(pw), totp_secret: null, totp_on: true, totp_last: step, setup_hash: null, setup_exp: null, setup_secret: null, v: rec.v + 1, active: true, last_login: new Date().toISOString() });
  m[r.id] = r; await saveMgrs(m);
  setSession(res, acctSession(r), req.body.dev);
  res.json({ ok: true, kind: r.kind || 'manager' });
});

/* sign in: email + password (no 2-step code) */
app.post('/api/login/manager', async (req, res) => {
  const t = throttled(req.ip); if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const email = String(req.body.email || '').trim().toLowerCase(), rec = Object.values(mgrs()).find(m => m.email === email);
  // no 2-step code (owner request): a tracker account with the right password signs straight in
  if (rec && rec.active !== false && rec.pw && checkPw(req.body.password, rec.pw)) {
    const m = Object.assign({}, mgrs()); m[rec.id] = Object.assign({}, rec, { last_login: new Date().toISOString() }); await saveMgrs(m);
    tries.delete(req.ip); setSession(res, acctSession(rec), req.body.dev); return res.json({ ok: true, role: rec.kind === 'rep' ? 'rep' : 'owner' });
  }
  // one login for both apps: otherwise the email + password are checked against the store's Team logins
  if (email && hubLinked()) {
    let r = null; try { r = await hubCall('/api/hub/check-pass', { method: 'POST', body: JSON.stringify({ email, password: String(req.body.password || '') }) }); } catch (e) { return res.status(503).json({ error: 'Could not reach the store to check your login. Try again in a moment.' }); }
    if (r && r.ok && r.user) {
      const u = r.user;
      if (u.role === 'rep') {
        const name = Object.keys(pins().reps).find(k => pins().reps[k].hub === u.id && pins().reps[k].active !== false);
        if (!name) { t.n++; return res.status(403).json({ error: 'Your login is not set up for the case tracker yet. Ask the COO to turn on the tracker for you in Team logins.' }); }
        tries.delete(req.ip); setSession(res, { role: 'rep', rep: name, hub: u.email, v: (pins().reps[name] || {}).v }, req.body.dev);
        return res.json({ ok: true, role: 'rep' });
      }
      tries.delete(req.ip); setSession(res, { role: 'owner', hub: u.email, hubId: u.id, hubName: u.name, hubStaff: u.role !== 'owner', v: adminV() }, req.body.dev);
      return res.json({ ok: true, role: 'owner' });
    }
    if (r && r.noTracker) { t.n++; return res.status(403).json({ error: 'This login does not have the case tracker turned on. Tick it under Team logins in the store admin.' }); }
  }
  t.n++; return res.status(401).json({ error: 'Wrong email or password.' });
});
app.post('/api/login/code', async (req, res) => {
  const t = throttled(req.ip); if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const tk = unsign(req.body.ticket), rec = tk && tk.t === '2fa' ? mgrs()[tk.mgr] : null;
  if (!rec || rec.v !== tk.v || rec.active === false) return res.status(401).json({ error: 'Sign-in expired. Start again.' });
  const step = totpCheck(rec.totp_secret, req.body.code, rec.totp_last);
  if (step == null) { t.n++; return res.status(401).json({ error: 'Wrong code. Type the newest 6-digit code from your authenticator app.' }); }
  const m = Object.assign({}, mgrs()); m[rec.id] = Object.assign({}, rec, { totp_last: step, last_login: new Date().toISOString() }); await saveMgrs(m);
  tries.delete(req.ip); setSession(res, acctSession(rec), req.body.dev);
  res.json({ ok: true, role: rec.kind === 'rep' ? 'rep' : 'owner' });
});

/* passkeys: Face ID / Touch ID / Windows Hello */
let wa = null; try { wa = { srv: require('@simplewebauthn/server'), b64: require('@simplewebauthn/server/helpers').isoBase64URL }; } catch (e) { console.log('passkeys off: @simplewebauthn/server not installed'); }
const rp = req => { const u = new URL(baseUrl(req)); return { id: u.hostname, origin: u.origin }; };
app.post('/api/passkey/register/options', needApi(), async (req, res) => {
  if (!wa) return res.status(501).json({ error: 'Passkeys are not available on this server.' });
  const rec = acctOf(req.s); if (!rec) return res.status(400).json({ error: 'Face ID needs an email account. Ask the COO for an email invite.' });
  const r = rp(req);
  const options = await wa.srv.generateRegistrationOptions({ rpName: '360 Medical Case Tracker', rpID: r.id, userID: rec.id, userName: rec.email, userDisplayName: rec.name, attestationType: 'none',
    excludeCredentials: (rec.passkeys || []).map(p => ({ id: wa.b64.toBuffer(p.id), type: 'public-key' })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
  res.json({ options, ticket: sign({ t: 'reg', mgr: rec.id, ch: options.challenge, exp: Date.now() + 5 * 60e3 }) });
});
app.post('/api/passkey/register/verify', needApi(), async (req, res) => {
  const tk = unsign(req.body.ticket); if (!wa || !tk || tk.t !== 'reg' || tk.mgr !== (req.s.mgr || req.s.acct)) return res.status(400).json({ error: 'Setup expired. Try again.' });
  const r = rp(req);
  let v; try { v = await wa.srv.verifyRegistrationResponse({ response: req.body.response, expectedChallenge: tk.ch, expectedOrigin: r.origin, expectedRPID: r.id, requireUserVerification: true }); } catch (e) { return res.status(400).json({ error: 'Face ID setup did not verify: ' + e.message }); }
  if (!v.verified) return res.status(400).json({ error: 'Face ID setup did not verify.' });
  const info = v.registrationInfo, m = Object.assign({}, mgrs()), rec = Object.assign({}, m[req.s.mgr || req.s.acct]);
  rec.passkeys = (rec.passkeys || []).concat([{ id: wa.b64.fromBuffer(info.credentialID), pk: wa.b64.fromBuffer(info.credentialPublicKey), counter: info.counter || 0, label: String(req.body.label || 'This device').slice(0, 60), at: new Date().toISOString() }]).slice(-10);
  m[rec.id] = rec; await saveMgrs(m); res.json({ ok: true, passkeys: pubMgr(rec).passkeys });
});
app.post('/api/passkey/login/options', async (req, res) => {
  if (!wa) return res.status(501).json({ error: 'Passkeys are not available.' });
  const r = rp(req), options = await wa.srv.generateAuthenticationOptions({ rpID: r.id, userVerification: 'required' });
  res.json({ options, ticket: sign({ t: 'auth', ch: options.challenge, exp: Date.now() + 5 * 60e3 }) });
});
app.post('/api/passkey/login/verify', async (req, res) => {
  const t = throttled(req.ip); if (t.n >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  const tk = unsign(req.body.ticket), resp = req.body.response || {};
  if (!wa || !tk || tk.t !== 'auth') return res.status(400).json({ error: 'Sign-in expired. Try again.' });
  const rec = Object.values(mgrs()).find(m => m.active !== false && (m.passkeys || []).some(p => p.id === resp.id));
  if (!rec) { t.n++; return res.status(401).json({ error: 'This Face ID / passkey is not registered. Sign in with email and code, then turn on Face ID again.' }); }
  const pk = rec.passkeys.find(p => p.id === resp.id), r = rp(req);
  let v; try { v = await wa.srv.verifyAuthenticationResponse({ response: resp, expectedChallenge: tk.ch, expectedOrigin: r.origin, expectedRPID: r.id, requireUserVerification: true, authenticator: { credentialID: wa.b64.toBuffer(pk.id), credentialPublicKey: wa.b64.toBuffer(pk.pk), counter: pk.counter || 0 } }); } catch (e) { t.n++; return res.status(401).json({ error: 'Face ID did not verify.' }); }
  if (!v.verified) { t.n++; return res.status(401).json({ error: 'Face ID did not verify.' }); }
  const m = Object.assign({}, mgrs()), r2 = Object.assign({}, rec);
  r2.passkeys = rec.passkeys.map(p => p.id === pk.id ? Object.assign({}, p, { counter: v.authenticationInfo.newCounter, last: new Date().toISOString() }) : p); r2.last_login = new Date().toISOString();
  m[r2.id] = r2; await saveMgrs(m);
  tries.delete(req.ip); setSession(res, acctSession(r2), req.body.dev);
  res.json({ ok: true, role: r2.kind === 'rep' ? 'rep' : 'owner', name: r2.name });
});
app.get('/api/me/passkeys', needApi(), (req, res) => { const rec = acctOf(req.s); res.json({ manager: !!rec, passkeys: rec ? pubMgr(rec).passkeys : [], available: !!wa }); });
app.delete('/api/me/passkeys/:pid', needApi(), async (req, res) => {
  const m = Object.assign({}, mgrs()), rec = m[req.s.mgr || req.s.acct]; if (!rec) return res.status(400).json({ error: 'No account.' });
  m[rec.id] = Object.assign({}, rec, { passkeys: (rec.passkeys || []).filter(p => p.id.slice(0, 10) !== req.params.pid) }); await saveMgrs(m); res.json({ ok: true });
});


/* ---------------- product videos ---------------- */
app.post('/api/admin/videos', needApi('owner'), express.raw({ type: () => true, limit: '160mb' }), async (req, res) => {
  const pid = String(req.query.product || ''), k = 'products/' + pid, prod = docs.get(k);
  if (!prod) return res.status(404).json({ error: 'Save the product first, then add videos.' });
  const type = String(req.get('content-type') || '').split(';')[0];
  if (!/^video\/(mp4|webm|quicktime)$/.test(type)) return res.status(400).json({ error: 'Upload an MP4 video (H.264). WebM and MOV also work in most browsers.' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'The video did not arrive. Try again.' });
  const id = 'vid' + crypto.randomBytes(8).toString('hex');
  await filePut(id, type, req.body, String(req.query.name || '').slice(0, 120));
  const poster = /^img[a-f0-9]{18}$/.test(String(req.query.poster || '')) && docs.has('_img/' + req.query.poster) ? String(req.query.poster) : null;
  const v = { id, title: String(req.query.title || 'Product video').slice(0, 120), poster, type, size: req.body.length, duration: Number(req.query.duration) || null };
  const next = Object.assign({}, docs.get(k)); next.videos = (next.videos || []).concat([v]).slice(0, 8);
  await put(k, next); res.json({ ok: true, video: v });
});
app.post('/api/admin/videos/:pid/:vid', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.pid, prod = docs.get(k); if (!prod) return res.status(404).json({ error: 'No such product' });
  const next = Object.assign({}, prod); next.videos = (prod.videos || []).map(v => v.id === req.params.vid ? Object.assign({}, v, { title: String(req.body.title || v.title).slice(0, 120) }) : v);
  await put(k, next); res.json({ ok: true });
});
app.delete('/api/admin/videos/:pid/:vid', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.pid, prod = docs.get(k); if (!prod) return res.status(404).json({ error: 'No such product' });
  const v = (prod.videos || []).find(x => x.id === req.params.vid);
  const next = Object.assign({}, prod); next.videos = (prod.videos || []).filter(x => x.id !== req.params.vid);
  await put(k, next);
  if (v) { await fileDel(v.id); if (v.poster && docs.has('_img/' + v.poster)) await del('_img/' + v.poster); }
  res.json({ ok: true });
});


/* ---------------- video links (Vimeo / YouTube embeds) ---------------- */
function parseVideoUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  const h = u.hostname.replace(/^www\./, '');
  if (/(^|\.)vimeo\.com$/.test(h)) {
    const m = /(?:video\/)?(\d{6,})(?:\/([a-f0-9]{6,}))?/.exec(u.pathname); if (!m) return null;
    const hash = u.searchParams.get('h') || m[2] || '';
    return { provider: 'vimeo', vid: m[1], embed: 'https://player.vimeo.com/video/' + m[1] + (hash ? '?h=' + hash : ''), url: 'https://vimeo.com/' + m[1] + (hash ? '/' + hash : '') };
  }
  if (h === 'youtu.be' || /(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
    const id = h === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || (/\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(u.pathname) || [])[1]);
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    return { provider: 'youtube', vid: id, embed: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0', url: 'https://www.youtube.com/watch?v=' + id, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
  }
  return null;
}
async function resolveVideo(raw) {
  const v = parseVideoUrl(raw); if (!v) return null;
  const oe = v.provider === 'vimeo' ? 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(raw) : 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(v.url);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(oe, { signal: ctl.signal }); clearTimeout(t);
    if (r.ok) {
      const j = await r.json(), src = (/src="([^"]+)"/.exec(j.html || '') || [])[1];
      if (src && v.provider === 'vimeo') { const hh = new URL(src.replace(/&amp;/g, '&')).searchParams.get('h'); if (hh) v.embed = 'https://player.vimeo.com/video/' + v.vid + '?h=' + hh; }
      v.title = j.title || ''; v.author = j.author_name || ''; v.thumb = j.thumbnail_url || v.thumb || ''; v.duration = j.duration || null;
    }
  } catch (e) {}
  return v;
}
async function addVideoLink(k, v) {
  const prod = Object.assign({}, docs.get(k)), list = (prod.video_links || []).filter(x => x.embed !== v.embed);
  prod.video_links = list.concat([{ id: 'vl' + crypto.randomBytes(5).toString('hex'), provider: v.provider, url: v.url, embed: v.embed, title: v.title || (v.provider === 'vimeo' ? 'Vimeo video' : 'YouTube video'), author: v.author || '', thumb: v.thumb || '', duration: v.duration || null }]).slice(0, 8);
  await put(k, prod); return prod.video_links[prod.video_links.length - 1];
}
app.post('/api/admin/products/:id/video-links', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id; if (!docs.has(k)) return res.status(404).json({ error: 'Save the product first.' });
  const v = await resolveVideo(req.body.url);
  if (!v) return res.status(400).json({ error: 'Paste a Vimeo or YouTube link, e.g. https://vimeo.com/123456789' });
  if (req.body.title) v.title = String(req.body.title).slice(0, 120);
  res.json({ ok: true, link: await addVideoLink(k, v) });
});
app.post('/api/admin/products/:id/video-links/:lid', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id, prod = docs.get(k); if (!prod) return res.status(404).json({ error: 'No such product' });
  const next = Object.assign({}, prod); next.video_links = (prod.video_links || []).map(x => x.id === req.params.lid ? Object.assign({}, x, { title: String(req.body.title || x.title).slice(0, 120) }) : x);
  await put(k, next); res.json({ ok: true });
});
app.delete('/api/admin/products/:id/video-links/:lid', needApi('owner'), async (req, res) => {
  const k = 'products/' + req.params.id, prod = docs.get(k); if (!prod) return res.status(404).json({ error: 'No such product' });
  const next = Object.assign({}, prod); next.video_links = (prod.video_links || []).filter(x => x.id !== req.params.lid);
  await put(k, next); res.json({ ok: true });
});
async function seedVideoLinks(only) {
  if (!only && docs.has('_seed/vlinks')) return;
  const entry = [...docs].find(([k, d]) => k.startsWith('products/') && (!only || only.has(k)) && /xtant medical portfolio/i.test(d.name || ''));
  if (!entry) return;
  const v = (await resolveVideo('https://vimeo.com/1132641948?fl=pl&fe=cm')) || {};
  await addVideoLink(entry[0], { provider: 'vimeo', url: 'https://vimeo.com/1132641948/60cd6de7cc', embed: v.embed && /h=/.test(v.embed) ? v.embed : 'https://player.vimeo.com/video/1132641948?h=60cd6de7cc', title: 'Xtant Medical · Biologics', author: 'Xtant Medical', thumb: v.thumb || 'https://i.vimeocdn.com/video/2076944072-80c50880bdccecd432a20270a9ae747db565bd742f365a9b06374d24bb5f285e-d?f=webp&region=us', duration: v.duration || null });
  await put('_seed/vlinks', { at: new Date().toISOString() });
}


/* extra Stability Biologics photos (cleaned from the product page banner) */
async function seedStabilityPhotos(only) {
  if (!only && docs.has('_seed/stab-photos')) return;
  const dir = path.join(__dirname, 'seed', 'products', 'stability'), files = ['stability-dry-storage.jpg', 'stability-large-graft.jpg', 'stability-range-of-sizes.jpg'];
  if (!files.every(f => fs.existsSync(path.join(dir, f)))) return;
  const targets = [...docs].filter(([k, d]) => k.startsWith('products/') && (!only || only.has(k)) && /stability biologics/i.test(d.manufacturer || ''));
  if (!targets.length) return;
  for (const [k] of targets) {
    const pid = k.slice(9), add = [];
    for (const f of files) {
      const id = 'img' + crypto.createHash('sha1').update(pid + f).digest('hex').slice(0, 18);
      if (!docs.has('_img/' + id)) await put('_img/' + id, { type: 'image/jpeg', b64: fs.readFileSync(path.join(dir, f)).toString('base64'), product: pid });
      add.push(id);
    }
    const next = Object.assign({}, docs.get(k)); next.photos = (next.photos || []).concat(add.filter(id => !(next.photos || []).includes(id))).slice(0, 12);
    await put(k, next);
  }
  await put('_seed/stab-photos', { at: new Date().toISOString(), products: targets.length });
}

function diagDump() {
  // read-only support aid: set DIAG_GREP on the service to print matching records to the log once at startup
  const q = String(process.env.DIAG_GREP || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean); if (!q.length) return;
  for (const [k, d] of docs) {
    if (!/^(visits|targets|surgeons|facilities)\//.test(k)) continue;
    const j = JSON.stringify(d).toLowerCase(); if (!q.some(x => j.includes(x))) continue;
    const pick = {}; ['rep', 'surgeon', 'name', 'facility', 'date', 'time', 'duration', 'status', 'check', 'check_attempts', 'reminded', 'created_by', 'target_id', 'address', 'lat', 'lng', 'approved', 'added_by', 'aliases'].forEach(f => { if (d[f] !== undefined) pick[f] = d[f]; });
    console.log('DIAG', k, JSON.stringify(pick));
  }
  const m = (docs.get('_auth/managers') || {}).m || {}; Object.values(m).forEach(a => { if (q.some(x => (a.rep || a.name || '').toLowerCase().includes(x))) console.log('DIAG account', JSON.stringify({ kind: a.kind, rep: a.rep, name: a.name, active: a.active, totp_on: a.totp_on, passkeys: (a.passkeys || []).length })); });
  console.log('DIAG settings', JSON.stringify(docs.get('config/settings') || {}), 'now', new Date().toISOString());
}
initStore().then(() => { diagDump(); app.listen(PORT, () => console.log(`360 Medical tracker on :${PORT} (storage: ${dbMode})`)); })
  .catch(e => { console.error('startup failed', e); process.exit(1); });
