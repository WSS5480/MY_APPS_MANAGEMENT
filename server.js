'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./lib/db');
const { E, ROLES, GROUPS, INTERNAL } = require('./lib/meta');
const logic = require('./lib/logic');
const { AppErr } = logic;

const VERSION = '1.0.0';
const SECRET = process.env.SESSION_SECRET || (process.env.DATABASE_URL && !/localhost|\/tmp\//.test(process.env.DATABASE_URL) ? (console.warn('[boot] SESSION_SECRET not set — using a random secret (sessions reset on restart)'), crypto.randomBytes(32).toString('hex')) : 'mna-dev-secret-local');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '12mb' }));

// ── helpers ──
const hashPin = pin => crypto.createHmac('sha256', SECRET).update('pin:' + String(pin)).digest('hex');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(uid) { const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 12 * 3600e3 })).toString('base64url'); return p + '.' + sign(p); }
function readToken(t) {
  if (!t || !t.includes('.')) return null;
  const [p, s] = t.split('.');
  const a = Buffer.from(sign(p)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function auth(req, res, next) {
  const tok = readToken(cookies(req).mna_s || (req.headers.authorization || '').replace('Bearer ', ''));
  if (!tok) return res.status(401).json({ code: 'AUTH', msg: ['Su sesión expiró. Ingrese su PIN.', 'Your session expired. Enter your PIN.'] });
  const u = await db.one('SELECT id, name, role, position, supplier_id, active FROM users WHERE id=$1', [tok.uid]);
  if (!u || u.active === false) return res.status(401).json({ code: 'AUTH', msg: ['Usuario inactivo.', 'Inactive user.'] });
  req.user = u; next();
}
const canRead = (e, u) => e.read.includes(u.role) || u.role === 'ADMIN';
const canWrite = (e, u) => e.write.includes(u.role) || u.role === 'ADMIN';
const visibleFields = (e, u) => e.fields.filter(f => f.t !== 'pin' && (!f.roles || f.roles.includes(u.role)));

// Row-level scope (supplier portal, drivers)
function scope(e, u) {
  if (u.role === 'PROV') {
    if (['purchase_orders', 'goods_receipts', 'supplier_invoices', 'supplier_payments'].includes(e.k)) return { sql: 'supplier_id = ' + (parseInt(u.supplier_id, 10) || -1) };
    return { sql: 'false' };
  }
  if (u.role === 'CHOF' && e.k === 'deliveries') return { sql: 'driver_id = ' + u.id };
  return null;
}
function ent(req) {
  const e = E[req.params.ent];
  if (!e) throw new AppErr(['Módulo no encontrado.', 'Module not found.'], 404);
  if (!canRead(e, req.user)) throw new AppErr(['No tiene acceso a este módulo.', 'You do not have access to this module.'], 403);
  return e;
}

function clean(e, body, u, isNew) {
  const out = {};
  for (const f of visibleFields(e, u)) {
    if (!(f.k in body) || f.ro) continue;
    out[f.k] = castVal(f, body[f.k]);
  }
  if (e.k === 'users' && body.pin) {
    if (!/^\d{4,6}$/.test(String(body.pin))) throw new AppErr(['El PIN debe tener de 4 a 6 dígitos.', 'PIN must be 4 to 6 digits.']);
    out.pin_hash = hashPin(body.pin);
  }
  if (e.lines && Array.isArray(body.lines)) {
    out.lines = body.lines.filter(l => l && Object.values(l).some(v => v !== '' && v != null)).map(l => {
      const o = {}; for (const f of e.lines) o[f.k] = castVal(f, l[f.k]); return o;
    });
  }
  if (isNew) for (const f of e.fields) if (out[f.k] == null && f.def !== undefined) out[f.k] = f.def;
  return out;
}
function castVal(f, v) {
  if (v === '' || v === undefined || v === null) return f.t === 'bool' ? false : null;
  switch (f.t) {
    case 'int': case 'ref': case 'file': { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
    case 'num': case 'money': case 'pct': { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; }
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'sí' || v === 'si';
    case 'date': { const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
    case 'select': return f.opts.some(o => o[0] === String(v)) ? String(v) : (f.opts.find(o => o[1].toLowerCase() === String(v).toLowerCase()) || [null])[0];
    default: return String(v).slice(0, 20000);
  }
}
function validate(e, row) {
  const miss = e.fields.filter(f => f.req && !f.ro && (row[f.k] === null || row[f.k] === undefined || row[f.k] === ''));
  if (miss.length) throw new AppErr(['Faltan campos obligatorios: ' + miss.map(f => f.l[0]).join(', '), 'Missing required fields: ' + miss.map(f => f.l[1]).join(', ')]);
  if (e.lines) for (const [i, l] of (row.lines || []).entries()) {
    const m = e.lines.filter(f => f.req && (l[f.k] === null || l[f.k] === undefined || l[f.k] === ''));
    if (m.length) throw new AppErr([`Partida ${i + 1}: falta ${m.map(f => f.l[0]).join(', ')}`, `Line ${i + 1}: missing ${m.map(f => f.l[1]).join(', ')}`]);
  }
}
function strip(e, row, u) {
  if (!row) return row;
  const hidden = e.fields.filter(f => f.roles && !f.roles.includes(u.role)).map(f => f.k);
  delete row.pin_hash; for (const k of hidden) delete row[k];
  return row;
}
async function resolveRefs(e, rows) {
  const refs = {};
  const fl = [...e.fields.filter(f => f.t === 'ref'), ...(e.lines || []).filter(f => f.t === 'ref').map(f => Object.assign({}, f, { inLines: true }))];
  for (const f of fl) {
    const ids = new Set();
    for (const r of rows) {
      if (f.inLines) (r.lines || []).forEach(l => l[f.k] && ids.add(l[f.k]));
      else if (r[f.k]) ids.add(r[f.k]);
    }
    if (!ids.size) continue;
    const te = E[f.ref];
    const res = await db.all(`SELECT id, ${labelSql(te)} AS t FROM ${te.k} WHERE id = ANY($1)`, [[...ids]]);
    refs[f.ref] = Object.assign(refs[f.ref] || {}, Object.fromEntries(res.map(x => [x.id, x.t])));
  }
  return refs;
}
function labelSql(te) {
  if (te.k === 'products' || te.k === 'customers') return `coalesce(code,'') || ' · ' || coalesce(name,'')`;
  if (te.k === 'goods_receipts') return `folio || ' · $' || to_char(coalesce(amount,0),'FM999,999,990.00')`;
  if (te.k === 'invoices') return `folio || ' · $' || to_char(coalesce(balance,0),'FM999,999,990.00')`;
  if (te.k === 'supplier_invoices') return `coalesce(left(uuid,8),'#'||id) || ' · $' || to_char(coalesce(total,0),'FM999,999,990.00')`;
  if (te.k === 'assets') return `tag || ' · ' || description`;
  if (te.k === 'deliveries' || te.k === 'double_freight') return `'#' || id`;
  return `coalesce(${te.title}::text, '#' || id)`;
}

async function audit(c, u, entity, id, action, detail) {
  await c.query('INSERT INTO audit_log(user_id,user_name,role,entity,record_id,action,detail) VALUES($1,$2,$3,$4,$5,$6,$7)', [u && u.id, u && u.name, u && u.role, entity, id, action, detail ? JSON.stringify(detail) : null]);
}
function mkctx(c, u) {
  return {
    user: u, c,
    q: (s, p) => c.query(s, p),
    one: async (s, p) => (await c.query(s, p)).rows[0] || null,
    all: async (s, p) => (await c.query(s, p)).rows,
    audit: (en, id, a, d) => audit(c, u, en, id, a, d),
    notify: (target, title, body, link) => c.query('INSERT INTO notifications(user_id, role, title, body, link) VALUES($1,$2,$3,$4,$5)', [typeof target === 'number' ? target : null, typeof target === 'string' ? target : null, title, body, link || null]),
    insert: (en, data) => insertRow(c, u, E[en], data),
    update: (en, id, data) => updateRow(c, E[en], id, data, u),
    get: async (en, id) => (await c.query(`SELECT * FROM ${en} WHERE id=$1`, [id])).rows[0] || null,
  };
}
async function insertRow(c, u, e, data) {
  const d = Object.assign({}, data);
  if (e.statuses && !d.status) d.status = e.initial;
  if (d.lines) d.lines = JSON.stringify(d.lines);
  const keys = Object.keys(d);
  const r = (await c.query(`INSERT INTO ${e.k} (${[...keys, 'created_by', 'updated_by'].join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}, $${keys.length + 1}, $${keys.length + 1}) RETURNING *`, [...keys.map(k => d[k]), u ? u.id : null])).rows[0];
  if (e.fields.some(f => f.k === 'folio') && !r.folio) {
    const pre = logic.FOLIO[e.k] || e.k.slice(0, 3).toUpperCase();
    r.folio = pre + '-' + String(r.id).padStart(5, '0');
    await c.query(`UPDATE ${e.k} SET folio=$1 WHERE id=$2`, [r.folio, r.id]);
  }
  return r;
}
async function updateRow(c, e, id, data, u) {
  const d = Object.assign({}, data);
  if (d.lines) d.lines = JSON.stringify(d.lines);
  const keys = Object.keys(d);
  if (!keys.length) return (await c.query(`SELECT * FROM ${e.k} WHERE id=$1`, [id])).rows[0];
  return (await c.query(`UPDATE ${e.k} SET ${keys.map((k, i) => k + '=$' + (i + 1)).join(',')}, updated_at=now(), updated_by=$${keys.length + 2} WHERE id=$${keys.length + 1} RETURNING *`, [...keys.map(k => d[k]), id, u ? u.id : null])).rows[0];
}

// ── public ──
app.get('/healthz', wrap(async (req, res) => {
  try { await db.q('SELECT 1'); res.json({ ok: true, version: VERSION, uptime: Math.round(process.uptime()) }); }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
}));

const attempts = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip || 'x';
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) throw new AppErr(['Demasiados intentos. Espere 5 minutos.', 'Too many attempts. Wait 5 minutes.'], 429);
  const pin = String((req.body || {}).pin || '');
  const u = /^\d{4,6}$/.test(pin) ? await db.one('SELECT id, name, role, active FROM users WHERE pin_hash=$1', [hashPin(pin)]) : null;
  if (!u || u.active === false) {
    a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60e3; a.n = 0; } attempts.set(ip, a);
    throw new AppErr(['PIN incorrecto.', 'Incorrect PIN.'], 401);
  }
  attempts.delete(ip);
  await audit(db.pool, u, 'users', u.id, 'login');
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `mna_s=${makeToken(u.id)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`);
  res.json({ ok: true, user: u });
}));
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'mna_s=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/demo-users', wrap(async (req, res) => {
  if (process.env.DEMO_MODE === '0') return res.json([]);
  const rows = await db.all("SELECT name, role, position, (SELECT v->>id::text FROM settings WHERE k='demo_pins') AS pin FROM users WHERE active ORDER BY array_position(ARRAY['ADMIN','DIR','GV','VTA','ATC','FACT','COB','CONT','COST','CXP','COMP','ALM','PROD','LOG','CHOF','PROV'], role), name");
  res.json(rows.map(r => Object.assign(r, { role_l: ROLES[r.role] })));
}));

