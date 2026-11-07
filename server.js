// Dealer System server — one dealer group per install, any number of stores (rooftops).
// Express + Postgres. Records live in `rec` (JSONB per kind); money moves are posted to `jrnl` (double-entry).
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 10000;
const OWNER_PIN = String(process.env.OWNER_PIN || '');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const API_TOKEN = process.env.API_TOKEN || '';
const SCHEMA = (process.env.DB_SCHEMA || 'dealer').replace(/[^a-z0-9_]/gi, '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
});
pool.on('connect', c => c.query(`SET search_path TO ${SCHEMA}`));

// ---------- helpers ----------
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = n => Number(n) || 0;
const today = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // Central time is close enough for "today"
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(d + 'T12:00:00Z'); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), 'dms:' + salt, 32, { N: 4096 }).toString('hex');
const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

function nthDue(first, freq, i) {
  if (freq === 'weekly') return addDays(first, 7 * i);
  if (freq === 'biweekly') return addDays(first, 14 * i);
  if (freq === 'semimonthly') return addDays(addMonths(first, Math.floor(i / 2)), i % 2 ? 15 : 0);
  return addMonths(first, i);
}
function pmt(principal, apr, n, freq) {
  const r = num(apr) / 100 / (PER_YEAR[freq] || 12);
  if (!n) return 0;
  if (!r) return r2(principal / n);
  return r2(principal * r / (1 - Math.pow(1 + r, -n)));
}

// Deal math: tax, fees, amount financed, payment, Truth-in-Lending numbers, gross.
function calcDeal(d, store, products) {
  const price = num(d.price), down = num(d.down), allow = num(d.trade && d.trade.allowance), payoff = num(d.trade && d.trade.payoff);
  const has = v => v != null && v !== '';
  const missing = [];
  const doc = has(d.doc_fee) ? num(d.doc_fee) : has(store && store.doc_fee) ? num(store.doc_fee) : (missing.push('doc fee'), 0);
  const fees = num(d.title_fees);
  const taxRate = has(d.tax_rate) ? num(d.tax_rate) : has(store && store.tax_rate) ? num(store.tax_rate) : (missing.push('sales tax rate'), 0);
  if (!store || typeof store.trade_tax_credit !== 'boolean') missing.push('whether trade-ins reduce sales tax (store setting)');
  const taxable = Math.max(0, price - (store && store.trade_tax_credit === true ? allow : 0));
  if (d.type !== 'cash') { if (!has(d.apr)) missing.push('APR'); if (!num(d.term)) missing.push('number of payments'); if (!d.frequency) missing.push('payment schedule'); }
  if (d.type === 'bhph') { if (!d.first_due) missing.push('first payment date'); if (!['simple', 'precomputed'].includes(d.interest_method)) missing.push('interest method'); }
  if (d.type === 'outside' && !d.lender) missing.push('lender');
  if (!['cash', 'bhph', 'outside'].includes(d.type)) missing.push('deal type');
  const tax = r2(taxable * taxRate / 100);
  const picked = (d.products || []).map(p => { const def = products.find(x => String(x.id) === String(p.id)) || {}; return { id: p.id, name: def.name || p.name, price: num(p.price != null && p.price !== '' ? p.price : def.price), cost: num(def.cost) }; }); // dealer cost always from the product setup
  const prodPrice = r2(picked.reduce((s, p) => s + p.price, 0)), prodCost = r2(picked.reduce((s, p) => s + p.cost, 0));
  const total = r2(price + doc + fees + tax + prodPrice);
  const financed = d.type === 'cash' ? 0 : r2(total - allow + payoff - down);
  const cashDue = d.type === 'cash' ? r2(total - allow + payoff) : down;
  const n = num(d.term), freq = d.frequency || '', apr = num(d.apr);
  const payment = financed > 0 ? pmt(financed, apr, n, freq) : 0;
  const totalPayments = financed > 0 && n ? r2(buildSchedule({ principal: financed, apr, frequency: freq, term: n, payment, first_due: '2000-01-01' }).reduce((s, x) => s + x.payment, 0)) : 0; // last payment is adjusted to the penny
  const financeCharge = financed > 0 ? r2(totalPayments - financed) : 0;
  const vehCost = num(d._veh_cost);
  const acv = has(d.trade && d.trade.acv) ? Math.min(num(d.trade.acv), allow) : allow; // blank ACV = allowance, same as delivery
  const front = r2(price - vehCost - (allow - acv));
  if (allow > 0 && !(d.trade && d.trade.vin)) missing.push('trade-in VIN');
  const reserve = d.type === 'outside' ? r2(financed * num(d.reserve_pct) / 100) : 0;
  const back = r2(prodPrice - prodCost + reserve + doc);
  return { missing, price, doc, fees, tax, taxRate, taxable, products: picked, prodPrice, prodCost, total, allow, payoff, down, financed, cashDue, payment, n, freq, apr, totalPayments, financeCharge, totalSale: r2(totalPayments + down), acv, front, back, reserve, gross: r2(front + back) };
}

// Planned installment schedule (actuarial split of each payment into interest and principal).
function buildSchedule(L) {
  const rows = []; let bal = num(L.principal); const r = num(L.apr) / 100 / (PER_YEAR[L.frequency] || 12), n = num(L.term);
  for (let i = 0; i < n; i++) { const int = r2(bal * r); const last = i === n - 1; const pr = last ? bal : r2(num(L.payment) - int); bal = r2(bal - pr);
    rows.push({ n: i + 1, due: nthDue(L.first_due, L.frequency, i), payment: last ? r2(pr + int) : num(L.payment), interest: int, principal: pr, balance: Math.max(0, bal) }); }
  return rows;
}
// Precomputed loans: scheduled interest for the installments a payment covers (used to split regular payments).
function earnedInterest(sched, paidPI) {
  let left = paidPI, earned = 0;
  for (const x of sched) { if (left <= 0) break; const f = Math.min(1, left / x.payment); earned += x.interest * f; left -= x.payment; }
  return r2(earned);
}
const byDate = pays => [...pays].sort((a, b) => (a.data.date < b.data.date ? -1 : a.data.date > b.data.date ? 1 : a.id - b.id));
// Interest the loan has truly earned as of a date.
//  simple: daily interest on the actual principal balance, payment by payment.
//  precomputed (actuarial): scheduled interest of every installment due by the date, plus the share of the current one.
function interestEarned(L, pays, asOf, sched) {
  if (L.method === 'precomputed') {
    let e = 0;
    for (let i = 0; i < sched.length; i++) {
      const x = sched[i], start = i === 0 ? L.start_date : sched[i - 1].due;
      if (x.due <= asOf) { e += x.interest; continue; }
      const len = Math.max(1, daysBetween(start, x.due)), used = Math.max(0, Math.min(len, daysBetween(start, asOf)));
      e += x.interest * used / len; break;
    }
    return r2(e);
  }
  const rate = num(L.apr) / 100 / 365; let bal = num(L.principal), from = L.start_date, e = 0;
  for (const p of byDate(pays)) { if (p.data.date > asOf) break; e += bal * rate * Math.max(0, daysBetween(from, p.data.date)); bal -= num(p.data.principal); from = p.data.date; }
  e += Math.max(0, bal) * rate * Math.max(0, daysBetween(from, asOf));
  return r2(e);
}
// Loan status as of a date (default today).
function loanStatus(loan, pays, asOf) {
  const L = loan.data, pre = L.method === 'precomputed';
  const pi = pays.reduce((s, p) => s + num(p.data.principal) + num(p.data.interest), 0);
  const prin = pays.reduce((s, p) => s + num(p.data.principal), 0), intPaid = pays.reduce((s, p) => s + num(p.data.interest), 0);
  const balance = r2(num(L.principal) - prin);
  const n = num(L.term), pay = num(L.payment), t = asOf || today(); const sched = buildSchedule(L);
  let dueCount = 0; while (dueCount < n && nthDue(L.first_due, L.frequency, dueCount) <= t) dueCount++;
  const paidCount = pay ? Math.min(n, Math.floor((pi + 0.005) / pay)) : 0;
  const nextIdx = Math.min(paidCount, n - 1);
  const nextDue = balance > 0 ? nthDue(L.first_due, L.frequency, nextIdx) : null;
  const pastDue = balance > 0 ? r2(Math.max(0, dueCount * pay - pi)) : 0;
  const daysLate = nextDue && nextDue < t ? daysBetween(nextDue, t) : 0;
  const lastPay = pays.length ? byDate(pays).pop().data.date : null;
  // interest earned but not yet paid; for precomputed loans paid ahead this goes negative = interest refunded at payoff
  const accrued = balance > 0 ? r2(interestEarned(L, pays, t, sched) - intPaid) : 0;
  const feesOwed = Math.max(0, r2(num(L.fees_assessed) - pays.reduce((s, p) => s + num(p.data.fees), 0)));
  const bucket = daysLate === 0 ? 'current' : daysLate <= 15 ? '1-15' : daysLate <= 30 ? '16-30' : daysLate <= 60 ? '31-60' : '60+';
  const contractBalance = pre ? (balance > 0 ? r2(sched.reduce((s, x) => s + x.payment, 0) - pi) : 0) : null;
  return { method: pre ? 'precomputed' : 'simple', balance, contractBalance, paidPI: r2(pi), dueCount, paidCount, nextDue, pastDue, daysLate, accrued, feesOwed, payoff: r2(Math.max(0, balance + accrued) + feesOwed), bucket, lastPaid: lastPay };
}
// Split a payment using the store's payment order: 'fees_first' (fees, interest, principal) or 'fees_last' (interest, principal, fees).
function allocate(loan, pays, amt, date, order) {
  const L = loan.data, pre = L.method === 'precomputed';
  const st = loanStatus(loan, pays, date); // figured as of the payment date
  const payoffPI = r2(Math.max(0, st.balance + st.accrued));
  let left = r2(amt), fees = 0, interest = 0, principal = 0;
  const takeFees = () => { fees = Math.min(left, st.feesOwed); left = r2(left - fees); };
  const takePI = () => {
    const x = Math.min(left, payoffPI);
    if (x >= payoffPI - 0.004) { principal = st.balance; interest = r2(x - principal); } // full payoff (for precomputed paid-ahead loans, interest can be negative = refund)
    else if (pre) { interest = r2(Math.max(0, Math.min(x, earnedInterest(buildSchedule(L), st.paidPI + x) - earnedInterest(buildSchedule(L), st.paidPI)))); principal = r2(x - interest); if (principal > st.balance) { principal = st.balance; interest = r2(x - principal); } }
    else { interest = r2(Math.min(x, Math.max(0, st.accrued))); principal = r2(x - interest); }
    left = r2(left - x);
  };
  if (order === 'fees_last') { takePI(); takeFees(); } else { takeFees(); takePI(); }
  return { fees, interest, principal, left, st, payoffTotal: r2(payoffPI + st.feesOwed) };
}

