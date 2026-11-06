'use strict';
const crypto = require('crypto');
const db = require('./db');

class AppErr extends Error {
  constructor(msg, status = 400, extra) { super(Array.isArray(msg) ? msg[0] : msg); this.msg = Array.isArray(msg) ? msg : [msg, msg]; this.status = status; this.extra = extra; }
}
const FOLIO = { orders: 'PV', contracts: 'CT', credit_notes: 'NC', production_orders: 'OF', loads: 'CG', invoices: 'FA', requisitions: 'SC', purchase_orders: 'OC', goods_receipts: 'EM' };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = n => Number(n) || 0;
const TZ = 'America/Mexico_City';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addBiz = (d, n) => { let x = d, k = 0; while (k < n) { x = addDays(x, 1); const w = new Date(x + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) k++; } return x; };
const bizBetween = (a, b) => { let n = 0, x = a; while (x < b) { x = addDays(x, 1); const w = new Date(x + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) n++; } return n; };
const monthEnd = p => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const period = (d = today()) => d.slice(0, 7);
const uuid = () => crypto.randomUUID().toUpperCase();
const B = (es, en) => (en && en !== es ? es + ' ‖ ' + en : es);
const fmt$ = n => '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function parseCFDI(xml) {
  const attr = (tag, a) => { const m = xml.match(new RegExp('<[\\w]*:?' + tag + '\\b[^>]*?\\s' + a + '="([^"]*)"', 'i')); return m ? m[1] : null; };
  const out = {
    uuid: attr('TimbreFiscalDigital', 'UUID'),
    date: (attr('Comprobante', 'Fecha') || '').slice(0, 10) || null,
    subtotal: parseFloat(attr('Comprobante', 'SubTotal')) || null,
    total: parseFloat(attr('Comprobante', 'Total')) || null,
    emisor: attr('Emisor', 'Rfc'), receptor: attr('Receptor', 'Rfc'),
    version: attr('Comprobante', 'Version'), method: attr('Comprobante', 'MetodoPago'),
  };
  const tr = xml.match(/TotalImpuestosTrasladados="([^"]*)"/); out.tax = tr ? parseFloat(tr[1]) : 0;
  const rt = xml.match(/TotalImpuestosRetenidos="([^"]*)"/); out.retention = rt ? parseFloat(rt[1]) : 0;
  return out;
}

async function setting(k, def) { const r = await db.one('SELECT v FROM settings WHERE k=$1', [k]); return r ? r.v : def; }

// ── Availability: stock − reserved (open orders) + scheduled production ──
async function availability(ctx, productId, warehouseId, excludeOrder) {
  const st = await ctx.one('SELECT coalesce(sum(qty),0)::float q FROM stock WHERE product_id=$1 AND ($2::int IS NULL OR warehouse_id=$2)', [productId, warehouseId || null]);
  const res = await ctx.one(`SELECT coalesce(sum((l->>'qty')::numeric),0)::float q FROM orders o, jsonb_array_elements(o.lines) l
    WHERE o.status IN ('confirmado','en_produccion','listo','programado') AND (l->>'product_id')::int=$1 AND ($2::int IS NULL OR o.warehouse_id=$2) AND o.id <> coalesce($3,-1)`, [productId, warehouseId || null, excludeOrder || null]);
  const prod = await ctx.one(`SELECT coalesce(sum(qty),0)::float q FROM production_orders WHERE product_id=$1 AND status IN ('solicitada','programada','en_proceso') AND order_id IS NULL`, [productId]);
  return { stock: st.q, reserved: res.q, incoming: prod.q, available: st.q - res.q };
}

async function nextCapacityDate(ctx, kg, from) {
  const lines = await ctx.all('SELECT id, kg_day, lead_days FROM production_lines ORDER BY kg_day DESC');
  if (!lines.length) return addBiz(from, 5);
  let best = null;
  for (const ln of lines) {
    let d = addBiz(from, 1);
    for (let i = 0; i < 60; i++) {
      const used = await ctx.one(`SELECT coalesce(sum(kg),0)::float k FROM production_orders WHERE line_id=$1 AND sched_date=$2 AND status IN ('programada','en_proceso')`, [ln.id, d]);
      if (used.k + kg <= num(ln.kg_day)) break;
      d = addBiz(d, 1);
    }
    const done = addBiz(d, num(ln.lead_days) || 4);
    if (!best || done < best.date) best = { date: done, line: ln.id, start: d };
  }
  return best.date;
}

// ── Order pricing engine (list price, contract price, promotions, approvals, freight, feasibility) ──
async function priceOrder(row, ctx) {
  const cust = row.customer_id ? await ctx.get('customers', row.customer_id) : null;
  const seg = cust ? await ctx.one('SELECT * FROM segment_rules WHERE segment=$1', [cust.segment_override || cust.segment]) : null;
  const contract = row.contract_id ? await ctx.get('contracts', row.contract_id) : null;
  const d = row.promised_date || today();
  const promos = await ctx.all(`SELECT * FROM promotions WHERE status='activa' AND starts <= $1 AND ends >= $1`, [d]);
  const out = []; let subtotal = 0, kg = 0, maxDisc = 0; const alerts = [];
  for (const l0 of (row.lines || [])) {
    if (l0.note && /PROMO/.test(l0.note) && num(l0.price) === 0) continue; // regenerate free lines
    const l = Object.assign({}, l0);
    const p = l.product_id ? await ctx.get('products', l.product_id) : null;
    if (!p) continue;
    const cl = contract && (contract.lines || []).find(x => x.product_id === p.id);
    if (cl) { l.price = num(cl.price); l.note = B('Precio de contrato ', 'Contract price ') + contract.folio; }
    else if (l.price == null || l.price === '' || num(l.price) === 0) l.price = num(p.list_price);
    const listDisc = num(p.list_price) > 0 ? Math.max(0, (1 - num(l.price) / num(p.list_price)) * 100) : 0;
    let disc = num(l.disc);
    let promoDisc = 0;
    for (const pr of promos) {
      if (pr.channel && cust && pr.channel !== cust.channel) continue;
      if (pr.product_id && pr.product_id !== p.id) continue;
      if (pr.family_id && pr.family_id !== p.family_id) continue;
      if (pr.type === 'pct') { promoDisc = Math.max(promoDisc, num(pr.pct)); l.note = 'PROMO ' + pr.name; l.promo_id = pr.id; }
      if (pr.type === 'nxm' && num(pr.buy) > 0) {
        const free = Math.floor(num(l.qty) / num(pr.buy)) * num(pr.get);
        if (free > 0) out.push({ product_id: p.id, qty: free, price: 0, disc: 0, total: 0, note: `PROMO ${pr.name} (${pr.buy}+${pr.get})`, promo_id: pr.id, promo_value: r2(free * num(p.list_price)) });
      }
    }
    const effDisc = !cl ? listDisc + disc : disc;
    if (!cl) maxDisc = Math.max(maxDisc, effDisc);
    if (promoDisc) l.note = `PROMO ${promos.find(x => x.id === l.promo_id).name} −${promoDisc}%`;
    else if (l.note && /^PROMO/.test(l.note)) l.note = null;
    const totalDisc = Math.min(100, disc + promoDisc);
    l.disc = r2(disc);
    l.total = r2(num(l.qty) * num(l.price) * (1 - totalDisc / 100));
    subtotal += l.total; kg += num(l.qty) * num(p.kg_unit || 0);
    out.push(l);
  }
  for (const l of out) if (num(l.price) === 0 && l.promo_id) { const p = await ctx.get('products', l.product_id); kg += num(l.qty) * num(p.kg_unit || 0); }
  // approval level by discount ceilings (V-4)
  let level = '';
  const vta = seg ? num(seg.max_disc_vta) : 3, gv = seg ? num(seg.max_disc_gv) : 7;
  if (maxDisc > gv + 0.001) level = 'DIR'; else if (maxDisc > vta + 0.001) level = 'GV';
  if (level) alerts.push(B(`Descuento máximo ${r2(maxDisc)}% excede el límite del segmento → requiere autorización de ${level === 'DIR' ? 'Dirección' : 'Gerencia de Ventas'}.`, `Max discount ${r2(maxDisc)}% exceeds the segment limit → requires ${level === 'DIR' ? 'management' : 'sales management'} approval.`));
  // freight (V-10)
  let freight = 0;
  if (cust && cust.route_id) { const rt = await ctx.get('routes', cust.route_id); if (rt) freight = r2(kg * num(rt.rate_kg)); }
  // feasibility / promise check (V-6, V-8, V-18)
  let earliest = today(); let shortKg = 0;
  for (const l of out) {
    const p = await ctx.get('products', l.product_id);
    const av = await availability(ctx, l.product_id, row.warehouse_id, row.id);
    if (p.mode === 'mto' || av.available < num(l.qty)) {
      const short = p.mode === 'mto' ? num(l.qty) : num(l.qty) - Math.max(0, av.available);
      shortKg += short * num(p.kg_unit || 0);
      if (p.mode !== 'mto') alerts.push(B(`${p.code}: disponible ${Math.max(0, r2(av.available))} de ${l.qty} solicitados en la bodega; faltante ${r2(short)} se enviará a producción.`, `${p.code}: ${Math.max(0, r2(av.available))} of ${l.qty} available in the warehouse; shortage of ${r2(short)} goes to production.`));
    }
  }
  let ship = 1;
  if (cust && cust.route_id) { const rt = await ctx.get('routes', cust.route_id); ship = num(rt && rt.ship_days) || 1; }
  if (shortKg > 0) earliest = addBiz(await nextCapacityDate(ctx, shortKg, today()), ship); else earliest = addBiz(today(), ship);
  if (row.promised_date && row.promised_date < earliest) alerts.push(B(`La fecha compromiso (${row.promised_date}) es anterior a la fecha factible (${earliest}). Ajuste la fecha o confirme con Producción.`, `Promised date (${row.promised_date}) is before the feasible date (${earliest}). Adjust the date or confirm with Production.`));
  // credit (V-7)
  if (cust) {
    if (num(cust.credit_limit) > 0 && num(cust.balance) + subtotal + freight > num(cust.credit_limit)) alerts.push(B(`El pedido excede la línea de crédito disponible (${fmt$(num(cust.credit_limit) - num(cust.balance))}).`, `Order exceeds the available credit line (${fmt$(num(cust.credit_limit) - num(cust.balance))}).`));
    if (cust.status === 'bloqueado') alerts.push(B('Cliente bloqueado por crédito.', 'Customer on credit hold.'));
  }
  return { lines: out, subtotal: r2(subtotal), freight, total: r2(subtotal + freight), kg: r2(kg), approval_level: level, earliest_date: earliest, alerts: alerts.join('\n') || null };
}