// ── authenticated ──
app.use('/api', wrap(auth));

app.get('/api/me', wrap(async (req, res) => {
  const unread = await db.one('SELECT count(*)::int n FROM notifications n WHERE n.read=false AND (n.user_id=$1 OR n.role=$2) AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)', [req.user.id, req.user.role]);
  res.json({ user: req.user, unread: unread.n, version: VERSION });
}));

app.get('/api/meta', (req, res) => {
  const u = req.user;
  const ents = {};
  for (const e of Object.values(E)) {
    if (!canRead(e, u)) continue;
    ents[e.k] = { k: e.k, g: e.g, l: e.l, one: e.one, title: e.title, fields: visibleFields(e, u).map(f => Object.assign({}, f, f.t === 'pin' ? {} : {})), lines: e.lines || null, statuses: e.statuses || null, initial: e.initial, canWrite: canWrite(e, u), canDelete: u.role === 'ADMIN', flow: (e.flow || []).filter(t => t.roles.includes(u.role) || u.role === 'ADMIN').map(t => ({ from: t.from, to: t.to, l: t.l, comment: !!t.comment })), actions: (e.actions || []).filter(a => a.roles.includes(u.role) || u.role === 'ADMIN') };
    if (e.k === 'users' && u.role === 'ADMIN') ents.users.fields = e.fields;
  }
  const reports = logic.REPORTS.filter(r => !r.hidden && (r.roles.includes(u.role) || u.role === 'ADMIN')).map(r => ({ k: r.k, g: r.g, l: r.l, d: r.d, filters: r.filters || [] }));
  res.json({ roles: ROLES, groups: GROUPS, entities: ents, reports, user: u });
});

