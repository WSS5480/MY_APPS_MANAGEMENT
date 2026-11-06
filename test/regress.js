// Regression checks for issues found in independent QA.
const BASE = process.env.BASE || 'http://localhost:3999';
const S = {};
async function as(pin, method, path, body, raw) {
  if (!S[pin]) { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) }); S[pin] = r.headers.get('set-cookie').split(';')[0]; }
  const h = { cookie: S[pin] }; if (raw) Object.assign(h, raw.headers); else if (body) h['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
}
const ok = (c, m) => { if (!c) { console.log('  ✗ ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); };
(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const cust = (await as('1003', 'GET', '/api/e/customers')).j.rows.find(c => c.channel === 'pet');
  const prod = (await as('1003', 'GET', '/api/e/products')).j.rows.find(p => p.code === 'PER-ADU-20');
  let o = (await as('1003', 'POST', '/api/e/orders', { customer_id: cust.id, source: 'asesor', promised_date: today, lines: [{ product_id: prod.id, qty: 10 }] })).j.row;
  const t0 = o.total;
  for (let i = 0; i < 3; i++) o = (await as('1003', 'PUT', `/api/e/orders/${o.id}`, { lines: o.lines })).j.row;
  ok(o.total === t0 && o.lines[0].disc === 0 && /PROMO/.test(o.lines[0].note), `promo 10% does not compound on re-save (total ${t0} → ${o.total})`);
  ok(o.approval_level === '', 'promo discount does not trigger price approval');
  const d = (await as('5480', 'GET', '/api/e/deliveries')).j.rows[0];
  ok((await as('5480', 'GET', `/api/e/deliveries/${d.id}`)).s === 200, 'delivery detail loads');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const f = (await as('1015', 'POST', '/api/files', null, { body: png, headers: { 'content-type': 'image/png', 'x-file-name': 'x.png' } })).j;
  ok((await as('2001', 'GET', `/api/files/${f.id}`)).s === 403, 'supplier cannot download another user\'s file');
  ok((await as('1007', 'GET', `/api/files/${f.id}`)).s === 200, 'internal user can download file');
  const si = (await as('2001', 'GET', '/api/e/supplier_invoices')).j.rows[0];
  if (si) { const r = await as('2001', 'PUT', `/api/e/supplier_invoices/${si.id}`, { supplier_id: 2 }); const after = (await as('5480', 'GET', `/api/e/supplier_invoices/${si.id}`)).j.row; ok(after.supplier_id === 1, 'supplier cannot reassign invoice to another supplier (' + r.s + ')'); }
  const m1 = (await as('1002', 'GET', '/api/me')).j.unread;
  await as('1002', 'POST', '/api/notifications/read', {});
  const m2 = (await as('1002', 'GET', '/api/me')).j.unread;
  ok(m2 === 0 && m1 > 0, `notifications read per user (${m1} → ${m2})`);
  const v = (await as('5480', 'GET', '/api/opts/users')).j; void v;
  const csv = await fetch(BASE + '/api/e/invoices?format=csv&lang=en', { headers: { cookie: S['5480'] } }).then(r => r.text());
  ok(/Paid|Open/.test(csv) && !/,pagada,/.test(csv), 'CSV export uses status labels');
  const sp = await fetch(BASE + '/api/e/subprocesses?format=csv&lang=en', { headers: { cookie: S['5480'] } }).then(r => r.text());
  ok(/Standard \/ actual costing/.test(sp) && !/‖/.test(sp), 'CSV picks English names');
})();