async function creditBlock(order, ctx) {
  const cust = await ctx.get('customers', order.customer_id);
  if (!cust) return null;
  if (cust.status === 'bloqueado') return B('Cliente bloqueado', 'Customer on hold');
  const open = await ctx.one(`SELECT coalesce(sum(total),0)::float t FROM orders WHERE customer_id=$1 AND status IN ('confirmado','en_produccion','listo','programado','en_ruta','entregado') AND id<>$2`, [cust.id, order.id]);
  if (num(cust.credit_limit) > 0 && num(cust.balance) + open.t + num(order.total) > num(cust.credit_limit)) return B('Excede línea de crédito', 'Exceeds credit line');
  const od = await ctx.one(`SELECT count(*)::int n FROM invoices WHERE customer_id=$1 AND status='abierta' AND balance > 1 AND due < $2`, [cust.id, addDays(today(), -15)]);
  if (od.n > 0) return B(`${od.n} factura(s) vencidas más de 15 días`, `${od.n} invoice(s) over 15 days past due`);
  return null;
}

async function confirmOrder(order, ctx) {
  let created = 0;
  for (const l of (order.lines || [])) {
    const p = await ctx.get('products', l.product_id);
    if (!p) continue;
    const av = await availability(ctx, p.id, order.warehouse_id, order.id);
    const short = p.mode === 'mto' ? num(l.qty) : num(l.qty) - Math.max(0, av.available);
    if (short > 0) {
      await ctx.insert('production_orders', { product_id: p.id, order_id: order.id, qty: Math.ceil(short), kg: r2(Math.ceil(short) * num(p.kg_unit)), need_by: addBiz(order.promised_date || today(), -1), warehouse_id: order.warehouse_id, std_total: r2(Math.ceil(short) * num(p.std_cost)) });
      created++;
    }
    if (l.promo_id && num(l.price) === 0) await ctx.q('UPDATE promotions SET cost = coalesce(cost,0) + $1 WHERE id=$2', [num(l.promo_value), l.promo_id]);
  }
  if (order.contract_id) await refreshContract(order.contract_id, ctx);
  if (created) await ctx.notify('PROD', B(`${created} orden(es) de fabricación nuevas`, `${created} new production order(s)`), B(`Pedido ${order.folio} requiere producción`, `Order ${order.folio} needs production`), `#/e/production_orders`);
  return created ? 'en_produccion' : 'confirmado';
}
async function refreshContract(id, ctx) {
  const c = await ctx.get('contracts', id); if (!c) return;
  const rel = await ctx.all(`SELECT (l->>'product_id')::int p, sum((l->>'qty')::numeric)::float q FROM orders o, jsonb_array_elements(o.lines) l WHERE o.contract_id=$1 AND o.status NOT IN ('cancelado','borrador','cotizacion') AND coalesce(l->>'price','1')::numeric > 0 GROUP BY 1`, [id]);
  let tq = 0, tr = 0;
  const lines = (c.lines || []).map(l => { const x = rel.find(r => r.p === l.product_id); l.released = x ? x.q : 0; tq += num(l.qty); tr += l.released; return l; });
  await ctx.update('contracts', id, { lines, pct_used: tq ? r2(tr / tq * 100) : 0, status: tq && tr >= tq ? 'agotado' : c.status });
}

async function customerBalance(id, ctx) {
  const b = await ctx.one(`SELECT coalesce(sum(balance),0)::float b FROM invoices WHERE customer_id=$1 AND status='abierta'`, [id]);
  await ctx.q('UPDATE customers SET balance=$1 WHERE id=$2', [r2(b.b), id]);
}

async function computeSegment(cust, ctx) {
  const rules = await ctx.all('SELECT * FROM segment_rules ORDER BY min_volume DESC NULLS LAST');
  if (!rules.length || !cust.id) return cust.segment || null;
  const v = await ctx.one(`SELECT coalesce(sum(total),0)::float v FROM invoices WHERE customer_id=$1 AND date >= $2 AND status<>'cancelada'`, [cust.id, addDays(today(), -365)]);
  const od = await ctx.one(`SELECT coalesce(max($2::date - due),0)::int d FROM invoices WHERE customer_id=$1 AND status='abierta' AND balance>1`, [cust.id, today()]);
  for (const r of rules) if (v.v >= num(r.min_volume) && num(cust.months_active) >= num(r.min_months) && od.d <= (r.max_dpd == null ? 9999 : num(r.max_dpd))) return r.segment;
  return rules[rules.length - 1].segment;
}