app.get('/api/e/:ent', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  const where = [], params = [];
  const sc = scope(e, u); if (sc) where.push(sc.sql);
  if (req.query.status) { params.push(String(req.query.status).split(',')); where.push(`status = ANY($${params.length})`); }
  for (const f of e.fields) {
    const v = req.query['f_' + f.k];
    if (v === undefined || v === '') continue;
    params.push(castVal(f, v)); where.push(`${f.k} = $${params.length}`);
  }
  if (req.query.q) {
    const txt = e.fields.filter(f => ['text', 'longtext', 'select'].includes(f.t));
    if (txt.length) { params.push('%' + req.query.q + '%'); where.push('(' + txt.map(f => `${f.k}::text ILIKE $${params.length}`).join(' OR ') + ` OR id::text = '${parseInt(req.query.q, 10) || -1}')`); }
  }
  const lim = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
  const rows = await db.all(`SELECT * FROM ${e.k} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${e.sort || 'id desc'} LIMIT ${lim}`, params);
  rows.forEach(r => strip(e, r, u));
  if (req.query.format === 'csv') {
    const refs = await resolveRefs(e, rows);
    const cols = visibleFields(e, u);
    const lang = req.query.lang === 'en' ? 1 : 0;
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['ID', ...(e.statuses ? [lang ? 'Status' : 'Estatus'] : []), ...cols.map(f => f.l[lang])];
    const pick = v => (typeof v === 'string' && v.includes(' ‖ ') ? v.split('\n').map(x => x.split(' ‖ ')[lang] || x.split(' ‖ ')[0]).join('\n') : v);
    const stl = s => { const st = (e.statuses || []).find(x => x.k === s); return st ? st.l[lang] : s; };
    const optl = (f, v) => { const o = (f.opts || []).find(x => x[0] === v); return o ? o[lang + 1] : v; };
    const lines = rows.map(r => [r.id, ...(e.statuses ? [stl(r.status)] : []), ...cols.map(f => f.t === 'ref' ? pick((refs[f.ref] || {})[r[f.k]] || '') : f.t === 'select' ? optl(f, r[f.k]) : pick(r[f.k]))].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${e.k}.csv"`);
    return res.send('﻿' + [head.map(esc).join(','), ...lines].join('\r\n'));
  }
  res.json({ rows, refs: await resolveRefs(e, rows) });
}));