// ---------- database ----------
const ACCOUNTS = [
  ['1000', 'Cash', 'asset', ''], ['1100', 'Contracts in Transit', 'asset', 'F&I'], ['1200', 'Notes Receivable — In-House (BHPH)', 'asset', 'BHPH'],
  ['1210', 'Warranty Receivable', 'asset', 'Service'], ['1220', 'Service Customer A/R', 'asset', 'Service'], ['1300', 'Vehicle Inventory', 'asset', 'Used'],
  ['1310', 'Repossessed Inventory', 'asset', 'BHPH'], ['1400', 'Parts Inventory', 'asset', 'Parts'],
  ['2000', 'Accounts Payable', 'liability', ''], ['2100', 'Floorplan Payable', 'liability', ''], ['2200', 'Sales Tax Payable', 'liability', ''],
  ['2210', 'Title & Registration Fees Payable', 'liability', ''], ['2220', 'Trade Payoffs Payable', 'liability', ''], ['2230', 'F&I Products Payable', 'liability', 'F&I'],
  ['3000', 'Owner Equity', 'equity', ''],
  ['4000', 'Vehicle Sales', 'income', 'Used'], ['4100', 'Doc Fee Income', 'income', 'F&I'], ['4200', 'F&I Product Income', 'income', 'F&I'],
  ['4210', 'Finance Reserve Income', 'income', 'F&I'], ['4300', 'Interest Income', 'income', 'BHPH'], ['4310', 'Late Fee Income', 'income', 'BHPH'],
  ['4400', 'Labor Sales', 'income', 'Service'], ['4410', 'Parts Sales', 'income', 'Parts'], ['4420', 'Internal Labor & Parts', 'income', 'Service'],
  ['5000', 'Vehicle Cost of Sales', 'expense', 'Used'], ['5200', 'F&I Product Cost', 'expense', 'F&I'], ['5400', 'Parts Cost of Sales', 'expense', 'Parts'],
  ['6000', 'Floorplan Interest', 'expense', 'Overhead'], ['6100', 'Bad Debt / Charge-offs', 'expense', 'BHPH'], ['6200', 'Repo Expense', 'expense', 'BHPH'],
  ['6300', 'Warranty Chargebacks', 'expense', 'Service'], ['6900', 'Other Overhead', 'expense', 'Overhead'],
];

async function init() {
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}`);
    await c.query(`CREATE TABLE IF NOT EXISTS rec (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, store_id BIGINT, data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await c.query(`CREATE INDEX IF NOT EXISTS rec_kind ON rec(kind, store_id)`);
    await c.query(`CREATE TABLE IF NOT EXISTS jrnl (id BIGSERIAL PRIMARY KEY, entry TEXT NOT NULL, date DATE NOT NULL, store_id BIGINT, acct TEXT NOT NULL,
      debit NUMERIC(14,2) NOT NULL DEFAULT 0, credit NUMERIC(14,2) NOT NULL DEFAULT 0, memo TEXT, src TEXT, ref BIGINT, by_user TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await c.query(`CREATE INDEX IF NOT EXISTS jrnl_date ON jrnl(store_id, date)`);
    await c.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, n BIGINT NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS audit (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), who TEXT, action TEXT, kind TEXT, ref BIGINT, detail TEXT)`);
    await c.query(`CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, kind TEXT NOT NULL, ref BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await c.query(`SELECT count(*)::int n FROM rec WHERE kind='account'`);
    if (!rows[0].n) for (const [no, name, type, dept] of ACCOUNTS) await c.query(`INSERT INTO rec(kind,data) VALUES('account',$1)`, [{ no, name, type, dept }]);
    const s = await c.query(`SELECT count(*)::int n FROM rec WHERE kind='store'`);
    if (!s.rows[0].n) await c.query(`INSERT INTO rec(kind,data) VALUES('store',$1)`, [{ name: '' }]);
    const st = await c.query(`SELECT count(*)::int n FROM rec WHERE kind='settings'`);
    if (!st.rows[0].n) await c.query(`INSERT INTO rec(kind,data) VALUES('settings',$1)`, [{ dealer_name: '', pay_link: '', phone: '', sms_reminder: 'Hi {first}, this is {dealer}. Your payment of {amount} was due {due}. Pay at {paylink} or call {phone}.', lead_reply: 'Thanks for your interest in the {vehicle}, {first}! When is a good time to come see it? — {dealer}' }]);
  } finally { c.release(); }
}
async function nextNum(c, name, start) {
  const { rows } = await c.query(`INSERT INTO counters(name,n) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET n=counters.n+1 RETURNING n`, [name, start]);
  return Number(rows[0].n);
}
// Load a record of an expected kind; users limited to one store only see that store's records.
async function need(c, id, kind, user) {
  const r = await getRec(c, id);
  if (!r || r.kind !== kind || (user && user.store_id && r.store_id && Number(r.store_id) !== Number(user.store_id))) throw new Error('Not found');
  return r;
}
async function getRec(c, id) { const { rows } = await c.query(`SELECT * FROM rec WHERE id=$1`, [id]); return rows[0]; }
async function list(c, kind, where = '', args = []) { const { rows } = await c.query(`SELECT * FROM rec WHERE kind=$1 ${where} ORDER BY id DESC LIMIT 5000`, [kind, ...args]); return rows; }
async function put(c, kind, store, data, id) {
  if (id) { const { rows } = await c.query(`UPDATE rec SET data=$2, store_id=$3, updated_at=now() WHERE id=$1 AND kind=$4 RETURNING *`, [id, data, store || null, kind]); return rows[0]; }
  const { rows } = await c.query(`INSERT INTO rec(kind,store_id,data) VALUES($1,$2,$3) RETURNING *`, [kind, store || null, data]); return rows[0];
}
// lines: [acct, debit, credit]; must balance
async function post(c, { date, store, memo, src, ref, who, lines }) {
  const net = {}; for (const [a, d, cr] of lines) net[a] = r2((net[a] || 0) + r2(d) - r2(cr)); // one line per account; negatives move to the other side
  const L = Object.entries(net).filter(([, v]) => v).map(([a, v]) => (v > 0 ? [a, v, 0] : [a, 0, -v]));
  const dr = r2(L.reduce((s, l) => s + l[1], 0)), cr = r2(L.reduce((s, l) => s + l[2], 0));
  if (Math.abs(dr - cr) > 0.009) throw new Error(`Entry out of balance (${dr} vs ${cr}) — ${memo}`);
  if (!L.length) return null;
  const entry = 'J' + (await nextNum(c, 'entry', 1001));
  for (const [a, d, k] of L) await c.query(`INSERT INTO jrnl(entry,date,store_id,acct,debit,credit,memo,src,ref,by_user) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [entry, date || today(), store || null, a, d, k, memo, src, ref || null, who]);
  return entry;
}
const audit = (c, who, action, kind, ref, detail) => c.query(`INSERT INTO audit(who,action,kind,ref,detail) VALUES($1,$2,$3,$4,$5)`, [who, action, kind, ref || null, String(detail || '').slice(0, 2000)]).catch(() => {});
async function tx(fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } }

// ---------- auth ----------
const ROLES = ['owner', 'manager', 'sales', 'finance', 'collector', 'service', 'parts', 'accounting'];
const WRITE = {
  sales: ['customer', 'lead', 'deal', 'vehicle', 'appt'],
  finance: ['customer', 'deal', 'lead', 'product', 'lender', 'loan', 'payment', 'cnote', 'vehicle'],
  collector: ['customer', 'cnote', 'payment', 'loan'],
  service: ['customer', 'ro', 'appt', 'part', 'claim'],
  parts: ['part', 'ro'],
  accounting: ['account', 'journal', 'payment', 'claim', 'vehicle', 'loan', 'lender', 'product'],
};
const can = (u, kind) => u && (u.role === 'owner' || u.role === 'manager' || (WRITE[u.role] || []).includes(kind));
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('hex').slice(0, 40);
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(x => { const i = x.indexOf('='); if (i > 0) o[x.slice(0, i).trim()] = decodeURIComponent(x.slice(i + 1).trim()); }); return o; }
async function who(req) {
  if (API_TOKEN && req.headers.authorization === 'Bearer ' + API_TOKEN) return { id: 0, name: 'API', role: 'manager' };
  const v = cookies(req).dms; if (!v || v.length > 100) return null;
  const { rows } = await pool.query(`SELECT user_id FROM sessions WHERE token=$1 AND expires_at > now()`, [crypto.createHash('sha256').update(v).digest('hex')]);
  if (!rows[0]) return null; const id = rows[0].user_id;
  if (id === 'owner') return { id: 'owner', name: 'Owner', role: 'owner' };
  const r = await getRec(pool, Number(id)); if (!r || r.kind !== 'user' || r.data.active === false) return null;
  return { id: r.id, name: r.data.name, role: r.data.role, store_id: r.data.store_id || null };
}
const tries = new Map();
const limited = ip => { const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 15 * 60e3); tries.set(ip, t); return t.length >= 10; };

// ---------- app ----------
// every route runs through W so a thrown error becomes a clear message instead of a crash
const W = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(400).json({ error: e.message }); });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff').set('Referrer-Policy', 'same-origin'); next(); });
const pub = f => path.join(__dirname, 'public', f);

app.get('/healthz', (req, res) => res.send('ok'));
app.get(['/manifest.webmanifest', '/sw.js', '/offline.html'], (req, res) => {
  if (req.path === '/sw.js') res.set('Cache-Control', 'no-cache');
  res.sendFile(pub(req.path.slice(1)), { headers: req.path.endsWith('webmanifest') ? { 'Content-Type': 'application/manifest+json' } : {} });
});
app.use('/icons', express.static(pub('icons'), { maxAge: '7d' }));