// ── beforeSave hooks: computed fields ──
async function beforeSave(ent, row, old, ctx) {
  switch (ent) {
    case 'customers': { if (row.id) return { segment: await computeSegment(row, ctx) }; return row; }
    case 'orders': {
      if (old && !['cotizacion', 'borrador', 'por_aprobar', 'retenido'].includes(old.status)) return {};
      if (!row.warehouse_id && row.customer_id) { const c = await ctx.get('customers', row.customer_id); if (c) row.warehouse_id = c.warehouse_id; }
      if (!old && row.doc_type === 'cotizacion') row.status = 'cotizacion';
      const p = await priceOrder(row, ctx);
      return old ? Object.assign(p, { warehouse_id: row.warehouse_id }) : Object.assign(row, p);
    }
    case 'credit_notes': { const lvl = num(row.amount) > num(await setting('cn_gv_limit', 20000)) || row.reason === 'precio' ? 'DIR' : 'GV'; return Object.assign(old ? {} : row, { approver_level: lvl }); }
    case 'forecasts': {
      if (!row.period || !row.product_id) return old ? {} : row;
      const a = await ctx.one(`SELECT coalesce(sum((l->>'qty')::numeric),0)::float q FROM orders o JOIN customers c ON c.id=o.customer_id, jsonb_array_elements(o.lines) l WHERE to_char(o.promised_date,'YYYY-MM')=$1 AND (l->>'product_id')::int=$2 AND ($3::int IS NULL OR c.advisor_id=$3) AND o.status NOT IN ('cancelado','cotizacion','borrador')`, [row.period, row.product_id, row.advisor_id || null]);
      const acc = num(row.qty) > 0 ? Math.max(0, (1 - Math.abs(num(row.qty) - a.q) / num(row.qty)) * 100) : null;
      return Object.assign(old ? {} : row, { actual: a.q, accuracy: acc == null ? null : r2(acc) });
    }
    case 'wh_movements': { const lag = row.captured_at && row.physical_at ? r2((new Date(row.captured_at) - new Date(row.physical_at)) / 36e5) : null; return Object.assign(old ? {} : row, { lag_hours: lag }); }
    case 'production_orders': { const p = row.product_id ? await ctx.get('products', row.product_id) : null; return Object.assign(old ? {} : row, p ? { kg: r2(num(row.qty) * num(p.kg_unit)), std_total: r2(num(row.qty) * num(p.std_cost)) } : {}); }
    case 'loads': {
      let kg = 0; const lines = [];
      for (const l of (row.lines || [])) {
        const o = l.order_id ? await ctx.get('orders', l.order_id) : null; if (!o) continue;
        const c = await ctx.get('customers', o.customer_id);
        lines.push({ order_id: o.id, kg: num(o.kg), customer: c ? c.name : '' }); kg += num(o.kg);
      }
      const t = row.truck_id ? await ctx.get('trucks', row.truck_id) : null;
      const fill = t && num(t.cap_kg) ? r2(kg / num(t.cap_kg) * 100) : null;
      if (fill > 100) throw new AppErr([`La carga (${r2(kg)} kg) excede la capacidad de la unidad (${t.cap_kg} kg).`, `Load (${r2(kg)} kg) exceeds truck capacity (${t.cap_kg} kg).`]);
      return Object.assign(old ? {} : row, { lines, kg: r2(kg), fill });
    }
    case 'invoices': {
      const lines = (row.lines || []).map(l => Object.assign(l, { total: r2(num(l.qty) * num(l.price) * (1 - num(l.disc) / 100)) }));
      const sub = r2(lines.reduce((s, l) => s + l.total, 0));
      const total = r2(sub + num(row.freight));
      const patch = { lines, subtotal: sub, total };
      if (!old) { patch.balance = total; patch.uuid = row.uuid || uuid(); if (!row.due && row.customer_id) { const c = await ctx.get('customers', row.customer_id); patch.due = addDays(row.date || today(), num(c && c.credit_days) || 30); } }
      return Object.assign(old ? {} : row, patch);
    }
    case 'requisitions': {
      const lines = (row.lines || []).map(l => Object.assign(l, { total: r2(num(l.qty) * num(l.price)) }));
      const total = r2(lines.reduce((s, l) => s + l.total, 0));
      return Object.assign(old ? {} : row, { lines, total, approver_level: total > num(await setting('req_dir_limit', 50000)) ? 'DIR' : 'COMP' });
    }
    case 'purchase_orders': {
      const lines = (row.lines || []).map(l => Object.assign(l, { total: r2(num(l.qty) * num(l.price)), received: num(l.received) }));
      const sub = r2(lines.reduce((s, l) => s + l.total, 0));
      return Object.assign(old ? {} : row, { lines, subtotal: sub, tax: r2(sub * 0.16), total: r2(sub * 1.16) });
    }
    case 'goods_receipts': {
      if (old) return {};
      const po = row.po_id ? await ctx.get('purchase_orders', row.po_id) : null;
      if (!po) return row;
      if (['recibida', 'cancelada'].includes(po.status)) throw new AppErr(['Esta orden de compra ya está recibida o cancelada.', 'This PO is already received or cancelled.']);
      let lines = row.lines && row.lines.length ? row.lines : (po.lines || []).map((l, i) => ({ line: i + 1, qty: r2(num(l.qty) - num(l.received)) }));
      lines = lines.map((l, i) => { const pl = (po.lines || [])[(l.line || i + 1) - 1] || {}; const rem = num(pl.qty) - num(pl.received); if (num(l.qty) > rem + 0.0001) throw new AppErr([`Partida ${i + 1}: recibe ${l.qty} pero solo quedan ${rem} pendientes en la OC.`, `Line ${i + 1}: receiving ${l.qty} but only ${rem} remain on the PO.`]); return { line: l.line || i + 1, description: pl.description, qty: num(l.qty), price: num(pl.price) }; }).filter(l => l.qty > 0);
      return Object.assign(row, { lines, supplier_id: po.supplier_id, amount: r2(lines.reduce((s, l) => s + l.qty * l.price, 0)) });
    }
    case 'supplier_invoices': {
      const patch = {};
      if (row.xml && (!old || old.xml !== row.xml)) {
        const f = await ctx.one('SELECT data FROM files WHERE id=$1', [row.xml]);
        if (f) {
          const x = parseCFDI(f.data.toString('utf8'));
          if (!x.uuid) throw new AppErr(['El XML no es un CFDI timbrado válido (no se encontró UUID).', 'The XML is not a valid stamped CFDI (no UUID).']);
          Object.assign(patch, { uuid: x.uuid, date: x.date, subtotal: x.subtotal, tax: x.tax, retention: x.retention, total: x.total });
          const s = row.supplier_id ? await ctx.get('suppliers', row.supplier_id) : null;
          const notes = [];
          if (s && x.emisor && x.emisor.toUpperCase() !== String(s.rfc).toUpperCase()) notes.push(B(`RFC emisor ${x.emisor} no coincide con el proveedor (${s.rfc}).`, `Issuer RFC ${x.emisor} does not match the supplier (${s.rfc}).`));
          const rfcs = await setting('company_rfcs', {});
          if (x.receptor && Object.values(rfcs).length && !Object.values(rfcs).includes(x.receptor.toUpperCase())) notes.push(B(`RFC receptor ${x.receptor} no corresponde a ninguna sociedad del grupo.`, `Receiver RFC ${x.receptor} does not match any group company.`));
          if (x.version && x.version !== '4.0') notes.push(B(`Versión CFDI ${x.version} (se espera 4.0).`, `CFDI version ${x.version} (4.0 expected).`));
          patch.match_note = notes.join('\n') || null;
        }
      }
      const uid = patch.uuid || row.uuid;
      if (uid) { const d = await ctx.one('SELECT id FROM supplier_invoices WHERE upper(uuid)=upper($1) AND id<>coalesce($2,-1)', [uid, row.id || null]); if (d) throw new AppErr(['Este UUID ya fue registrado (factura duplicada).', 'This UUID was already registered (duplicate invoice).']); }
      if (row.gr_id) {
        const gr = await ctx.get('goods_receipts', row.gr_id);
        if (!gr) throw new AppErr(['La entrada de mercancía no existe.', 'Goods receipt not found.']);
        if (row.supplier_id && gr.supplier_id !== row.supplier_id) throw new AppErr(['La entrada de mercancía pertenece a otro proveedor.', 'The goods receipt belongs to another supplier.']);
        if (!old && gr.status === 'facturada') throw new AppErr(['Esa entrada ya fue facturada.', 'That receipt is already invoiced.']);
      }
      const s = row.supplier_id ? await ctx.get('suppliers', row.supplier_id) : null;
      const d = patch.date || row.date;
      if (d) patch.due = addDays(d, num(s && s.pay_days) || 30);
      return Object.assign(old ? {} : row, patch);
    }
    case 'supplier_payments': {
      let amount = 0, tax = 0, ret = 0;
      for (const l of (row.lines || [])) {
        const inv = await ctx.get('supplier_invoices', l.invoice_id); if (!inv) continue;
        const k = num(inv.total) ? num(l.amount) / num(inv.total) : 0;
        amount += num(l.amount); tax += num(inv.tax) * k; ret += num(inv.retention) * k;
      }
      return Object.assign(old ? {} : row, { amount: r2(amount), tax: r2(tax), tax_base: r2(tax / 0.16), retention: r2(ret) });
    }
    case 'gl_accounts': { const c = row.nature === 'A' ? num(row.opening) - num(row.debits) + num(row.credits) : num(row.opening) + num(row.debits) - num(row.credits); return Object.assign(old ? {} : row, { closing: r2(c) }); }
    case 'account_recons': return Object.assign(old ? {} : row, { difference: r2(num(row.gl_balance) - num(row.support_balance)) });
    case 'ic_balances': return Object.assign(old ? {} : row, { difference: r2(num(row.amount_a) - num(row.amount_b)) });
    case 'payroll': return Object.assign(old ? {} : row, { net: r2(num(row.gross) - num(row.isr) - num(row.imss)) });
    case 'assets': return Object.assign(old ? {} : row, { nbv: r2(num(row.cost) - num(row.book_accum)), book_accum: num(row.book_accum), fiscal_accum: num(row.fiscal_accum) });
    case 'asset_events': {
      const a = row.asset_id ? await ctx.get('assets', row.asset_id) : null; const patch = {};
      if (row.type === 'mejora') { const th = num(await setting('cap_threshold', 15000)); patch.policy_check = num(row.amount) >= th ? B(`Cumple política: ≥ ${fmt$(th)} se capitaliza como mejora.`, `Meets policy: ≥ ${fmt$(th)} is capitalized as an improvement.`) : B(`NO cumple: menor a ${fmt$(th)} debe registrarse como gasto de mantenimiento.`, `Does NOT meet policy: under ${fmt$(th)} must be expensed as maintenance.`); }
      if (a && (row.type === 'venta' || row.type === 'baja')) patch.gain_loss = r2(num(row.type === 'venta' ? row.amount : 0) - (num(a.cost) - num(a.book_accum)));
      return Object.assign(old ? {} : row, patch);
    }
    case 'boms': {
      const lines = (row.lines || []).map(l => Object.assign(l, { total: r2(num(l.qty_ton) * num(l.std_price)) }));
      return Object.assign(old ? {} : row, { lines, material_ton: r2(lines.reduce((s, l) => s + l.total, 0)) });
    }
    case 'cost_pools': return Object.assign(old ? {} : row, { rate: num(row.driver_qty) ? Math.round(num(row.amount) / num(row.driver_qty) * 10000) / 10000 : 0 });
    default: return old ? {} : row;
  }
}

