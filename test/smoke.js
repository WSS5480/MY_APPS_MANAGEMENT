// Smoke test: logs in as each demo role and hits every module and report.
const BASE = process.env.BASE || 'http://localhost:3999';
const PINS = (process.env.PINS || '5480,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012,1014,1015,2001').split(',');
let fails = 0;
async function call(ck, path, opt = {}) {
  const r = await fetch(BASE + path, Object.assign({ headers: Object.assign({ cookie: ck, 'content-type': 'application/json' }, opt.headers || {}) }, opt));
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
(async () => {
  for (const pin of PINS) {
    const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
    if (lr.status !== 200) { console.log('LOGIN FAIL', pin, lr.status); fails++; continue; }
    const ck = lr.headers.get('set-cookie').split(';')[0];
    const meta = (await call(ck, '/api/meta')).j;
    const role = meta.user.role;
    let n = 0;
    for (const p of ['/api/me', '/api/dashboard', '/api/inbox']) { const r = await call(ck, p); n++; if (r.s !== 200) { fails++; console.log(role, p, r.s, JSON.stringify(r.j).slice(0, 200)); } }
    for (const k of Object.keys(meta.entities)) {
      const r = await call(ck, '/api/e/' + k); n++;
      if (r.s !== 200) { fails++; console.log(role, 'list', k, r.s, JSON.stringify(r.j).slice(0, 200)); continue; }
      const row = r.j.rows[0];
      if (row) { const d = await call(ck, `/api/e/${k}/${row.id}`); n++; if (d.s !== 200) { fails++; console.log(role, 'get', k, d.s, JSON.stringify(d.j).slice(0, 200)); } }
      const csv = await call(ck, `/api/e/${k}?format=csv`); n++; if (csv.s !== 200) { fails++; console.log(role, 'csv', k, csv.s); }
      const o = await call(ck, `/api/opts/${k}`); n++; if (o.s !== 200) { fails++; console.log(role, 'opts', k, o.s, JSON.stringify(o.j).slice(0, 200)); }
    }
    for (const rp of meta.reports) {
      const r = await call(ck, '/api/report/' + rp.k); n++;
      if (r.s !== 200) { fails++; console.log(role, 'report', rp.k, r.s, JSON.stringify(r.j).slice(0, 300)); }
    }
    console.log(`${role.padEnd(5)} ${meta.user.name.padEnd(28)} ents=${Object.keys(meta.entities).length} reports=${meta.reports.length} calls=${n}`);
  }
  console.log(fails ? `FAILURES: ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