app.get('/api/e/:ent/:id(\\d+)', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  const sc = scope(e, u);
  const row = await db.one(`SELECT * FROM ${e.k} WHERE id=$1 ${sc ? 'AND ' + sc.sql : ''}`, [req.params.id]);
  if (!row) throw new AppErr(['Registro no encontrado.', 'Record not found.'], 404);
  strip(e, row, u);
  const history = await db.all('SELECT ts, user_name, role, action, detail FROM audit_log WHERE entity=$1 AND record_id=$2 ORDER BY ts DESC LIMIT 100', [e.k, row.id]);
  const extra = logic.detailExtra ? await logic.detailExtra(e.k, row, u) : null;
  res.json({ row, refs: await resolveRefs(e, [row]), history, extra, locked: logic.isLocked(e.k, row) });
}));

app.post('/api/e/:ent', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  if (!canWrite(e, u)) throw new AppErr(['No tiene permiso para crear registros aquí.', 'You cannot create records here.'], 403);
  const r = await db.tx(async c => {
    const ctx = mkctx(c, u);
    let data = clean(e, req.body || {}, u, true);
    if (u.role === 'PROV' && e.k === 'supplier_invoices') data.supplier_id = u.supplier_id;
    if (logic.beforeSave) data = (await logic.beforeSave(e.k, data, null, ctx)) || data;
    validate(e, data);
    const row = await insertRow(c, u, e, data);
    await audit(c, u, e.k, row.id, 'create', { status: row.status });
    if (logic.afterSave) await logic.afterSave(e.k, row, null, ctx);
    return await ctx.get(e.k, row.id);
  });
  res.json({ row: strip(e, r, u) });
}));