const LOCK = { orders: s => !['cotizacion', 'borrador', 'por_aprobar', 'retenido'].includes(s), invoices: () => true, credit_notes: s => s !== 'solicitada', requisitions: s => s !== 'solicitada', purchase_orders: s => s !== 'emitida', goods_receipts: () => true, supplier_invoices: s => !['recibida', 'excepcion'].includes(s), supplier_payments: s => s === 'pagado', receipts: s => s === 'aplicado', depr_runs: s => s === 'contabilizada', close_periods: s => s === 'cerrado', account_recons: s => s === 'aprobada', policies: s => s !== 'borrador', boms: s => s !== 'borrador', deliveries: s => s !== 'pendiente', loads: s => s !== 'planeada', production_orders: s => s === 'liquidada', asset_events: s => s !== 'solicitado', payroll: s => s === 'contabilizada' };
const isLocked = (ent, row) => !!(LOCK[ent] && LOCK[ent](row.status));

// ── Workflow guards ──
const guards = {
  async orderConfirm(row, ctx) {
    if (!(row.lines || []).length) throw new AppErr(['Agregue al menos una partida al pedido.', 'Add at least one line to the order.']);
    if (!row.promised_date) throw new AppErr(['Capture la fecha compromiso de entrega.', 'Enter the promised delivery date.']);
    const fresh = await priceOrder(row, ctx);
    Object.assign(row, fresh, { doc_type: 'pedido' });
    await ctx.update('orders', row.id, Object.assign({}, fresh, { doc_type: 'pedido' }));
    const block = await creditBlock(row, ctx);
    if (block) { await ctx.notify('COB', B('Pedido retenido por crédito', 'Order on credit hold'), `${row.folio}: ${block}`, `#/e/orders/${row.id}`); return { status: 'retenido', patch: { alerts: [fresh.alerts, B('Retenido: ', 'Held: ') + block].filter(Boolean).join('\n') } }; }
    if (fresh.approval_level) { await ctx.notify(fresh.approval_level, B('Autorización de precio especial', 'Special price approval'), B(`${row.folio} requiere su autorización`, `${row.folio} needs your approval`), `#/e/orders/${row.id}`); return { status: 'por_aprobar' }; }
    return { status: await confirmOrder(row, ctx) };
  },
  async priceApprove(row, ctx) {
    if (row.approval_level === 'DIR' && !['DIR', 'ADMIN'].includes(ctx.user.role)) throw new AppErr(['Este descuento solo lo autoriza Dirección.', 'Only management can approve this discount.'], 403);
    return { status: await confirmOrder(row, ctx), patch: { approval_level: '', alerts: (row.alerts || '') + '\n' + B(`Precio autorizado por ${ctx.user.name}`, `Price approved by ${ctx.user.name}`) } };
  },
  async creditRelease(row, ctx) {
    if (row.approval_level) { await ctx.notify(row.approval_level, B('Autorización de precio especial', 'Special price approval'), B(`${row.folio} requiere su autorización`, `${row.folio} needs your approval`), `#/e/orders/${row.id}`); return { status: 'por_aprobar', patch: { alerts: (row.alerts || '') + '\n' + B(`Crédito liberado por ${ctx.user.name}`, `Credit released by ${ctx.user.name}`) } }; }
    return { status: await confirmOrder(row, ctx), patch: { alerts: (row.alerts || '') + '\n' + B(`Crédito liberado por ${ctx.user.name}`, `Credit released by ${ctx.user.name}`) } };
  },
  async invoiceOrder(row, ctx) {
    const cust = await ctx.get('customers', row.customer_id);
    const inv = await ctx.insert('invoices', { company: row.company, customer_id: row.customer_id, order_id: row.id, date: today(), due: addDays(today(), num(cust && cust.credit_days) || 30), method: 'PPD', lines: row.lines, freight: row.freight, subtotal: row.subtotal, total: row.total, balance: row.total, uuid: uuid() });
    await customerBalance(row.customer_id, ctx);
    if (cust && cust.advisor_id) await ctx.notify(cust.advisor_id, B('Pedido facturado', 'Order invoiced'), `${row.folio} → ${inv.folio}`, `#/e/invoices/${inv.id}`);
    return { patch: { sap_folio: row.sap_folio || inv.folio } };
  },
  async cnApprove(row, ctx) {
    if (row.approver_level === 'DIR' && !['DIR', 'ADMIN'].includes(ctx.user.role)) throw new AppErr(['Por monto o motivo, esta nota la autoriza Dirección.', 'Due to amount or reason, management must approve this note.'], 403);
    await ctx.notify('FACT', B('Nota de crédito aprobada', 'Credit note approved'), B(`${row.folio} lista para timbrar`, `${row.folio} ready to stamp`), `#/e/credit_notes/${row.id}`);
  },
  async cnApply(row, ctx) {
    if (row.invoice_id) {
      const inv = await ctx.get('invoices', row.invoice_id);
      if (inv) { const bal = r2(Math.max(0, num(inv.balance) - num(row.amount))); await ctx.q('UPDATE invoices SET balance=$1, status=$2 WHERE id=$3', [bal, bal <= 0.01 ? 'pagada' : inv.status, inv.id]); }
    }
    await customerBalance(row.customer_id, ctx);
    return { patch: { uuid: uuid() } };
  },
  async poSchedule(row, ctx) {
    if (!row.line_id || !row.sched_date) throw new AppErr(['Seleccione la línea y la fecha programada antes de programar.', 'Select line and scheduled date first.']);
    const ln = await ctx.get('production_lines', row.line_id);
    const used = await ctx.one(`SELECT coalesce(sum(kg),0)::float k FROM production_orders WHERE line_id=$1 AND sched_date=$2 AND status IN ('programada','en_proceso') AND id<>$3`, [row.line_id, row.sched_date, row.id]);
    if (used.k + num(row.kg) > num(ln.kg_day)) {
      const nd = await nextCapacityDate(ctx, num(row.kg), addDays(row.sched_date, -1));
      throw new AppErr([`Capacidad insuficiente en ${ln.name} el ${row.sched_date}: ocupado ${r2(used.k)} de ${ln.kg_day} kg. Próxima fecha con capacidad: ${addBiz(nd, -(num(ln.lead_days) || 4))}.`, `Not enough capacity on ${ln.name} on ${row.sched_date}: ${r2(used.k)} of ${ln.kg_day} kg used.`]);
    }
  },
  async poFinish(row, ctx) {
    const qty = num(row.qty_done) || num(row.qty);
    const lot = 'L' + today().replace(/-/g, '').slice(2) + '-' + row.id;
    let wh = row.warehouse_id; if (!wh) { const w = await ctx.one('SELECT id FROM warehouses ORDER BY id LIMIT 1'); wh = w && w.id; }
    await ctx.insert('stock', { warehouse_id: wh, product_id: row.product_id, qty, lot, expires: addDays(today(), 180) });
    await ctx.insert('wh_movements', { warehouse_id: wh, type: 'entrada', reference: row.folio, product_id: row.product_id, qty, lot, physical_at: new Date().toISOString(), captured_at: new Date().toISOString(), lag_hours: 0 });
    if (row.order_id) {
      const pend = await ctx.one(`SELECT count(*)::int n FROM production_orders WHERE order_id=$1 AND status IN ('solicitada','programada','en_proceso') AND id<>$2`, [row.order_id, row.id]);
      const o = await ctx.get('orders', row.order_id);
      if (o && !pend.n && ['en_produccion', 'confirmado'].includes(o.status)) { await ctx.q("UPDATE orders SET status='listo' WHERE id=$1", [o.id]); await ctx.audit('orders', o.id, 'status', { from: o.status, to: 'listo', action: ['Producción terminada', 'Production finished'] }); await ctx.notify('LOG', B('Pedido listo para embarque', 'Order ready to ship'), o.folio, `#/e/orders/${o.id}`); }
    }
    return { patch: { qty_done: qty, lot, warehouse_id: wh } };
  },
  async poSettle(row, ctx) {
    const p = await ctx.get('products', row.product_id);
    const per = period(row.sched_date || today());
    const pools = await ctx.all(`SELECT driver, sum(rate)::float r FROM cost_pools WHERE period=(SELECT max(period) FROM cost_pools WHERE period<=$1) GROUP BY driver`, [per]);
    const kgRate = (pools.find(x => x.driver === 'kg') || {}).r || 0, hRate = (pools.find(x => x.driver === 'horas') || {}).r || 0;
    const laborRate = num(await setting('labor_rate_hour', 180));
    const qty = num(row.qty_done) || num(row.qty);
    const kg = qty * num(p.kg_unit);
    const actual = r2(num(row.material_actual) + num(row.labor_hours) * laborRate + kg * kgRate + num(row.labor_hours) * hRate);
    const std = r2(qty * num(p.std_cost));
    return { patch: { actual_total: actual, std_total: std, variance: r2(actual - std) } };
  },
  async loadDispatch(row, ctx) {
    if (!(row.lines || []).length) throw new AppErr(['Agregue pedidos a la carga.', 'Add orders to the load.']);
    const truck = await ctx.get('trucks', row.truck_id);
    for (const l of row.lines) {
      const o = await ctx.get('orders', l.order_id);
      if (!o || !['listo', 'programado', 'confirmado'].includes(o.status)) throw new AppErr([`El pedido ${o ? o.folio : l.order_id} no está listo para embarque.`, `Order ${o ? o.folio : l.order_id} is not ready to ship.`]);
      await ctx.q("UPDATE orders SET status='en_ruta' WHERE id=$1", [o.id]);
      await ctx.audit('orders', o.id, 'status', { from: o.status, to: 'en_ruta', action: ['Despachado en carga ' + row.folio, 'Dispatched'] });
      await ctx.insert('deliveries', { load_id: row.id, order_id: o.id, customer_id: o.customer_id, driver_id: truck && truck.driver_id });
      const c = await ctx.get('customers', o.customer_id);
      if (c && c.advisor_id) await ctx.notify(c.advisor_id, B('Pedido en ruta', 'Order in transit'), B(`${o.folio} salió en ${row.folio}`, `${o.folio} left on ${row.folio}`), `#/e/orders/${o.id}`);
    }
    if (truck && truck.driver_id) await ctx.notify(truck.driver_id, B('Nueva ruta asignada', 'New route assigned'), B(`${row.folio}: ${row.lines.length} entrega(s)`, `${row.folio}: ${row.lines.length} delivery(ies)`), '#/e/deliveries');
  },
  async loadClose(row, ctx) {
    const pend = await ctx.one(`SELECT count(*)::int n FROM deliveries WHERE load_id=$1 AND status='pendiente'`, [row.id]);
    if (pend.n) throw new AppErr([`Faltan ${pend.n} entrega(s) por confirmar.`, `${pend.n} delivery(ies) still pending.`]);
    const t = await ctx.get('trucks', row.truck_id); const rt = await ctx.get('routes', row.route_id);
    const cost = t && t.type === 'externa' ? num(row.carrier_cost) + num(row.tolls) : num(rt && rt.km) * num(t && t.cost_km) + num(row.tolls);
    for (const l of row.lines || []) {
      const share = num(row.kg) ? num(l.kg) / num(row.kg) : 0;
      await ctx.q('UPDATE orders SET freight_actual = coalesce(freight_actual,0) + $1 WHERE id=$2', [r2(cost * share), l.order_id]);
    }
    const bad = await ctx.all(`SELECT d.order_id FROM deliveries d WHERE load_id=$1 AND status IN ('parcial','rechazado')`, [row.id]);
    if (bad.length) await ctx.notify('LOG', B('Registrar doble flete', 'Log double freight'), B(`${row.folio}: ${bad.length} entrega(s) parcial/rechazada requieren segundo viaje`, `${row.folio}: ${bad.length} partial/rejected delivery(ies) need a second trip`), '#/e/double_freight');
    return { patch: { actual_cost: r2(cost) } };
  },
  async deliver(row, ctx, opt) {
    const body = opt.body || {};
    const photo = body.photo || row.photo;
    if (opt.to !== 'rechazado' && !photo) throw new AppErr(['Adjunte la foto de la remisión firmada para confirmar.', 'Attach the signed delivery note photo to confirm.']);
    const o = await ctx.get('orders', row.order_id);
    const next = opt.to === 'rechazado' ? 'listo' : 'entregado';
    await ctx.q('UPDATE orders SET status=$1 WHERE id=$2', [next, o.id]);
    await ctx.audit('orders', o.id, 'status', { from: o.status, to: next, action: ['Confirmación de entrega: ' + opt.to, 'Delivery confirmation: ' + opt.to], comment: opt.comment });
    const c = await ctx.get('customers', o.customer_id);
    if (c && c.advisor_id) await ctx.notify(c.advisor_id, opt.to === 'rechazado' ? B('Entrega rechazada', 'Delivery rejected') : B('Entrega confirmada', 'Delivery confirmed'), `${o.folio} — ${c.name}`, `#/e/orders/${o.id}`);
    if (next === 'entregado') await ctx.notify('FACT', B('Pedido entregado — por facturar', 'Order delivered — to invoice'), `${o.folio} — ${c ? c.name : ''}`, `#/e/orders/${o.id}`);
    return { patch: { photo: photo || null, received_by: body.received_by || row.received_by, gps: body.gps || null, delivered_at: new Date().toISOString() } };
  },
  async applyReceipt(row, ctx) {
    const lines = row.lines || [];
    if (!lines.length) throw new AppErr(['Indique a qué facturas se aplica el pago (use "Sugerir aplicación").', 'Indicate which invoices the payment applies to.']);
    const sum = lines.reduce((s, l) => s + num(l.amount), 0);
    if (sum > num(row.amount) + 0.01) throw new AppErr([`Lo aplicado (${fmt$(sum)}) excede el importe del cobro (${fmt$(row.amount)}).`, 'Applied amount exceeds the receipt.']);
    let ppd = false;
    for (const l of lines) {
      const inv = await ctx.get('invoices', l.invoice_id);
      if (!inv || inv.customer_id !== row.customer_id) throw new AppErr(['Una factura no pertenece a este cliente.', 'An invoice does not belong to this customer.']);
      if (num(l.amount) > num(inv.balance) + 0.01) throw new AppErr([`El importe aplicado a ${inv.folio} excede su saldo (${fmt$(inv.balance)}).`, `Amount applied to ${inv.folio} exceeds its balance.`]);
      const bal = r2(num(inv.balance) - num(l.amount));
      await ctx.q('UPDATE invoices SET balance=$1, status=$2 WHERE id=$3', [bal, bal <= 0.01 ? 'pagada' : 'abierta', inv.id]);
      if (inv.method === 'PPD') ppd = true;
    }
    await customerBalance(row.customer_id, ctx);
    return { patch: { rep_uuid: ppd ? uuid() : null } };
  },
  async creditEvaluate(row, ctx) {
    const miss = [['doc_rfc', 'RFC'], ['doc_csf', 'Constancia de situación fiscal'], ['doc_pagare', 'Pagaré']].filter(([k]) => !row[k]);
    if (miss.length) throw new AppErr(['Faltan documentos obligatorios: ' + miss.map(m => m[1]).join(', '), 'Missing required documents: ' + miss.map(m => m[1]).join(', ')]);
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(String(row.rfc || '').trim())) throw new AppErr(['El RFC no tiene un formato válido.', 'Invalid RFC format.']);
    const pol = await ctx.all('SELECT factor, weight FROM credit_policies');
    const W = Object.fromEntries(pol.map(p => [p.factor, num(p.weight)]));
    let hist = 0.5;
    if (row.customer_id) { const od = await ctx.one(`SELECT coalesce(avg(greatest(0, $2::date - due)),0)::float d FROM invoices WHERE customer_id=$1 AND status='abierta'`, [row.customer_id, today()]); hist = od.d <= 0 ? 1 : od.d < 15 ? 0.7 : od.d < 45 ? 0.4 : 0.1; }
    const F = { years: Math.min(1, num(row.years) / 5), history: hist, volume: Math.min(1, num(row.monthly_volume) * 2 / Math.max(1, num(row.line_req))), guarantee: Math.min(1, num(row.guarantee) / Math.max(1, num(row.line_req))), references: Math.min(1, num(row.references_ok) / 3), bureau: { bueno: 1, regular: 0.6, malo: 0, sin: 0.4 }[row.bureau || 'sin'] };
    const tw = Object.values(W).reduce((a, b) => a + b, 0) || 1;
    const score = r2(Object.entries(F).reduce((s, [k, v]) => s + v * (W[k] || 0), 0) / tw * 100);
    const lo = num(await setting('credit_band_low', 40)), hi = num(await setting('credit_band_high', 60));
    const maxAuto = num(await setting('credit_auto_max', 300000));
    let status = 'revision_direccion', decision;
    if (score < lo) { status = 'rechazada'; decision = B(`Score ${score}% < ${lo}%: rechazo automático por política.`, `Score ${score}% < ${lo}%: automatic rejection by policy.`); }
    else if (score > hi && num(row.line_req) <= maxAuto) { status = 'aprobada'; decision = B(`Score ${score}% > ${hi}%: aprobación automática por política.`, `Score ${score}% > ${hi}%: automatic approval by policy.`); }
    else decision = score > hi ? B(`Score ${score}% aprobatorio, pero la línea solicitada excede ${fmt$(maxAuto)} → Dirección.`, `Score ${score}% passes, but the requested line exceeds ${fmt$(maxAuto)} → management.`) : B(`Score ${score}% entre ${lo}% y ${hi}% → revisión de Dirección.`, `Score ${score}% between ${lo}% and ${hi}% → management review.`);
    if (status === 'aprobada') await grantCredit(row, ctx);
    if (status === 'revision_direccion') await ctx.notify('DIR', B('Solicitud de crédito por revisar', 'Credit application to review'), `${row.applicant}: ${fmt$(row.line_req)} (score ${score}%)`, `#/e/credit_requests/${row.id}`);
    return { status, patch: { score, decision } };
  },
  async creditGrant(row, ctx) { await grantCredit(row, ctx); },
  async reqApprove(row, ctx) { if (row.approver_level === 'DIR' && !['DIR', 'ADMIN'].includes(ctx.user.role)) throw new AppErr(['Por su monto, esta solicitud la autoriza Dirección.', 'Due to the amount, management must approve.'], 403); },
  async match3(row, ctx) {
    if (!row.uuid || !row.total) throw new AppErr(['Cargue el XML del CFDI o capture UUID y total.', 'Upload the CFDI XML or enter UUID and total.']);
    const gr = await ctx.get('goods_receipts', row.gr_id);
    const po = gr && await ctx.get('purchase_orders', gr.po_id);
    const notes = []; let ok = true;
    if (!gr || !po) { ok = false; notes.push(B('No hay entrada de mercancía / OC vinculada.', 'No linked goods receipt / PO.')); }
    else {
      const expected = r2(num(gr.amount));
      const sub = num(row.subtotal) || r2(num(row.total) / 1.16);
      const diff = r2(sub - expected);
      const tol = Math.max(100, expected * 0.01);
      notes.push(B(`OC ${po.folio} · Entrada ${gr.folio} · Esperado ${fmt$(expected)} · Facturado ${fmt$(sub)} · Diferencia ${fmt$(diff)} (tolerancia ${fmt$(tol)})`, `PO ${po.folio} · Receipt ${gr.folio} · Expected ${fmt$(expected)} · Invoiced ${fmt$(sub)} · Difference ${fmt$(diff)} (tolerance ${fmt$(tol)})`));
      if (Math.abs(diff) > tol) { ok = false; notes.push(B('Diferencia fuera de tolerancia.', 'Difference outside tolerance.')); }
    }
    if (row.match_note && /no coincide|no corresponde/.test(row.match_note)) { ok = false; notes.push(row.match_note); }
    if (ok && gr) await ctx.q("UPDATE goods_receipts SET status='facturada' WHERE id=$1", [gr.id]);
    if (!ok) await ctx.notify('COMP', B('Factura de proveedor con excepción', 'Supplier invoice exception'), notes.join(' '), `#/e/supplier_invoices/${row.id}`);
    return { status: ok ? 'validada' : 'excepcion', patch: { match_note: notes.join('\n') } };
  },
  async payConfirm(row, ctx) {
    for (const l of row.lines || []) {
      const paid = await ctx.one(`SELECT coalesce(sum((l->>'amount')::numeric),0)::float p FROM supplier_payments sp, jsonb_array_elements(sp.lines) l WHERE (l->>'invoice_id')::int=$1 AND (sp.status='pagado' OR sp.id=$2)`, [l.invoice_id, row.id]);
      const inv = await ctx.get('supplier_invoices', l.invoice_id);
      if (inv && paid.p >= num(inv.total) - 0.01) await ctx.q("UPDATE supplier_invoices SET status='pagada' WHERE id=$1", [inv.id]);
    }
  },
  async closePeriod(row, ctx) {
    const pend = await ctx.all(`SELECT task, area FROM close_tasks WHERE period_id=$1 AND required AND status<>'validada'`, [row.id]);
    if (pend.length) throw new AppErr([`No se puede cerrar: ${pend.length} tarea(s) obligatoria(s) sin validar (${pend.slice(0, 4).map(p => p.area).join(', ')}…).`, `Cannot close: ${pend.length} required task(s) not validated.`]);
    return { patch: { closed_day: bizBetween(monthEnd(row.period), today()), progress: 100, late: 0 } };
  },
  async reconPrepare(row, ctx) {
    const th = num(await setting('recon_threshold', 5000));
    if (Math.abs(num(row.difference)) > th && !String(row.explanation || '').trim()) throw new AppErr([`La diferencia excede ${fmt$(th)}: escriba la explicación.`, `Difference exceeds ${fmt$(th)}: enter an explanation.`]);
    if (!row.evidence) throw new AppErr(['Adjunte la evidencia de la conciliación.', 'Attach reconciliation evidence.']);
    return { patch: { preparer: `${ctx.user.name} · ${new Date().toLocaleString('es-GT', { timeZone: TZ })}#${ctx.user.id}` } };
  },
  async reconReview(row, ctx) {
    const pid = parseInt(String(row.preparer || '').split('#')[1], 10);
    if (pid === ctx.user.id) throw new AppErr(['Segregación de funciones: el revisor debe ser distinto del preparador.', 'Segregation of duties: reviewer must differ from preparer.'], 403);
    return { patch: { reviewer: `${ctx.user.name} · ${new Date().toLocaleString('es-GT', { timeZone: TZ })}` } };
  },
  async assetEvent(row, ctx) {
    const a = await ctx.get('assets', row.asset_id);
    if (row.type === 'mejora') {
      if (/NO cumple/.test(row.policy_check || '')) throw new AppErr(['El importe no cumple la política de capitalización; regístrelo como gasto.', 'Amount does not meet capitalization policy.']);
      await ctx.q('UPDATE assets SET cost = cost + $1, nbv = cost + $1 - coalesce(book_accum,0) WHERE id=$2', [num(row.amount), a.id]);
    } else if (row.type === 'traspaso') await ctx.q('UPDATE assets SET location=$1 WHERE id=$2', [row.new_location, a.id]);
    else await ctx.q("UPDATE assets SET status='baja' WHERE id=$1", [a.id]);
  },
  async deprPost(row, ctx) {
    if (!(row.lines || []).length) throw new AppErr(['Primero calcule la depreciación.', 'Calculate depreciation first.']);
    for (const l of row.lines) await ctx.q('UPDATE assets SET book_accum = coalesce(book_accum,0) + $1, fiscal_accum = coalesce(fiscal_accum,0) + $2, nbv = cost - coalesce(book_accum,0) - $1 WHERE id=$3', [l.book, l.fiscal, l.asset_id]);
  },
  async bomActivate(row, ctx) {
    await ctx.q("UPDATE boms SET status='obsoleta' WHERE product_id=$1 AND status='vigente' AND id<>$2", [row.product_id, row.id]);
    const p = await ctx.get('products', row.product_id);
    const pools = await ctx.one(`SELECT coalesce(sum(rate),0)::float r FROM cost_pools WHERE driver='kg' AND period=(SELECT max(period) FROM cost_pools)`);
    const perKg = (num(row.material_ton) + num(row.labor_ton)) / 1000 + pools.r;
    const std = r2(perKg * num(p.kg_unit) + num(row.packaging_unit));
    await ctx.q('UPDATE products SET std_cost=$1 WHERE id=$2', [std, p.id]);
    await ctx.audit('products', p.id, 'update', { std_cost: [p.std_cost, std], source: 'Fórmula ' + row.version });
  },
  async policyPublish(row, ctx) {
    for (const r of String(row.audience || '').split(',').map(s => s.trim()).filter(Boolean)) await ctx.notify(r, B('Nueva política vigente', 'New policy in force'), B(`${row.name} v${row.version}: lea y acuse de recibido`, `${row.name} v${row.version}: please read and acknowledge`), `#/e/policies/${row.id}`);
    return { patch: { effective: row.effective || today(), acks: 0 } };
  },
  async policyNewVersion(row) { return { patch: { version: num(row.version) + 1, acks: 0 } }; },
};

