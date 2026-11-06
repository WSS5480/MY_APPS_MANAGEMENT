// End-to-end workflow test across all value chains.
const BASE = process.env.BASE || 'http://localhost:3999';
const sess = {};
async function login(pin) { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) }); if (r.status !== 200) throw new Error('login ' + pin); return r.headers.get('set-cookie').split(';')[0]; }
async function as(pin, method, path, body, raw) {
  sess[pin] = sess[pin] || await login(pin);
  const h = { cookie: sess[pin] };
  if (raw) Object.assign(h, raw.headers); else if (body) h['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j.msg || j)}`); e.status = r.status; e.j = j; throw e; }
  return j;
}
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓ ' + m); };
const PIN = { admin: '5480', dir: '1001', gv: '1002', vta: '1003', atc: '1004', fact: '1005', cob: '1006', cont: '1007', cont2: '1017', cost: '1008', cxp: '1009', comp: '1010', alm: '1011', prod: '1012', log: '1014', chof: '1015', prov: '2001' };
const today = new Date().toLocaleDateString('en-CA');
(async () => {
  console.log('ORDER TO CASH');
  const cust = (await as(PIN.vta, 'GET', '/api/e/customers')).rows.find(c => c.name === 'Granjas El Porvenir');
  await as(PIN.cob, 'PUT', `/api/e/customers/${cust.id}`, { credit_limit: 50000000 });
  const prods = (await as(PIN.vta, 'GET', '/api/e/products')).rows;
  const mto = prods.find(p => p.code === 'ESP-PRE-40'), mts = prods.find(p => p.code === 'POR-ENG-40');
  let o = (await as(PIN.vta, 'POST', '/api/e/orders', { customer_id: cust.id, source: 'whatsapp', promised_date: today, lines: [{ product_id: mts.id, qty: 50 }, { product_id: mto.id, qty: 20, disc: 2 }] })).row;
  ok(o.folio && o.total > 0 && o.freight > 0, `order ${o.folio} priced: total ${o.total}, freight ${o.freight}`);
  ok(o.earliest_date && o.alerts && /factible/.test(o.alerts), 'promise-date check warns when promised date is before feasible date');
  ok(o.approval_level === '' || o.approval_level === 'GV', 'discount within advisor/manager band');
  o = (await as(PIN.vta, 'POST', `/api/e/orders/${o.id}/flow`, { to: 'confirmado' })).row;
  if (o.status === 'retenido') { ok(/vencidas|crédito/.test(o.alerts), 'held for overdue invoices → Cobranza releases'); o = (await as(PIN.cob, 'POST', `/api/e/orders/${o.id}/flow`, { to: 'confirmado' })).row; }
  ok(['en_produccion', 'por_aprobar', 'confirmado'].includes(o.status), 'confirm → ' + o.status);
  if (o.status === 'por_aprobar') o = (await as(PIN.gv, 'POST', `/api/e/orders/${o.id}/flow`, { to: 'confirmado' })).row;
  ok(o.status === 'en_produccion', 'MTO line created production order → en_produccion');
  const pos = (await as(PIN.prod, 'GET', `/api/e/production_orders?f_order_id=${o.id}`)).rows;
  ok(pos.length >= 1, `${pos.length} production order(s) auto-created`);
  const lines = (await as(PIN.prod, 'GET', '/api/e/production_lines')).rows;
  for (const po of pos) {
    await as(PIN.prod, 'PUT', `/api/e/production_orders/${po.id}`, { line_id: lines[3].id, sched_date: today });
    await as(PIN.prod, 'POST', `/api/e/production_orders/${po.id}/flow`, { to: 'programada' });
    await as(PIN.prod, 'POST', `/api/e/production_orders/${po.id}/flow`, { to: 'en_proceso' });
    await as(PIN.prod, 'PUT', `/api/e/production_orders/${po.id}`, { material_actual: 9000, labor_hours: 6 });
    const f = (await as(PIN.prod, 'POST', `/api/e/production_orders/${po.id}/flow`, { to: 'terminada' })).row;
    ok(f.lot, 'production finished with lot ' + f.lot);
    const st = (await as(PIN.cost, 'POST', `/api/e/production_orders/${po.id}/flow`, { to: 'liquidada' })).row;
    ok(st.actual_total > 0 && st.variance != null, `settled: actual ${st.actual_total} std ${st.std_total} var ${st.variance}`);
  }
  o = (await as(PIN.vta, 'GET', `/api/e/orders/${o.id}`)).row;
  ok(o.status === 'listo', 'order auto-moved to listo when production finished');
  const trucks = (await as(PIN.log, 'GET', '/api/e/trucks')).rows;
  let ld = (await as(PIN.log, 'POST', '/api/e/loads', { date: today, route_id: cust.route_id, truck_id: trucks.find(x => x.driver_id).id, lines: [{ order_id: o.id }] })).row;
  ok(ld.kg > 0 && ld.fill > 0, `load ${ld.folio} ${ld.kg} kg, fill ${ld.fill}%`);
  const sug = await as(PIN.log, 'POST', `/api/e/loads/${ld.id}/act/suggest`, {});
  ok(sug.msg, 'suggest same-route orders: ' + sug.msg[0]);
  ld = (await as(PIN.log, 'POST', `/api/e/loads/${ld.id}/flow`, { to: 'en_ruta' })).row;
  ok(ld.status === 'en_ruta', 'load dispatched');
  const dels = (await as(PIN.chof, 'GET', `/api/e/deliveries?f_load_id=${ld.id}`)).rows;
  ok(dels.length >= 1, `driver sees ${dels.length} deliveries`);
  try { await as(PIN.chof, 'POST', `/api/e/deliveries/${dels[0].id}/flow`, { to: 'entregado' }); ok(false, 'photo required'); } catch (e) { ok(/foto/i.test(JSON.stringify(e.j)), 'delivery blocked without signed-note photo'); }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const file = await as(PIN.chof, 'POST', '/api/files', null, { body: png, headers: { 'content-type': 'image/png', 'x-file-name': 'remision.png' } });
  for (const d of dels) { const r = (await as(PIN.chof, 'POST', `/api/e/deliveries/${d.id}/flow`, { to: 'entregado', photo: file.id, received_by: 'Juan', gps: '25.68,-100.31' })).row; ok(r.status === 'entregado' && r.photo, 'delivery confirmed with photo + GPS'); }
  o = (await as(PIN.fact, 'GET', `/api/e/orders/${o.id}`)).row;
  ok(o.status === 'entregado', 'order in billing queue (entregado)');
  ld = (await as(PIN.log, 'PUT', `/api/e/loads/${ld.id}`, { tolls: 1200 }).catch(() => ({ row: ld }))).row;
  ld = (await as(PIN.log, 'POST', `/api/e/loads/${ld.id}/flow`, { to: 'cerrada' })).row;
  ok(ld.actual_cost > 0, 'load closed & costed: ' + ld.actual_cost);
  o = (await as(PIN.fact, 'POST', `/api/e/orders/${o.id}/flow`, { to: 'facturado' })).row;
  ok(o.status === 'facturado', 'invoiced');
  const inv = (await as(PIN.fact, 'GET', `/api/e/invoices?f_order_id=${o.id}`)).rows[0];
  ok(inv && inv.uuid && inv.balance > 0, `invoice ${inv.folio} uuid ${inv.uuid.slice(0, 8)} balance ${inv.balance}`);
  let rc = (await as(PIN.cob, 'POST', '/api/e/receipts', { customer_id: cust.id, date: today, amount: inv.total, reference: 'SPEI ' + inv.folio })).row;
  await as(PIN.cob, 'POST', `/api/e/receipts/${rc.id}/act/suggestApply`, {});
  rc = (await as(PIN.cob, 'POST', `/api/e/receipts/${rc.id}/flow`, { to: 'aplicado' })).row;
  ok(rc.status === 'aplicado' && rc.rep_uuid, 'payment applied, REP generated');
  const inv2 = (await as(PIN.fact, 'GET', `/api/e/invoices/${inv.id}`)).row;
  ok(inv2.status === 'pagada' && inv2.balance === 0, 'invoice paid');

  console.log('PRICE APPROVAL & CREDIT HOLD');
  let o2 = (await as(PIN.vta, 'POST', '/api/e/orders', { customer_id: cust.id, source: 'telefono', promised_date: today, lines: [{ product_id: mts.id, qty: 10, disc: 12 }] })).row;
  ok(o2.approval_level === 'DIR', 'discount 12% needs Dirección');
  o2 = (await as(PIN.vta, 'POST', `/api/e/orders/${o2.id}/flow`, { to: 'confirmado' })).row;
  if (o2.status === 'retenido') o2 = (await as(PIN.cob, 'POST', `/api/e/orders/${o2.id}/flow`, { to: 'confirmado' })).row;
  ok(o2.status === 'por_aprobar', 'order waiting price approval');
  try { await as(PIN.gv, 'POST', `/api/e/orders/${o2.id}/flow`, { to: 'confirmado' }); ok(false, 'gv blocked'); } catch (e) { ok(e.status === 403, 'Gerencia cannot approve a Dirección-level discount'); }
  o2 = (await as(PIN.dir, 'POST', `/api/e/orders/${o2.id}/flow`, { to: 'confirmado' })).row;
  ok(['confirmado', 'en_produccion'].includes(o2.status), 'Dirección approved → ' + o2.status);
  const small = (await as(PIN.vta, 'GET', '/api/e/customers')).rows.find(c => c.name === 'Rancho San Isidro');
  await as(PIN.cob, 'PUT', `/api/e/customers/${small.id}`, { credit_limit: 1000 });
  let o3 = (await as(PIN.vta, 'POST', '/api/e/orders', { customer_id: small.id, source: 'correo', promised_date: today, lines: [{ product_id: mts.id, qty: 10 }] })).row;
  o3 = (await as(PIN.vta, 'POST', `/api/e/orders/${o3.id}/flow`, { to: 'confirmado' })).row;
  ok(o3.status === 'retenido', 'order over credit line held');
  o3 = (await as(PIN.cob, 'POST', `/api/e/orders/${o3.id}/flow`, { to: 'confirmado' })).row;
  ok(['confirmado', 'en_produccion'].includes(o3.status), 'Cobranza released → ' + o3.status);
  let q = (await as(PIN.vta, 'POST', '/api/e/orders', { doc_type: 'cotizacion', customer_id: small.id, source: 'correo', promised_date: today, lines: [{ product_id: mts.id, qty: 5 }] })).row;
  ok(q.status === 'cotizacion', 'quote created');
  await as(PIN.vta, 'POST', `/api/e/orders/${q.id}/act/toOrder`, {});
  q = (await as(PIN.vta, 'GET', `/api/e/orders/${q.id}`)).row;
  ok(q.status === 'borrador' && q.doc_type === 'pedido', 'quote converted to order');
  const pet = (await as(PIN.vta, 'GET', '/api/e/customers')).rows.find(c => c.channel === 'pet');
  const kit = prods.find(p => p.code === 'GAT-GAT-03');
  const op = (await as(PIN.vta, 'POST', '/api/e/orders', { customer_id: pet.id, source: 'asesor', promised_date: today, lines: [{ product_id: kit.id, qty: 30 }] })).row;
  ok(op.lines.some(l => /PROMO/.test(l.note || '') && l.price === 0 && l.qty === 3), 'promotion 10+1 adds 3 free units automatically');

  console.log('CREDIT NOTES');
  let cn = (await as(PIN.vta, 'POST', '/api/e/credit_notes', { customer_id: cust.id, invoice_id: inv.id, reason: 'entrega', amount: 35000, description: 'Sacos dañados' })).row;
  ok(cn.approver_level === 'DIR', 'note > $20k routes to Dirección');
  try { await as(PIN.gv, 'POST', `/api/e/credit_notes/${cn.id}/flow`, { to: 'aprobada' }); ok(false, ''); } catch (e) { ok(e.status === 403, 'Gerencia blocked on Dirección-level note'); }
  cn = (await as(PIN.dir, 'POST', `/api/e/credit_notes/${cn.id}/flow`, { to: 'aprobada' })).row;
  cn = (await as(PIN.fact, 'POST', `/api/e/credit_notes/${cn.id}/flow`, { to: 'aplicada' })).row;
  ok(cn.status === 'aplicada' && cn.uuid, 'note applied & stamped');
  const cnSelf = (await as(PIN.gv, 'POST', '/api/e/credit_notes', { customer_id: cust.id, reason: 'flete', amount: 1000, description: 'x' })).row;
  try { await as(PIN.gv, 'POST', `/api/e/credit_notes/${cnSelf.id}/flow`, { to: 'aprobada' }); ok(false, ''); } catch (e) { ok(e.status === 403 && /Segregaci/.test(JSON.stringify(e.j)), 'segregation of duties: creator cannot approve'); }

  console.log('CREDIT APPLICATION');
  let cr = (await as(PIN.cob, 'GET', '/api/e/credit_requests?status=borrador')).rows[0];
  try { await as(PIN.cob, 'POST', `/api/e/credit_requests/${cr.id}/flow`, { to: 'evaluar' }); ok(false, ''); } catch (e) { ok(/documentos/i.test(JSON.stringify(e.j)), 'evaluation blocked until documents uploaded'); }
  const pdf = await as(PIN.cob, 'POST', '/api/files', null, { body: Buffer.from('%PDF-1.4 test'), headers: { 'content-type': 'application/pdf', 'x-file-name': 'doc.pdf' } });
  await as(PIN.cob, 'PUT', `/api/e/credit_requests/${cr.id}`, { doc_rfc: pdf.id, doc_csf: pdf.id, doc_pagare: pdf.id });
  cr = (await as(PIN.cob, 'POST', `/api/e/credit_requests/${cr.id}/flow`, { to: 'evaluar' })).row;
  ok(cr.score > 0 && cr.decision, `scored ${cr.score}% → ${cr.status}`);
  const cr2 = (await as(PIN.dir, 'GET', '/api/e/credit_requests?status=revision_direccion')).rows[0];
  if (cr2) { const g = (await as(PIN.dir, 'POST', `/api/e/credit_requests/${cr2.id}/flow`, { to: 'aprobada' })).row; ok(g.status === 'aprobada', 'Dirección approved credit; customer created/updated'); }

  console.log('PROCURE TO PAY');
  let rq = (await as(PIN.prod, 'POST', '/api/e/requisitions', { area: 'Planta', justification: 'Refacciones', supplier_id: 1, lines: [{ description: 'Banda', qty: 2, price: 5000 }] })).row;
  ok(rq.total === 10000 && rq.approver_level === 'COMP', 'requisition $10k → Compras approves');
  rq = (await as(PIN.comp, 'POST', `/api/e/requisitions/${rq.id}/flow`, { to: 'aprobada' })).row;
  const toPO = await as(PIN.comp, 'POST', `/api/e/requisitions/${rq.id}/act/toPO`, {});
  const poId = +toPO.go.split('/').pop();
  const po = (await as(PIN.comp, 'GET', `/api/e/purchase_orders/${poId}`)).row;
  ok(po.total === 11600, 'PO created with IVA: ' + po.total);
  try { await as(PIN.alm, 'POST', '/api/e/goods_receipts', { po_id: po.id, date: today, lines: [{ line: 1, qty: 5 }] }); ok(false, ''); } catch (e) { ok(/quedan/.test(JSON.stringify(e.j)), 'over-receipt blocked'); }
  const gr = (await as(PIN.alm, 'POST', '/api/e/goods_receipts', { po_id: po.id, date: today })).row;
  ok(gr.amount === 10000, 'goods receipt ' + gr.folio + ' amount ' + gr.amount);
  const sup = (await as(PIN.comp, 'GET', `/api/e/suppliers/${po.supplier_id}`)).row;
  const uuid = 'AAAAAAAA-BBBB-4CCC-8DDD-' + String(Date.now()).slice(-12);
  const xml = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="${today}T10:00:00" SubTotal="10000.00" Total="11600.00" MetodoPago="PPD"><cfdi:Emisor Rfc="${sup.rfc}" Nombre="X"/><cfdi:Receptor Rfc="MME0103157K2"/><cfdi:Impuestos TotalImpuestosTrasladados="1600.00"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="x" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
  // supplier portal (PROV user belongs to supplier 1)
  const xf = await as(PIN.prov, 'POST', '/api/files', null, { body: Buffer.from(xml), headers: { 'content-type': 'text/xml', 'x-file-name': 'factura.xml' } });
  let si;
  if (po.supplier_id === 1) si = (await as(PIN.prov, 'POST', '/api/e/supplier_invoices', { gr_id: gr.id, xml: xf.id })).row;
  else si = (await as(PIN.cxp, 'POST', '/api/e/supplier_invoices', { supplier_id: po.supplier_id, gr_id: gr.id, xml: xf.id })).row;
  ok(si.uuid === uuid && si.total === 11600 && si.tax === 1600, 'CFDI XML parsed (UUID, total, IVA) via portal');
  try { await as(PIN.cxp, 'POST', '/api/e/supplier_invoices', { supplier_id: po.supplier_id, gr_id: gr.id, uuid, total: 11600 }); ok(false, ''); } catch (e) { ok(/duplicad|facturada/i.test(JSON.stringify(e.j)), 'duplicate UUID / already-invoiced receipt blocked'); }
  si = (await as(PIN.cxp, 'POST', `/api/e/supplier_invoices/${si.id}/flow`, { to: 'validar' })).row;
  ok(si.status === 'validada', '3-way match OK');
  si = (await as(PIN.cxp, 'POST', `/api/e/supplier_invoices/${si.id}/flow`, { to: 'aprobada' })).row;
  let pay = (await as(PIN.cxp, 'POST', '/api/e/supplier_payments', { supplier_id: po.supplier_id, date: today, reference: 'SPEI-TEST', lines: [{ invoice_id: si.id, amount: 11600 }] })).row;
  ok(pay.tax === 1600 && pay.tax_base === 10000, 'payment computed DIOT base/IVA');
  pay = (await as(PIN.admin, 'POST', `/api/e/supplier_payments/${pay.id}/flow`, { to: 'pagado' })).row;
  const si2 = (await as(PIN.cxp, 'GET', `/api/e/supplier_invoices/${si.id}`)).row;
  ok(si2.status === 'pagada', 'supplier invoice marked paid');
  const diot = await as(PIN.cont, 'GET', `/api/report/diot?period=${today.slice(0, 7)}`);
  ok(diot.table.rows.length > 0, 'DIOT has ' + diot.table.rows.length + ' suppliers');
  const prov = await as(PIN.prov, 'GET', '/api/e/supplier_invoices');
  ok(prov.rows.every(r => r.supplier_id === 1), 'supplier portal only shows own invoices');
  try { await as(PIN.prov, 'GET', '/api/e/customers'); ok(false, ''); } catch (e) { ok(e.status === 403, 'supplier cannot see customers'); }

  console.log('RECORD TO REPORT');
  const cp = (await as(PIN.cont, 'POST', '/api/e/close_periods', { period: today.slice(0, 7), company: 'MNA' })).row;
  const g = await as(PIN.cont, 'POST', `/api/e/close_periods/${cp.id}/act/genTasks`, {});
  ok(/13/.test(g.msg[0]), g.msg[0]);
  try { await as(PIN.cont, 'POST', `/api/e/close_periods/${cp.id}/flow`, { to: 'cerrado' }); ok(false, ''); } catch (e) { ok(/sin validar/.test(JSON.stringify(e.j)), 'close blocked until tasks validated'); }
  const tasks = (await as(PIN.cont, 'GET', `/api/e/close_tasks?f_period_id=${cp.id}`)).rows;
  for (const tk of tasks) { await as(PIN.cont2, 'POST', `/api/e/close_tasks/${tk.id}/flow`, { to: 'entregada' }); await as(PIN.cont, 'POST', `/api/e/close_tasks/${tk.id}/flow`, { to: 'validada' }); }
  const cp2 = (await as(PIN.cont, 'POST', `/api/e/close_periods/${cp.id}/flow`, { to: 'cerrado' })).row;
  ok(cp2.status === 'cerrado' && cp2.closed_day != null, 'period closed on D+' + cp2.closed_day);
  const rec = (await as(PIN.cont, 'GET', '/api/e/account_recons?status=pendiente')).rows[0];
  await as(PIN.cont2, 'PUT', `/api/e/account_recons/${rec.id}`, { evidence: pdf.id, explanation: 'Partidas en tránsito' });
  await as(PIN.cont2, 'POST', `/api/e/account_recons/${rec.id}/flow`, { to: 'preparada' });
  try { await as(PIN.cont2, 'POST', `/api/e/account_recons/${rec.id}/flow`, { to: 'aprobada' }); ok(false, ''); } catch (e) { ok(e.status === 403, 'preparer cannot also sign as reviewer'); }
  const rr = (await as(PIN.cont, 'POST', `/api/e/account_recons/${rec.id}/flow`, { to: 'aprobada' })).row;
  ok(rr.status === 'aprobada' && rr.reviewer, 'reconciliation double-signed');
  const bm = await as(PIN.cont, 'POST', '/api/bankmatch', {});
  ok(bm.matched > 0, `bank auto-match: ${bm.matched} of ${bm.checked}`);
  const ea = await as(PIN.cont, 'GET', '/api/report/e_accounting?type=balanza');
  ok(ea.xml && /BCE:Balanza/.test(ea.xml), 'e-accounting balanza XML generated');

  console.log('FIXED ASSETS & COSTING');
  const dr = (await as(PIN.cont, 'GET', '/api/e/depr_runs?status=borrador')).rows[0];
  const c1 = await as(PIN.cont, 'POST', `/api/e/depr_runs/${dr.id}/act/calc`, {});
  ok(/Depreciación calculada/.test(c1.msg[0]), c1.msg[0]);
  const before = (await as(PIN.cont, 'GET', '/api/e/assets')).rows.reduce((s, a) => s + (a.book_accum || 0), 0);
  await as(PIN.cont, 'POST', `/api/e/depr_runs/${dr.id}/flow`, { to: 'contabilizada' });
  const after = (await as(PIN.cont, 'GET', '/api/e/assets')).rows.reduce((s, a) => s + (a.book_accum || 0), 0);
  ok(after > before, 'depreciation posted to asset register');
  const jr = await fetch(BASE + `/api/report/depr_journal?format=csv&run=${dr.id}`, { headers: { cookie: sess[PIN.cont] } });
  ok(jr.status === 200 && (await jr.text()).includes('Depreciación'), 'journal CSV export');
  const ev = (await as(PIN.cont, 'GET', '/api/e/asset_events?status=solicitado')).rows;
  for (const x of ev) { const r = (await as(PIN.cont, 'POST', `/api/e/asset_events/${x.id}/flow`, { to: 'aprobado' })).row; ok(r.status === 'aprobado', `asset event ${x.type} approved`); }
  const smallImp = (await as(PIN.prod, 'POST', '/api/e/asset_events', { asset_id: ev[0].asset_id, type: 'mejora', date: today, amount: 3000, justification: 'x' })).row;
  ok(/NO cumple/.test(smallImp.policy_check), 'capitalization policy flags amounts under threshold');
  const bom = (await as(PIN.cost, 'POST', '/api/e/boms', { product_id: mts.id, version: 'v-test', labor_ton: 300, packaging_unit: 7, lines: [{ component: 'Sorgo', qty_ton: 600, std_price: 5 }, { component: 'Soya', qty_ton: 400, std_price: 9 }] })).row;
  ok(bom.material_ton === 6600, 'BOM material/ton ' + bom.material_ton);
  await as(PIN.cost, 'POST', `/api/e/boms/${bom.id}/flow`, { to: 'vigente' });
  const p2 = (await as(PIN.cost, 'GET', `/api/e/products/${mts.id}`)).row;
  ok(p2.std_cost > 0 && p2.std_cost !== mts.std_cost, 'standard cost updated from BOM: ' + p2.std_cost);
  try { await as(PIN.cont, 'GET', '/api/e/boms'); ok(false, ''); } catch (e) { ok(e.status === 403, 'BOM confidential: Contabilidad blocked'); }
  const vp = await as(PIN.vta, 'GET', `/api/e/products/${mts.id}`);
  ok(vp.row.std_cost === undefined, 'sales advisors cannot see standard cost');

  console.log('GOVERNANCE');
  const pol = (await as(PIN.vta, 'GET', '/api/e/policies?status=vigente')).rows[0];
  const ak = await as(PIN.vta, 'POST', `/api/e/policies/${pol.id}/act/ack`, {});
  ok(ak.msg, 'policy acknowledged');
  console.log('\nALL WORKFLOWS PASSED');
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