app.put('/api/e/:ent/:id(\\d+)', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  if (!canWrite(e, u)) throw new AppErr(['No tiene permiso para modificar.', 'You cannot edit here.'], 403);
  const r = await db.tx(async c => {
    const ctx = mkctx(c, u);
    const sc = scope(e, u);
    const old = (await c.query(`SELECT * FROM ${e.k} WHERE id=$1 ${sc ? 'AND ' + sc.sql : ''} FOR UPDATE`, [req.params.id])).rows[0];
    if (!old) throw new AppErr(['Registro no encontrado.', 'Record not found.'], 404);
    if (logic.isLocked && logic.isLocked(e.k, old)) throw new AppErr(['Este documento ya no se puede modificar en su estatus actual.', 'This document can no longer be edited in its current status.']);
    let data = clean(e, req.body || {}, u, false);
    if (u.role === 'PROV') { data.supplier_id = u.supplier_id; }
    const merged = Object.assign({}, old, data);
    if (logic.beforeSave) data = Object.assign(data, (await logic.beforeSave(e.k, merged, old, ctx)) || {});
    validate(e, Object.assign({}, old, data));
    const changed = {};
    for (const k of Object.keys(data)) if (k !== 'lines' && k !== 'pin_hash' && JSON.stringify(old[k]) !== JSON.stringify(data[k])) changed[k] = [old[k], data[k]];
    if (data.lines && JSON.stringify(old.lines) !== JSON.stringify(data.lines)) changed.lines = ['…', (data.lines || []).length + ' partidas'];
    const row = await updateRow(c, e, old.id, Object.fromEntries(Object.entries(Object.assign({}, data)).filter(([k]) => k in merged || k === 'pin_hash' || k === 'lines')), u);
    if (Object.keys(changed).length) await audit(c, u, e.k, row.id, 'update', changed);
    if (logic.afterSave) await logic.afterSave(e.k, row, old, ctx);
    return await ctx.get(e.k, row.id);
  });
  res.json({ row: strip(e, r, u) });
}));

app.delete('/api/e/:ent/:id(\\d+)', wrap(async (req, res) => {
  const e = ent(req);
  if (req.user.role !== 'ADMIN') throw new AppErr(['Solo el administrador puede eliminar.', 'Only the administrator can delete.'], 403);
  await db.tx(async c => { await c.query(`DELETE FROM ${e.k} WHERE id=$1`, [req.params.id]); await audit(c, req.user, e.k, +req.params.id, 'delete'); });
  res.json({ ok: true });
}));