async function grantCredit(row, ctx) {
  let cid = row.customer_id;
  if (!cid) {
    const ex = await ctx.one('SELECT id FROM customers WHERE upper(rfc)=upper($1)', [row.rfc]);
    if (ex) cid = ex.id;
    else { const c = await ctx.insert('customers', { code: 'C' + Date.now().toString().slice(-6), name: row.applicant, rfc: row.rfc, segment: row.segment, channel: 'pecuario', months_active: 0 }); cid = c.id; await ctx.q('UPDATE credit_requests SET customer_id=$1 WHERE id=$2', [cid, row.id]); }
  }
  await ctx.q('UPDATE customers SET credit_limit=$1, credit_days=$2 WHERE id=$3', [num(row.line_req), num(row.days_req), cid]);
  await ctx.audit('customers', cid, 'update', { credit_limit: [null, row.line_req], credit_days: [null, row.days_req], source: 'Solicitud de crédito #' + row.id });
}

// ── Custom actions ──
const actions = {
  orders: {
    async toOrder(row, ctx) { await ctx.update('orders', row.id, { doc_type: 'pedido', status: 'borrador' }); return { msg: ['Cotización convertida en pedido (borrador). Revise y confirme.', 'Quote converted to draft order.'] }; },
  },
  loads: {
    async suggest(row, ctx) {
      const t = await ctx.get('trucks', row.truck_id);
      const inLoads = (await ctx.all(`SELECT (l->>'order_id')::int id FROM loads, jsonb_array_elements(lines) l WHERE status IN ('planeada','en_ruta')`)).map(x => x.id);
      const cands = await ctx.all(`SELECT o.id, o.kg, o.folio, c.name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status IN ('listo','confirmado') AND c.route_id=$1 ORDER BY o.promised_date`, [row.route_id]);
      let kg = num(row.kg); const lines = (row.lines || []).slice(); let added = 0;
      for (const c of cands) {
        if (inLoads.includes(c.id) || lines.some(l => l.order_id === c.id)) continue;
        if (t && kg + num(c.kg) > num(t.cap_kg)) continue;
        lines.push({ order_id: c.id, kg: num(c.kg), customer: c.name }); kg += num(c.kg); added++;
      }
      await ctx.update('loads', row.id, { lines, kg: r2(kg), fill: t && num(t.cap_kg) ? r2(kg / num(t.cap_kg) * 100) : null });
      for (const l of lines) await ctx.q("UPDATE orders SET status='programado' WHERE id=$1 AND status='listo'", [l.order_id]);
      return { msg: [`Se agregaron ${added} pedido(s) de la ruta. Ocupación ${t ? r2(kg / num(t.cap_kg) * 100) : '—'}%.`, `${added} order(s) added from the route.`] };
    },
  },
  receipts: {
    async suggestApply(row, ctx) {
      const inv = await ctx.all(`SELECT id, folio, balance::float b FROM invoices WHERE customer_id=$1 AND status='abierta' AND balance>0.01 ORDER BY due, id`, [row.customer_id]);
      let rest = num(row.amount); const lines = [];
      const exact = inv.find(i => Math.abs(i.b - rest) < 0.01) || (row.reference && inv.find(i => String(row.reference).includes(i.folio)));
      if (exact) { lines.push({ invoice_id: exact.id, amount: r2(Math.min(rest, exact.b)) }); }
      else for (const i of inv) { if (rest <= 0.009) break; const a = r2(Math.min(rest, i.b)); lines.push({ invoice_id: i.id, amount: a }); rest = r2(rest - a); }
      await ctx.update('receipts', row.id, { lines });
      return { msg: [exact ? 'Coincidencia exacta encontrada por importe/referencia.' : `Aplicación sugerida a ${lines.length} factura(s) por antigüedad (PEPS).`, exact ? 'Exact match found.' : `Suggested FIFO application to ${lines.length} invoice(s).`] };
    },
  },
  requisitions: {
    async toPO(row, ctx) {
      if (!row.supplier_id) throw new AppErr(['Asigne un proveedor a la solicitud.', 'Assign a supplier first.']);
      const lines = (row.lines || []).map(l => ({ description: l.description, qty: num(l.qty), price: num(l.price), total: r2(num(l.qty) * num(l.price)), received: 0 }));
      const sub = r2(lines.reduce((s, l) => s + l.total, 0));
      const po = await ctx.insert('purchase_orders', { company: row.company, supplier_id: row.supplier_id, requisition_id: row.id, date: today(), lines, subtotal: sub, tax: r2(sub * 0.16), total: r2(sub * 1.16) });
      await ctx.update('requisitions', row.id, { status: 'en_oc' });
      return { msg: [`Orden de compra ${po.folio} generada.`, `PO ${po.folio} created.`], go: `#/e/purchase_orders/${po.id}` };
    },
  },
  close_periods: {
    async genTasks(row, ctx) {
      const ex = await ctx.one('SELECT count(*)::int n FROM close_tasks WHERE period_id=$1', [row.id]);
      if (ex.n) throw new AppErr(['Las tareas de este cierre ya fueron generadas.', 'Tasks already generated.']);
      const tpl = await ctx.all('SELECT * FROM close_templates ORDER BY day_offset, id');
      const me = monthEnd(row.period);
      for (const t of tpl) await ctx.insert('close_tasks', { period_id: row.id, task: t.task, area: t.area, owner_id: t.owner_id, due: addBiz(me, num(t.day_offset)), required: t.required !== false });
      for (const t of tpl) if (t.owner_id) await ctx.notify(t.owner_id, B('Tarea de cierre asignada', 'Close task assigned'), `${row.period}: ${t.task} (D+${t.day_offset})`, '#/e/close_tasks');
      return { msg: [`${tpl.length} tareas generadas con sus fechas límite.`, `${tpl.length} tasks generated.`] };
    },
  },
  depr_runs: {
    async calc(row, ctx) {
      const start = row.period + '-01';
      const list = await ctx.all(`SELECT a.*, c.book_months, c.fiscal_rate, c.gl_dep, c.gl_exp, c.name cname FROM assets a JOIN asset_classes c ON c.id=a.class_id WHERE a.status='activo' AND a.in_service < $1::date`, [start]);
      const lines = []; let bt = 0, ft = 0;
      for (const a of list) {
        const base = num(a.cost) - num(a.salvage);
        const book = Math.max(0, Math.min(base / Math.max(1, num(a.book_months)), base - num(a.book_accum)));
        const fiscal = Math.max(0, Math.min(num(a.cost) * num(a.fiscal_rate) / 100 / 12, num(a.cost) - num(a.fiscal_accum)));
        if (book <= 0 && fiscal <= 0) continue;
        lines.push({ asset_id: a.id, tag: a.tag, cls: a.cname, book: r2(book), fiscal: r2(fiscal), gl_dep: a.gl_dep, gl_exp: a.gl_exp });
        bt += book; ft += fiscal;
      }
      await ctx.update('depr_runs', row.id, { lines, assets: lines.length, book_total: r2(bt), fiscal_total: r2(ft) });
      return { msg: [`Depreciación calculada para ${lines.length} activos: contable ${fmt$(bt)}, fiscal ${fmt$(ft)}.`, `Depreciation calculated for ${lines.length} assets.`] };
    },
  },
  policies: {
    async ack(row, ctx) {
      await ctx.q('INSERT INTO policy_acks(policy_id, version, user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [row.id, row.version, ctx.user.id]);
      await refreshAcks(row, ctx);
      return { msg: ['Acuse registrado. Gracias.', 'Acknowledgment recorded. Thank you.'] };
    },
  },
};
async function refreshAcks(row, ctx) {
  const roles = String(row.audience || '').split(',').map(s => s.trim()).filter(Boolean);
  const tot = await ctx.one(`SELECT count(*)::int n FROM users WHERE active AND role <> 'PROV' AND (cardinality($1::text[])=0 OR role = ANY($1))`, [roles]);
  const ack = await ctx.one(`SELECT count(*)::int n FROM policy_acks pa JOIN users u ON u.id=pa.user_id WHERE policy_id=$1 AND version=$2 AND (cardinality($3::text[])=0 OR u.role = ANY($3))`, [row.id, row.version, roles]);
  await ctx.q('UPDATE policies SET acks=$1 WHERE id=$2', [tot.n ? r2(ack.n / tot.n * 100) : 0, row.id]);
}

async function afterSave(ent, row, old, ctx) {
  if (ent === 'credit_notes' && !old) await ctx.notify(row.approver_level || 'GV', B('Nota de crédito por autorizar', 'Credit note to approve'), `${row.folio}: ${fmt$(row.amount)} — ${row.reason}`, `#/e/credit_notes/${row.id}`);
  if (ent === 'requisitions' && !old) await ctx.notify(row.approver_level === 'DIR' ? 'DIR' : 'COMP', B('Solicitud de compra por autorizar', 'Requisition to approve'), `${row.folio}: ${fmt$(row.total)}`, `#/e/requisitions/${row.id}`);
  if (ent === 'supplier_invoices' && !old) await ctx.notify('CXP', B('Nueva factura de proveedor', 'New supplier invoice'), `UUID ${row.uuid || ''} ${fmt$(row.total)}`, `#/e/supplier_invoices/${row.id}`);
  if (ent === 'goods_receipts' && !old) {
    const po = await ctx.get('purchase_orders', row.po_id);
    const pl = (po.lines || []).map(l => Object.assign({}, l));
    for (const l of row.lines || []) { const x = pl[(l.line || 1) - 1]; if (x) x.received = r2(num(x.received) + num(l.qty)); }
    const done = pl.every(l => num(l.received) >= num(l.qty) - 0.0001);
    await ctx.update('purchase_orders', po.id, { lines: pl, status: done ? 'recibida' : 'parcial' });
  }
  if (ent === 'receipts' && !old && row.customer_id) await ctx.notify('COB', B('Cobro por aplicar', 'Receipt to apply'), `${fmt$(row.amount)} ref. ${row.reference || ''}`, `#/e/receipts/${row.id}`);
}

async function afterFlow(ent, row, from, ctx) {
  if (ent === 'close_tasks') {
    const p = row.period_id; if (!p) return;
    const s = await ctx.one(`SELECT count(*)::int t, count(*) FILTER (WHERE status='validada')::int v, count(*) FILTER (WHERE status IN ('pendiente','rechazada') AND due < $2)::int l FROM close_tasks WHERE period_id=$1`, [p, today()]);
    await ctx.q('UPDATE close_periods SET progress=$1, late=$2 WHERE id=$3', [s.t ? r2(s.v / s.t * 100) : 0, s.l, p]);
    if (row.status === 'entregada') await ctx.notify('CONT', B('Tarea de cierre entregada', 'Close task delivered'), row.task, `#/e/close_tasks/${row.id}`);
  }
  if (ent === 'policies' && row.status === 'vigente') await refreshAcks(row, ctx);
}

async function detailExtra(ent, row) {
  if (ent === 'depr_runs') return { table: { cols: [{ k: 'tag', l: ['Activo', 'Asset'] }, { k: 'cls', l: ['Clase', 'Class'] }, { k: 'book', l: ['Contable', 'Book'], t: 'money' }, { k: 'fiscal', l: ['Fiscal', 'Tax'], t: 'money' }], rows: row.lines || [] }, links: [{ l: ['Descargar póliza contable (CSV)', 'Download journal entry (CSV)'], href: `/api/report/depr_journal?format=csv&run=${row.id}` }] };
  if (ent === 'orders') {
    const prod = await db.all('SELECT id, folio, status, qty FROM production_orders WHERE order_id=$1', [row.id]);
    const dl = await db.all('SELECT id, status, photo, delivered_at FROM deliveries WHERE order_id=$1', [row.id]);
    const inv = await db.all('SELECT id, folio, total, balance, status FROM invoices WHERE order_id=$1', [row.id]);
    const links = [...prod.map(p => ({ l: [`Orden de fabricación ${p.folio} (${p.status})`, `Production order ${p.folio} (${p.status})`], href: `#/e/production_orders/${p.id}` })), ...dl.map(d => ({ l: [`Entrega #${d.id} (${d.status})`, `Delivery #${d.id} (${d.status})`], href: `#/e/deliveries/${d.id}` })), ...inv.map(i => ({ l: [`Factura ${i.folio} — saldo ${fmt$(i.balance)}`, `Invoice ${i.folio} — balance ${fmt$(i.balance)}`], href: `#/e/invoices/${i.id}` }))];
    return links.length ? { links } : null;
  }
  if (ent === 'close_periods') return { links: [{ l: ['Ver tareas de este cierre', 'View tasks for this close'], href: `#/e/close_tasks?f_period_id=${row.id}` }] };
  if (ent === 'loads') return { links: [{ l: ['Ver entregas de esta carga', 'View deliveries for this load'], href: `#/e/deliveries?f_load_id=${row.id}` }] };
  return null;
}

module.exports = Object.assign(module.exports, { B, AppErr, FOLIO, parseCSV, parseCFDI, beforeSave, afterSave, afterFlow, isLocked, guards, actions, detailExtra, availability, helpers: { r2, num, today, addDays, addBiz, bizBetween, monthEnd, period, uuid, fmt$, setting } });
Object.assign(module.exports, require('./reports'));