app.get('/login', (req, res) => res.sendFile(pub('login.html')));
// Sign-in = PIN, plus a phone code on a new device and every 30 days.
// The code is sent by a texting service that has not been picked yet (pending). Until one is connected,
// sendCode() reports "not connected" and staff get in with the PIN alone; the app shows a warning to managers.
const CODE_SENDER = null; // pending decision: texting provider
const codeSenderReady = () => !!CODE_SENDER;
async function sendCode(phone, code) { if (!CODE_SENDER) throw new Error('Texting service not connected'); return CODE_SENDER(phone, `Your sign-in code is ${code}`); }
const DEVICE_DAYS = 30;
const tickets = new Map(); // ticket -> { id, code, exp, tries }
// Sessions live on the server (so sign-out and expiry really end them). Length: one 12-hour shift.
const SESSION_HOURS = 12;
async function setSession(req, res, id) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now() + interval '${SESSION_HOURS} hours')`, [crypto.createHash('sha256').update(token).digest('hex'), String(id)]);
  pool.query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
  return [`dms=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`];
}
function trustedDevice(req, id) {
  const v = cookies(req).dmsdev; if (!v) return false;
  const body = v.slice(0, v.lastIndexOf('.')); if (sign(body) !== v) return false;
  const [uid, exp] = body.split('|'); return uid === String(id) && Number(exp) > Date.now();
}
const deviceCookie = (req, id) => `dmsdev=${encodeURIComponent(sign(`${id}|${Date.now() + DEVICE_DAYS * 864e5}|${crypto.randomBytes(6).toString('hex')}`))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_DAYS * 86400}${req.secure ? '; Secure' : ''}`;
async function phoneFor(id) { if (id === 'owner') { const s = (await list(pool, 'settings'))[0]; return s && s.data.owner_phone; } const u = await getRec(pool, Number(id)); return u && u.data.phone; }
app.post('/login', W(async (req, res) => {
  const ip = req.ip; if (limited(ip)) return res.status(429).json({ error: 'Too many tries — wait 15 minutes.' });
  const pin = String(req.body.pin || '').trim();
  let id = null;
  if (OWNER_PIN && pin === OWNER_PIN) id = 'owner';
  else if (pin) { const us = await list(pool, 'user'); const u = us.find(x => x.data.active !== false && x.data.pin_hash === hashPin(pin, x.data.salt || '')); if (u) id = String(u.id); }
  if (!id) { tries.get(ip).push(Date.now()); return res.status(401).json({ error: 'Wrong PIN' }); }
  if (!trustedDevice(req, id) && codeSenderReady()) {
    const phone = await phoneFor(id); if (!phone) return res.status(403).json({ error: 'No phone on file for the sign-in code — ask a manager to add it.' });
    const code = String(crypto.randomInt(100000, 1000000)), ticket = crypto.randomBytes(18).toString('base64url');
    tickets.set(ticket, { id, code, exp: Date.now() + 10 * 60e3, tries: 0 });
    try { await sendCode(phone, code); } catch (e) { return res.status(502).json({ error: 'Could not send the code: ' + e.message }); }
    return res.json({ need_code: true, ticket, to: String(phone).replace(/\d(?=\d{4})/g, '•') });
  }
  res.set('Set-Cookie', await setSession(req, res, id));
  audit(pool, id, 'login', 'user', Number(id) || null, ip + (codeSenderReady() ? '' : ' (phone code pending)'));
  res.json({ ok: true, code_pending: !codeSenderReady() });
}));
app.post('/login/code', W(async (req, res) => {
  const t = tickets.get(String(req.body.ticket || '')); if (!t || t.exp < Date.now()) return res.status(400).json({ error: 'Code expired — sign in again' });
  if (++t.tries > 5) { tickets.delete(req.body.ticket); return res.status(429).json({ error: 'Too many tries — sign in again' }); }
  if (String(req.body.code || '').trim() !== t.code) return res.status(401).json({ error: 'Wrong code' });
  tickets.delete(req.body.ticket);
  res.set('Set-Cookie', [...(await setSession(req, res, t.id)), deviceCookie(req, t.id)]);
  audit(pool, t.id, 'login', 'user', Number(t.id) || null, req.ip + ' with code'); res.json({ ok: true });
}));
app.post('/logout', W(async (req, res) => { const v = cookies(req).dms; if (v) await pool.query(`DELETE FROM sessions WHERE token=$1`, [crypto.createHash('sha256').update(v).digest('hex')]); res.set('Set-Cookie', 'dms=; Path=/; Max-Age=0'); res.json({ ok: true }); }));

// ---------- public: customer pay portal + inspection approval ----------
app.get('/pay', (req, res) => res.sendFile(pub('pay.html')));
app.post('/api/public/account', W(async (req, res) => {
  if (limited('pay:' + req.ip)) return res.status(429).json({ error: 'Too many tries — wait 15 minutes.' });
  const acct = String(req.body.account || '').trim(), last = String(req.body.last || '').trim().toLowerCase();
  const loans = await list(pool, 'loan', `AND data->>'account'=$2`, [acct]);
  const loan = loans[0];
  const cust = loan && await getRec(pool, loan.data.customer_id);
  if (!loan || !cust || String(cust.data.last || '').toLowerCase() !== last) { tries.get('pay:' + req.ip).push(Date.now()); return res.status(404).json({ error: 'No account matches that number and last name.' }); }
  const pays = await list(pool, 'payment', `AND (data->>'loan_id')::bigint=$2`, [loan.id]);
  const st = loanStatus(loan, pays);
  const s = (await list(pool, 'settings'))[0]; const store = loan.store_id && await getRec(pool, loan.store_id);
  res.json({ name: cust.data.first, vehicle: loan.data.vehicle_label, account: acct, payment: loan.data.payment, frequency: loan.data.frequency, ...st,
    history: pays.slice(0, 12).map(p => ({ date: p.data.date, amount: p.data.amount, method: p.data.method })), dealer: (store && store.data.name) || s.data.dealer_name,
    phone: (store && store.data.phone) || s.data.phone, pay_link: s.data.pay_link });
}));
app.get('/approve/:token', (req, res) => res.sendFile(pub('approve.html')));
app.get('/api/public/inspection/:token', W(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM tokens WHERE token=$1 AND kind='ro' AND created_at > now() - interval '7 days'`, [req.params.token]);
  if (!rows[0]) return res.status(404).json({ error: 'This link has expired — ask the service advisor for a new one.' });
  const ro = await getRec(pool, rows[0].ref); const s = (await list(pool, 'settings'))[0];
  if (!ro || ro.data.status === 'closed') return res.status(410).json({ error: 'This repair order is closed.' });
  res.json({ ro: ro.data.number, vehicle: ro.data.vehicle_label, dealer: s.data.dealer_name, items: (ro.data.inspection || []).map((x, i) => ({ i, item: x.item, status: x.status, note: x.note, price: x.price, approved: x.approved })) });
}));
app.post('/api/public/inspection/:token', W(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM tokens WHERE token=$1 AND kind='ro' AND created_at > now() - interval '7 days'`, [req.params.token]);
  if (!rows[0]) return res.status(404).json({ error: 'This link has expired.' });
  await tx(async c => {
    const ro = await getRec(c, rows[0].ref); if (!ro || ro.data.status === 'closed') throw new Error('This repair order is closed.'); const ok = new Set((req.body.approved || []).map(Number));
    (ro.data.inspection || []).forEach((x, i) => { if (x.status !== 'green') { x.approved = ok.has(i); x.decided_at = new Date().toISOString(); } });
    await put(c, 'ro', ro.store_id, ro.data, ro.id); await audit(c, 'customer', 'approve', 'ro', ro.id, [...ok].join(','));
  });
  res.json({ ok: true });
}));

// ---------- everything below needs sign-in ----------
app.use(async (req, res, next) => {
  try {
    req.user = await who(req);
    if (req.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Signed out' });
    return res.redirect('/login');
  } catch (e) { next(e); }
});
app.get('/', (req, res) => res.sendFile(pub('index.html')));
app.get('/app.js', (req, res) => res.sendFile(pub('app.js')));
app.get('/api/me', W(async (req, res) => { const s = (await list(pool, 'settings'))[0]; res.json({ user: req.user, roles: ROLES, write: WRITE, settings: s && s.data, code_sender_ready: codeSenderReady() }); }));

const deny = (res, msg = 'Your role can’t do that') => res.status(403).json({ error: msg });

const READ_KINDS = new Set(['store', 'customer', 'vehicle', 'lead', 'deal', 'loan', 'payment', 'cnote', 'ro', 'part', 'claim', 'product', 'lender', 'account', 'appt', 'settings', 'user']);
app.get('/api/list/:kind', W(async (req, res) => {
  const k = req.params.kind; if (!READ_KINDS.has(k)) return res.status(404).json({ error: 'Unknown list' });
  if (k === 'user' && !['owner', 'manager'].includes(req.user.role)) return deny(res);
  let rows = await list(pool, k);
  if (req.user.store_id && !['store', 'settings', 'account', 'product', 'lender', 'user', 'customer'].includes(k)) rows = rows.filter(r => !r.store_id || Number(r.store_id) === Number(req.user.store_id));
  if (k === 'user') rows = rows.map(r => ({ ...r, data: { ...r.data, pin_hash: undefined, salt: undefined } }));
  res.json(rows);
}));
app.get('/api/rec/:id', W(async (req, res) => { const r = await getRec(pool, req.params.id);
  if (!r || r.kind === 'user' || (req.user.store_id && r.store_id && r.kind !== 'store' && Number(r.store_id) !== Number(req.user.store_id))) return res.status(404).json({ error: 'Not found' }); res.json(r); }));

// generic save for the simple kinds
const SAVE_KINDS = new Set(['store', 'user', 'customer', 'vehicle', 'lead', 'deal', 'ro', 'part', 'product', 'lender', 'account', 'appt', 'settings']);
app.post('/api/save/:kind', W(async (req, res) => {
  const k = req.params.kind, u = req.user; if (!SAVE_KINDS.has(k)) return res.status(404).json({ error: 'Unknown record type' });
  if (['store', 'settings', 'user'].includes(k) ? !['owner', 'manager'].includes(u.role) : !can(u, k)) return deny(res);
  if (k === 'store' && u.role !== 'owner') return deny(res, 'Only the owner can add or change stores');
  const id = req.body.id ? Number(req.body.id) : null, store = req.body.store_id ? Number(req.body.store_id) : null;
  let data = { ...(req.body.data || {}) };
  const out = await tx(async c => {
    const old = id ? await getRec(c, id) : null;
    if (id && (!old || old.kind !== k)) throw new Error('Record not found');
    if (k === 'user') {
      if (!ROLES.includes(data.role)) throw new Error('Pick a role');
      if (data.role === 'owner' && u.role !== 'owner') throw new Error('Only the owner can add owners');
      if (data.pin) { if (!/^\d{4,8}$/.test(data.pin)) throw new Error('PIN must be 4–8 digits'); if (data.pin === OWNER_PIN) throw new Error('Pick a different PIN');
        const others = (await list(c, 'user')).filter(x => x.id !== id);
        if (others.some(x => x.data.pin_hash === hashPin(data.pin, x.data.salt || ''))) throw new Error('That PIN is taken — pick another');
        data.salt = crypto.randomBytes(8).toString('hex'); data.pin_hash = hashPin(data.pin, data.salt); }
      else if (old) { data.salt = old.data.salt; data.pin_hash = old.data.pin_hash; }
      else throw new Error('Give the new user a PIN');
      delete data.pin;
    }
    if (k === 'deal' && old && ['delivered', 'unwound'].includes(old.data.status)) throw new Error('Delivered deals are locked — unwind it to change it');
    if (k === 'deal' && !old) { data.number = 'D' + (await nextNum(c, 'deal', 1001)); data.status = 'pending'; data.created_by = u.name; }
    if (k === 'deal') data.status = old ? old.data.status : 'pending';
    if (k === 'ro' && !old) { data.number = 'RO' + (await nextNum(c, 'ro', 5001)); data.status = data.status || 'open'; data.opened = data.opened || today(); data.advisor = data.advisor || u.name; }
    if (k === 'ro' && old && old.data.status === 'closed') throw new Error('Closed ROs are locked');
    if (k === 'ro') { const OPEN = ['open', 'waiting_approval', 'in_progress', 'waiting_parts', 'ready']; if (!OPEN.includes(data.status)) data.status = old ? old.data.status : 'open'; }
    if (k === 'ro' && old) { data.number = old.data.number; data.closed_entry = old.data.closed_entry; data.opened = old.data.opened;
      // the customer's answers on the approval link always win over whatever the advisor's screen had loaded
      const was = old.data.inspection || [];
      data.inspection = (data.inspection || []).map(x => { const o = was.find(w => w.item === x.item && w.decided_at); return o ? { ...x, approved: o.approved, decided_at: o.decided_at } : { ...x, approved: x.status === 'green' ? undefined : x.approved }; }); }
    if (k === 'part') { if (old) { data.qty = old.data.qty; data.cost = old.data.cost; data.last_received = old.data.last_received; } else { data.qty = 0; if (!data.number) throw new Error('Enter a part #'); } }
    if (k === 'vehicle') {
      const EDITABLE = ['in_stock', 'hold', 'in_transit'];
      if (old && !EDITABLE.includes(old.data.status) && data.status !== old.data.status) throw new Error('This unit is ' + old.data.status + ' — its status changes only through a deal, repo or wholesale');
      if (!EDITABLE.includes(data.status)) data.status = old ? old.data.status : 'in_stock';
      if (!old) { data.stock = data.stock || ('S' + (await nextNum(c, 'stock', 10001))); data.acquired = data.acquired || today(); }
      data.photos = (data.photos || []).filter(p => typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)).slice(0, 12);
      if (data.floorplan_lender) { if (!num(data.floorplan_amount)) throw new Error('Enter the floored amount'); if (num(data.floorplan_amount) > num(data.cost)) throw new Error('Floored amount can’t be more than the vehicle cost'); }
      else data.floorplan_amount = 0;
      for (const f of ['posted_cost', 'posted_floor', 'posted_floor_lender', 'posted_credit']) data[f] = old ? old.data[f] : undefined;
      if (old && ['sold', 'repo', 'wholesaled'].includes(old.data.status) && (num(data.cost) !== num(old.data.posted_cost) || num(data.floorplan_amount) !== num(old.data.posted_floor))) throw new Error('Cost and floorplan are locked once a unit is sold');
      // recon lines carry a stable id; posted amounts come only from what the server already posted
      const oldRecon = (old && old.data.recon) || [];
      data.recon = (data.recon || []).map(x => { const o = x.id && oldRecon.find(r => r.id === x.id); return { item: x.item, vendor: x.vendor, cost: num(x.cost), date: x.date, id: o ? o.id : crypto.randomBytes(5).toString('hex'), posted_amount: o ? num(o.posted_amount != null ? o.posted_amount : (o.posted ? o.cost : 0)) : 0, ...(o && o.from_ro ? { from_ro: o.from_ro } : {}) }; });
      const kept = new Set(data.recon.map(x => x.id));
      data.recon_removed = (old && old.data.recon_removed) || []; // never taken from the client
      for (const o of oldRecon) if (!kept.has(o.id)) { if (o.from_ro) throw new Error('Recon from a repair order can’t be removed here'); data.recon_removed = [...data.recon_removed, { ...o, removed: today() }]; }
    }
    if (k === 'lead' && !old) data.created = today();
    const rec = await put(c, k, store, data, id);
    if (k === 'vehicle') await postVehicleCost(c, rec, u);
    await audit(c, u.name, id ? 'update' : 'create', k, rec.id, JSON.stringify(data).slice(0, 500));
    return rec;
  });
  res.json(out);
}));
// Keep the books in step with a vehicle's cost, floorplan and recon. Each change posts only the difference.
async function postVehicleCost(c, rec, u) {
  const d = rec.data; let changed = false; const memo = `Stock ${d.stock} ${d.year || ''} ${d.make || ''} ${d.model || ''}`;
  const cost = num(d.cost), floor = d.floorplan_lender ? num(d.floorplan_amount) : 0, credit = d.paid_with === 'ap' ? '2000' : '1000';
  const pCost = num(d.posted_cost), pFloor = num(d.posted_floor), pCredit = d.posted_credit || credit;
  if (r2(cost - pCost) || r2(floor - pFloor) || (pCredit !== credit && r2(pCost - pFloor))) {
    // undo what was posted, then post the new split: inventory at cost, floorplan for the floored part, cash/AP for the rest
    const lines = [['1300', cost - pCost, 0], ['2100', 0, floor - pFloor], [pCredit, pCost - pFloor, 0], [credit, 0, cost - floor]];
    await post(c, { date: pCost ? today() : d.acquired, store: rec.store_id, memo: memo + (pCost ? ' cost/floorplan change' : ' purchase'), src: 'vehicle', ref: rec.id, who: u.name, lines });
    d.posted_cost = cost; d.posted_floor = floor; d.posted_credit = credit; d.posted_floor_lender = d.floorplan_lender || ''; changed = true;
  }
  for (const x of d.recon || []) { const diff = r2(num(x.cost) - num(x.posted_amount));
    if (diff) { await post(c, { date: x.date || today(), store: rec.store_id, memo: `Recon ${d.stock}: ${x.item || ''} ${x.vendor || ''}`, src: 'recon', ref: rec.id, who: u.name, lines: [['1300', diff, 0], ['2000', 0, diff]] }); x.posted_amount = num(x.cost); changed = true; } }
  for (const x of d.recon_removed || []) if (num(x.posted_amount)) {
    await post(c, { date: today(), store: rec.store_id, memo: `Recon removed ${d.stock}: ${x.item || ''}`, src: 'recon', ref: rec.id, who: u.name, lines: [['2000', num(x.posted_amount), 0], ['1300', 0, num(x.posted_amount)]] }); x.posted_amount = 0; changed = true; }
  if (changed) await put(c, 'vehicle', rec.store_id, d, rec.id);
}
const vehCostOf = v => r2(num(v.data.posted_cost) + (v.data.recon || []).reduce((s, x) => s + num(x.posted_amount != null ? x.posted_amount : x.cost), 0));
app.post('/api/delete/:id', W(async (req, res) => {
  if (!['owner', 'manager'].includes(req.user.role)) return deny(res);
  await tx(async c => {
    const r = await getRec(c, req.params.id); if (!r) throw new Error('Not found');
    if (['loan', 'payment', 'account', 'settings', 'store'].includes(r.kind)) throw new Error('This kind of record can’t be deleted — it carries accounting history');
    if (r.kind === 'deal' && r.data.status === 'delivered') throw new Error('Unwind the deal instead of deleting it');
    if (r.kind === 'ro' && r.data.status === 'closed') throw new Error('Closed ROs can’t be deleted');
    if (r.kind === 'vehicle' && (num(r.data.posted_cost) || (r.data.recon || []).some(x => num(x.posted_amount)))) throw new Error('This vehicle is on the books — wholesale or sell it instead');
    await c.query(`DELETE FROM rec WHERE id=$1`, [r.id]); await audit(c, req.user.name, 'delete', r.kind, r.id, JSON.stringify(r.data).slice(0, 500));
  });
  res.json({ ok: true });
}));

// ---------- VIN decode (NHTSA, free) ----------
app.get('/api/vin/:vin', W(async (req, res) => {
  const vin = String(req.params.vin).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (vin.length !== 17) return res.status(400).json({ error: 'VIN must be 17 characters' });
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json(); const x = (j.Results || [])[0] || {};
  res.json({ vin, year: x.ModelYear, make: x.Make, model: x.Model, trim: x.Trim || x.Series, body: x.BodyClass, engine: [x.DisplacementL && x.DisplacementL + 'L', x.EngineCylinders && x.EngineCylinders + ' cyl'].filter(Boolean).join(' '), drive: x.DriveType, fuel: x.FuelTypePrimary });
}));

// ---------- deals ----------
async function dealCtx(c, data, storeId) {
  const store = storeId ? (await getRec(c, storeId)) : (await list(c, 'store'))[0];
  const products = (await list(c, 'product')).map(p => ({ id: p.id, ...p.data }));
  const veh = data.vehicle_id ? await getRec(c, data.vehicle_id) : null;
  const vehCost = veh ? vehCostOf(veh) : 0; // what is actually on the books for this unit
  return { store: store && store.data, products, veh, vehCost };
}
app.post('/api/deal/calc', W(async (req, res) => {
  const d = req.body.data || {}; const x = await dealCtx(pool, d, req.body.store_id);
  res.json(calcDeal({ ...d, _veh_cost: x.vehCost }, x.store, x.products));
}));
app.post('/api/deal/:id/deliver', W(async (req, res) => {
  if (!can(req.user, 'deal') || req.user.role === 'sales') return deny(res, 'A manager or finance user delivers deals');
  const out = await tx(async c => {
    const deal = await getRec(c, req.params.id); if (!deal || deal.kind !== 'deal') throw new Error('Deal not found');
    const d = deal.data; if (d.status !== 'pending') throw new Error('Deal is already ' + d.status);
    if (!d.customer_id || !d.vehicle_id) throw new Error('Pick a customer and a vehicle first');
    const x = await dealCtx(c, d, deal.store_id); const k = calcDeal({ ...d, _veh_cost: x.vehCost }, x.store, x.products);
    const veh = x.veh; if (!veh || veh.kind !== 'vehicle' || !['in_stock', 'hold'].includes(veh.data.status)) throw new Error('That vehicle is not available to sell (it must be in stock or on hold)');
    if (deal.store_id && veh.store_id && Number(deal.store_id) !== Number(veh.store_id)) throw new Error('That vehicle belongs to another store — move it first');
    if (k.missing.length) throw new Error('Before delivering, fill in: ' + k.missing.join(', '));
    if (!k.price) throw new Error('Enter the selling price');
    if (d.type !== 'cash' && k.financed <= 0) throw new Error('Nothing is being financed — make it a cash deal');
    if (d.type === 'bhph' && !['fees_first', 'fees_last'].includes(x.store && x.store.pay_order)) throw new Error('Set the payment order for this store first (Settings → Stores)');
    const cust = await getRec(c, d.customer_id); const label = [veh.data.year, veh.data.make, veh.data.model].filter(Boolean).join(' ');
    const date = d.sale_date || today(), S = deal.store_id, who = req.user.name;
    const acv = k.acv; // trade goes on the books at actual cash value; over-allowance comes off the sale
    const finAcct = d.type === 'bhph' ? '1200' : '1100';
    await post(c, { date, store: S, memo: `Deal ${d.number} ${cust.data.first} ${cust.data.last} — ${label}`, src: 'deal', ref: deal.id, who, lines: [
      ['1000', k.cashDue, 0], [finAcct, k.financed, 0], ['1300', acv, 0], ['4000', r2(k.allow - acv), 0],
      ['4000', 0, k.price], ['4100', 0, k.doc], ['2210', 0, k.fees], ['2200', 0, k.tax], ['4200', 0, k.prodPrice], ['2220', 0, k.payoff]] });
    await post(c, { date, store: S, memo: `Deal ${d.number} cost of sale`, src: 'deal', ref: deal.id, who, lines: [['5000', x.vehCost, 0], ['1300', 0, x.vehCost], ['5200', k.prodCost, 0], ['2230', 0, k.prodCost]] });
    if (k.reserve) await post(c, { date, store: S, memo: `Deal ${d.number} finance reserve`, src: 'deal', ref: deal.id, who, lines: [['1100', k.reserve, 0], ['4210', 0, k.reserve]] });
    if (num(veh.data.posted_floor)) {
      const fp = num(veh.data.posted_floor), int = r2(fp * num(veh.data.floorplan_rate) / 100 / 365 * Math.max(0, daysBetween(veh.data.acquired || date, date)));
      await post(c, { date, store: S, memo: `Floorplan payoff ${veh.data.stock} (${veh.data.floorplan_lender})`, src: 'floorplan', ref: deal.id, who, lines: [['2100', fp, 0], ['6000', int, 0], ['1000', 0, r2(fp + int)]] });
    }
    veh.data.status = 'sold'; veh.data.sold_date = date; veh.data.deal_id = deal.id; await put(c, 'vehicle', veh.store_id, veh.data, veh.id);
    if (d.trade && num(d.trade.allowance)) {
      const tv = await put(c, 'vehicle', S, { vin: d.trade.vin, year: d.trade.year, make: d.trade.make, model: d.trade.model, miles: d.trade.miles, cond: 'used', cost: acv, posted_cost: acv, posted_floor: 0, posted_credit: '1000', paid_with: 'cash', stock: 'T' + (await nextNum(c, 'stock', 10001)), status: 'in_stock', acquired: date, source: 'Trade-in on ' + d.number, recon: [] });
      d.trade_vehicle_id = tv.id;
    }
    let loan = null;
    if (d.type === 'bhph') {
      const acct = String(await nextNum(c, 'loan', 200001));
      loan = await put(c, 'loan', S, { account: acct, deal_id: deal.id, customer_id: d.customer_id, vehicle_id: veh.id, vehicle_label: label + (veh.data.vin ? ' ' + veh.data.vin.slice(-6) : ''),
        customer_label: `${cust.data.first} ${cust.data.last}`, principal: k.financed, apr: k.apr, term: k.n, frequency: k.freq, payment: k.payment, first_due: d.first_due, start_date: date, method: d.interest_method,
        status: 'active', fees_assessed: 0, gps: d.gps || null, collector: d.collector || '' });
    }
    d.status = 'delivered'; d.delivered = date; d.calc = k; d.loan_id = loan && loan.id; d.funding = d.type === 'outside' ? (d.funding || 'pending') : null;
    await put(c, 'deal', S, d, deal.id); await audit(c, who, 'deliver', 'deal', deal.id, d.number);
    return { deal: d, loan };
  });
  res.json(out);
}));
app.post('/api/deal/:id/fund', W(async (req, res) => {
  if (!can(req.user, 'deal') || req.user.role === 'sales') return deny(res);
  const out = await tx(async c => {
    const deal = await need(c, req.params.id, 'deal', req.user); const d = deal.data;
    if (d.type !== 'outside' || d.status !== 'delivered' || d.funding === 'funded') throw new Error('Nothing to fund on this deal');
    const amt = r2(num(d.calc.financed) + num(d.calc.reserve));
    await post(c, { date: req.body.date || today(), store: deal.store_id, memo: `Funding ${d.number} from ${d.lender || 'lender'}`, src: 'funding', ref: deal.id, who: req.user.name, lines: [['1000', amt, 0], ['1100', 0, amt]] });
    d.funding = 'funded'; d.funded_date = req.body.date || today(); await put(c, 'deal', deal.store_id, d, deal.id); return d;
  });
  res.json(out);
}));
app.post('/api/deal/:id/unwind', W(async (req, res) => {
  if (!['owner', 'manager'].includes(req.user.role)) return deny(res, 'A manager unwinds deals');
  const out = await tx(async c => {
    const deal = await need(c, req.params.id, 'deal', req.user); const d = deal.data; if (d.status !== 'delivered') throw new Error('Only delivered deals can be unwound');
    if (d.loan_id) { const pays = await list(c, 'payment', `AND (data->>'loan_id')::bigint=$2`, [d.loan_id]); if (pays.length) throw new Error('This account has payments — handle it as a repo or payoff instead');
      const ln = await getRec(c, d.loan_id); if (ln.data.status !== 'active' || ln.data.repo) throw new Error('This account is ' + ln.data.status + (ln.data.repo ? ' with repo activity' : '') + ' — it can’t be unwound'); }
    if (d.trade_vehicle_id) { const tv = await getRec(c, d.trade_vehicle_id);
      if (tv && (tv.data.status !== 'in_stock' || (tv.data.recon || []).some(x => num(x.posted_amount)) || num(tv.data.posted_cost) !== num(d.calc && d.calc.acv))) throw new Error('The trade-in from this deal has been sold, reconditioned or re-costed — undo that first'); }
    const { rows } = await c.query(`SELECT acct, sum(debit) d, sum(credit) k FROM jrnl WHERE ref=$1 AND src IN ('deal','floorplan','funding') GROUP BY acct`, [deal.id]);
    const lines = rows.map(r => [r.acct, num(r.k), num(r.d)]); // reverse exactly what this deal posted (floorplan payoff included)
    await post(c, { date: today(), store: deal.store_id, memo: `Unwind ${d.number}`, src: 'unwind', ref: deal.id, who: req.user.name, lines });
    const veh = await getRec(c, d.vehicle_id); veh.data.status = 'in_stock'; delete veh.data.sold_date; delete veh.data.deal_id;
    await put(c, 'vehicle', veh.store_id, veh.data, veh.id);
    if (d.trade_vehicle_id) await c.query('DELETE FROM rec WHERE id=$1', [d.trade_vehicle_id]);
    if (d.loan_id) { const loan = await getRec(c, d.loan_id); loan.data.status = 'unwound'; await put(c, 'loan', loan.store_id, loan.data, loan.id); }
    d.status = 'unwound'; d.unwound = today(); await put(c, 'deal', deal.store_id, d, deal.id); await audit(c, req.user.name, 'unwind', 'deal', deal.id, d.number); return d;
  });
  res.json(out);
}));

// Wholesale (or otherwise dispose of) a unit: cash in, unit off the books at what it carries, difference to vehicle gross.
app.post('/api/vehicle/:id/wholesale', W(async (req, res) => {
  if (!['owner', 'manager', 'accounting'].includes(req.user.role)) return deny(res, 'A manager wholesales units');
  const out = await tx(async c => {
    const v = await need(c, req.params.id, 'vehicle', req.user); const d = v.data;
    if (!['in_stock', 'hold', 'in_transit'].includes(d.status)) throw new Error('Only units in inventory can be wholesaled');
    if (req.body.amount === '' || req.body.amount == null || num(req.body.amount) < 0) throw new Error('Enter the wholesale price');
    const amt = r2(req.body.amount), cost = vehCostOf(v), date = req.body.date || today(), who = req.user.name;
    await post(c, { date, store: v.store_id, memo: `Wholesale ${d.stock} to ${req.body.buyer || 'buyer'}`, src: 'wholesale', ref: v.id, who, lines: [['1000', amt, 0], ['4000', 0, amt], ['5000', cost, 0], ['1300', 0, cost]] });
    if (num(d.posted_floor)) { const fp = num(d.posted_floor), int = r2(fp * num(d.floorplan_rate) / 100 / 365 * Math.max(0, daysBetween(d.acquired || date, date)));
      await post(c, { date, store: v.store_id, memo: `Floorplan payoff ${d.stock} (${d.floorplan_lender})`, src: 'floorplan', ref: v.id, who, lines: [['2100', fp, 0], ['6000', int, 0], ['1000', 0, r2(fp + int)]] }); }
    d.status = 'wholesaled'; d.wholesale = { date, amount: amt, buyer: req.body.buyer || '', by: who }; await put(c, 'vehicle', v.store_id, d, v.id);
    await audit(c, who, 'wholesale', 'vehicle', v.id, amt); return v;
  });
  res.json(out);
}));

// ---------- loans / payments / collections ----------
async function loanFull(c, loan) { const pays = await list(c, 'payment', `AND (data->>'loan_id')::bigint=$2`, [loan.id]); return { ...loan, status: loanStatus(loan, pays), payments: pays }; }
app.get('/api/loans', W(async (req, res) => {
  const loans = await list(pool, 'loan'); const pays = await list(pool, 'payment'); const by = {};
  for (const p of pays) (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p);
  res.json(loans.filter(l => !req.user.store_id || Number(l.store_id) === Number(req.user.store_id)).map(l => ({ ...l, status: loanStatus(l, by[l.id] || []) })));
}));
app.get('/api/loan/:id', W(async (req, res) => {
  const l = await need(pool, req.params.id, 'loan', req.user);
  const full = await loanFull(pool, l); const notes = await list(pool, 'cnote', `AND (data->>'loan_id')::bigint=$2`, [l.id]);
  const sched = buildSchedule(l.data);
  res.json({ ...full, notes, schedule: sched });
}));
app.get('/api/loan/:id/payoff', W(async (req, res) => {
  const loan = await need(pool, req.params.id, 'loan', req.user);
  const date = req.query.date || today(); const pays = await list(pool, 'payment', `AND (data->>'loan_id')::bigint=$2`, [loan.id]);
  const st = loanStatus(loan, pays, date); res.json({ date, payoff: st.payoff, balance: st.balance, interest: st.accrued, fees: st.feesOwed });
}));
app.post('/api/loan/:id/pay', W(async (req, res) => {
  if (!can(req.user, 'payment')) return deny(res);
  const out = await tx(async c => {
    const loan = await need(c, req.params.id, 'loan', req.user); if (!loan || loan.data.status !== 'active') throw new Error('Account is not active');
    const amt = r2(req.body.amount), date = req.body.date || today(), method = req.body.method || 'cash';
    if (amt <= 0) throw new Error('Enter an amount');
    if (date > today()) throw new Error('Payment date can’t be in the future');
    const pays = await list(c, 'payment', `AND (data->>'loan_id')::bigint=$2`, [loan.id]);
    const lastDate = pays.length ? pays.map(p => p.data.date).sort().pop() : loan.data.start_date;
    if (date < lastDate) throw new Error('Payment date is before the last payment (' + lastDate + ')');
    const store = loan.store_id ? await getRec(c, loan.store_id) : null; const order = store && store.data.pay_order;
    if (!['fees_first', 'fees_last'].includes(order)) throw new Error('Set the payment order for this store first (Settings → Stores)');
    const a = allocate(loan, pays, amt, date, order); const { fees, interest, principal } = a; const st = a.st;
    if (a.left > 0.004) throw new Error(`That’s more than the payoff (${a.payoffTotal})`);
    const receipt = 'R' + (await nextNum(c, 'receipt', 100001));
    const p = await put(c, 'payment', loan.store_id, { loan_id: loan.id, account: loan.data.account, customer_label: loan.data.customer_label, date, amount: amt, method, fees, interest, principal, receipt, cashier: req.user.name, ref: req.body.ref || '' });
    await post(c, { date, store: loan.store_id, memo: `Payment ${receipt} acct ${loan.data.account} ${loan.data.customer_label}`, src: 'payment', ref: p.id, who: req.user.name, lines: [['1000', amt, 0], ['1200', 0, principal], ['4300', 0, interest], ['4310', 0, fees]] });
    if (r2(st.balance - principal) <= 0 && r2(st.feesOwed - fees) <= 0) { loan.data.status = 'paid'; loan.data.paid_off = date; await put(c, 'loan', loan.store_id, loan.data, loan.id); }
    // a kept promise
    const notes = await list(c, 'cnote', `AND (data->>'loan_id')::bigint=$2 AND data->>'type'='promise' AND coalesce(data->>'kept','')=''`, [loan.id]);
    for (const n of notes) { n.data.kept = num(n.data.promise_amount) <= amt + 0.01 ? 'yes' : 'partial'; await put(c, 'cnote', n.store_id, n.data, n.id); }
    await audit(c, req.user.name, 'payment', 'loan', loan.id, `${receipt} ${amt} ${method}`);
    return p;
  });
  res.json(out);
}));
app.post('/api/loan/:id/fee', W(async (req, res) => {
  if (!can(req.user, 'loan')) return deny(res);
  const out = await tx(async c => { const loan = await need(c, req.params.id, 'loan', req.user); const amt = r2(req.body.amount); if (amt <= 0) throw new Error('Enter a fee amount');
    loan.data.fees_assessed = r2(num(loan.data.fees_assessed) + amt); (loan.data.fee_log = loan.data.fee_log || []).push({ date: today(), amount: amt, reason: req.body.reason || 'Late fee', by: req.user.name });
    await put(c, 'loan', loan.store_id, loan.data, loan.id); await audit(c, req.user.name, 'fee', 'loan', loan.id, amt); return loan; });
  res.json(out);
}));
app.post('/api/loan/:id/update', W(async (req, res) => {
  if (!can(req.user, 'loan')) return deny(res);
  const out = await tx(async c => { const loan = await need(c, req.params.id, 'loan', req.user); const b = req.body;
    for (const k of ['collector', 'gps', 'cpi', 'notes']) if (k in b) loan.data[k] = b[k];
    if (b.first_due && ['owner', 'manager'].includes(req.user.role)) { (loan.data.deferments = loan.data.deferments || []).push({ date: today(), from: loan.data.first_due, to: b.first_due, by: req.user.name }); loan.data.first_due = b.first_due; }
    await put(c, 'loan', loan.store_id, loan.data, loan.id); await audit(c, req.user.name, 'update', 'loan', loan.id, JSON.stringify(b).slice(0, 300)); return loan; });
  res.json(out);
}));
app.post('/api/loan/:id/gps', W(async (req, res) => {
  const act = req.body.action; if (!['locate', 'tone', 'disable', 'enable'].includes(act)) return res.status(400).json({ error: 'Unknown action' });
  if (!can(req.user, 'loan')) return deny(res);
  if (['disable', 'enable'].includes(act) && !['owner', 'manager'].includes(req.user.role)) return deny(res, 'A manager approves starter disable / enable');
  const out = await tx(async c => { const loan = await need(c, req.params.id, 'loan', req.user); (loan.data.gps_log = loan.data.gps_log || []).push({ at: new Date().toISOString(), action: act, by: req.user.name, reason: req.body.reason || '', sent: false });
    await put(c, 'loan', loan.store_id, loan.data, loan.id); await audit(c, req.user.name, 'gps:' + act, 'loan', loan.id, req.body.reason); return loan; });
  res.json({ ...out, note: 'Logged. Sending it to the device needs your GPS provider connected in Settings → Integrations.' });
}));
app.post('/api/loan/:id/note', W(async (req, res) => {
  if (!can(req.user, 'cnote')) return deny(res);
  const l = await need(pool, req.params.id, 'loan', req.user); const b = req.body;
  if (!['call', 'text', 'visit', 'promise', 'note', 'letter'].includes(b.type)) throw new Error('Pick a note type');
  if (b.type === 'promise' && (!b.promise_date || !num(b.promise_amount))) throw new Error('A promise needs a date and an amount');
  const n = await put(pool, 'cnote', l.store_id, { loan_id: l.id, account: l.data.account, type: b.type, result: b.result || '', note: b.note || '', promise_date: b.promise_date || null, promise_amount: num(b.promise_amount) || null, by: req.user.name, at: new Date().toISOString() });
  res.json(n);
}));
app.post('/api/loan/:id/repo', W(async (req, res) => {
  if (!['owner', 'manager', 'finance', 'collector'].includes(req.user.role)) return deny(res);
  const b = req.body; const steps = ['assigned', 'recovered', 'notice_sent', 'redeemed', 'sold', 'charged_off'];
  if (!steps.includes(b.step)) return res.status(400).json({ error: 'Unknown repo step' });
  if (['sold', 'charged_off', 'redeemed', 'recovered'].includes(b.step) && !['owner', 'manager'].includes(req.user.role)) return deny(res, 'A manager records this step');
  const out = await tx(async c => {
    const loan = await need(c, req.params.id, 'loan', req.user); const L = loan.data; const full = await loanFull(c, loan); const bal = full.status.balance; const date = b.date || today(), who = req.user.name;
    const need2 = { assigned: ['active'], recovered: ['active'], notice_sent: ['repo'], redeemed: ['repo'], sold: ['repo'], charged_off: ['active'] }[b.step];
    if (!need2.includes(L.status)) throw new Error(`Can’t record "${b.step}" — the account is ${L.status}`);
    if (['recovered', 'redeemed', 'sold'].includes(b.step) && (b.amount === '' || b.amount == null || num(b.amount) < 0)) throw new Error('Enter the amount for this step');
    L.repo = L.repo || { steps: [] }; L.repo.steps.push({ step: b.step, date, by: who, agent: b.agent || '', cost: num(b.cost), amount: num(b.amount), note: b.note || '' });
    if (b.agent) L.repo.agent = b.agent;
    if (num(b.cost)) { L.repo.costs = r2(num(L.repo.costs) + num(b.cost)); await post(c, { date, store: loan.store_id, memo: `Repo cost acct ${L.account}`, src: 'repo', ref: loan.id, who, lines: [['6200', num(b.cost), 0], ['2000', 0, num(b.cost)]] }); }
    if (b.step === 'recovered') { const value = Math.min(r2(b.amount), bal); L.status = 'repo'; L.repo.value = value; /* never carried above the balance */ L.repo.balance_at_repo = bal;
      await post(c, { date, store: loan.store_id, memo: `Repossession acct ${L.account}`, src: 'repo', ref: loan.id, who, lines: [['1310', value, 0], ['6100', r2(bal - value), 0], ['1200', 0, bal]] });
      const veh = await getRec(c, L.vehicle_id); if (veh) { veh.data.status = 'repo'; await put(c, 'vehicle', veh.store_id, veh.data, veh.id); } }
    if (b.step === 'redeemed') { if (L.status !== 'repo') throw new Error('Not in repo'); const v = num(L.repo.value);
      await post(c, { date, store: loan.store_id, memo: `Redeemed acct ${L.account}`, src: 'repo', ref: loan.id, who, lines: [['1000', num(b.amount), 0], ['1310', 0, v], ['6100', 0, r2(num(b.amount) - v)]] });
      L.status = 'paid'; const veh = await getRec(c, L.vehicle_id); if (veh) { veh.data.status = 'sold'; await put(c, 'vehicle', veh.store_id, veh.data, veh.id); } }
    if (b.step === 'sold') { if (L.status !== 'repo') throw new Error('Not in repo'); const v = num(L.repo.value), sale = num(b.amount);
      await post(c, { date, store: loan.store_id, memo: `Repo sold acct ${L.account}`, src: 'repo', ref: loan.id, who, lines: [['1000', sale, 0], ['1310', 0, v], ['6100', r2(v - sale), 0]] }); // gain over carrying value reduces bad debt
      L.repo.sale = sale; L.repo.deficiency = r2(num(L.repo.balance_at_repo) + num(L.repo.costs) - sale); L.status = 'closed_repo';
      const veh = await getRec(c, L.vehicle_id); if (veh) { veh.data.status = 'wholesaled'; await put(c, 'vehicle', veh.store_id, veh.data, veh.id); } }
    if (b.step === 'charged_off') { if (L.status !== 'active') throw new Error('Only active accounts charge off this way');
      await post(c, { date, store: loan.store_id, memo: `Charge-off acct ${L.account}`, src: 'chargeoff', ref: loan.id, who, lines: [['6100', bal, 0], ['1200', 0, bal]] }); L.status = 'charged_off'; }
    await put(c, 'loan', loan.store_id, L, loan.id); await audit(c, who, 'repo:' + b.step, 'loan', loan.id, b.note); return L;
  });
  res.json(out);
}));

// ---------- service: repair orders ----------
function roTotals(ro, partsById) {
  let labor = { customer: 0, warranty: 0, internal: 0 }, parts = { customer: 0, warranty: 0, internal: 0 }, pcost = 0, flagged = 0, actual = 0;
  for (const l of ro.lines || []) {
    const pay = l.pay_type || 'customer', lab = r2(num(l.hours) * num(l.rate));
    labor[pay] = r2(labor[pay] + lab); flagged += num(l.hours); actual += num(l.actual_hours);
    for (const p of l.parts || []) { parts[pay] = r2(parts[pay] + num(p.qty) * num(p.price)); pcost = r2(pcost + num(p.qty) * num(p.cost != null ? p.cost : (partsById[p.part_id] || {}).cost)); }
  }
  for (const x of ro.inspection || []) if (x.approved && num(x.price)) labor.customer = r2(labor.customer + num(x.price));
  const supplies = r2(num(ro.shop_supplies)), taxRate = num(ro.tax_rate), tax = r2(parts.customer * taxRate / 100);
  return { labor, parts, pcost, supplies, tax, customer: r2(labor.customer + parts.customer + supplies + tax), warranty: r2(labor.warranty + parts.warranty), internal: r2(labor.internal + parts.internal), flagged: r2(flagged), actual: r2(actual) };
}
app.post('/api/ro/totals', W(async (req, res) => { const parts = {}; (await list(pool, 'part')).forEach(p => parts[p.id] = p.data); res.json(roTotals(req.body.data || {}, parts)); }));
app.post('/api/ro/:id/link', W(async (req, res) => {
  if (!can(req.user, 'ro')) return deny(res);
  const ro = await need(pool, req.params.id, 'ro', req.user); const token = crypto.randomBytes(18).toString('base64url');
  await pool.query(`INSERT INTO tokens(token,kind,ref) VALUES($1,'ro',$2)`, [token, ro.id]);
  const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host; res.json({ url: base + '/approve/' + token });
}));
app.post('/api/ro/:id/close', W(async (req, res) => {
  if (!can(req.user, 'ro')) return deny(res);
  const out = await tx(async c => {
    const ro = await need(c, req.params.id, 'ro', req.user); const d = ro.data; if (d.status === 'closed') throw new Error('Already closed');
    if ((d.lines || []).some(l => num(l.hours) && !num(l.rate))) throw new Error('Every labor line with hours needs a labor rate');
    if ((d.lines || []).some(l => (l.parts || []).length && (l.pay_type || 'customer') === 'customer') && (d.tax_rate == null || d.tax_rate === '')) throw new Error('Enter the parts tax rate (0 if none)');
    const partsRecs = await list(c, 'part'); const pById = {}; partsRecs.forEach(p => pById[p.id] = p);
    const pd = {}; partsRecs.forEach(p => pd[p.id] = p.data); const t = roTotals(d, pd);
    for (const l of d.lines || []) for (const p of l.parts || []) if (p.part_id && pById[p.part_id]) { const pr = pById[p.part_id]; pr.data.qty = r2(num(pr.data.qty) - num(p.qty)); if (p.cost == null) p.cost = num(pr.data.cost); await put(c, 'part', pr.store_id, pr.data, pr.id); }
    if (d.stock_vehicle_id) { const sv = await getRec(c, d.stock_vehicle_id); if (!sv || sv.kind !== 'vehicle' || !['in_stock', 'hold', 'in_transit'].includes(sv.data.status)) throw new Error('The stock unit on this RO is no longer in inventory — clear it or pick another'); }
    if (t.internal && !d.stock_vehicle_id && !['owner', 'manager'].includes(req.user.role)) throw new Error('Internal work not tied to a stock unit needs a manager to close');
    const date = req.body.date || today(), who = req.user.name, payAcct = req.body.paid ? '1000' : '1220';
    const intTotal = t.internal;
    const entry = await post(c, { date, store: ro.store_id, memo: `${d.number} ${d.customer_label || ''} ${d.vehicle_label || ''}`, src: 'ro', ref: ro.id, who, lines: [
      [payAcct, t.customer, 0], ['1210', t.warranty, 0], ['1300', d.stock_vehicle_id ? intTotal : 0, 0], ['6900', d.stock_vehicle_id ? 0 : intTotal, 0],
      ['4400', 0, r2(t.labor.customer + t.labor.warranty + t.supplies)], ['4410', 0, r2(t.parts.customer + t.parts.warranty)], ['4420', 0, intTotal], ['2200', 0, t.tax],
      ['5400', t.pcost, 0], ['1400', 0, t.pcost]] });
    if (d.stock_vehicle_id && intTotal) { const v = await getRec(c, d.stock_vehicle_id); if (v) { (v.data.recon = v.data.recon || []).push({ id: crypto.randomBytes(5).toString('hex'), item: d.number + ' internal', vendor: 'Service', cost: intTotal, posted_amount: intTotal, from_ro: ro.id, date }); await put(c, 'vehicle', v.store_id, v.data, v.id); } }
    for (const l of d.lines || []) if (l.pay_type === 'warranty') {
      const amt = r2(num(l.hours) * num(l.rate) + (l.parts || []).reduce((s, p) => s + num(p.qty) * num(p.price), 0));
      await put(c, 'claim', ro.store_id, { ro_id: ro.id, ro: d.number, vin: d.vin, line: l.desc, op: l.op, oem: d.oem || req.body.oem || '', amount: amt, status: 'to_submit', opened: date, customer_label: d.customer_label });
    }
    d.status = 'closed'; d.closed = date; d.totals = t; d.closed_entry = entry; d.paid = !!req.body.paid; await put(c, 'ro', ro.store_id, d, ro.id);
    await audit(c, who, 'close', 'ro', ro.id, d.number); return d;
  });
  res.json(out);
}));
app.post('/api/ro/:id/collect', W(async (req, res) => {
  if (!can(req.user, 'ro') && !can(req.user, 'payment')) return deny(res);
  const out = await tx(async c => { const ro = await need(c, req.params.id, 'ro', req.user); const d = ro.data; if (d.status !== 'closed' || d.paid) throw new Error('Nothing owed on this RO');
    await post(c, { date: today(), store: ro.store_id, memo: `Paid ${d.number}`, src: 'ro_pay', ref: ro.id, who: req.user.name, lines: [['1000', d.totals.customer, 0], ['1220', 0, d.totals.customer]] });
    d.paid = true; d.paid_date = today(); await put(c, 'ro', ro.store_id, d, ro.id); return d; });
  res.json(out);
}));
app.post('/api/claim/:id', W(async (req, res) => {
  if (!can(req.user, 'claim')) return deny(res);
  const out = await tx(async c => { const cl = await need(c, req.params.id, 'claim', req.user); const d = cl.data; const st = req.body.status;
    if (!['to_submit', 'submitted', 'paid', 'rejected'].includes(st)) throw new Error('Unknown status');
    if (['paid', 'rejected'].includes(d.status)) throw new Error('Claim is already ' + d.status);
    if (st === 'submitted') { d.claim_no = req.body.claim_no || d.claim_no; d.submitted = today(); }
    if (st === 'paid' || st === 'rejected') { const paid = st === 'paid' ? r2(req.body.paid_amount != null ? req.body.paid_amount : d.amount) : 0, short = r2(num(d.amount) - paid);
      await post(c, { date: today(), store: cl.store_id, memo: `Warranty ${d.claim_no || ''} ${d.ro} ${st}`, src: 'claim', ref: cl.id, who: req.user.name, lines: [['1000', paid, 0], ['6300', short, 0], ['1210', 0, num(d.amount)]] });
      d.paid_amount = paid; d.chargeback = short; d.closed = today(); }
    d.status = st; d.note = req.body.note || d.note; await put(c, 'claim', cl.store_id, d, cl.id); return d; });
  res.json(out);
}));
app.post('/api/part/:id/receive', W(async (req, res) => {
  if (!can(req.user, 'part')) return deny(res);
  const adjust = req.body.mode === 'adjust';
  const out = await tx(async c => { const p = await need(c, req.params.id, 'part', req.user); const qty = num(req.body.qty), cost = adjust ? num(p.data.cost) : num(req.body.cost);
    if (!qty) throw new Error('Enter a quantity');
    if (!adjust && qty < 0) throw new Error('Use Count adjustment to remove stock');
    if (!adjust && !(cost >= 0) ) throw new Error('Enter the cost');
    if (adjust) await post(c, { date: today(), store: p.store_id, memo: `Parts count adjust ${p.data.number} ${qty > 0 ? '+' : ''}${qty}`, src: 'parts', ref: p.id, who: req.user.name, lines: [['1400', r2(qty * cost), 0], ['5400', 0, r2(qty * cost)]] });
    else await post(c, { date: today(), store: p.store_id, memo: `Parts received ${p.data.number} x${qty}`, src: 'parts', ref: p.id, who: req.user.name, lines: [['1400', r2(qty * cost), 0], ['2000', 0, r2(qty * cost)]] });
    if (!adjust) { const oldQ = Math.max(0, num(p.data.qty)); p.data.cost = r2((oldQ * num(p.data.cost) + qty * cost) / (oldQ + qty)); }
    p.data.qty = r2(num(p.data.qty) + qty); p.data.last_received = qty > 0 ? today() : p.data.last_received; await put(c, 'part', p.store_id, p.data, p.id); return p; });
  res.json(out);
}));
app.post('/api/parts/counter', W(async (req, res) => {
  if (!can(req.user, 'part')) return deny(res);
  const out = await tx(async c => { let sale = 0, cost = 0; const lines = req.body.lines || [];
    if (!lines.length) throw new Error('Add parts');
    for (const l of lines) { const p = await getRec(c, l.part_id); if (!p) throw new Error('Part not found'); sale = r2(sale + num(l.qty) * num(l.price != null ? l.price : p.data.price)); cost = r2(cost + num(l.qty) * num(p.data.cost)); p.data.qty = r2(num(p.data.qty) - num(l.qty)); await put(c, 'part', p.store_id, p.data, p.id); }
    const tax = r2(sale * num(req.body.tax_rate) / 100), inv = 'P' + (await nextNum(c, 'pinv', 30001));
    await post(c, { date: today(), store: req.body.store_id || null, memo: `Counter ticket ${inv} ${req.body.customer || ''}`, src: 'parts', who: req.user.name, lines: [['1000', r2(sale + tax), 0], ['4410', 0, sale], ['2200', 0, tax], ['5400', cost, 0], ['1400', 0, cost]] });
    return { invoice: inv, sale, tax, total: r2(sale + tax) }; });
  res.json(out);
}));

// ---------- accounting ----------
app.get('/api/journal', W(async (req, res) => {
  if (!['owner', 'manager', 'accounting'].includes(req.user.role)) return deny(res); if (req.user.store_id) req.query.store = String(req.user.store_id);
  const { from = '1900-01-01', to = '2999-12-31', store } = req.query;
  const { rows } = await pool.query(`SELECT * FROM jrnl WHERE date BETWEEN $1 AND $2 ${store ? 'AND store_id=$3' : ''} ORDER BY id DESC LIMIT 3000`, store ? [from, to, store] : [from, to]);
  res.json(rows);
}));
app.post('/api/journal', W(async (req, res) => {
  if (!can(req.user, 'journal')) return deny(res);
  const lines = (req.body.lines || []).map(l => [String(l.acct), num(l.debit), num(l.credit)]);
  const accts = new Set((await list(pool, 'account')).map(a => a.data.no)); if (lines.some(l => !accts.has(l[0]))) throw new Error('Unknown account number');
  const e = await tx(c => post(c, { date: req.body.date || today(), store: req.body.store_id || null, memo: req.body.memo || 'Manual entry', src: 'manual', who: req.user.name, lines }));
  res.json({ entry: e });
}));
app.get('/api/trial', W(async (req, res) => {
  if (!['owner', 'manager', 'accounting'].includes(req.user.role)) return deny(res); if (req.user.store_id) req.query.store = String(req.user.store_id);
  const { from = '1900-01-01', to = '2999-12-31', store } = req.query;
  const { rows } = await pool.query(`SELECT acct, sum(debit)::float d, sum(credit)::float k FROM jrnl WHERE date BETWEEN $1 AND $2 ${store ? 'AND store_id=$3' : ''} GROUP BY acct ORDER BY acct`, store ? [from, to, store] : [from, to]);
  const accts = {}; (await list(pool, 'account')).forEach(a => accts[a.data.no] = a.data);
  res.json(rows.map(r => ({ ...r, ...(accts[r.acct] || { name: '?' }), bal: r2(r.d - r.k) })));
}));

// ---------- dashboard / reports ----------
app.get('/api/dashboard', W(async (req, res) => {
  const t = today(), m = t.slice(0, 8) + '01', store = req.user.store_id ? Number(req.user.store_id) : req.query.store ? Number(req.query.store) : null;
  const inStore = r => !store || r.store_id === store;
  const [vehs, deals, loans, pays, ros, claims, leads, stores] = await Promise.all(['vehicle', 'deal', 'loan', 'payment', 'ro', 'claim', 'lead', 'store'].map(k => list(pool, k)));
  const by = {}; pays.forEach(p => (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p));
  const out = { stores: [] };
  const calc = sid => {
    const f = r => !sid || r.store_id === sid;
    const inv = vehs.filter(v => f(v) && v.data.status === 'in_stock');
    const age = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    inv.forEach(v => { const a = daysBetween(v.data.acquired || t, t); age[a <= 30 ? '0-30' : a <= 60 ? '31-60' : a <= 90 ? '61-90' : '90+']++; });
    const mtd = deals.filter(d => f(d) && d.data.status === 'delivered' && (d.data.delivered || '') >= m);
    const act = loans.filter(l => f(l) && l.data.status === 'active').map(l => ({ l, s: loanStatus(l, by[l.id] || []) }));
    const recv = r2(act.reduce((s, x) => s + x.s.balance, 0)), late = act.filter(x => x.s.daysLate > 0);
    const buckets = {}; act.forEach(x => buckets[x.s.bucket] = (buckets[x.s.bucket] || 0) + 1);
    const payToday = pays.filter(p => f(p) && p.data.date === t), payMtd = pays.filter(p => f(p) && p.data.date >= m);
    const dueToday = act.filter(x => x.s.nextDue === t).length;
    return {
      inventory: inv.length, inventoryValue: r2(inv.reduce((s, v) => s + num(v.data.cost) + (v.data.recon || []).reduce((a, x) => a + num(x.cost), 0), 0)), aging: age,
      dealsMtd: mtd.length, frontMtd: r2(mtd.reduce((s, d) => s + num(d.data.calc && d.data.calc.front), 0)), backMtd: r2(mtd.reduce((s, d) => s + num(d.data.calc && d.data.calc.back), 0)),
      fiPerUnit: mtd.length ? r2(mtd.reduce((s, d) => s + num(d.data.calc && d.data.calc.back), 0) / mtd.length) : 0,
      receivable: recv, accounts: act.length, late: late.length, delinquencyPct: act.length ? r2(late.length / act.length * 100) : 0, pastDue: r2(late.reduce((s, x) => s + x.s.pastDue, 0)), buckets, dueToday,
      cashToday: r2(payToday.reduce((s, p) => s + num(p.data.amount), 0)), paymentsToday: payToday.length, collectedMtd: r2(payMtd.reduce((s, p) => s + num(p.data.amount), 0)),
      openRos: ros.filter(r => f(r) && r.data.status !== 'closed').length, rosMtd: ros.filter(r => f(r) && r.data.status === 'closed' && (r.data.closed || '') >= m).length,
      claimsOpen: claims.filter(x => f(x) && ['to_submit', 'submitted'].includes(x.data.status)).length,
      leadsOpen: leads.filter(x => f(x) && !['sold', 'lost'].includes(x.data.status)).length, followupsDue: leads.filter(x => f(x) && !['sold', 'lost'].includes(x.data.status) && x.data.next_followup && x.data.next_followup <= t).length,
      pendingFunding: deals.filter(d => f(d) && d.data.type === 'outside' && d.data.status === 'delivered' && d.data.funding !== 'funded').length,
    };
  };
  Object.assign(out, calc(store));
  // absorption: service+parts gross / overhead, month to date, from the books
  const { rows } = await pool.query(`SELECT acct, sum(credit-debit)::float n FROM jrnl WHERE date>=$1 ${store ? 'AND store_id=$2' : ''} GROUP BY acct`, store ? [m, store] : [m]);
  const g = a => (rows.find(r => r.acct === a) || { n: 0 }).n;
  const fixedGross = g('4400') + g('4410') + g('5400'), overhead = -(g('6000') + g('6900'));
  out.absorption = overhead > 0 ? r2(fixedGross / overhead * 100) : null; out.fixedGrossMtd = r2(fixedGross);
  if (!store) out.stores = stores.map(s => ({ id: s.id, name: s.data.name, ...calc(s.id) }));
  res.json(out);
}));
app.get('/api/collections', W(async (req, res) => {
  const loans = await list(pool, 'loan', `AND data->>'status'='active'`); const pays = await list(pool, 'payment'); const notes = await list(pool, 'cnote');
  const custs = {}; (await list(pool, 'customer')).forEach(c => custs[c.id] = c.data);
  const by = {}; pays.forEach(p => (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p));
  const nb = {}; notes.forEach(n => (nb[n.data.loan_id] = nb[n.data.loan_id] || []).push(n));
  const t = today();
  const q = loans.map(l => { const s = loanStatus(l, by[l.id] || []); const ns = (nb[l.id] || []); const lastNote = ns[0]; const promise = ns.find(n => n.data.type === 'promise' && !n.data.kept && n.data.promise_date >= addDays(t, -3));
    const cu = custs[l.data.customer_id] || {};
    return { id: l.id, store_id: l.store_id, account: l.data.account, name: l.data.customer_label, phone: cu.phone, vehicle: l.data.vehicle_label, payment: l.data.payment, collector: l.data.collector, gps: !!(l.data.gps && l.data.gps.device), ...s,
      lastNote: lastNote && { at: lastNote.data.at, type: lastNote.data.type, note: lastNote.data.note, by: lastNote.data.by }, promise: promise && { date: promise.data.promise_date, amount: promise.data.promise_amount }, touchedToday: ns.some(n => (n.data.at || '').slice(0, 10) === t) };
  }).filter(x => !req.user.store_id || Number(x.store_id) === Number(req.user.store_id)).filter(x => x.daysLate > 0 || x.nextDue === t || (x.promise && x.promise.date <= t)).sort((a, b) => b.daysLate - a.daysLate);
  // collector scorecard (last 30 days)
  const since = addDays(t, -30); const sc = {};
  notes.filter(n => (n.data.at || '') >= since).forEach(n => { const k = n.data.by || '?'; const x = sc[k] = sc[k] || { who: k, contacts: 0, promises: 0, kept: 0 }; x.contacts++; if (n.data.type === 'promise') { x.promises++; if (n.data.kept === 'yes') x.kept++; } });
  pays.filter(p => p.data.date >= since).forEach(p => { const k = p.data.cashier || '?'; const x = sc[k] = sc[k] || { who: k, contacts: 0, promises: 0, kept: 0 }; x.collected = r2(num(x.collected) + num(p.data.amount)); });
  res.json({ queue: q, scorecard: Object.values(sc) });
}));
app.get('/api/opportunities', W(async (req, res) => {
  const loans = await list(pool, 'loan', `AND data->>'status'='active'`); const pays = await list(pool, 'payment'); const by = {}; pays.forEach(p => (by[p.data.loan_id] = by[p.data.loan_id] || []).push(p));
  const custs = {}; (await list(pool, 'customer')).forEach(c => custs[c.id] = c.data);
  const eq = loans.map(l => ({ l, s: loanStatus(l, by[l.id] || []) })).filter(x => x.s.daysLate === 0 && x.s.paidPI >= num(x.l.data.principal) * 0.5)
    .map(x => ({ loan_id: x.l.id, name: x.l.data.customer_label, phone: (custs[x.l.data.customer_id] || {}).phone, vehicle: x.l.data.vehicle_label, payoff: x.s.payoff, paidPct: r2(x.s.paidCount / num(x.l.data.term) * 100) }));
  const ros = await list(pool, 'ro', `AND data->>'status'='closed'`); const yr = new Date().getFullYear();
  const svc = ros.filter(r => num(r.data.year) && yr - num(r.data.year) >= 8 || num(r.data.miles) >= 120000).slice(0, 100).map(r => ({ ro: r.data.number, name: r.data.customer_label, phone: (custs[r.data.customer_id] || {}).phone, vehicle: r.data.vehicle_label, miles: r.data.miles, closed: r.data.closed }));
  res.json({ equity: eq, service: svc });
}));
app.get('/api/audit', W(async (req, res) => { if (!['owner', 'manager'].includes(req.user.role)) return deny(res); const { rows } = await pool.query(`SELECT * FROM audit ORDER BY id DESC LIMIT 500`); res.json(rows); }));
app.get('/api/export', W(async (req, res) => {
  if (!['owner', 'manager', 'accounting'].includes(req.user.role) || req.user.store_id) return deny(res, 'Only an all-stores owner, manager or accountant can export everything');
  const recs = (await pool.query(`SELECT id,kind,store_id,data,created_at,updated_at FROM rec`)).rows.map(r => r.kind === 'user' ? { ...r, data: { ...r.data, pin_hash: undefined, salt: undefined } } : r);
  const j = (await pool.query(`SELECT * FROM jrnl ORDER BY id`)).rows;
  res.set('Content-Disposition', `attachment; filename="dealer-export-${today()}.json"`).json({ exported: new Date().toISOString(), records: recs, journal: j });
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

if (require.main === module) init().then(() => app.listen(PORT, () => console.log('Dealer System on ' + PORT))).catch(e => { console.error(e); process.exit(1); });
module.exports = { calcDeal, loanStatus, allocate, buildSchedule, earnedInterest, pmt, nthDue, roTotals };