app.post('/api/e/:ent/:id(\\d+)/flow', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  const { to, comment } = req.body || {};
  const r = await db.tx(async c => {
    const ctx = mkctx(c, u);
    const sc = scope(e, u);
    const row = (await c.query(`SELECT * FROM ${e.k} WHERE id=$1 ${sc ? 'AND ' + sc.sql : ''} FOR UPDATE`, [req.params.id])).rows[0];
    if (!row) throw new AppErr(['Registro no encontrado.', 'Record not found.'], 404);
    const t = (e.flow || []).find(x => x.to === to && x.from.includes(row.status));
    if (!t) throw new AppErr(['Esta acción no está disponible en el estatus actual.', 'This action is not available in the current status.']);
    if (!(t.roles.includes(u.role) || u.role === 'ADMIN')) throw new AppErr(['Su rol no puede realizar esta acción.', 'Your role cannot perform this action.'], 403);
    if (t.comment && !String(comment || '').trim()) throw new AppErr(['Escriba un comentario para continuar.', 'Please enter a comment to continue.']);
    let actor = row.created_by;
    if (t.sod === 'last') { const la = (await c.query(`SELECT user_id FROM audit_log WHERE entity=$1 AND record_id=$2 AND action='status' AND detail->>'to'=$3 ORDER BY id DESC LIMIT 1`, [e.k, row.id, row.status])).rows[0]; if (la) actor = la.user_id; }
    if (t.sod && actor === u.id && u.role !== 'ADMIN') throw new AppErr(['Segregación de funciones: quien captura el documento no puede autorizarlo.', 'Segregation of duties: the person who entered the document cannot approve it.'], 403);
    let next = t.to, patch = {};
    if (t.guard) {
      const g = logic.guards[t.guard];
      const out = g ? await g(row, ctx, { to: t.to, comment, body: req.body || {} }) : null;
      if (out && out.status) next = out.status;
      if (out && out.patch) patch = out.patch;
    }
    const upd = await updateRow(c, e, row.id, Object.assign({}, patch, { status: next }), u);
    await audit(c, u, e.k, row.id, 'status', { from: row.status, to: next, comment: comment || undefined, action: t.l });
    if (logic.afterFlow) await logic.afterFlow(e.k, upd, row.status, ctx);
    return upd;
  });
  res.json({ row: strip(e, r, u) });
}));

app.post('/api/e/:ent/:id(\\d+)/act/:act', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  const a = (e.actions || []).find(x => x.k === req.params.act);
  if (!a || !(a.roles.includes(u.role) || u.role === 'ADMIN')) throw new AppErr(['Acción no permitida.', 'Action not allowed.'], 403);
  const out = await db.tx(async c => {
    const ctx = mkctx(c, u);
    const sc = scope(e, u);
    const row = (await c.query(`SELECT * FROM ${e.k} WHERE id=$1 ${sc ? 'AND ' + sc.sql : ''} FOR UPDATE`, [req.params.id])).rows[0];
    if (!row) throw new AppErr(['Registro no encontrado.', 'Record not found.'], 404);
    if (a.when && !a.when.includes(row.status)) throw new AppErr(['Acción no disponible en este estatus.', 'Action not available in this status.']);
    const fn = (logic.actions[e.k] || {})[a.k];
    const r = await fn(row, ctx, req.body || {});
    await audit(c, u, e.k, row.id, 'action', { action: a.l });
    return r || {};
  });
  res.json(out);
}));

