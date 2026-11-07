// End-to-end check against a running server: BASE=http://localhost:10000 OWNER_PIN=... node test.js
const BASE = process.env.BASE || 'http://localhost:10000';
let cookie = '';
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
async function api(p, body) {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => null); if (!r.ok) throw Object.assign(new Error((j && j.error) || r.status), { status: r.status }); return j;
}
const expectErr = async (fn, m) => { try { await fn(); ok(false, m + ' (should have been refused)'); } catch (e) { ok(true, m + ' → ' + e.message); } };
const near = (a, b) => Math.abs(a - b) < 0.011;
const r2 = n => Math.round(n * 100) / 100;
async function books() { const tb = await api('/api/trial'); const d = tb.reduce((s, r) => s + r.d, 0), k = tb.reduce((s, r) => s + r.k, 0); return { tb, bal: a => (tb.find(r => r.acct === a) || { bal: 0 }).bal, balanced: near(d, k) }; }

(async () => {
  await expectErr(() => api('/api/list/vehicle'), 'blocked before sign-in');
  await expectErr(() => api('/login', { pin: '0000' }), 'wrong PIN refused');
  await api('/login', { pin: process.env.OWNER_PIN }); ok(true, 'owner signs in');
  const me = await api('/api/me'); ok(me.user.role === 'owner', 'me = owner');
  const store = (await api('/api/list/store'))[0];
  ok(store.data.name === '' && store.data.tax_rate === undefined, 'new install starts with blank store setup');
  // a deal can't be delivered until the store is set up — checked below once a deal exists
  const SETUP = { name: 'Main Store', state: 'TX', tax_rate: 6.25, doc_fee: 150, late_fee: 15, grace_days: 10, labor_rate: 120, trade_tax_credit: true, pay_order: 'fees_first' };
  const s2 = await api('/api/save/store', { data: { ...SETUP, name: 'North Lot', pay_order: 'fees_last' } }); ok(s2.id, 'second store added (pays interest/principal before fees)');

  // users & roles
  const sales = await api('/api/save/user', { data: { name: 'Sam Sales', role: 'sales', pin: '4321', active: true } }); ok(sales.id, 'sales user');
  await expectErr(() => api('/api/save/user', { data: { name: 'Dup', role: 'sales', pin: '4321' } }), 'duplicate PIN refused');
  await api('/api/save/product', { data: { name: 'Service contract 24/24', price: 1495, cost: 600, term: '24 mo / 24k' } });
  const gap = await api('/api/save/product', { data: { name: 'GAP', price: 695, cost: 200 } });
  await api('/api/save/lender', { data: { name: 'NextGear', floorplan: true } });
  await api('/api/save/lender', { data: { name: 'Westlake', reserve: 2 } });

  // inventory + accounting on purchase
  const v1 = await api('/api/save/vehicle', { store_id: store.id, data: { vin: '1HGCM82633A004352', year: 2018, make: 'Honda', model: 'Accord', miles: 82000, cost: 9000, price: 14995, recon: [{ item: 'Detail', vendor: 'Shine', cost: 250 }] } });
  ok(/^S\d+/.test(v1.data.stock), 'stock # assigned ' + v1.data.stock);
  let B = await books(); ok(B.balanced && near(B.bal('1300'), 9250), 'purchase + recon posted, inventory 9250');
  await api('/api/save/vehicle', { id: v1.id, store_id: store.id, data: { ...v1.data, cost: 9100 } });
  B = await books(); ok(near(B.bal('1300'), 9350), 'cost change posts only the difference (9350)');
  const v2 = await api('/api/save/vehicle', { store_id: store.id, data: { year: 2016, make: 'Ford', model: 'F-150', cost: 15000, price: 21995, floorplan_lender: 'NextGear', floorplan_amount: 15000, floorplan_rate: 7.3, acquired: '2026-10-01' } });
  B = await books(); ok(near(B.bal('2100'), -15000), 'floored unit on floorplan payable');

  // customer + BHPH deal
  const cu = await api('/api/save/customer', { data: { first: 'Maria', last: 'Lopez', phone: '9565551234' } });
  const deal = await api('/api/save/deal', { store_id: store.id, data: { customer_id: cu.id, vehicle_id: v1.id, type: 'bhph', price: 14995, down: 2000, doc_fee: 150, title_fees: 90, apr: 18, term: 52, frequency: 'biweekly', first_due: '2026-10-15', sale_date: '2026-10-01', products: [{ id: gap.id, price: 695 }], trade: { vin: '2T1BURHE0JC000001', year: 2012, make: 'Toyota', model: 'Corolla', allowance: 1500, acv: 1200, payoff: 0 } } });
  ok(/^D\d+/.test(deal.data.number) && deal.data.status === 'pending', 'deal saved ' + deal.data.number);
  await expectErr(() => api(`/api/deal/${deal.id}/deliver`, {}), 'delivery refused while store setup and interest method are blank');
  await api('/api/save/store', { id: store.id, data: SETUP });
  await api('/api/save/deal', { id: deal.id, store_id: store.id, data: { ...deal.data, interest_method: 'simple' } });
  const k = await api('/api/deal/calc', { store_id: store.id, data: { ...deal.data, interest_method: 'simple' } }); ok(k.missing.length === 0, 'nothing missing after setup');
  ok(near(k.tax, (14995 - 1500) * 0.0625), 'Texas tax on price less trade = ' + k.tax);
  ok(near(k.financed, 14995 + 150 + 90 + k.tax + 695 - 1500 - 2000), 'amount financed ' + k.financed);
  ok(k.payment > 0 && near(k.financeCharge, k.totalPayments - k.financed), 'payment ' + k.payment + ', finance charge ' + k.financeCharge);
  // sales role can't deliver
  const ownerCookie = cookie; await api('/login', { pin: '4321' });
  await expectErr(() => api(`/api/deal/${deal.id}/deliver`, {}), 'sales user cannot deliver');
  await expectErr(() => api('/api/list/user'), 'sales user cannot see users');
  cookie = ownerCookie;
  const del = await api(`/api/deal/${deal.id}/deliver`, {}); ok(del.loan && del.loan.data.account, 'delivered, account ' + del.loan.data.account);
  B = await books(); ok(B.balanced, 'books balance after delivery');
  ok(near(B.bal('1200'), k.financed), 'note receivable = amount financed');
  ok(near(B.bal('1300'), 15000 + 1200), 'inventory = floored truck + trade at ACV (16200)');
  ok(near(B.bal('4000'), -(14995 - 300)), 'over-allowance of 300 comes off vehicle sales');
  const vehs = await api('/api/list/vehicle'); ok(vehs.some(v => v.data.vin === '2T1BURHE0JC000001' && v.data.status === 'in_stock'), 'trade-in added to stock');
  await expectErr(() => api('/api/save/deal', { id: deal.id, store_id: store.id, data: { ...deal.data, price: 1 } }), 'delivered deal is locked');

  // payments
  const L = del.loan;
  const p1 = await api(`/api/loan/${L.id}/pay`, { amount: k.payment, date: '2026-10-15', method: 'cash' });
  ok(near(p1.data.principal + p1.data.interest, k.payment) && p1.data.interest > 0, `payment split P ${p1.data.principal} / I ${p1.data.interest}`);
  await expectErr(() => api(`/api/loan/${L.id}/pay`, { amount: 10, date: '2026-10-10' }), 'back-dated payment before last one refused');
  await api(`/api/loan/${L.id}/fee`, { amount: 15 });
  const p2 = await api(`/api/loan/${L.id}/pay`, { amount: 100, date: '2026-10-29', method: 'card' }); ok(near(p2.data.fees, 15), 'late fee collected first');
  await api(`/api/loan/${L.id}/note`, { type: 'promise', promise_date: '2026-11-20', promise_amount: 50, note: 'payday' });
  const lf = await api('/api/loan/' + L.id); ok(lf.schedule.length === 52 && lf.status.balance < k.financed, 'schedule 52 rows, balance ' + lf.status.balance);
  const coll = await api('/api/collections'); ok(Array.isArray(coll.queue), 'collections queue builds (' + coll.queue.length + ' late)');
  const pub = await api('/api/public/account', { account: L.data.account, last: 'lopez' }); ok(near(pub.balance, lf.status.balance), 'customer portal shows balance');
  await expectErr(() => api('/api/public/account', { account: L.data.account, last: 'smith' }), 'portal refuses wrong last name');
  await api(`/api/loan/${L.id}/gps`, { action: 'disable', reason: 'test' }); ok(true, 'starter disable logged');
  B = await books(); ok(B.balanced, 'books balance after payments');

  // precomputed loan at the North Lot (fees last): payments earn scheduled interest; early payoff refunds the rest
  const vP = await api('/api/save/vehicle', { store_id: s2.id, data: { year: 2015, make: 'Chevy', model: 'Malibu', cost: 4000, price: 7995, acquired: '2026-09-01' } });
  const cP = await api('/api/save/customer', { data: { first: 'Ana', last: 'Cruz', phone: '9565550000' } });
  const dP = await api('/api/save/deal', { store_id: s2.id, data: { customer_id: cP.id, vehicle_id: vP.id, type: 'bhph', interest_method: 'precomputed', price: 7995, down: 1000, apr: 24, term: 26, frequency: 'biweekly', first_due: '2026-09-15', sale_date: '2026-09-01', trade: {} } });
  const delP = await api(`/api/deal/${dP.id}/deliver`, {}); const LP = delP.loan; ok(LP.data.method === 'precomputed', 'precomputed account opened');
  const sch = (await api('/api/loan/' + LP.id)).schedule;
  await api(`/api/loan/${LP.id}/fee`, { amount: 20 });
  const q1 = await api(`/api/loan/${LP.id}/pay`, { amount: LP.data.payment, date: '2026-09-25', method: 'cash' });
  ok(near(q1.data.interest, sch[0].interest) && near(q1.data.fees, 0), `fees-last store: full payment goes to P&I, interest = scheduled ${sch[0].interest}`);
  const q2 = await api(`/api/loan/${LP.id}/pay`, { amount: 20, date: '2026-09-26', method: 'cash' });
  ok(near(q2.data.fees, 0) && q2.data.principal + q2.data.interest > 0, 'fees-last: small payment still goes to P&I first');
  const pre0 = (await api('/api/loan/' + LP.id)).status;
  ok(pre0.contractBalance > pre0.balance, `contract balance ${pre0.contractBalance} > principal ${pre0.balance} (unearned interest)`);
  const quote = await api(`/api/loan/${LP.id}/payoff?date=2026-09-27`);
  const pay = await api(`/api/loan/${LP.id}/pay`, { amount: quote.payoff, date: '2026-09-27', method: 'cash' }).catch(e => ({ err: e.message }));
  if (pay.err) { // payoff today is computed against today's date; pay exactly the quoted payoff on the posting date instead
    const st2 = (await api('/api/loan/' + LP.id)).status; ok(false, 'payoff failed: ' + pay.err + ' quoted ' + st2.payoff); }
  else { const after = await api('/api/loan/' + LP.id); ok(after.data.status === 'paid' && near(after.status.balance, 0), 'early payoff closes the account'); ok(pay.data.interest < pre0.contractBalance - pre0.balance, 'payoff charged less interest than the full contract (refund applied)'); }
  B = await books(); ok(B.balanced, 'books balance after precomputed loan');

  // outside-finance deal on the floored truck + funding
  const cu2 = await api('/api/save/customer', { data: { first: 'John', last: 'Reyes' } });
  const d2 = await api('/api/save/deal', { store_id: store.id, data: { customer_id: cu2.id, vehicle_id: v2.id, type: 'outside', lender: 'Westlake', reserve_pct: 2, doc_fee: 150, price: 21995, down: 3000, apr: 9.9, term: 72, frequency: 'monthly', sale_date: '2026-11-01', trade: {} } });
  await api(`/api/deal/${d2.id}/deliver`, {}); B = await books(); ok(B.balanced && near(B.bal('2100'), 0), 'floorplan paid off at delivery');
  ok(B.bal('6000') > 0, 'floorplan interest posted ' + B.bal('6000'));
  await api(`/api/deal/${d2.id}/fund`, { date: '2026-11-05' }); B = await books(); ok(near(B.bal('1100'), 0), 'contracts in transit cleared on funding');
  // unwind a cash deal
  const v3 = await api('/api/save/vehicle', { store_id: store.id, data: { year: 2010, make: 'Nissan', model: 'Altima', cost: 3000, price: 5995 } });
  const d3 = await api('/api/save/deal', { store_id: store.id, data: { customer_id: cu2.id, vehicle_id: v3.id, type: 'cash', price: 5995, trade: {} } });
  const before = (await books()).bal('1000');
  await api(`/api/deal/${d3.id}/deliver`, {}); await api(`/api/deal/${d3.id}/unwind`, {});
  B = await books(); ok(B.balanced && near(B.bal('1000'), before), 'unwind reverses cash exactly');
  ok((await api('/api/rec/' + v3.id)).data.status === 'in_stock', 'unwound car back in stock');

  // service: RO with customer + warranty + parts, inspection approval
  const part = await api('/api/save/part', { store_id: store.id, data: { number: 'OF-123', description: 'Oil filter', cost: 4, price: 12, min: 5, qty: 0 } });
  await api(`/api/part/${part.id}/receive`, { qty: 20, cost: 4 }); B = await books(); ok(near(B.bal('1400'), 80), 'parts received to inventory 80');
  const ro = await api('/api/save/ro', { store_id: store.id, data: { customer_id: cu.id, customer_label: 'Maria Lopez', vehicle_label: 'Honda Accord', vin: '1HGCM82633A004352', year: 2018, miles: 130000, tax_rate: 8.25, shop_supplies: 10, oem: 'Honda',
    lines: [{ op: 'LOF', desc: 'Oil change', pay_type: 'customer', hours: 0.5, rate: 120, actual_hours: 0.4, tech: 'Luis', parts: [{ part_id: part.id, qty: 1, price: 12 }] }, { op: 'W1', desc: 'Recall', pay_type: 'warranty', hours: 1, rate: 100, tech: 'Luis', parts: [] }],
    inspection: [{ item: 'Front brakes', status: 'red', note: '2mm', price: 289 }, { item: 'Wipers', status: 'green' }] } });
  ok(/^RO\d+/.test(ro.data.number), 'RO opened ' + ro.data.number);
  const link = await api(`/api/ro/${ro.id}/link`, {}); const tok = link.url.split('/').pop();
  const insp = await api('/api/public/inspection/' + tok); ok(insp.items.length === 2, 'customer sees inspection');
  await api('/api/public/inspection/' + tok, { approved: [0] });
  const closed = await api(`/api/ro/${ro.id}/close`, { paid: false });
  ok(near(closed.totals.customer, 60 + 12 + 289 + 10 + 0.99), 'RO customer total incl. approved brakes ' + closed.totals.customer);
  B = await books(); ok(B.balanced && near(B.bal('1400'), 76), 'part relieved from inventory');
  const claims = await api('/api/list/claim'); ok(claims.length === 1 && near(claims[0].data.amount, 100), 'warranty claim created 100');
  await api('/api/claim/' + claims[0].id, { status: 'submitted', claim_no: 'H123' }); await api('/api/claim/' + claims[0].id, { status: 'paid', paid_amount: 90 });
  B = await books(); ok(near(B.bal('1210'), 0) && near(B.bal('6300'), 10), 'claim paid, 10 chargeback');
  await api(`/api/ro/${ro.id}/collect`, {}); B = await books(); ok(near(B.bal('1220'), 0), 'service A/R collected');
  await api('/api/parts/counter', { lines: [{ part_id: part.id, qty: 2 }], tax_rate: 8.25 }); B = await books(); ok(B.balanced && near(B.bal('1400'), 68), 'counter sale posted');

  // repo flow on the BHPH account
  await api(`/api/loan/${L.id}/repo`, { step: 'assigned', agent: 'RGV Recovery', cost: 0 });
  const bal = (await api('/api/loan/' + L.id)).status.balance;
  await api(`/api/loan/${L.id}/repo`, { step: 'recovered', amount: 8000, cost: 350 });
  await api(`/api/loan/${L.id}/repo`, { step: 'sold', amount: 8500 });
  const lr = await api('/api/loan/' + L.id); ok(lr.data.status === 'closed_repo' && near(lr.data.repo.deficiency, bal + 350 - 8500), 'repo sold, deficiency ' + lr.data.repo.deficiency);
  B = await books(); ok(B.balanced && near(B.bal('1200'), 0) && near(B.bal('1310'), 0), 'note and repo inventory cleared');

  // manual entry, dashboard, export, permissions
  await expectErr(() => api('/api/journal', { memo: 'bad', lines: [{ acct: '1000', debit: 10 }, { acct: '3000', credit: 9 }] }), 'unbalanced manual entry refused');
  await api('/api/journal', { memo: 'Rent', lines: [{ acct: '6900', debit: 2500 }, { acct: '1000', credit: 2500 }] });
  const dash = await api('/api/dashboard'); ok(dash.stores.length === 2 && dash.dealsMtd >= 0, 'dashboard with per-store rollup; absorption ' + dash.absorption);
  const ex = await api('/api/export'); ok(ex.records.length > 10 && ex.journal.length > 10 && !ex.records.some(r => r.data.pin_hash), 'export has data, no PIN hashes');
  await expectErr(() => api('/api/delete/' + L.id, {}), 'loans cannot be deleted');

  // ===== regression checks for the independent review =====
  const sp = (d, n) => { const x = new Date(Date.now() - 6 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const T0 = sp(0, 0);
  const newCar = async (extra = {}) => api('/api/save/vehicle', { store_id: store.id, data: { year: 2014, make: 'Kia', model: 'Soul', cost: 5000, price: 8995, ...extra } });
  const custR = await api('/api/save/customer', { data: { first: 'Rev', last: 'Iew', phone: '9565559999' } });
  // 1. over-paid warranty claim keeps the ledger balanced
  const roW = await api('/api/save/ro', { store_id: store.id, data: { customer_id: custR.id, tax_rate: 0, oem: 'Kia', lines: [{ desc: 'Recall', pay_type: 'warranty', hours: 1, rate: 100, parts: [] }] } });
  await api(`/api/ro/${roW.id}/close`, { paid: true }); const clW = (await api('/api/list/claim')).find(x => x.data.ro_id === roW.id);
  await api('/api/claim/' + clW.id, { status: 'paid', paid_amount: 120 }); B = await books(); ok(B.balanced, 'R1 warranty paid above claim stays balanced');
  // cash deal where the trade is worth more than the car
  const vX = await newCar({ cost: 2500, price: 3000 }); const dX = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: vX.id, type: 'cash', price: 3000, doc_fee: 0, trade: { vin: '1FTFW1ET5DFA00001', allowance: 5000, acv: 5000 } } });
  await api(`/api/deal/${dX.id}/deliver`, {}); B = await books(); ok(B.balanced, 'R1 trade worth more than the car stays balanced (dealer owes buyer)');
  // 2. precomputed: payoff with missed payments includes the interest already earned
  const v2a = await newCar(); const d2a = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: v2a.id, type: 'bhph', interest_method: 'precomputed', price: 10000, down: 0, doc_fee: 0, apr: 24, term: 12, frequency: 'monthly', first_due: sp(0, -300), sale_date: sp(0, -330), trade: {} } });
  const L2a = (await api(`/api/deal/${d2a.id}/deliver`, {})).loan; const s2a = await api('/api/loan/' + L2a.id);
  const earned = s2a.schedule.filter(x => x.due <= T0).reduce((s, x) => s + x.interest, 0);
  ok(s2a.status.payoff >= s2a.status.balance + earned - 0.01, `R2 missed-payment payoff ${s2a.status.payoff} includes earned interest ${earned.toFixed(2)}`);
  // 3. precomputed: pay three installments right after the sale, then pay off -> unearned interest refunded
  const v3a = await newCar(); const d3a = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: v3a.id, type: 'bhph', interest_method: 'precomputed', price: 9000, down: 0, doc_fee: 0, apr: 24, term: 12, frequency: 'monthly', first_due: sp(0, 28), sale_date: sp(0, -2), trade: {} } });
  const L3a = (await api(`/api/deal/${d3a.id}/deliver`, {})).loan; await api(`/api/loan/${L3a.id}/pay`, { amount: r2(L3a.data.payment * 3), date: sp(0, -1) });
  const q3a = await api(`/api/loan/${L3a.id}/payoff?date=${T0}`); const p3a = await api(`/api/loan/${L3a.id}/pay`, { amount: q3a.payoff, date: T0 });
  const all3 = (await api('/api/loan/' + L3a.id)).payments.reduce((s, p) => s + p.data.interest, 0);
  ok(all3 < 30 && (await api('/api/loan/' + L3a.id)).data.status === 'paid', `R3 paid ahead then paid off: total interest ${all3.toFixed(2)} for ~2 days`);
  // 4. simple interest: a fee-only payment does not wipe out interest owed
  const v4a = await newCar(); const d4a = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: v4a.id, type: 'bhph', interest_method: 'simple', price: 10000, down: 0, doc_fee: 0, apr: 24, term: 24, frequency: 'monthly', first_due: sp(0, -60), sale_date: sp(0, -90), trade: {} } });
  const L4a = (await api(`/api/deal/${d4a.id}/deliver`, {})).loan; await api(`/api/loan/${L4a.id}/fee`, { amount: 15 });
  const a4 = (await api('/api/loan/' + L4a.id)).status.accrued; const f4 = await api(`/api/loan/${L4a.id}/pay`, { amount: 15, date: T0 });
  ok(near(f4.data.fees, 15) && near((await api('/api/loan/' + L4a.id)).status.accrued, a4), `R4 fee-only payment leaves interest owed (${a4})`);
  const s4 = await api(`/api/loan/${L4a.id}/pay`, { amount: 5, date: T0 }); ok(near((await api('/api/loan/' + L4a.id)).status.accrued, a4 - 5), 'R4 small payment only reduces interest owed by what it paid');
  // 5-7. repo: value above balance is capped; recovered twice refused; "assigned" can't reopen a repo
  await api(`/api/loan/${L4a.id}/repo`, { step: 'recovered', amount: 999999 });
  await expectErr(() => api(`/api/loan/${L4a.id}/repo`, { step: 'recovered', amount: 1 }), 'R6 recovered twice refused');
  await expectErr(() => api(`/api/loan/${L4a.id}/repo`, { step: 'assigned', cost: 75 }), 'R7 "assigned" after recovery refused');
  await api(`/api/loan/${L4a.id}/repo`, { step: 'sold', amount: 12000 }); B = await books(); ok(B.balanced && B.bal('1310') > -0.01, 'R5 repo inventory never goes negative');
  // 8. recon edit posts the difference; removal reverses
  const v8 = await newCar({ cost: 1000, recon: [{ item: 'Tires', cost: 100 }] }); const inv0 = (await books()).bal('1300');
  const r8 = v8.data.recon; await api('/api/save/vehicle', { id: v8.id, store_id: store.id, data: { ...v8.data, recon: [{ ...r8[0], cost: 150 }, { item: 'Detail', cost: 30 }] } });
  ok(near((await books()).bal('1300'), inv0 + 80), 'R8 recon edit posts only the change (+50 +30)');
  const v8b = await api('/api/rec/' + v8.id); await api('/api/save/vehicle', { id: v8.id, store_id: store.id, data: { ...v8b.data, recon: [v8b.data.recon[1]] } });
  ok(near((await books()).bal('1300'), inv0 - 70), 'R8 removing the $150 recon line reverses it (inventory = cost + $30)');
  // 9-10. floored for less than cost; sell/unwind twice keeps floorplan right
  const fp0 = (await books()).bal('2100'); const v9 = await newCar({ cost: 5000, floorplan_lender: 'NextGear', floorplan_amount: 4000, floorplan_rate: 0 });
  ok(near((await books()).bal('2100'), fp0 - 4000), 'R10 only the floored amount goes to floorplan');
  for (let i = 0; i < 2; i++) { const d9 = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: v9.id, type: 'cash', price: 7000, doc_fee: 0, trade: {} } }); await api(`/api/deal/${d9.id}/deliver`, {}); await api(`/api/deal/${d9.id}/unwind`, {}); }
  B = await books(); ok(B.balanced && near(B.bal('2100'), fp0 - 4000), 'R9 two sell/unwinds leave floorplan at 4000');
  // 11. blank ACV -> front gross uses allowance
  const v11 = await newCar({ cost: 5000, price: 10000 }); const k11 = await api('/api/deal/calc', { store_id: store.id, data: { type: 'cash', vehicle_id: v11.id, price: 10000, doc_fee: 0, trade: { vin: 'X', allowance: 2000, acv: '' } } });
  ok(near(k11.front, 5000), 'R11 blank ACV front gross 5000');
  // 13. status / photo injection refused
  const v13 = await api('/api/save/vehicle', { store_id: store.id, data: { make: 'X', cost: 0, status: '<img src=x onerror=alert(1)>', photos: ['javascript:alert(1)', 'data:image/jpeg;base64,AAAA'] } });
  ok(v13.data.status === 'in_stock' && v13.data.photos.length === 1, 'R13 bad status and photo addresses dropped');
  // 14-15. stale save keeps the customer's approval; status "closed" can't be set by saving
  const ro14 = await api('/api/save/ro', { store_id: store.id, data: { customer_id: custR.id, tax_rate: 0, lines: [], inspection: [{ item: 'Brakes', status: 'red', price: 300 }] } });
  const tk = (await api(`/api/ro/${ro14.id}/link`, {})).url.split('/').pop(); await api('/api/public/inspection/' + tk, { approved: [0] });
  await api('/api/save/ro', { id: ro14.id, store_id: store.id, data: { ...ro14.data, status: 'closed' } });
  const ro14b = await api('/api/rec/' + ro14.id); ok(ro14b.data.inspection[0].approved === true, 'R14 customer approval survives a stale save'); ok(ro14b.data.status !== 'closed', 'R15 saving can’t mark an RO closed');
  const c14 = await api(`/api/ro/${ro14.id}/close`, { paid: true }); ok(near(c14.totals.customer, 300), 'R14 approved work billed on close');
  // ===== second review =====
  // N1 approvals are tied to each item; re-pricing an item asks again
  const roN = await api('/api/save/ro', { store_id: store.id, data: { customer_id: custR.id, tax_rate: 0, lines: [], inspection: [{ item: 'Brakes', status: 'red', price: 300 }, { item: 'Tires', status: 'yellow', price: 100 }, { item: 'Tires', status: 'red', price: 600 }] } });
  const tkN = (await api(`/api/ro/${roN.id}/link`, {})).url.split('/').pop(); await api('/api/public/inspection/' + tkN, { approved: [0, 1] });
  const roN2 = await api('/api/rec/' + roN.id); roN2.data.inspection[0].price = 900; await api('/api/save/ro', { id: roN.id, store_id: store.id, data: roN2.data });
  const cN = await api(`/api/ro/${roN.id}/close`, { paid: true }); ok(near(cN.totals.customer, 100), 'N1 re-priced brakes need a new answer; only the approved $100 tires bill');
  // N2 recon locked on a sold unit
  const vN = await newCar(); const dN = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: vN.id, type: 'cash', price: 9000, doc_fee: 0, trade: {} } }); await api(`/api/deal/${dN.id}/deliver`, {});
  const vN2 = await api('/api/rec/' + vN.id); await expectErr(() => api('/api/save/vehicle', { id: vN.id, store_id: store.id, data: { ...vN2.data, recon: [{ item: 'late', cost: 200 }] } }), 'N2 recon on a sold unit refused');
  // N3 per-store dashboard matches the all-stores rollup
  const dAll = await api('/api/dashboard'); const dOne = await api('/api/dashboard?store=' + store.id); const row = dAll.stores.find(x => String(x.id) === String(store.id));
  ok(dOne.inventory === row.inventory && dOne.inventory > 0 && dOne.dealsMtd === row.dealsMtd, `N3 store dashboard ${dOne.inventory} units = rollup ${row.inventory}`);
  // N4 a manager limited to one store can't touch another store's records
  const mgr = await api('/api/save/user', { data: { name: 'North Mgr', role: 'manager', pin: '7777', store_id: Number(s2.id), active: true } });
  const ownerCk = cookie; cookie = ''; await api('/login', { pin: '7777' });
  await expectErr(() => api('/api/save/vehicle', { id: vN.id, store_id: s2.id, data: { ...vN2.data, price: 1 } }), 'N4 other-store vehicle save refused');
  await expectErr(() => api('/api/rec/' + vN.id), 'N4 other-store record hidden');
  ok((await api('/api/list/vehicle')).every(v => !v.store_id || String(v.store_id) === String(s2.id)), 'N4 lists show only their store');
  cookie = ownerCk;
  // ===== phase 2 =====
  const rawGet = async p => { const r = await fetch(BASE + p, { headers: { cookie } }); return { status: r.status, text: await r.text() }; };
  // website + lead routing
  await api('/api/save/user', { data: { name: 'Rep One', role: 'sales', pin: '1111', active: true } }); await api('/api/save/user', { data: { name: 'Rep Two', role: 'sales', pin: '2222', active: true } });
  const setr = (await api('/api/list/settings'))[0]; await api('/api/save/settings', { id: setr.id, data: { ...setr.data, lead_routing: 'round_robin', dealer_name: 'Test Motors' } });
  const site = await (await fetch(BASE + '/api/site/inventory')).json(); ok(Array.isArray(site) && site.length > 0 && !('cost' in site[0]), `P website lists ${site.length} units without cost`);
  const keep2 = cookie; cookie = '';
  const l1 = await api('/api/site/lead', { first: 'Web', last: 'Buyer', phone: '9565551111', consent: true, vehicle_id: site[0].id, message: 'Is it available?' });
  const l2 = await api('/api/site/lead', { first: 'Web2', last: 'Buyer', phone: '9565552222', consent: true, type: 'credit_app', employer: 'HEB', income: 3200 });
  cookie = keep2; const leads = await api('/api/list/lead'); const L1 = leads.find(x => x.id === l1.id), L2 = leads.find(x => x.id === l2.id);
  ok(L1 && L2 && L1.data.owner && L2.data.owner && L1.data.owner !== L2.data.owner, `P website leads rotate: ${L1.data.owner} / ${L2.data.owner}`);
  ok(L2.data.credit_app && L2.data.credit_app.employer === 'HEB', 'P credit application saved on the lead');
  await expectErr(() => api('/api/site/lead', { first: 'x', phone: '1', consent: false }), 'P lead without consent refused');
  const st2 = (await api('/api/list/settings'))[0]; const feed = await rawGet('/feed/inventory.csv?token=' + st2.data.feed_token);
  ok(feed.status === 200 && feed.text.startsWith('DealerName') && feed.text.split('\n').length > 2, 'P listing feed CSV');
  ok((await rawGet('/feed/inventory.csv?token=wrong')).status === 404, 'P feed refused without the token');
  ok((await rawGet('/status')).status === 200, 'P status page');
  // appraisal -> buy into inventory
  const ap = await api('/api/save/appraisal', { store_id: store.id, data: { vin: '3VWDP7AJ7DM000001', year: 2013, make: 'VW', model: 'Jetta', miles: 98000, offer: 3500 } });
  const inv0p = (await books()).bal('1300'); const bought = await api(`/api/appraisal/${ap.id}/buy`, { paid_with: 'cash' });
  ok(bought.data.stock && near((await books()).bal('1300'), inv0p + 3500), 'P appraisal bought into inventory at the offer');
  await expectErr(() => api(`/api/appraisal/${ap.id}/buy`, {}), 'P appraisal can’t be used twice');
  // e-signature
  const anyDeal = (await api('/api/list/deal'))[0]; const sr = await api('/api/sign/request', { ref: anyDeal.id, title: 'Bill of sale', html: '<h2>Bill of Sale</h2><p>Test document with enough text to sign.</p>' });
  const stok = sr.url.split('/').pop(); const keep3 = cookie; cookie = '';
  await expectErr(() => api('/api/public/sign/' + stok, { consent: false, name: 'X', sig: 'x' }), 'P signing needs e-sign consent');
  const png = 'data:image/png;base64,' + 'A'.repeat(400); await api('/api/public/sign/' + stok, { consent: true, name: 'Maria Lopez', sig: png });
  await expectErr(() => api('/api/public/sign/' + stok, { consent: true, name: 'Again', sig: png }), 'P a document can only be signed once');
  cookie = keep3; const sl = await api('/api/sign/list/' + anyDeal.id); ok(sl[0] && sl[0].signer === 'Maria Lopez' && sl[0].doc_hash, 'P signed document kept with signer and fingerprint');
  // automatic late fees
  const vLF = await newCar(); const dLF = await api('/api/save/deal', { store_id: store.id, data: { customer_id: custR.id, vehicle_id: vLF.id, type: 'bhph', interest_method: 'simple', price: 6000, doc_fee: 0, apr: 18, term: 24, frequency: 'monthly', first_due: sp(0, -45), sale_date: sp(0, -75), trade: {} } });
  const LLF = (await api(`/api/deal/${dLF.id}/deliver`, {})).loan; const stc = await api('/api/rec/' + store.id); await api('/api/save/store', { id: store.id, data: { ...stc.data, auto_late_fee: true } });
  const lf1 = await api('/api/late-fees/run', {}); ok(lf1.assessed === 0, 'P turning on late fees doesn’t charge old missed payments');
  const stc2 = await api('/api/rec/' + store.id); ok(stc2.data.auto_late_fee_since === T0, 'P late fees start date recorded');
  // insurance alerts
  ok((await api('/api/insurance-alerts')).some(x => x.id === LLF.id), 'P account without insurance shows on alerts');
  // cashier drawer
  await api(`/api/loan/${LLF.id}/pay`, { amount: 100, method: 'cash', date: T0 }); const dr = await api('/api/drawer?date=' + T0);
  ok(dr.expectedCash >= 100, 'P drawer expects the cash taken'); const cashB = (await books()).bal('1000');
  const cl = await api('/api/drawer/close', { date: T0, counted_cash: dr.expectedCash - 5 }); ok(near(cl.over_short, -5) && near((await books()).bal('1000'), cashB - 5), 'P drawer short $5 posted');
  await expectErr(() => api('/api/drawer/close', { date: T0, counted_cash: 1 }), 'P drawer can’t close twice');
  // bills
  const vend = await api('/api/save/vendor', { data: { name: 'Shine Detail' } }); const bill = await api('/api/save/bill', { store_id: store.id, data: { vendor_id: vend.id, number: 'INV9', date: T0, lines: [{ acct: '6900', amount: 250 }] } });
  const ap0 = (await books()).bal('2000'); await api(`/api/bill/${bill.id}/post`, {}); ok(near((await books()).bal('2000'), ap0 - 250), 'P bill posted to A/P');
  await expectErr(() => api('/api/save/bill', { id: bill.id, store_id: store.id, data: { ...bill.data, lines: [] } }), 'P posted bill locked');
  await api(`/api/bill/${bill.id}/pay`, { amount: 250 }); ok(near((await books()).bal('2000'), ap0), 'P bill paid');
  // bank reconciliation
  const rec0 = await api('/api/bank/rec'); const one = rec0.bookUncleared.find(x => x.amount > 0);
  const csvTxt = `Date,Description,Amount\n${one.date},Deposit,${one.amount}\n${one.date},Bank fee,-12.50\n`;
  const imp = await api('/api/bank/import', { csv: csvTxt }); ok(imp.added === 2, 'P bank statement imported');
  ok((await api('/api/bank/import', { csv: csvTxt })).added === 0, 'P same statement not imported twice');
  const auto = await api('/api/bank/auto', {}); const rec1 = await api('/api/bank/rec'); ok(auto.matched >= 1 && rec1.bankUnmatched.length === 1, 'P auto-match clears the deposit, bank fee left to post');
  // month-end lock
  await api('/api/close-period', { through: sp(0, -1) });
  await expectErr(() => api('/api/journal', { date: sp(0, -2), memo: 'old', lines: [{ acct: '6900', debit: 1 }, { acct: '1000', credit: 1 }] }), 'P posting into a closed period refused');
  const s9 = (await api('/api/list/settings'))[0]; await api('/api/save/settings', { id: s9.id, data: { ...s9.data, closed_through: null } });
  ok((await api('/api/list/settings'))[0].data.closed_through === sp(0, -1), 'P settings save can’t reopen the books');
  await api('/api/close-period', { through: null });
  // exports, OEM, transfer
  const iif = await rawGet('/api/export/qb'); ok(iif.text.startsWith('!TRNS') && iif.text.includes('ENDTRNS'), 'P QuickBooks IIF export');
  ok(Array.isArray(await api('/api/report/oem')), 'P factory statement report');
  const vT = await newCar({ cost: 2000 }); const ic = (await books());
  await api(`/api/vehicle/${vT.id}/transfer`, { to_store: s2.id }); const icB = await books();
  ok(icB.balanced && near(icB.bal('1500'), ic.bal('1500') + 2000) && near(icB.bal('2500'), ic.bal('2500') - 2000) && String((await api('/api/rec/' + vT.id)).store_id) === String(s2.id), 'P store transfer with intercompany entries');
  // payroll + time clock
  const rep = (await api('/api/list/user')).find(u => u.data.name === 'Rep One'); await api('/api/payplans', { user_id: rep.id, per_unit: 100, pct_front: 20 });
  const keep4 = cookie; cookie = ''; await api('/login', { pin: '1111' }); await api('/api/clock', { action: 'in' }); await expectErr(() => api('/api/clock', { action: 'in' }), 'P can’t clock in twice'); await api('/api/clock', { action: 'out' });
  await expectErr(() => api('/api/payroll?from=' + sp(0, -30) + '&to=' + T0), 'P sales rep can’t see payroll'); cookie = keep4;
  const pr = await api('/api/payroll?from=' + sp(0, -400) + '&to=' + T0); ok(pr.some(r => r.name === 'Rep One' && r.hasPlan), 'P payroll report with pay plans');
  ok((await rawGet('/api/payroll.csv?from=' + sp(0, -30) + '&to=' + T0)).text.startsWith('Employee'), 'P payroll export CSV');
  // capacity
  await api('/api/save/store', { id: store.id, data: { ...(await api('/api/rec/' + store.id)).data, tech_count: 2, tech_hours: 8 } });
  await api('/api/save/appt', { store_id: store.id, data: { when: T0 + 'T09:00', hours: 3, customer_id: custR.id } }); const cap = await api('/api/capacity?store=' + store.id + '&from=' + T0 + '&days=1');
  ok(cap.capacity === 16 && cap.days[0].booked >= 3, 'P shop capacity counts booked hours');
  // integrations: keys never returned whole; not-connected message
  await api('/api/integrations', { name: 'marketcheck', values: { api_key: 'secretkey123456', zip: '78501' } }); const ik = await api('/api/integrations');
  ok(ik.marketcheck.api_key === '••••3456' && ik.marketcheck.zip === '78501', 'P integration key masked');
  ok(!(await api('/api/list/settings'))[0].data.marketcheck, 'P keys not in settings'); await expectErr(() => api('/api/list/secret'), 'P secrets can’t be listed');
  await expectErr(() => api('/api/media/upload-url', { ro_id: roW.id, ext: 'mp4' }), 'P video storage says not connected');
  // ===== phase 2 review fixes + downloads =====
  const keyRec = (await (async () => { const all = []; for (let i = 1; i < 400; i++) { try { const r = await api('/api/rec/' + i); if (r.kind === 'secret') all.push(r); } catch (e) {} } return all; })());
  ok(keyRec.length === 0, 'Q integration keys can’t be read through any record id');
  const exAll = await api('/api/export'); ok(!exAll.records.some(r => r.kind === 'secret'), 'Q keys not in the full export');
  await expectErr(() => api('/api/save/settings', { data: { dealer_name: 'second' } }), 'Q a second settings record can’t be made');
  await api('/api/close-period', { through: sp(0, -1) });
  await expectErr(() => api('/api/journal', { date: sp(0, -3).replace(/-/g, ''), memo: 'fmt', lines: [{ acct: '6900', debit: 1 }, { acct: '1000', credit: 1 }] }), 'Q odd date format can’t slip past the lock');
  await api('/api/close-period', { through: null });
  const evil = await api('/api/sign/request', { ref: anyDeal.id, title: 'x', html: '<p>Doc text long enough to sign here</p><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>' });
  const evDoc = await api('/api/sign/doc/' + evil.url.split('/').pop()); ok(!/onerror|<script|javascript:/i.test(evDoc.html), 'Q signing documents are cleaned of scripts');
  const cuBefore = (await api('/api/list/customer')).find(c => c.data.phone === '9565551111'); const keepQ = cookie; cookie = '';
  await api('/api/site/lead', { first: 'Bad', last: 'Actor', phone: '9565551111', consent: true, type: 'credit_app', address: '666 Fake Rd', income: 1 }); cookie = keepQ;
  const cuAfter = await api('/api/rec/' + cuBefore.id); ok(cuAfter.data.address === cuBefore.data.address && cuAfter.data.first === cuBefore.data.first, 'Q public form can’t change an existing customer');
  const hid = await newCar({ photos: ['data:image/jpeg;base64,AAAA'], hide_web: true }); ok((await rawGet(`/photo/${hid.id}/0`)).status === 404, 'Q hidden unit photos aren’t public');
  ok((await rawGet('/api/site/vehicle/abc')).status === 404, 'Q bad vehicle id gives a clean not-found');
  const dupCsv = `Date,Description,Amount\n${T0},DEPOSIT,20.00\n${T0},DEPOSIT,20.00\n`; const di = await api('/api/bank/import', { csv: dupCsv }); ok(di.added === 2, 'Q two real identical deposits both import');
  ok((await api('/api/bank/import', { csv: dupCsv })).added === 0, 'Q re-importing the same file adds nothing');
  const b0 = await api('/api/save/bill', { store_id: store.id, data: { vendor_id: vend.id, number: 'Z', lines: [{ acct: '6900', amount: 100 }, { acct: '6900', amount: -100 }] } });
  await expectErr(() => api(`/api/bill/${b0.id}/post`, {}), 'Q bills with zero or negative lines refused');
  await expectErr(() => api('/api/delete/' + bill.id, {}), 'Q posted bills can’t be deleted');
  for (const n of ['inventory', 'customers', 'leads', 'deals', 'accounts', 'payments', 'collections', 'repair_orders', 'parts', 'warranty_claims', 'appraisals', 'bills', 'vendors', 'bank_lines', 'time_clock', 'drawers', 'trial_balance', 'chart_of_accounts', 'audit_log']) {
    const r = await rawGet('/api/csv/' + n); ok(r.status === 200 && r.text.split('\n').length >= 2 && /^[A-Z]/.test(r.text.replace(/^\ufeff/, '')), 'Q CSV ' + n); }
  const keepR = cookie; cookie = ''; await api('/login', { pin: '1111' }); ok((await rawGet('/api/csv/payments')).status === 403 && (await rawGet('/api/csv/inventory')).status === 200, 'Q sales rep gets inventory CSV but not payments'); cookie = keepR;
  // 12. sign-out really ends the session
  const keep = cookie; await api('/logout', {}); cookie = keep; await expectErr(() => api('/api/me'), 'R12 old session refused after sign-out');
  await api('/login', { pin: process.env.OWNER_PIN });
  B = await books(); ok(B.balanced, 'FINAL: books balance');
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
