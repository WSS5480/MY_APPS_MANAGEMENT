// Dealer System add-ons: public website + feeds, lead routing, appraisals & data connections, e-signatures,
// automatic late fees, cashier drawers, insurance alerts, vendor bills, bank reconciliation, month-end lock,
// QuickBooks export, store-to-store transfers, factory statement, pay plans + time clock, shop capacity, media storage.
'use strict';
const path = require('path');

// ---------- small helpers ----------
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
function parseCsv(text) { // handles quoted fields
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PUBLIC_VEH = v => ({ id: v.id, stock: v.data.stock, vin: v.data.vin, year: v.data.year, make: v.data.make, model: v.data.model, trim: v.data.trim, body: v.data.body, engine: v.data.engine, drive: v.data.drive, color: v.data.color, miles: v.data.miles, price: v.data.web_price || v.data.price, cond: v.data.cond, photos: (v.data.photos || []).length, notes: v.data.web_notes || '', store_id: v.store_id });

module.exports = { init, publicRoutes, privateRoutes };

async function init(c) {
  await c.query(`ALTER TABLE jrnl ADD COLUMN IF NOT EXISTS cleared_by BIGINT`);
  await c.query(`CREATE TABLE IF NOT EXISTS signatures (token TEXT PRIMARY KEY, ref BIGINT, kind TEXT, title TEXT, html TEXT NOT NULL, signer TEXT, signed_at TIMESTAMPTZ, sig TEXT, ip TEXT, ua TEXT, consent BOOLEAN, doc_hash TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const s = (await c.query(`SELECT * FROM rec WHERE kind='settings' LIMIT 1`)).rows[0];
  if (s && !s.data.feed_token) { s.data.feed_token = require('crypto').randomBytes(16).toString('hex'); await c.query(`UPDATE rec SET data=$2 WHERE id=$1`, [s.id, s.data]); }
}

// ---------- secrets (integration keys) live in their own record and are never sent back whole ----------
async function secrets(ctx) { const r = (await ctx.list(ctx.pool, 'secret'))[0]; return r ? r.data : {}; }
const SECRET_FIELDS = {
  marketcheck: ['api_key', 'zip', 'dealer_type'], vinaudit: ['user', 'pass', 'key'], r2: ['account_id', 'access_key_id', 'secret_access_key', 'bucket'],
};

// ---------- lead routing ----------
async function assignLead(ctx, c, storeId) {
  const s = (await ctx.list(c, 'settings'))[0]; const mode = s.data.lead_routing || 'none';
  if (mode === 'none') return '';
  let reps = (await ctx.list(c, 'user')).filter(u => u.data.active !== false && u.data.role === 'sales');
  if (mode === 'round_robin_store' && storeId) reps = reps.filter(u => !u.data.store_id || Number(u.data.store_id) === Number(storeId));
  if (!reps.length) return '';
  reps.sort((a, b) => a.id - b.id);
  const key = 'rr_' + (mode === 'round_robin_store' ? storeId || 'all' : 'all');
  const n = await ctx.nextNum(c, key, 0);
  return reps[n % reps.length].data.name;
}

// ---------- automatic late fees: once per installment, after the store's grace days ----------
async function runLateFees(ctx) {
  const stores = {}; (await ctx.list(ctx.pool, 'store')).forEach(s => stores[s.id] = s.data);
  const loans = await ctx.list(ctx.pool, 'loan', `AND data->>'status'='active'`); const t = ctx.today(); let n = 0;
  for (const l of loans) {
    const st = stores[l.store_id]; if (!st || st.auto_late_fee !== true || !(ctx.num(st.late_fee) > 0) || st.grace_days === '' || st.grace_days == null) continue;
    const sched = ctx.buildSchedule(l.data); const done = new Set(l.data.late_fee_installments || []); const add = [];
    const pays = await ctx.list(ctx.pool, 'payment', `AND (data->>'loan_id')::bigint=$2`, [l.id]);
    sched.forEach((x, i) => {
      const cutoff = ctx.addDays(x.due, ctx.num(st.grace_days)); if (cutoff >= t || done.has(i) || !st.auto_late_fee_since || cutoff < st.auto_late_fee_since) return;
      const paid = pays.filter(p => p.data.date <= cutoff).reduce((s, p) => s + ctx.num(p.data.principal) + ctx.num(p.data.interest), 0);
      const owed = sched.slice(0, i + 1).reduce((s, y) => s + y.payment, 0);
      if (paid + 0.005 < owed) add.push(i);
    });
    if (!add.length) continue;
    await ctx.tx(async c => { const L = await ctx.getRec(c, l.id); if (L.data.status !== 'active') return;
      const already = new Set(L.data.late_fee_installments || []); const fresh = add.filter(i => !already.has(i)); if (!fresh.length) return;
      const amt = ctx.r2(fresh.length * ctx.num(st.late_fee));
      L.data.fees_assessed = ctx.r2(ctx.num(L.data.fees_assessed) + amt); L.data.late_fee_installments = [...already, ...fresh];
      (L.data.fee_log = L.data.fee_log || []).push({ date: t, amount: amt, reason: `Automatic late fee (payment ${fresh.map(i => i + 1).join(', ')})`, by: 'system' });
      await ctx.put(c, 'loan', L.store_id, L.data, L.id); await ctx.audit(c, 'system', 'late_fee', 'loan', L.id, amt); n += fresh.length; });
  }
  return n;
}

// ---------- S3-compatible (Cloudflare R2) presigned URLs, AWS Signature V4 ----------
function presign(cfg, method, key, expires = 900, contentType) {
  const crypto = require('crypto');
  const host = `${cfg.account_id}.r2.cloudflarestorage.com`, region = 'auto', service = 's3';
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const canonPath = '/' + enc(cfg.bucket) + '/' + key.split('/').map(enc).join('/');
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cfg.access_key_id}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const canon = [method, canonPath, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n');
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kSig = h(h(h(h('AWS4' + cfg.secret_access_key, date), region), service), 'aws4_request');
  return `https://${host}${canonPath}?${qs}&X-Amz-Signature=${crypto.createHmac('sha256', kSig).update(toSign).digest('hex')}`;
}

// =====================================================================================
function publicRoutes(ctx) {
  const { app, pool, W } = ctx;
  const pub = f => path.join(__dirname, 'public', f);
  const settingsOf = async () => (await ctx.list(pool, 'settings'))[0] || { data: {} };

  // public inventory website
  app.get(['/cars', '/cars/:id'], (req, res) => res.sendFile(pub('site.html')));
  app.get('/api/site/info', W(async (req, res) => { const s = await settingsOf(); const stores = (await ctx.list(pool, 'store')).map(x => ({ id: x.id, name: x.data.name, address: x.data.address, phone: x.data.phone }));
    res.json({ dealer: s.data.dealer_name, phone: s.data.phone, tagline: s.data.site_tagline || '', stores, credit_app: s.data.site_credit_app !== false }); }));
  app.get('/api/site/inventory', W(async (req, res) => { const vs = (await ctx.list(pool, 'vehicle', `AND data->>'status'='in_stock'`)).filter(v => !v.data.hide_web);
    res.json(vs.map(PUBLIC_VEH)); }));
  app.get('/api/site/vehicle/:id', W(async (req, res) => { const v = await ctx.getRec(pool, req.params.id);
    if (!v || v.kind !== 'vehicle' || v.data.status !== 'in_stock' || v.data.hide_web) return res.status(404).json({ error: 'This vehicle is no longer available' }); res.json(PUBLIC_VEH(v)); }));
  app.get('/photo/:id/:n', W(async (req, res) => {
    const v = await ctx.getRec(pool, req.params.id); const p = v && v.kind === 'vehicle' && v.data.status === 'in_stock' && !v.data.hide_web && (v.data.photos || [])[Number(req.params.n)];
    const m = p && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p); if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]).set('Cache-Control', 'public, max-age=3600').send(Buffer.from(m[2], 'base64'));
  }));
  // website forms -> customer + lead (auto-assigned). No SSN is collected until a credit-pull service is connected.
  app.post('/api/site/lead', W(async (req, res) => {
    if (ctx.limited('lead:' + req.ip)) return res.status(429).json({ error: 'Too many requests — try again later.' });
    ctx.tries.get('lead:' + req.ip).push(Date.now());
    const b = req.body || {}; if (b.website) return res.json({ ok: true }); // spam trap
    const first = String(b.first || '').trim().slice(0, 60), last = String(b.last || '').trim().slice(0, 60), phone = String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 15), email = String(b.email || '').trim().slice(0, 120);
    if (!first || (!phone && !email)) throw new Error('Please give your name and a phone number or email');
    if (!b.consent) throw new Error('Please agree to be contacted');
    const out = await ctx.tx(async c => {
      const veh = b.vehicle_id ? await ctx.getRec(c, b.vehicle_id) : null; const st0 = b.store_id ? await ctx.getRec(c, b.store_id) : null; const storeId = veh && veh.kind === 'vehicle' ? veh.store_id : (st0 && st0.kind === 'store' ? st0.id : null);
      const custs = await ctx.list(c, 'customer'); let cu = custs.find(x => String(x.data.last || '').trim().toLowerCase() === last.toLowerCase() && last && ((phone && String(x.data.phone || '').replace(/[^\d+]/g, '') === phone) || (email && (x.data.email || '').toLowerCase() === email.toLowerCase())));
      const app2 = b.type === 'credit_app' ? { employer: String(b.employer || '').slice(0, 80), income: ctx.num(b.income), job_time: String(b.job_time || '').slice(0, 40), housing: String(b.housing || '').slice(0, 80), address: String(b.address || '').slice(0, 120), city: String(b.city || '').slice(0, 60), state: String(b.state || '').slice(0, 2), zip: String(b.zip || '').slice(0, 10), down: ctx.num(b.down) } : null;
      if (!cu) cu = await ctx.put(c, 'customer', null, { first, last, phone, email, sms_ok: !!b.consent, source: 'Website' }); // an existing customer is never changed from the public form; what they typed stays on the lead
      const owner = await assignLead(ctx, c, storeId);
      const lead = await ctx.put(c, 'lead', storeId, { customer_id: cu.id, source: 'Website', status: 'new', owner, vehicle_id: veh && veh.kind === 'vehicle' ? veh.id : '', interest: veh ? [veh.data.year, veh.data.make, veh.data.model].join(' ') : '', notes: String(b.message || '').slice(0, 1000), created: ctx.today(), next_followup: ctx.today(), credit_app: app2 ? { ...app2, first, last, phone, email, submitted: new Date().toISOString(), consent: true } : undefined, log: [{ at: new Date().toISOString(), by: 'Website', note: b.type === 'credit_app' ? 'Credit application submitted online' : 'Website inquiry' }] });
      await ctx.audit(c, 'website', 'lead', 'lead', lead.id, b.type || 'inquiry'); return lead;
    });
    res.json({ ok: true, id: out.id });
  }));
  // inventory feeds for listing sites (CarGurus, Cars.com, Autotrader, Facebook catalog) — secret token in the address
  app.get(['/feed/inventory.csv', '/feed/facebook.csv'], W(async (req, res) => {
    const s = await settingsOf(); if (!s.data.feed_token || req.query.token !== s.data.feed_token) return res.status(404).send('Not found');
    const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host;
    const stores = {}; (await ctx.list(pool, 'store')).forEach(x => stores[x.id] = x.data);
    const vs = (await ctx.list(pool, 'vehicle', `AND data->>'status'='in_stock'`)).filter(v => !v.data.hide_web && v.data.vin);
    const photos = v => (v.data.photos || []).map((_, i) => `${base}/photo/${v.id}/${i}`);
    let rows;
    if (req.path.includes('facebook')) rows = [['vehicle_id', 'title', 'description', 'url', 'make', 'model', 'year', 'mileage.value', 'mileage.unit', 'image[0].url', 'image[1].url', 'image[2].url', 'body_style', 'exterior_color', 'state_of_vehicle', 'price', 'vin', 'address', 'dealer_name', 'dealer_phone'],
      ...vs.map(v => { const d = v.data, st = stores[v.store_id] || {}, ph = photos(v); return [d.stock || v.id, [d.year, d.make, d.model, d.trim].filter(Boolean).join(' '), d.web_notes || [d.year, d.make, d.model, d.trim, d.color].filter(Boolean).join(' '), `${base}/cars/${v.id}`, d.make, d.model, d.year, ctx.num(d.miles), 'MI', ph[0] || '', ph[1] || '', ph[2] || '', d.body || '', d.color || '', d.cond === 'new' ? 'NEW' : 'USED', `${ctx.num(d.web_price || d.price).toFixed(2)} USD`, d.vin, st.address || '', st.name || s.data.dealer_name || '', st.phone || s.data.phone || '']; })];
    else rows = [['DealerName', 'DealerAddress', 'DealerPhone', 'StockNumber', 'VIN', 'Condition', 'Year', 'Make', 'Model', 'Trim', 'Body', 'Mileage', 'Price', 'ExteriorColor', 'Engine', 'Drivetrain', 'Description', 'PhotoURLs', 'VehicleURL'],
      ...vs.map(v => { const d = v.data, st = stores[v.store_id] || {}; return [st.name || s.data.dealer_name || '', st.address || '', st.phone || s.data.phone || '', d.stock, d.vin, d.cond === 'new' ? 'New' : 'Used', d.year, d.make, d.model, d.trim, d.body, ctx.num(d.miles), ctx.num(d.web_price || d.price), d.color, d.engine, d.drive, d.web_notes || '', photos(v).join('|'), `${base}/cars/${v.id}`]; })];
    res.set('Content-Type', 'text/csv; charset=utf-8').send(csv(rows));
  }));
  // public status page
  app.get('/status', W(async (req, res) => { let db = 'ok'; const t0 = Date.now(); try { await pool.query('SELECT 1'); } catch (e) { db = 'down'; }
    const up = Math.round(process.uptime());
    res.status(db === 'ok' ? 200 : 503).send(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status</title><body style="font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px"><h2>Dealer System status</h2><p>App: <b style="color:#0d8a4e">running</b> (up ${Math.floor(up / 3600)}h ${Math.floor(up % 3600 / 60)}m)</p><p>Database: <b style="color:${db === 'ok' ? '#0d8a4e' : '#c42b2b'}">${db}</b> (${Date.now() - t0} ms)</p><p style="color:#62708a">Checked ${new Date().toUTCString()}</p></body>`); }));
  // customer signing page (e-signature)
  app.get('/sign/:token', (req, res) => res.sendFile(pub('sign.html')));
  app.get('/api/public/sign/:token', W(async (req, res) => {
    const { rows } = await pool.query(`SELECT token,title,html,signed_at,signer FROM signatures WHERE token=$1 AND created_at > now() - interval '14 days'`, [req.params.token]);
    if (!rows[0]) return res.status(404).json({ error: 'This signing link has expired — ask the dealership for a new one.' });
    const s = await settingsOf(); res.json({ ...rows[0], dealer: s.data.dealer_name });
  }));
  app.post('/api/public/sign/:token', W(async (req, res) => {
    const b = req.body || {}; if (!b.consent) throw new Error('Please agree to sign electronically');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{200,400000}$/.test(String(b.sig || ''))) throw new Error('Please sign in the box');
    const name = String(b.name || '').trim().slice(0, 80); if (!name) throw new Error('Type your full name');
    const { rows } = await pool.query(`UPDATE signatures SET signer=$2, signed_at=now(), sig=$3, ip=$4, ua=$5, consent=true WHERE token=$1 AND signed_at IS NULL AND created_at > now() - interval '14 days' RETURNING token`, [req.params.token, name, b.sig, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]);
    if (!rows[0]) throw new Error('This document was already signed or the link expired');
    res.json({ ok: true });
  }));
}

// =====================================================================================
function privateRoutes(ctx) {
  const { app, pool, W, deny, can, need, getRec, list, put, post, tx, audit, num, r2, today, crypto } = ctx;
  const mgr = u => ['owner', 'manager'].includes(u.role);
  const books = u => ['owner', 'manager', 'accounting'].includes(u.role);
  const mine = (u, r) => !u.store_id || !r.store_id || Number(r.store_id) === Number(u.store_id);
  for (const k of ['appraisal', 'vendor', 'bill']) { ctx.READ_KINDS.add(k); ctx.SAVE_KINDS.add(k); }
  ctx.WRITE.sales.push('appraisal'); ctx.WRITE.finance.push('appraisal'); ctx.WRITE.accounting.push('vendor', 'bill');

  // ---- integrations: keys stored server-side, shown masked ----
  app.get('/api/integrations', W(async (req, res) => { if (!mgr(req.user)) return deny(res); const s = await secrets(ctx); const out = {};
    for (const [k, fs] of Object.entries(SECRET_FIELDS)) out[k] = Object.fromEntries(fs.map(f => [f, s[k] && s[k][f] ? (/(key|pass|secret)/.test(f) ? '••••' + String(s[k][f]).slice(-4) : s[k][f]) : '']));
    res.json(out); }));
  app.post('/api/integrations', W(async (req, res) => { if (req.user.role !== 'owner') return deny(res, 'Only the owner can change connection keys');
    const name = req.body.name; if (!SECRET_FIELDS[name]) throw new Error('Unknown connection');
    await tx(async c => { const r = (await list(c, 'secret'))[0]; const d = r ? r.data : {}; d[name] = d[name] || {};
      for (const f of SECRET_FIELDS[name]) { const v = String((req.body.values || {})[f] ?? '').trim(); if (v && !v.startsWith('••••')) d[name][f] = v; if (req.body.clear) delete d[name][f]; }
      await put(c, 'secret', null, d, r && r.id); await audit(c, req.user.name, 'integration', 'secret', null, name); });
    res.json({ ok: true }); }));

  // ---- MarketCheck market price (used for appraisals and price-to-market) ----
  async function marketPrice(vin, miles) {
    const s = (await secrets(ctx)).marketcheck || {}; if (!s.api_key) throw new Error('MarketCheck isn’t connected yet — add the key in Settings → Integrations');
    if (!s.zip || !['franchise', 'independent'].includes(s.dealer_type)) throw new Error('Add your ZIP and dealer type (franchise or independent) in Settings → Integrations → MarketCheck');
    if (!(num(miles) > 0)) throw new Error('Enter the miles first');
    const u = new URL('https://api.marketcheck.com/v2/predict/car/us/marketcheck_price');
    for (const [k, v] of Object.entries({ api_key: s.api_key, vin, miles: String(Math.round(num(miles))), dealer_type: s.dealer_type, zip: s.zip })) u.searchParams.set(k, v);
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('MarketCheck: ' + (j.message || r.status));
    if (j.marketcheck_price == null) throw new Error('MarketCheck couldn’t price this exact VIN');
    return { price: num(j.marketcheck_price), msrp: num(j.msrp), raw: j };
  }
  app.post('/api/market/vehicle/:id', W(async (req, res) => { if (!can(req.user, 'vehicle')) return deny(res); const v = await need(pool, req.params.id, 'vehicle', req.user); if (!v.data.vin) throw new Error('Add the VIN first');
    const m = await marketPrice(v.data.vin, v.data.miles);
    await tx(async c => { const x = await getRec(c, v.id); x.data.market = { price: m.price, msrp: m.msrp, checked: today() }; await put(c, 'vehicle', x.store_id, x.data, x.id); });
    res.json({ price: m.price, msrp: m.msrp, toMarket: m.price ? r2(num(v.data.price) / m.price * 100) : null }); }));
  // ---- VinAudit vehicle history (federal title database) ----
  app.get('/api/history/:vin', W(async (req, res) => { if (!can(req.user, 'vehicle') && !can(req.user, 'appraisal')) return deny(res);
    const s = (await secrets(ctx)).vinaudit || {}; if (!s.key) throw new Error('VinAudit isn’t connected yet — add the key in Settings → Integrations');
    const vin = String(req.params.vin).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, ''); if (vin.length !== 17) throw new Error('VIN must be 17 characters');
    const u = new URL('https://api.vinaudit.com/pullreport.php'); const id = 'dms-' + vin + '-' + today();
    for (const [k, v] of Object.entries({ id, vin, user: s.user || '', pass: s.pass || '', key: s.key, format: 'json' })) u.searchParams.set(k, v);
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error('VinAudit: ' + (j.error || r.status));
    await audit(pool, req.user.name, 'history', 'vehicle', null, vin); res.json(j); }));

  // ---- appraisals -> trade-in on a deal, or a purchase into inventory ----
  app.post('/api/appraisal/:id/market', W(async (req, res) => { if (!can(req.user, 'appraisal')) return deny(res); const a = await need(pool, req.params.id, 'appraisal', req.user); if (!a.data.vin) throw new Error('Add the VIN first');
    const m = await marketPrice(a.data.vin, a.data.miles); await tx(async c => { const x = await getRec(c, a.id); x.data.market = { price: m.price, msrp: m.msrp, checked: today() }; await put(c, 'appraisal', x.store_id, x.data, x.id); });
    res.json(m); }));
  app.post('/api/appraisal/:id/buy', W(async (req, res) => {
    if (!mgr(req.user) && req.user.role !== 'finance') return deny(res, 'A manager or finance user buys vehicles into stock');
    const out = await tx(async c => { const a = await need(c, req.params.id, 'appraisal', req.user); const d = a.data;
      if (d.status !== 'open') throw new Error('This appraisal was already used');
      if (!(num(d.offer) > 0)) throw new Error('Enter the offer (what you are paying)');
      const stock = 'S' + (await ctx.nextNum(c, 'stock', 10001));
      const v = await put(c, 'vehicle', a.store_id, { vin: d.vin, year: d.year, make: d.make, model: d.model, trim: d.trim, miles: d.miles, color: d.color, cost: num(d.offer), paid_with: req.body.paid_with === 'ap' ? 'ap' : 'cash', price: d.retail_target || '', source: 'Bought from appraisal ' + d.number, cond: 'used', status: 'in_stock', stock, acquired: today(), recon: [], photos: d.photos || [] });
      await ctx.postVehicleCost(c, v, req.user);
      d.status = 'bought'; d.vehicle_id = v.id; await put(c, 'appraisal', a.store_id, d, a.id); await audit(c, req.user.name, 'buy', 'appraisal', a.id, v.id); return v; });
    res.json(out); }));

  // ---- e-signatures: staff prepare a document; the customer signs on their phone or a store tablet ----
  app.post('/api/sign/request', W(async (req, res) => {
    if (!can(req.user, 'deal') && !can(req.user, 'ro')) return deny(res);
    const b = req.body || {}; let html = String(b.html || ''); if (html.length < 50 || html.length > 400000) throw new Error('Nothing to sign');
    html = html.replace(/<\s*(script|iframe|object|embed|link|meta|style|form|base)[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*("|')\s*(?!data:image\/)[^"']*\2/gi, '').replace(/javascript:/gi, '');
    const ref = b.ref ? await getRec(pool, b.ref) : null; if (b.ref && (!ref || !mine(req.user, ref))) throw new Error('Not found');
    const token = crypto.randomBytes(18).toString('base64url'), hash = crypto.createHash('sha256').update(html).digest('hex');
    await pool.query(`INSERT INTO signatures(token,ref,kind,title,html,doc_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [token, ref ? ref.id : null, ref ? ref.kind : null, String(b.title || 'Document').slice(0, 120), html, hash, req.user.name]);
    const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host; res.json({ url: base + '/sign/' + token, token });
  }));
  app.get('/api/sign/list/:ref', W(async (req, res) => { const r = await getRec(pool, req.params.ref); if (!r || !mine(req.user, r)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(`SELECT token,title,signer,signed_at,created_by,created_at,doc_hash,ip FROM signatures WHERE ref=$1 ORDER BY created_at DESC`, [r.id]); res.json(rows); }));
  app.get('/api/sign/doc/:token', W(async (req, res) => { const { rows } = await pool.query(`SELECT * FROM signatures WHERE token=$1`, [req.params.token]); const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Not found' }); if (s.ref) { const r = await getRec(pool, s.ref); if (r && !mine(req.user, r)) return res.status(404).json({ error: 'Not found' }); } res.json(s); }));

  // ---- automatic late fees: checked hourly and on demand ----
  setInterval(() => runLateFees(ctx).catch(e => console.error('late fees', e)), 60 * 60 * 1000).unref();
  setTimeout(() => runLateFees(ctx).catch(e => console.error('late fees', e)), 20000).unref();
  app.post('/api/late-fees/run', W(async (req, res) => { if (!mgr(req.user) && req.user.role !== 'finance') return deny(res); res.json({ assessed: await runLateFees(ctx) }); }));

  // ---- insurance alerts ----
  app.get('/api/insurance-alerts', W(async (req, res) => { if (!['owner', 'manager', 'finance', 'collector', 'accounting'].includes(req.user.role)) return deny(res); const soon = ctx.addDays(today(), 15);
    const loans = (await list(pool, 'loan', `AND data->>'status'='active'`)).filter(l => mine(req.user, l));
    res.json(loans.map(l => ({ id: l.id, account: l.data.account, name: l.data.customer_label, vehicle: l.data.vehicle_label, company: l.data.cpi && l.data.cpi.company, expires: l.data.cpi && l.data.cpi.expires }))
      .filter(x => !x.expires || x.expires <= soon).sort((a, b) => String(a.expires || '').localeCompare(String(b.expires || '')))); }));

  // ---- cashier drawer close-out ----
  async function drawerExpected(c, user, date, storeId) {
    const pays = (await list(c, 'payment')).filter(p => p.data.date === date && p.data.cashier === user && (!storeId || Number(p.store_id) === Number(storeId)));
    const by = {}; pays.forEach(p => by[p.data.method] = r2((by[p.data.method] || 0) + num(p.data.amount)));
    const { rows } = await c.query(`SELECT src, sum(debit-credit)::float n FROM jrnl WHERE acct='1000' AND date=$1 AND by_user=$2 AND src IN ('parts','ro_pay','ro','deal','wholesale') ${storeId ? 'AND store_id=$3' : ''} GROUP BY src`, storeId ? [date, user, storeId] : [date, user]);
    const other = r2(rows.reduce((s, r) => s + r.n, 0));
    return { byMethod: by, payments: pays.length, otherCash: other, expectedCash: r2(by.cash || 0) };
  }
  app.get('/api/drawer', W(async (req, res) => { if (!can(req.user, 'payment') && !can(req.user, 'ro') && !can(req.user, 'part')) return deny(res); const date = req.query.date || today(), who = mgr(req.user) && req.query.cashier ? req.query.cashier : req.user.name;
    const store = req.user.store_id || req.query.store || null; const exp = await drawerExpected(pool, who, date, store);
    const closed = (await list(pool, 'drawer')).find(d => d.data.date === date && d.data.cashier === who && String(d.store_id || '') === String(store || ''));
    res.json({ date, cashier: who, ...exp, closed: closed && closed.data }); }));
  app.post('/api/drawer/close', W(async (req, res) => { if (!can(req.user, 'payment') && !can(req.user, 'ro') && !can(req.user, 'part')) return deny(res);
    const date = req.body.date || today(), who = mgr(req.user) && req.body.cashier ? req.body.cashier : req.user.name, store = req.user.store_id || req.body.store_id || null;
    if (req.body.counted_cash === '' || req.body.counted_cash == null) throw new Error('Enter the cash you counted');
    const out = await tx(async c => { await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['drawer|' + who + '|' + date]);
      if ((await list(c, 'drawer')).some(d => d.data.date === date && d.data.cashier === who && String(d.store_id || '') === String(store || ''))) throw new Error('This drawer is already closed');
      const exp = await drawerExpected(c, who, date, store); const counted = r2(req.body.counted_cash), diff = r2(counted - exp.expectedCash);
      if (diff) await post(c, { date, store, memo: `Drawer ${who} ${date} ${diff > 0 ? 'over' : 'short'}`, src: 'drawer', who: req.user.name, lines: [['1000', diff, 0], ['6950', 0, diff]] });
      return put(c, 'drawer', store, { date, cashier: who, counted_cash: counted, expected_cash: exp.expectedCash, over_short: diff, by_method: exp.byMethod, closed_by: req.user.name, closed_at: new Date().toISOString(), note: req.body.note || '' });
    });
    res.json(out.data); }));

  // ---- vendor bills (A/P) ----
  app.post('/api/bill/:id/post', W(async (req, res) => { if (!books(req.user)) return deny(res);
    const out = await tx(async c => { const b = await need(c, req.params.id, 'bill', req.user); const d = b.data; if (d.posted) throw new Error('Already posted');
      const lines = (d.lines || []).filter(l => l.acct || num(l.amount)); if (!lines.length) throw new Error('Add at least one line');
      if (lines.some(l => !l.acct || !(num(l.amount) > 0))) throw new Error('Every line needs an account and an amount more than 0');
      const accts = new Set((await list(c, 'account')).map(a => a.data.no)); if (lines.some(l => !accts.has(String(l.acct)))) throw new Error('Unknown account on a line');
      const total = r2(lines.reduce((s, l) => s + num(l.amount), 0)); const v = d.vendor_id ? await getRec(c, d.vendor_id) : null;
      d.entry = await post(c, { date: d.date || today(), store: b.store_id, memo: `Bill ${d.number || ''} ${v ? v.data.name : ''}`, src: 'bill', ref: b.id, who: req.user.name, lines: [...lines.map(l => [String(l.acct), num(l.amount), 0]), ['2000', 0, total]] });
      d.posted = true; d.total = total; d.balance = total; d.status = 'open'; await put(c, 'bill', b.store_id, d, b.id); return d; });
    res.json(out); }));
  app.post('/api/bill/:id/pay', W(async (req, res) => { if (!books(req.user)) return deny(res);
    const out = await tx(async c => { const b = await need(c, req.params.id, 'bill', req.user); const d = b.data; if (!d.posted) throw new Error('Post the bill first');
      const amt = r2(req.body.amount != null && req.body.amount !== '' ? req.body.amount : d.balance); if (!(amt > 0) || amt > num(d.balance) + 0.004) throw new Error('Amount must be more than 0 and no more than the balance');
      await post(c, { date: req.body.date || today(), store: b.store_id, memo: `Pay bill ${d.number || ''} ${req.body.ref || ''}`, src: 'billpay', ref: b.id, who: req.user.name, lines: [['2000', amt, 0], ['1000', 0, amt]] });
      d.balance = r2(num(d.balance) - amt); (d.payments = d.payments || []).push({ date: req.body.date || today(), amount: amt, method: req.body.method || '', ref: req.body.ref || '', by: req.user.name }); d.status = d.balance <= 0 ? 'paid' : 'open';
      await put(c, 'bill', b.store_id, d, b.id); return d; });
    res.json(out); }));

  // ---- bank reconciliation (cash account 1000) ----
  app.post('/api/bank/import', W(async (req, res) => { if (!books(req.user)) return deny(res);
    if (!req.user.store_id && !req.body.store_id && (await list(pool, 'store')).length > 1) throw new Error('Pick the store this bank account belongs to (store picker at the top)');
    const rows = parseCsv(String(req.body.csv || '')); if (rows.length < 2) throw new Error('Paste the bank’s CSV export (with a header row)');
    const h = rows[0].map(x => x.trim().toLowerCase()); const col = (...n) => h.findIndex(x => n.some(y => x.includes(y)));
    const iD = col('date'), iDesc = col('description', 'memo', 'payee', 'name'), iAmt = col('amount'), iDr = col('debit', 'withdrawal'), iCr = col('credit', 'deposit');
    if (iD < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0))) throw new Error('Couldn’t find Date and Amount (or Debit/Credit) columns');
    const toDate = s => { s = String(s).trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return null; };
    const money = s => { s = String(s || '').replace(/[$,\s]/g, ''); let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); } const v = num(s); return neg ? -Math.abs(v) : v; };
    const store = req.user.store_id || req.body.store_id || null; let added = 0, skipped = 0;
    await tx(async c => { await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['bank|' + (store || 'all')]);
      const have = {}; (await list(c, 'bankline')).filter(b => String(b.store_id || '') === String(store || '')).forEach(b => have[b.data.key] = (have[b.data.key] || 0) + 1); const seen = {};
      for (const r of rows.slice(1)) { const date = toDate(r[iD]); if (!date) { skipped++; continue; }
      const amount = r2(iAmt >= 0 ? money(r[iAmt]) : Math.abs(money(r[iCr])) - Math.abs(money(r[iDr]))); if (!amount) { skipped++; continue; }
      const desc = iDesc >= 0 ? String(r[iDesc]).slice(0, 200) : ''; const key = `${date}|${amount}|${desc}`; seen[key] = (seen[key] || 0) + 1;
      if (seen[key] <= (have[key] || 0)) { skipped++; continue; } // same line already imported (counts repeats, so two real $20 deposits both stay)
      await put(c, 'bankline', store, { date, amount, desc, key, matched: [] }); added++; } });
    res.json({ added, skipped }); }));
  app.get('/api/bank/rec', W(async (req, res) => { if (!books(req.user)) return deny(res); const store = req.user.store_id || req.query.store || null;
    if (!store && (await list(pool, 'store')).length > 1) return res.json({ pickStore: true });
    const bl = (await list(pool, 'bankline')).filter(b => !store || String(b.store_id || '') === String(store));
    const { rows } = await pool.query(`SELECT id,entry,date,memo,src,debit::float d,credit::float k,cleared_by FROM jrnl WHERE acct='1000' ${store ? 'AND store_id=$1' : ''} ORDER BY date, id`, store ? [store] : []);
    const book = r2(rows.reduce((s, r) => s + r.d - r.k, 0)); const unclearedBook = rows.filter(r => !r.cleared_by);
    const outstanding = r2(unclearedBook.reduce((s, r) => s + r.d - r.k, 0));
    res.json({ book, outstanding, cleared: r2(book - outstanding), bankUnmatched: bl.filter(b => !(b.data.matched || []).length).map(b => ({ id: b.id, ...b.data })).sort((a, b) => a.date.localeCompare(b.date)),
      bookUncleared: unclearedBook.map(r => ({ ...r, date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10), amount: r2(r.d - r.k) })) }); }));
  app.post('/api/bank/match', W(async (req, res) => { if (!books(req.user)) return deny(res);
    await tx(async c => { const b = await need(c, req.body.bankline_id, 'bankline', req.user); if ((b.data.matched || []).length) throw new Error('Already matched');
      const ids = (req.body.jrnl_ids || []).map(Number).filter(Boolean); if (!ids.length) throw new Error('Pick the book entries that match');
      const { rows } = await c.query(`SELECT id, store_id, debit::float d, credit::float k, cleared_by FROM jrnl WHERE acct='1000' AND id = ANY($1) FOR UPDATE`, [ids]);
      if (rows.some(r => String(r.store_id || '') !== String(b.store_id || ''))) throw new Error('Those entries belong to another store');
      if (rows.length !== ids.length || rows.some(r => r.cleared_by)) throw new Error('Some of those entries are already cleared');
      const sum = r2(rows.reduce((s, r) => s + r.d - r.k, 0)); if (Math.abs(sum - num(b.data.amount)) > 0.009) throw new Error(`Amounts don’t match (book ${sum} vs bank ${b.data.amount})`);
      await c.query(`UPDATE jrnl SET cleared_by=$1 WHERE id = ANY($2)`, [b.id, ids]); b.data.matched = ids; b.data.matched_by = req.user.name; await put(c, 'bankline', b.store_id, b.data, b.id); });
    res.json({ ok: true }); }));
  app.post('/api/bank/auto', W(async (req, res) => { if (!books(req.user)) return deny(res); const store = req.user.store_id || req.body.store_id || null; let n = 0;
    await tx(async c => { const bl = (await list(c, 'bankline')).filter(b => !(b.data.matched || []).length && (!store || String(b.store_id || '') === String(store)));
      const { rows } = await c.query(`SELECT id, date, debit::float d, credit::float k FROM jrnl WHERE acct='1000' AND cleared_by IS NULL ${store ? 'AND store_id=$1' : ''}`, store ? [store] : []);
      const used = new Set();
      for (const b of bl) { const amt = num(b.data.amount); const cands = rows.filter(r => !used.has(r.id) && Math.abs(r2(r.d - r.k) - amt) < 0.005 && Math.abs(ctx.daysBetween(String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10), b.data.date)) <= 5);
        if (cands.length === 1) { used.add(cands[0].id); await c.query(`UPDATE jrnl SET cleared_by=$1 WHERE id=$2`, [b.id, cands[0].id]); b.data.matched = [cands[0].id]; b.data.matched_by = 'auto'; await put(c, 'bankline', b.store_id, b.data, b.id); n++; } } });
    res.json({ matched: n }); }));
  app.post('/api/bank/unmatch', W(async (req, res) => { if (!books(req.user)) return deny(res);
    await tx(async c => { const b = await need(c, req.body.bankline_id, 'bankline', req.user); await c.query(`UPDATE jrnl SET cleared_by=NULL WHERE cleared_by=$1`, [b.id]); b.data.matched = []; await put(c, 'bankline', b.store_id, b.data, b.id); });
    res.json({ ok: true }); }));

  // ---- month-end lock (owner only) ----
  app.post('/api/close-period', W(async (req, res) => { if (req.user.role !== 'owner') return deny(res, 'Only the owner closes or reopens the books');
    const through = req.body.through || null; if (through && !/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error('Pick a date');
    await tx(async c => { const s = (await list(c, 'settings'))[0]; const was = s.data.closed_through; s.data.closed_through = through; await put(c, 'settings', null, s.data, s.id); await audit(c, req.user.name, 'close_period', 'settings', s.id, `${was || 'open'} -> ${through || 'open'}`); });
    res.json({ closed_through: through }); }));

  // ---- QuickBooks export (IIF general journal) ----
  app.get('/api/export/qb', W(async (req, res) => { if (!books(req.user)) return deny(res);
    const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31', store = req.user.store_id || req.query.store || null;
    const accts = {}; (await list(pool, 'account')).forEach(a => accts[a.data.no] = `${a.data.no} ${a.data.name}`.replace(/[\t\r\n:]/g, ' '));
    const { rows } = await pool.query(`SELECT entry, to_char(date,'MM/DD/YYYY') d, acct, debit::float dr, credit::float cr, memo FROM jrnl WHERE date BETWEEN $1 AND $2 ${store ? 'AND store_id=$3' : ''} ORDER BY entry, id`, store ? [from, to, store] : [from, to]);
    const clean = s => String(s || '').replace(/[\t\r\n]/g, ' ').slice(0, 200);
    const out = ['!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO', '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO', '!ENDTRNS'];
    const by = {}; rows.forEach(r => (by[r.entry] = by[r.entry] || []).push(r));
    for (const [e, ls] of Object.entries(by)) ls.forEach((l, i) => { out.push([i ? 'SPL' : 'TRNS', '', 'GENERAL JOURNAL', l.d, accts[l.acct] || l.acct, r2(l.dr - l.cr).toFixed(2), e, clean(l.memo)].join('\t')); if (i === ls.length - 1) out.push('ENDTRNS'); });
    res.set('Content-Type', 'text/plain').set('Content-Disposition', `attachment; filename="journal-${from}-to-${to}.iif"`).send(out.join('\r\n') + '\r\n'); }));
  app.get('/api/export/journal.csv', W(async (req, res) => { if (!books(req.user)) return deny(res);
    const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31', store = req.user.store_id || req.query.store || null;
    const { rows } = await pool.query(`SELECT entry, to_char(date,'YYYY-MM-DD') d, acct, debit::float dr, credit::float cr, memo, src FROM jrnl WHERE date BETWEEN $1 AND $2 ${store ? 'AND store_id=$3' : ''} ORDER BY entry, id`, store ? [from, to, store] : [from, to]);
    res.set('Content-Type', 'text/csv').set('Content-Disposition', `attachment; filename="journal-${from}-to-${to}.csv"`).send(csv([['Entry', 'Date', 'Account', 'Debit', 'Credit', 'Memo', 'Source'], ...rows.map(r => [r.entry, r.d, r.acct, r.dr.toFixed(2), r.cr.toFixed(2), r.memo, r.src])])); }));

  // ---- move a unit to another store, with intercompany entries ----
  app.post('/api/vehicle/:id/transfer', W(async (req, res) => { if (!mgr(req.user) || req.user.store_id) return deny(res, 'An all-stores manager moves units between stores');
    const out = await tx(async c => { const v = await need(c, req.params.id, 'vehicle', req.user); const d = v.data; const to = Number(req.body.to_store);
      const dest = await getRec(c, to); if (!dest || dest.kind !== 'store') throw new Error('Pick the store to move it to'); if (Number(v.store_id) === to) throw new Error('It’s already at that store');
      if (!['in_stock', 'hold', 'in_transit'].includes(d.status)) throw new Error('Only units in inventory can move');
      if (num(d.posted_floor)) throw new Error('This unit is floored — pay off or move the floorplan with the lender first');
      const cost = ctx.vehCostOf(v), date = today();
      if (cost) { await post(c, { date, store: v.store_id, memo: `Transfer ${d.stock} to ${dest.data.name}`, src: 'transfer', ref: v.id, who: req.user.name, lines: [['1500', cost, 0], ['1300', 0, cost]] });
        await post(c, { date, store: to, memo: `Transfer ${d.stock} in from store ${v.store_id}`, src: 'transfer', ref: v.id, who: req.user.name, lines: [['1300', cost, 0], ['2500', 0, cost]] }); }
      (d.transfers = d.transfers || []).push({ date, from: v.store_id, to, cost, by: req.user.name }); await put(c, 'vehicle', to, d, v.id); return d; });
    res.json(out); }));

  // ---- factory (OEM) statement: accounts grouped by the statement line they map to ----
  app.get('/api/report/oem', W(async (req, res) => { if (!books(req.user)) return deny(res);
    const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31', store = req.user.store_id || req.query.store || null;
    const accts = {}; (await list(pool, 'account')).forEach(a => accts[a.data.no] = a.data);
    const { rows } = await pool.query(`SELECT acct, sum(debit-credit)::float n FROM jrnl WHERE date BETWEEN $1 AND $2 ${store ? 'AND store_id=$3' : ''} GROUP BY acct`, store ? [from, to, store] : [from, to]);
    const lines = {}; for (const r of rows) { const a = accts[r.acct] || {}; const k = a.oem_line || '(not mapped)'; const x = lines[k] = lines[k] || { line: k, amount: 0, accounts: [] }; x.amount = r2(x.amount + r.n); x.accounts.push(r.acct); }
    res.json(Object.values(lines).sort((a, b) => a.line.localeCompare(b.line))); }));

  // ---- pay plans, time clock, commissions (exported to the payroll company) ----
  app.get('/api/payplans', W(async (req, res) => { if (!books(req.user)) return deny(res); res.json((await list(pool, 'payplan')).filter(p => mine(req.user, p))); }));
  app.post('/api/payplans', W(async (req, res) => { if (!mgr(req.user)) return deny(res, 'A manager sets pay plans');
    const b = req.body || {}; const u = await getRec(pool, b.user_id); if (!u || u.kind !== 'user') throw new Error('Pick a person');
    if (String(u.id) === String(req.user.id)) throw new Error('Someone else has to set your own pay plan');
    if (req.user.store_id && Number(u.data.store_id) !== Number(req.user.store_id)) throw new Error('You can only set pay plans for your own store');
    const d = { user_id: u.id, name: u.data.name, hourly: num(b.hourly), salary: num(b.salary), per_unit: num(b.per_unit), pct_front: num(b.pct_front), pct_back: num(b.pct_back), per_flag_hour: num(b.per_flag_hour), min_per_unit: num(b.min_per_unit), notes: String(b.notes || '').slice(0, 300) };
    const old = (await list(pool, 'payplan')).find(p => String(p.data.user_id) === String(u.id));
    const r = await put(pool, 'payplan', u.data.store_id || null, d, old && old.id); await audit(pool, req.user.name, 'payplan', 'user', u.id, JSON.stringify(d)); res.json(r); }));
  app.post('/api/clock', W(async (req, res) => { const act = req.body.action; if (!['in', 'out'].includes(act)) throw new Error('Clock in or out');
    if (req.user.id === 'owner' || req.user.id === 0) throw new Error('The owner login doesn’t use the time clock');
    const out = await tx(async c => { await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['clock|' + req.user.id]); const open = (await list(c, 'timeclock')).find(t => Number(t.data.user_id) === Number(req.user.id) && !t.data.out);
      if (act === 'in') { if (open) throw new Error('You’re already clocked in'); return put(c, 'timeclock', req.user.store_id, { user_id: req.user.id, name: req.user.name, in: new Date().toISOString() }); }
      if (!open) throw new Error('You’re not clocked in'); open.data.out = new Date().toISOString(); open.data.hours = r2((new Date(open.data.out) - new Date(open.data.in)) / 36e5); return put(c, 'timeclock', open.store_id, open.data, open.id); });
    res.json(out.data); }));
  app.get('/api/clock/me', W(async (req, res) => { const t = (await list(pool, 'timeclock')).filter(x => Number(x.data.user_id) === Number(req.user.id)).slice(0, 20); res.json(t.map(x => x.data)); }));
  app.post('/api/clock/fix', W(async (req, res) => { if (!mgr(req.user)) return deny(res); const t = await need(pool, req.body.id, 'timeclock', req.user);
    if (String(t.data.user_id) === String(req.user.id)) throw new Error('Someone else has to fix your own punches');
    const d = t.data; if (req.body.in) d.in = new Date(req.body.in).toISOString(); if (req.body.out) d.out = new Date(req.body.out).toISOString();
    if (d.out && new Date(d.out) < new Date(d.in)) throw new Error('Out is before in'); d.hours = d.out ? r2((new Date(d.out) - new Date(d.in)) / 36e5) : null; (d.edits = d.edits || []).push({ by: req.user.name, at: new Date().toISOString() });
    await put(pool, 'timeclock', t.store_id, d, t.id); res.json(d); }));
  async function payroll(req) {
    const from = req.query.from, to = req.query.to; if (!from || !to) throw new Error('Pick the pay period');
    const plans = {}; (await list(pool, 'payplan')).forEach(p => plans[p.data.user_id] = p.data);
    const users = (await list(pool, 'user')).filter(u => u.data.active !== false && (!req.user.store_id || Number(u.data.store_id) === Number(req.user.store_id)));
    const ld = iso => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NAME || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const clock = (await list(pool, 'timeclock')).filter(t => t.data.out && ld(t.data.in) >= from && ld(t.data.in) <= to); // pay periods in local dates
    const deals = (await list(pool, 'deal')).filter(d => d.data.status === 'delivered' && d.data.delivered >= from && d.data.delivered <= to);
    const ros = (await list(pool, 'ro')).filter(r => r.data.status === 'closed' && r.data.closed >= from && r.data.closed <= to);
    return users.map(u => { const p = plans[u.id] || {}; const name = u.data.name;
      const hours = r2(clock.filter(t => String(t.data.user_id) === String(u.id)).reduce((s, t) => s + num(t.data.hours), 0));
      const mineDeals = deals.filter(d => (d.data.salesperson || '').trim().toLowerCase() === name.trim().toLowerCase());
      const front = r2(mineDeals.reduce((s, d) => s + num(d.data.calc && d.data.calc.front), 0)), back = r2(mineDeals.reduce((s, d) => s + num(d.data.calc && d.data.calc.back), 0));
      const perDeal = mineDeals.map(d => Math.max(num(p.min_per_unit), num(p.per_unit) + num(d.data.calc && d.data.calc.front) * num(p.pct_front) / 100 + num(d.data.calc && d.data.calc.back) * num(p.pct_back) / 100));
      const flag = r2(ros.reduce((s, r) => s + (r.data.lines || []).filter(l => (l.tech || '').trim().toLowerCase() === name.trim().toLowerCase()).reduce((a, l) => a + num(l.hours), 0), 0));
      const commission = r2(perDeal.reduce((s, x) => s + x, 0)), techPay = r2(flag * num(p.per_flag_hour)), hourlyPay = r2(hours * num(p.hourly));
      return { user_id: u.id, name, role: u.data.role, hours, hourly: num(p.hourly), hourlyPay, units: mineDeals.length, front, back, commission, flagHours: flag, techPay, salary: num(p.salary), total: r2(hourlyPay + commission + techPay + num(p.salary)), hasPlan: !!plans[u.id] };
    }); }
  app.get('/api/payroll', W(async (req, res) => { if (!books(req.user)) return deny(res); res.json(await payroll(req)); }));
  app.get('/api/payroll.csv', W(async (req, res) => { if (!books(req.user)) return deny(res); const rows = await payroll(req);
    res.set('Content-Type', 'text/csv').set('Content-Disposition', `attachment; filename="payroll-${req.query.from}-to-${req.query.to}.csv"`)
      .send(csv([['Employee', 'Role', 'Hours', 'Hourly rate', 'Hourly pay', 'Units sold', 'Front gross', 'Back gross', 'Commission', 'Flag hours', 'Tech pay', 'Salary', 'Total'], ...rows.map(r => [r.name, r.role, r.hours, r.hourly, r.hourlyPay, r.units, r.front, r.back, r.commission, r.flagHours, r.techPay, r.salary, r.total])])); }));

  // ---- CSV downloads for every list ----
  const CSVS = {
    inventory: { roles: null, kind: 'vehicle', head: ['Stock', 'VIN', 'Year', 'Make', 'Model', 'Trim', 'Color', 'Miles', 'Status', 'Acquired', 'Days in stock', 'Cost', 'Recon', 'Total cost', 'Price', 'Floorplan lender', 'Floored', 'Store'],
      row: (v, x) => { const recon = (v.data.recon || []).reduce((s, r) => s + num(r.cost), 0); return [v.data.stock, v.data.vin, v.data.year, v.data.make, v.data.model, v.data.trim, v.data.color, v.data.miles, v.data.status, v.data.acquired, v.data.acquired ? ctx.daysBetween(v.data.acquired, today()) : '', num(v.data.cost), r2(recon), r2(num(v.data.cost) + recon), num(v.data.price), v.data.floorplan_lender || '', num(v.data.posted_floor), x.store(v)]; } },
    customers: { roles: ['owner','manager','sales','finance','collector','service','accounting'], kind: 'customer', head: u => ['First', 'Last', 'Mobile', 'Email', 'Address', 'City', 'State', 'ZIP', 'Employer', ...(mgr(u) ? ["Driver's license", 'DL state', 'Date of birth', 'Monthly income'] : []), 'OK to text', 'Created'],
      row: (c, x, u) => [c.data.first, c.data.last, c.data.phone, c.data.email, c.data.address, c.data.city, c.data.state, c.data.zip, c.data.employer, ...(mgr(u) ? [c.data.dl, c.data.dl_state, c.data.dob, c.data.income] : []), c.data.sms_ok === false ? 'No' : 'Yes', String(c.created_at.toISOString ? c.created_at.toISOString() : c.created_at).slice(0, 10)] },
    leads: { roles: ['owner','manager','sales','finance'], kind: 'lead', head: ['Created', 'Customer', 'Phone', 'Source', 'Status', 'Salesperson', 'Interest', 'Next follow-up', 'Store'],
      row: (l, x) => { const c = x.cust[l.data.customer_id] || {}; return [l.data.created, [c.first, c.last].filter(Boolean).join(' '), c.phone, l.data.source, l.data.status, l.data.owner, l.data.interest, l.data.next_followup, x.store(l)]; } },
    deals: { roles: ['owner','manager','sales','finance','accounting'], kind: 'deal', head: ['Deal', 'Status', 'Delivered', 'Type', 'Customer', 'Vehicle', 'Salesperson', 'Price', 'Down', 'Amount financed', 'Payment', 'Term', 'APR', 'Front gross', 'Back gross', 'Total gross', 'Lender', 'Funding', 'Store'],
      row: (d, x) => { const k = d.data.calc || {}, c = x.cust[d.data.customer_id] || {}; return [d.data.number, d.data.status, d.data.delivered || '', d.data.type, [c.first, c.last].filter(Boolean).join(' '), d.data.vehicle_label, d.data.salesperson, num(k.price || d.data.price), num(k.down || d.data.down), num(k.financed), num(k.payment), k.n || d.data.term || '', k.apr != null ? k.apr : d.data.apr, num(k.front), num(k.back), num(k.gross), d.data.lender || '', d.data.funding || '', x.store(d)]; } },
    accounts: { roles: ['owner','manager','finance','collector','accounting'], kind: 'loan', head: ['Account', 'Customer', 'Vehicle', 'Status', 'Interest method', 'APR', 'Payments', 'Schedule', 'Payment', 'Balance', 'Past due', 'Days late', 'Next due', 'Payoff today', 'Fees owed', 'Store'], status: true,
      row: (l, x) => { const s = l.status; return [l.data.account, l.data.customer_label, l.data.vehicle_label, l.data.status, l.data.method, l.data.apr, l.data.term, l.data.frequency, l.data.payment, s.balance, s.pastDue, s.daysLate, s.nextDue || '', s.payoff, s.feesOwed, x.store(l)]; } },
    payments: { roles: ['owner','manager','finance','collector','accounting'], kind: 'payment', head: ['Date', 'Receipt', 'Account', 'Customer', 'Amount', 'Method', 'Principal', 'Interest', 'Fees', 'Cashier', 'Reference', 'Store'],
      row: (p, x) => [p.data.date, p.data.receipt, p.data.account, p.data.customer_label, p.data.amount, p.data.method, p.data.principal, p.data.interest, p.data.fees, p.data.cashier, p.data.ref, x.store(p)] },
    repair_orders: { roles: ['owner','manager','service','parts','accounting'], kind: 'ro', head: ['RO', 'Opened', 'Closed', 'Status', 'Department', 'Customer', 'Vehicle', 'VIN', 'Customer pays', 'Warranty', 'Internal', 'Paid', 'Advisor', 'Store'],
      row: (r, x) => { const t = r.data.totals || {}; return [r.data.number, r.data.opened, r.data.closed || '', r.data.status, r.data.dept, r.data.customer_label, r.data.vehicle_label, r.data.vin, num(t.customer), num(t.warranty), num(t.internal), r.data.paid ? 'Yes' : 'No', r.data.advisor, x.store(r)]; } },
    parts: { roles: ['owner','manager','service','parts','accounting'], kind: 'part', head: ['Part #', 'Description', 'Brand', 'Bin', 'On hand', 'Average cost', 'List price', 'Value at cost', 'Reorder at', 'Stock to', 'Vendor', 'Store'],
      row: (p, x) => [p.data.number, p.data.description, p.data.brand, p.data.bin, num(p.data.qty), num(p.data.cost), num(p.data.price), r2(Math.max(0, num(p.data.qty)) * num(p.data.cost)), p.data.min, p.data.max, p.data.vendor, x.store(p)] },
    warranty_claims: { roles: ['owner','manager','service','accounting'], kind: 'claim', head: ['RO', 'Opened', 'Manufacturer', 'Claim #', 'Line', 'Amount', 'Status', 'Paid', 'Chargeback', 'Store'],
      row: (c, x) => [c.data.ro, c.data.opened, c.data.oem, c.data.claim_no || '', c.data.line, c.data.amount, c.data.status, c.data.paid_amount != null ? c.data.paid_amount : '', c.data.chargeback != null ? c.data.chargeback : '', x.store(c)] },
    appraisals: { roles: ['owner','manager','sales','finance'], kind: 'appraisal', head: ['Appraisal', 'Status', 'VIN', 'Year', 'Make', 'Model', 'Miles', 'Customer', 'Offer', 'Target retail', 'Est. recon', 'Market price', 'Store'],
      row: (a, x) => [a.data.number, a.data.status, a.data.vin, a.data.year, a.data.make, a.data.model, a.data.miles, a.data.customer, a.data.offer, a.data.retail_target, a.data.recon_estimate, a.data.market ? a.data.market.price : '', x.store(a)] },
    bills: { roles: ['owner', 'manager', 'accounting'], kind: 'bill', head: ['Vendor', 'Bill #', 'Date', 'Due', 'Status', 'Total', 'Balance', 'Store'],
      row: (b, x) => [(x.vendor[b.data.vendor_id] || {}).name, b.data.number, b.data.date, b.data.due, b.data.posted ? b.data.status : 'draft', b.data.total != null ? b.data.total : (b.data.lines || []).reduce((s, l) => s + num(l.amount), 0), b.data.balance != null ? b.data.balance : '', x.store(b)] },
    vendors: { roles: ['owner', 'manager', 'accounting'], kind: 'vendor', head: ['Vendor', 'Terms'], row: v => [v.data.name, v.data.terms] },
    bank_lines: { roles: ['owner', 'manager', 'accounting'], kind: 'bankline', head: ['Date', 'Description', 'Amount', 'Matched', 'Store'], row: (b, x) => [b.data.date, b.data.desc, b.data.amount, (b.data.matched || []).length ? 'Yes' : 'No', x.store(b)] },
    time_clock: { roles: ['owner', 'manager', 'accounting'], kind: 'timeclock', head: ['Employee', 'In', 'Out', 'Hours', 'Edited'], row: t => [t.data.name, t.data.in, t.data.out || '', t.data.hours != null ? t.data.hours : '', (t.data.edits || []).length ? 'Yes' : ''] },
    drawers: { roles: ['owner', 'manager', 'accounting'], kind: 'drawer', head: ['Date', 'Cashier', 'Expected cash', 'Counted', 'Over/short', 'Closed by', 'Store'], row: (d, x) => [d.data.date, d.data.cashier, d.data.expected_cash, d.data.counted_cash, d.data.over_short, d.data.closed_by, x.store(d)] },
  };
  app.get('/api/csv/:name', W(async (req, res) => {
    const name = req.params.name, u = req.user;
    const send = (rows, file) => res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${file}-${today()}.csv"`).send('﻿' + csv(rows));
    const storeQ = u.store_id || req.query.store || null; const inStore = r => !storeQ || !r.store_id || String(r.store_id) === String(storeQ);
    if (name === 'trial_balance') { if (!books(u)) return deny(res); const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
      const accts = {}; (await list(pool, 'account')).forEach(a => accts[a.data.no] = a.data);
      const { rows } = await pool.query(`SELECT acct, sum(debit)::float d, sum(credit)::float k FROM jrnl WHERE date BETWEEN $1 AND $2 ${storeQ ? 'AND store_id=$3' : ''} GROUP BY acct ORDER BY acct`, storeQ ? [from, to, storeQ] : [from, to]);
      return send([['Account', 'Name', 'Type', 'Department', 'Debits', 'Credits', 'Net'], ...rows.map(r => [r.acct, (accts[r.acct] || {}).name, (accts[r.acct] || {}).type, (accts[r.acct] || {}).dept, r2(r.d), r2(r.k), r2(r.d - r.k)])], 'trial-balance'); }
    if (name === 'chart_of_accounts') { if (!books(u)) return deny(res); } if (name === 'chart_of_accounts') return send([['Number', 'Name', 'Type', 'Department', 'Factory statement line'], ...(await list(pool, 'account')).sort((a, b) => a.data.no > b.data.no ? 1 : -1).map(a => [a.data.no, a.data.name, a.data.type, a.data.dept, a.data.oem_line || ''])], 'chart-of-accounts');
    if (name === 'audit_log') { if (!mgr(u) || u.store_id) return deny(res); const { rows } = await pool.query(`SELECT at, who, action, kind, ref, detail FROM audit ORDER BY id DESC LIMIT 20000`);
      return send([['When', 'Who', 'Action', 'Record type', 'Record', 'Detail'], ...rows.map(r => [r.at.toISOString(), r.who, r.action, r.kind, r.ref, r.detail])], 'audit-log'); }
    if (name === 'collections' && !['owner', 'manager', 'finance', 'collector', 'accounting'].includes(u.role)) return deny(res);
    if (name === 'collections') { const loans = (await list(pool, 'loan', `AND data->>'status'='active'`)).filter(inStore); const pays = await list(pool, 'payment'); const by = {}; pays.forEach(p => (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p));
      const cust = {}; (await list(pool, 'customer')).forEach(c => cust[c.id] = c.data);
      const q = loans.map(l => ({ l, s: ctx.loanStatus(l, by[l.id] || []) })).filter(x => x.s.daysLate > 0).sort((a, b) => b.s.daysLate - a.s.daysLate);
      return send([['Account', 'Customer', 'Phone', 'Vehicle', 'Days late', 'Bucket', 'Past due', 'Balance', 'Payment', 'Next due', 'Collector'], ...q.map(({ l, s }) => [l.data.account, l.data.customer_label, (cust[l.data.customer_id] || {}).phone, l.data.vehicle_label, s.daysLate, s.bucket, s.pastDue, s.balance, l.data.payment, s.nextDue, l.data.collector || ''])], 'collections'); }
    const def = CSVS[name]; if (!def) return res.status(404).json({ error: 'Unknown download' });
    if (def.roles && !def.roles.includes(u.role)) return deny(res);
    let recs = (await list(pool, def.kind)).filter(inStore).reverse();
    if (def.status) { const pays = await list(pool, 'payment'); const by = {}; pays.forEach(p => (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p)); recs = recs.map(l => ({ ...l, status: ctx.loanStatus(l, by[l.id] || []) })); }
    const stores = {}; (await list(pool, 'store')).forEach(s => stores[s.id] = s.data.name); const cust = {}; if (['leads', 'deals'].includes(name)) (await list(pool, 'customer')).forEach(c => cust[c.id] = c.data);
    const vendor = {}; if (name === 'bills') (await list(pool, 'vendor')).forEach(v => vendor[v.id] = v.data);
    const x = { store: r => stores[r.store_id] || '', cust, vendor };
    send([typeof def.head === 'function' ? def.head(u) : def.head, ...recs.map(r => def.row(r, x, u))], name.replace(/_/g, '-'));
  }));

  // ---- shop capacity: booked hours vs technician hours, by day ----
  app.get('/api/capacity', W(async (req, res) => { const store = req.user.store_id || req.query.store || null; const from = req.query.from || today(), days = Math.min(31, num(req.query.days) || 7);
    const sts = store ? [await getRec(pool, store)].filter(Boolean) : await list(pool, 'store'); const cap = r2(sts.reduce((s, st) => s + num(st.data.tech_count) * num(st.data.tech_hours), 0));
    const appts = (await list(pool, 'appt')).filter(a => (!store || String(a.store_id || '') === String(store)) && a.data.status !== 'no_show');
    const out = []; for (let i = 0; i < days; i++) { const d = ctx.addDays(from, i); const booked = r2(appts.filter(a => (a.data.when || '').slice(0, 10) === d).reduce((s, a) => s + num(a.data.hours || 1), 0)); out.push({ date: d, booked, capacity: cap, open: r2(cap - booked) }); }
    res.json({ capacity: cap, set: !!cap, days: out }); }));

  // ---- service media: inspection video uploads to Cloudflare R2 (S3-compatible) ----
  app.post('/api/media/upload-url', W(async (req, res) => { if (!can(req.user, 'ro')) return deny(res);
    const cfg = (await secrets(ctx)).r2 || {}; if (!cfg.account_id || !cfg.access_key_id || !cfg.secret_access_key || !cfg.bucket) throw new Error('Video storage isn’t connected yet — add the Cloudflare R2 keys in Settings → Integrations');
    const ro = await need(pool, req.body.ro_id, 'ro', req.user); const ext = String(req.body.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
    const key = `ro/${ro.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`; res.json({ key, url: presign(cfg, 'PUT', key, 900) }); }));
  app.get('/api/media/view', W(async (req, res) => { const cfg = (await secrets(ctx)).r2 || {}; const key = String(req.query.key || '');
    if (!/^ro\/\d+\//.test(key) || !cfg.bucket) return res.status(404).json({ error: 'Not found' }); const ro = await need(pool, key.split('/')[1], 'ro', req.user); res.json({ url: presign(cfg, 'GET', key, 3600) }); }));
}

module.exports.presign = presign; module.exports.parseCsv = parseCsv;