// CSV import: body is CSV text; header row uses field keys or Spanish/English labels.
app.post('/api/e/:ent/import', wrap(async (req, res) => {
  const e = ent(req); const u = req.user;
  if (!canWrite(e, u)) throw new AppErr(['No tiene permiso para importar.', 'You cannot import here.'], 403);
  const rows = logic.parseCSV(typeof req.body === 'string' ? req.body : (req.body && req.body.csv) || '');
  if (rows.length < 2) throw new AppErr(['El archivo no tiene filas de datos.', 'The file has no data rows.']);
  const head = rows[0].map(h => h.trim().replace(/^﻿/, '').toLowerCase());
  const map = head.map(h => e.fields.find(f => f.k === h || f.l[0].toLowerCase() === h || f.l[1].toLowerCase() === h));
  const errors = []; let n = 0;
  await db.tx(async c => {
    const ctx = mkctx(c, u);
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].some(x => x.trim())) continue;
      const body = {};
      for (let j = 0; j < map.length; j++) {
        const f = map[j]; if (!f) continue;
        let v = rows[i][j];
        if (f.t === 'ref' && v && !/^\d+$/.test(v)) {
          const te = E[f.ref];
          const hit = await ctx.one(`SELECT id FROM ${te.k} WHERE ${labelSql(te)} ILIKE $1 OR ${te.title}::text ILIKE $1 ${te.fields.some(x => x.k === 'code') ? 'OR code ILIKE $1' : ''} LIMIT 1`, [v.trim()]);
          v = hit ? hit.id : null;
        }
        body[f.k] = v;
      }
      try {
        let data = clean(e, body, u, true);
        if (logic.beforeSave) data = (await logic.beforeSave(e.k, data, null, ctx)) || data;
        validate(e, data);
        await insertRow(c, u, e, data); n++;
      } catch (err) { errors.push({ row: i + 1, msg: err.msg || [err.message, err.message] }); }
    }
    if (errors.length) throw new AppErr(['La importación no se aplicó: ' + errors.length + ' fila(s) con error.', 'Import not applied: ' + errors.length + ' row(s) with errors.'], 400, { errors });
    await audit(c, u, e.k, null, 'import', { rows: n });
  });
  res.json({ ok: true, imported: n });
}));

app.get('/api/opts/:ent', wrap(async (req, res) => {
  const e = ent(req);
  const sc = scope(e, req.user);
  const where = [];
  if (sc) where.push(sc.sql);
  if (e.k === 'users') where.push("active IS NOT FALSE AND role <> 'PROV'");
  if (req.query.status) where.push(`status = ANY('{${String(req.query.status).replace(/[^a-z_,]/g, '')}}')`);
  res.json(await db.all(`SELECT id, ${labelSql(e)} AS t FROM ${e.k} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY 2 LIMIT 3000`));
}));

// Files (stored in Postgres so they survive restarts)
app.post('/api/files', express.raw({ type: '*/*', limit: '10mb' }), wrap(async (req, res) => {
  const name = String(req.headers['x-file-name'] || 'archivo').slice(0, 200);
  const mime = String(req.headers['content-type'] || 'application/octet-stream');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppErr(['Archivo vacío.', 'Empty file.']);
  if (!/^(image\/|application\/pdf|text\/xml|application\/xml|text\/csv|text\/plain|application\/vnd)/.test(mime) && !/\.(xml|pdf|jpg|jpeg|png|csv|xlsx)$/i.test(name)) throw new AppErr(['Tipo de archivo no permitido (use PDF, XML o imagen).', 'File type not allowed (use PDF, XML or image).']);
  const r = await db.one('INSERT INTO files(name,mime,size,data,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id, name, size', [decodeURIComponent(name), mime, req.body.length, req.body, req.user.id]);
  res.json(r);
}));
async function canFile(u, id) {
  if (u.role !== 'PROV') return true;
  const sid = parseInt(u.supplier_id, 10) || -1;
  const r = await db.one(`SELECT 1 ok FROM files f WHERE f.id=$1 AND (f.created_by=$2
    OR EXISTS (SELECT 1 FROM supplier_invoices s WHERE s.supplier_id=$3 AND (s.xml=f.id OR s.pdf=f.id))
    OR EXISTS (SELECT 1 FROM goods_receipts g WHERE g.supplier_id=$3 AND g.photo=f.id))`, [id, u.id, sid]);
  return !!r;
}
app.get('/api/files/:id(\\d+)', wrap(async (req, res) => {
  if (!await canFile(req.user, req.params.id)) throw new AppErr(['Sin acceso a este archivo.', 'No access to this file.'], 403);
  const f = await db.one('SELECT name, mime, data FROM files WHERE id=$1', [req.params.id]);
  if (!f) throw new AppErr(['Archivo no encontrado.', 'File not found.'], 404);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${/^image|pdf/.test(f.mime) ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`);
  res.send(f.data);
}));
app.get('/api/files/:id(\\d+)/info', wrap(async (req, res) => { if (!await canFile(req.user, req.params.id)) throw new AppErr(['Sin acceso.', 'No access.'], 403); res.json(await db.one('SELECT id, name, mime, size FROM files WHERE id=$1', [req.params.id])); }));

app.get('/api/dashboard', wrap(async (req, res) => res.json(await logic.dashboard(req.user))));
app.get('/api/inbox', wrap(async (req, res) => res.json(await logic.inbox(req.user))));
app.post('/api/notifications/read', wrap(async (req, res) => { await db.q('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]); await db.q('INSERT INTO notification_reads(notification_id, user_id) SELECT id, $1 FROM notifications WHERE role=$2 ON CONFLICT DO NOTHING', [req.user.id, req.user.role]); res.json({ ok: true }); }));
app.get('/api/report/:k', wrap(async (req, res) => {
  const r = logic.REPORTS.find(x => x.k === req.params.k);
  if (!r || !(r.roles.includes(req.user.role) || req.user.role === 'ADMIN')) throw new AppErr(['Reporte no disponible.', 'Report not available.'], 403);
  const out = await r.run(req.query, req.user);
  if (req.query.format === 'csv' && out.table) {
    const lang = req.query.lang === 'en' ? 1 : 0;
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.k}.csv"`);
    return res.send('﻿' + [out.table.cols.map(c => esc(c.l[lang])).join(','), ...out.table.rows.map(row => out.table.cols.map(c => esc(row[c.k])).join(','))].join('\r\n'));
  }
  if (req.query.format === 'xml' && out.xml) { res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${out.xmlName || r.k + '.xml'}"`); return res.send(out.xml); }
  res.json(out);
}));
app.post('/api/bankmatch', wrap(async (req, res) => {
  if (!['ADMIN', 'CONT', 'CXP'].includes(req.user.role)) throw new AppErr(['Sin acceso.', 'No access.'], 403);
  res.json(await logic.bankMatch(req.user, parseInt((req.body || {}).account, 10) || null));
}));
app.get('/api/audit', wrap(async (req, res) => {
  if (!['ADMIN', 'DIR'].includes(req.user.role)) throw new AppErr(['Sin acceso.', 'No access.'], 403);
  res.json(await db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500'));
}));
app.post('/api/admin/reset-demo', wrap(async (req, res) => {
  if (req.user.role !== 'ADMIN') throw new AppErr(['Solo administrador.', 'Admin only.'], 403);
  await require('./lib/seed').reset(hashPin);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ code: 'NF', msg: ['Ruta no encontrada.', 'Route not found.'] }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// central error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof AppErr) return res.status(err.status).json({ code: 'APP', msg: err.msg, extra: err.extra });
  if (err.type === 'entity.too.large') return res.status(413).json({ code: 'BIG', msg: ['El archivo es demasiado grande (máx. 10 MB).', 'File too large (max 10 MB).'] });
  if (err.code === '23505') return res.status(409).json({ code: 'DUP', msg: ['Ya existe un registro con ese valor (duplicado).', 'A record with that value already exists.'] });
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ code: 'ERR', msg: ['Ocurrió un error inesperado. Intente de nuevo.', 'Unexpected error. Please try again.'] });
});
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
process.on('uncaughtException', e => console.error('[uncaughtException]', e));

async function boot() {
  for (let i = 1; i <= 12; i++) {
    try { await db.q('SELECT 1'); break; }
    catch (e) { console.log(`[boot] waiting for database (${i})…`, e.message); await new Promise(r => setTimeout(r, Math.min(2000 * i, 10000))); }
  }
  await db.migrate();
  await require('./lib/seed').ensure(hashPin);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`[boot] MNA Procesos v${VERSION} listening on ${port}`));
}
if (require.main === module) boot().catch(e => { console.error('[boot] fatal', e); process.exit(1); });
module.exports = { app, boot, hashPin };
