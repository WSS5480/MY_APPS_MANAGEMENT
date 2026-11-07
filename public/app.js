// Dealer System — phone-first single-page app. Talks to the server's /api.
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const $$ = (n, d = 2) => (num(n) < 0 ? '-$' : '$') + Math.abs(num(n)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtD = d => d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
let ME = null, S = { stores: [], settings: {} }, STORE = localStorage.getItem('dms_store') || '';
const cache = {};

async function api(url, body, method) {
  const r = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
const L = async (kind, fresh) => { if (fresh || !cache[kind]) cache[kind] = await api('/api/list/' + kind); return cache[kind]; };
const bust = (...k) => k.forEach(x => delete cache[x]);
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', err ? 5000 : 2500); }
const run = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const can = kind => ME && (['owner', 'manager'].includes(ME.user.role) || (ME.write[ME.user.role] || []).includes(kind));
const isMgr = () => ME && ['owner', 'manager'].includes(ME.user.role);
const inStore = r => !STORE || String(r.store_id || '') === STORE || !r.store_id;
const storeName = id => (S.stores.find(s => String(s.id) === String(id)) || { data: { name: '' } }).data.name || 'Unnamed store';
const curStore = () => S.stores.find(s => String(s.id) === STORE) || S.stores[0];

// ---------- form helpers ----------
// field(label, path, value, type, opts) — path like "trade.allowance"; read back with readForm(root)
function field(label, path, value, type = 'text', o = {}) {
  const w = o.wide ? ' wide' : '', at = `data-f="${path}" ${o.attrs || ''}`;
  let inp;
  if (type === 'select') inp = `<select ${at}>${(o.options || []).map(x => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
  else if (type === 'textarea') inp = `<textarea ${at}>${esc(value)}</textarea>`;
  else if (type === 'check') return `<label class="l${w}" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${at} ${value ? 'checked' : ''}> ${esc(label)}</label>`;
  else inp = `<input type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${at} value="${esc(value)}">`;
  return `<label class="l${w}">${esc(label)}${inp}</label>`;
}
function readForm(root, base = {}) {
  const out = JSON.parse(JSON.stringify(base));
  root.querySelectorAll('[data-f]').forEach(el => {
    const sub = el.closest('[data-sub]'); if (sub && sub !== root) return; // fields inside a nested row belong to that row
    const p = el.dataset.f.split('.'); let o = out; for (let i = 0; i < p.length - 1; i++) o = o[p[i]] = o[p[i]] || {};
    o[p.at(-1)] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
  });
  return out;
}
const opts = (rows, label, blank = '— pick —') => [['', blank], ...rows.map(r => [r.id, label(r)])];
const custName = c => c ? `${c.data.first || ''} ${c.data.last || ''}`.trim() : '';
const vehLabel = v => v ? `${v.data.stock || ''} · ${[v.data.year, v.data.make, v.data.model, v.data.trim].filter(Boolean).join(' ')}` : '';
const storeSel = (val) => S.stores.length > 1 ? field('Store', '_store', val || STORE || (S.stores[0] && S.stores[0].id), 'select', { options: S.stores.map(s => [s.id, s.data.name || 'Unnamed store']) }) : '';
const fillTpl = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => m[k] ?? '');
const smsLink = (phone, body) => `sms:${String(phone || '').replace(/[^\d+]/g, '')}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(body)}`;
const telLink = p => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;

// ---------- shell ----------
const PAGES = [
  ['home', 'Dashboard', null], ['inventory', 'Inventory', 'vehicle'], ['leads', 'Leads', 'lead'], ['customers', 'Customers', null], ['appraisals', 'Appraisals', 'appraisal'], ['deals', 'Deals', 'deal'],
  ['accounts', 'BHPH Accounts', null], ['collections', 'Collections', null], ['cashier', 'Cashier', null], ['insurance', 'Insurance', null], ['service', 'Service', 'ro'], ['parts', 'Parts', null], ['warranty', 'Warranty', null],
  ['books', 'Accounting', null], ['payroll', 'Payroll', null], ['reports', 'Reports', null], ['clock', 'Time clock', null], ['settings', 'Settings', null],
];
const ROLE_PAGES = {
  sales: ['home', 'inventory', 'leads', 'customers', 'appraisals', 'deals', 'clock'], finance: ['home', 'inventory', 'leads', 'customers', 'appraisals', 'deals', 'accounts', 'collections', 'cashier', 'insurance', 'reports', 'clock'],
  collector: ['home', 'customers', 'accounts', 'collections', 'cashier', 'insurance', 'clock'], service: ['home', 'customers', 'service', 'parts', 'warranty', 'cashier', 'clock'], parts: ['home', 'service', 'parts', 'cashier', 'clock'],
  accounting: ['home', 'inventory', 'deals', 'accounts', 'insurance', 'warranty', 'books', 'payroll', 'reports', 'customers', 'cashier', 'clock'],
};
const allowed = p => ['owner', 'manager'].includes(ME.user.role) ? true : (ROLE_PAGES[ME.user.role] || ['home']).includes(p);

async function boot() {
  ME = await api('/api/me'); S.settings = ME.settings || {};
  S.stores = await L('store');
  if (STORE && !S.stores.some(s => String(s.id) === STORE)) STORE = '';
  if (ME.user.store_id) STORE = String(ME.user.store_id);
  $('#brand').innerHTML = `${esc(S.settings.dealer_name || 'Dealer System')}<small id="who">${esc(ME.user.name)} · ${esc(ME.user.role)}</small>`;
  const sp = $('#storePick');
  sp.innerHTML = (S.stores.length > 1 && !ME.user.store_id ? '<option value="">All stores</option>' : '') + S.stores.map(s => `<option value="${s.id}" ${String(s.id) === STORE ? 'selected' : ''}>${esc(storeName(s.id))}</option>`).join('');
  sp.style.display = S.stores.length > 1 ? '' : 'none';
  sp.onchange = () => { STORE = sp.value; localStorage.setItem('dms_store', STORE); route(); };
  window.addEventListener('hashchange', route); route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
async function logout() { await fetch('/logout', { method: 'POST' }); try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('signout'); await caches.delete('dms-data-v1'); } catch (e) {} location.href = '/login'; }
function route() {
  const [page, id, extra] = (location.hash.slice(1) || 'home').split('/');
  $('#nav').innerHTML = PAGES.filter(p => allowed(p[0])).map(p => `<a href="#${p[0]}" class="${p[0] === page ? 'on' : ''}">${p[1]}</a>`).join('');
  const fn = VIEWS[page]; if (!fn || !allowed(page)) { location.hash = 'home'; return; }
  window.scrollTo(0, 0); $('#main').innerHTML = '<p class="mut">Loading…</p>';
  run(fn)(id, extra);
}
const view = html => { $('#main').innerHTML = html; };
// On phones, tables fold into stacked rows (label left, value right) instead of scrolling sideways.
function stackTables(root) { root.querySelectorAll('table.tbl:not(.stack)').forEach(t => { const rows = [...t.rows]; if (!rows.length) return; const hs = [...rows[0].cells].map(c => c.textContent.trim());
  rows.slice(1).forEach(r => [...r.cells].forEach((c, i) => { if (!c.dataset.l) c.dataset.l = c.colSpan > 1 ? '' : (hs[i] || ''); })); t.classList.add('stack'); }); }
new MutationObserver(() => stackTables(document.getElementById('main'))).observe(document.getElementById('main'), { childList: true, subtree: true });
const go = h => { if (location.hash === '#' + h) route(); else location.hash = h; };

// ---------- dashboard ----------
const VIEWS = {};
VIEWS.home = async () => {
  const d = await api('/api/dashboard' + (STORE ? '?store=' + STORE : ''));
  const tile = (l, v, href) => `<a class="tile" ${href ? `href="#${href}" style="text-decoration:none;color:inherit"` : ''}><span>${l}</span><b>${v}</b></a>`;
  const ageChips = Object.entries(d.aging).map(([k, v]) => `<span class="chip ${k === '90+' && v ? 'bad' : k === '61-90' && v ? 'warn' : ''}">${k} days: ${v}</span>`).join(' ');
  const bk = ['current', '1-15', '16-30', '31-60', '60+'].map(k => `<span class="chip ${k === 'current' ? 'ok' : k === '60+' ? 'bad' : 'warn'}">${k}: ${d.buckets[k] || 0}</span>`).join(' ');
  const st = curStore(), need = st ? [['name', 'store name'], ['tax_rate', 'sales tax rate'], ['doc_fee', 'doc fee'], ['trade_tax_credit', 'trade-in tax rule'], ['pay_order', 'payment order'], ['late_fee', 'late fee'], ['grace_days', 'grace days'], ['labor_rate', 'labor rate']].filter(([k]) => st.data[k] == null || st.data[k] === '').map(x => x[1]) : [];
  const banners = (isMgr() && !ME.code_sender_ready ? `<div class="card" style="border-color:#e3a500;background:var(--warnb)"><b>Sign-in phone code is built but not switched on.</b> It needs a texting service (pending). Until then staff sign in with their PIN only.</div>` : '')
    + (isMgr() && need.length ? `<div class="card" style="border-color:#e3a500;background:var(--warnb)"><b>Finish store setup${S.stores.length > 1 ? ' for ' + esc(st.data.name || 'this store') : ''}:</b> ${esc(need.join(', '))}. <a href="#settings" onclick="sessionStorage.st='stores'">Settings → Stores</a></div>` : '');
  view(`${banners}<h1>Dashboard${STORE ? ' — ' + esc(storeName(STORE)) : ''}</h1>
  <h3>Today</h3><div class="tiles">${tile('Cash collected today', $$(d.cashToday), 'collections')}${tile('Payments today', d.paymentsToday)}${tile('Accounts due today', d.dueToday, 'collections')}${tile('Follow-ups due', d.followupsDue, 'leads')}${tile('Open repair orders', d.openRos, 'service')}</div>
  <h3>Sales — month to date</h3><div class="tiles">${tile('Deals delivered', d.dealsMtd, 'deals')}${tile('Front gross', $$(d.frontMtd, 0))}${tile('Back gross', $$(d.backMtd, 0))}${tile('F&I per unit', $$(d.fiPerUnit, 0))}${tile('Awaiting lender funding', d.pendingFunding, 'deals')}${tile('Open leads', d.leadsOpen, 'leads')}</div>
  <h3>In-house financing</h3><div class="tiles">${tile('Receivable', $$(d.receivable, 0), 'accounts')}${tile('Active accounts', d.accounts, 'accounts')}${tile('Late accounts', d.late, 'collections')}${tile('Delinquency', d.delinquencyPct + '%', 'collections')}${tile('Past due $', $$(d.pastDue, 0), 'collections')}${tile('Collected MTD', $$(d.collectedMtd, 0))}</div>
  <div class="card">${bk}</div>
  <h3>Inventory & fixed ops</h3><div class="tiles">${tile('Units in stock', d.inventory, 'inventory')}${tile('Inventory cost', $$(d.inventoryValue, 0), 'inventory')}${tile('ROs closed MTD', d.rosMtd, 'service')}${tile('Service + parts gross MTD', $$(d.fixedGrossMtd, 0), 'books')}${tile('Absorption rate', d.absorption == null ? '—' : d.absorption + '%', 'books')}${tile('Open warranty claims', d.claimsOpen, 'warranty')}</div>
  <div class="card">${ageChips}</div>
  ${d.stores && d.stores.length > 1 ? `<h2>By store</h2><div class="grid">${d.stores.map(s => `<div class="card"><div class="t" style="font-weight:800;margin-bottom:6px">${esc(s.name)}</div>
    <div class="kv"><span>Units in stock</span><b>${s.inventory}</b></div><div class="kv"><span>Deals MTD</span><b>${s.dealsMtd}</b></div><div class="kv"><span>Gross MTD</span><b>${$$(s.frontMtd + s.backMtd, 0)}</b></div>
    <div class="kv"><span>Receivable</span><b>${$$(s.receivable, 0)}</b></div><div class="kv"><span>Delinquency</span><b>${s.delinquencyPct}%</b></div><div class="kv"><span>Collected MTD</span><b>${$$(s.collectedMtd, 0)}</b></div><div class="kv"><span>Open ROs</span><b>${s.openRos}</b></div></div>`).join('')}</div>` : ''}`);
};

// ---------- inventory ----------
const VSTAT = { in_stock: ['In stock', 'ok'], hold: ['On hold', 'warn'], sold: ['Sold', ''], wholesaled: ['Wholesaled', ''], repo: ['Repo', 'bad'], in_transit: ['In transit', 'acc'] };
VIEWS.inventory = async (id) => {
  if (id) return vehicleForm(id);
  const vs = (await L('vehicle', true)).filter(inStore);
  const st = sessionStorage.vf || 'in_stock', q = (sessionStorage.vq || '').toLowerCase();
  const show = vs.filter(v => (st === 'all' || v.data.status === st) && (!q || JSON.stringify(v.data).toLowerCase().includes(q)));
  view(`<h1>Inventory</h1><div class="bar"><input class="grow" placeholder="Search stock #, VIN, make, model" value="${esc(sessionStorage.vq || '')}" oninput="sessionStorage.vq=this.value;clearTimeout(window._q);window._q=setTimeout(route,300)">
  <select onchange="sessionStorage.vf=this.value;route()">${[['in_stock', 'In stock'], ['hold', 'On hold'], ['in_transit', 'In transit'], ['repo', 'Repo'], ['sold', 'Sold'], ['wholesaled', 'Wholesaled'], ['all', 'All']].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select>
  ${can('vehicle') ? `<a class="btn" href="#inventory/new">+ Add vehicle</a>` : ''}</div>
  <div class="grid">${show.map(v => { const d = v.data, cost = num(d.cost) + (d.recon || []).reduce((s, x) => s + num(x.cost), 0), age = Math.round((Date.now() - new Date((d.acquired || today()) + 'T12:00:00')) / 864e5);
    return `<a class="item" href="#inventory/${v.id}"><div class="row"><span class="t">${esc([d.year, d.make, d.model].filter(Boolean).join(' ') || 'Vehicle')}</span><span class="chip ${(VSTAT[d.status] || [])[1] || ''}">${esc((VSTAT[d.status] || [d.status])[0])}</span></div>
    <div class="s">${esc(d.stock)} · ${esc(d.trim || '')} ${d.miles ? '· ' + num(d.miles).toLocaleString() + ' mi' : ''} · ${esc((d.vin || '').slice(-8))}</div>
    <div class="row" style="margin-top:6px"><span><b>${$$(d.price, 0)}</b> <span class="mut small">price</span></span><span class="mut small">cost ${$$(cost, 0)} · ${d.status === 'in_stock' ? age + ' days' : ''}</span></div>
    ${d.photos && d.photos[0] ? `<img src="${esc(d.photos[0])}" style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-top:8px">` : ''}</a>`; }).join('') || '<p class="mut">No vehicles here.</p>'}</div>`);
};
async function vehicleForm(id) {
  const v = id === 'new' ? { data: { status: 'in_stock', cond: 'used', recon: [], photos: [] } } : await api('/api/rec/' + id);
  const d = v.data, lenders = await L('lender');
  const totalCost = num(d.cost) + (d.recon || []).reduce((s, x) => s + num(x.cost), 0);
  view(`<div class="bar"><a href="#inventory" class="btn sec sm">← Inventory</a><span class="grow"></span>${id !== 'new' ? `<button class="btn sec sm" onclick="printTag()">Print price tag</button>` : ''}</div>
  <h1>${id === 'new' ? 'Add vehicle' : esc(vehLabel(v))}</h1>
  <div class="card" id="vf"><div class="f">
    ${field('VIN', 'vin', d.vin, 'text', { attrs: 'style="text-transform:uppercase"' })}
    <label class="l">&nbsp;<button class="btn sec" type="button" onclick="decodeVin()">Decode VIN</button></label>
    ${field('Stock #', 'stock', d.stock)}${['in_stock', 'hold', 'in_transit'].includes(d.status) ? field('Status', 'status', d.status, 'select', { options: [['in_stock', 'In stock'], ['hold', 'On hold'], ['in_transit', 'In transit']] }) : `<label class="l">Status<span class="chip ${(VSTAT[d.status] || [])[1] || ''}" style="align-self:flex-start;margin-top:6px">${esc((VSTAT[d.status] || [d.status])[0])}</span></label>`}
    ${field('New / used', 'cond', d.cond, 'select', { options: [['used', 'Used'], ['new', 'New'], ['cpo', 'Certified pre-owned']] })}
    ${field('Year', 'year', d.year)}${field('Make', 'make', d.make)}${field('Model', 'model', d.model)}${field('Trim', 'trim', d.trim)}
    ${field('Body', 'body', d.body)}${field('Engine', 'engine', d.engine)}${field('Drive', 'drive', d.drive)}${field('Color', 'color', d.color)}${field('Miles', 'miles', d.miles, 'number')}
    ${field('Date acquired', 'acquired', d.acquired || today(), 'date')}${field('Source (auction, trade, street)', 'source', d.source)}
    ${field('Vehicle cost', 'cost', d.cost, 'number')}${field('Paid with', 'paid_with', d.paid_with || 'cash', 'select', { options: [['cash', 'Cash'], ['ap', 'On account (A/P)']] })}
    ${field('Asking price', 'price', d.price, 'number')}${field('MSRP / book', 'msrp', d.msrp, 'number')}${field('Internet price', 'web_price', d.web_price, 'number')}
    ${field('Floorplan lender', 'floorplan_lender', d.floorplan_lender, 'select', { options: [['', 'Not floored'], ...lenders.filter(l => l.data.floorplan).map(l => [l.data.name, l.data.name])] })}
    ${field('Floored amount', 'floorplan_amount', d.floorplan_amount, 'number')}${field('Floorplan rate %', 'floorplan_rate', d.floorplan_rate, 'number')}
    ${field('Key / lot location', 'location', d.location)}${field('Title status', 'title', d.title, 'select', { options: ['', 'In hand', 'Waiting on title', 'Lien payoff pending', 'Sent to DMV'] })}
    ${storeSel(v.store_id)}${field('Notes', 'notes', d.notes, 'textarea', { wide: true })}
  </div>${typeof vehExtra === 'function' ? vehExtra(d) : ''}
  <h3>Reconditioning</h3><div id="recon">${(d.recon || []).map((x, i) => reconRow(x, i)).join('')}</div>
  <button class="btn sec sm" type="button" onclick="addRecon()">+ Add recon item</button>
  <div class="kv" style="margin-top:8px"><span>Total cost with recon</span><b>${$$(totalCost)}</b></div><div class="kv"><span>Potential front gross</span><b>${$$(num(d.price) - totalCost)}</b></div>
  <h3>Photos</h3><div class="photos" id="photos">${(d.photos || []).map((p, i) => `<img src="${esc(p)}" onclick="if(confirm('Remove photo?')){VP.splice(${i},1);drawPhotos()}">`).join('')}</div>
  <input type="file" accept="image/*" multiple capture="environment" onchange="addPhotos(this.files)" style="margin-top:6px">
  </div>
  <div class="sticky">${can('vehicle') ? `<button class="btn" onclick="saveVehicle(${id === 'new' ? 'null' : id})">Save</button>` : ''}${id !== 'new' && isMgr() ? `<button class="btn sec" onclick="delRec(${id},'inventory')">Delete</button>` : ''}
  ${id !== 'new' && d.status === 'in_stock' && can('deal') ? `<a class="btn ok" href="#deals/new/${id}">Start a deal</a>` : ''}
  ${typeof vehButtons === 'function' ? vehButtons(id, d) : ''}${id !== 'new' && ['in_stock', 'hold', 'in_transit'].includes(d.status) && ['owner', 'manager', 'accounting'].includes(ME.user.role) ? `<button class="btn sec" onclick="wholesale(${id})">Wholesale</button>` : ''}</div>
  <div class="print-only" id="tag"></div>`);
  window.VP = [...(d.photos || [])]; window.VD = d;
}
const reconRow = (x, i) => `<div class="sub f" data-sub data-recon="${i}" data-rid="${esc(x.id || '')}">${field('Item', 'item', x.item)}${field('Vendor', 'vendor', x.vendor)}${field('Cost', 'cost', x.cost, 'number')}${field('Date', 'date', x.date || today(), 'date')}
  <div style="align-self:end;display:flex;gap:6px;flex-wrap:wrap">${num(x.posted_amount) ? '<span class="chip ok">On the books</span>' : ''}${x.from_ro ? '<span class="chip">From service RO</span>' : `<button type="button" class="btn sec sm" onclick="if(confirm('Remove this recon line? Anything already posted is reversed when you save.'))this.closest('[data-recon]').remove()">Remove</button>`}</div></div>`;
window.addRecon = () => { const box = $('#recon'); box.insertAdjacentHTML('beforeend', reconRow({}, box.children.length)); };
window.drawPhotos = () => { $('#photos').innerHTML = VP.map((p, i) => `<img src="${esc(p)}" onclick="if(confirm('Remove photo?')){VP.splice(${i},1);drawPhotos()}">`).join(''); };
window.addPhotos = async files => {
  for (const f of files) { if (VP.length >= 12) { toast('12 photos max', true); break; }
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = URL.createObjectURL(f); });
    const c = document.createElement('canvas'), s = Math.min(1, 900 / Math.max(img.width, img.height)); c.width = img.width * s; c.height = img.height * s;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); VP.push(c.toDataURL('image/jpeg', 0.72)); }
  drawPhotos();
};
window.decodeVin = run(async () => {
  const vin = document.querySelector('[data-f=vin]').value.trim(); const x = await api('/api/vin/' + encodeURIComponent(vin));
  for (const k of ['year', 'make', 'model', 'trim', 'body', 'engine', 'drive']) { const el = document.querySelector(`#vf [data-f=${k}]`); if (el && x[k] && !el.value) el.value = x[k]; }
  document.querySelector('[data-f=vin]').value = x.vin; toast(x.make ? 'Decoded: ' + [x.year, x.make, x.model].join(' ') : 'VIN not found in the federal database', !x.make);
});
window.saveVehicle = run(async id => {
  const root = $('#vf'); const data = readForm(root, VD); data.vin = (data.vin || '').toUpperCase();
  data.recon = [...root.querySelectorAll('[data-recon]')].map(el => ({ ...((VD.recon || []).find(r => r.id && r.id === el.dataset.rid) || {}), ...readForm(el), id: el.dataset.rid || undefined })).filter(x => x.id || x.item || num(x.cost));
  data.photos = VP; const st = data._store; delete data._store;
  const r = await api('/api/save/vehicle', { id, store_id: st || STORE || (S.stores[0] && S.stores[0].id), data }); bust('vehicle'); toast('Saved'); go('inventory/' + r.id);
});
window.wholesale = run(async id => { const amt = prompt('Wholesale price'); if (amt === null || amt === '') return; const buyer = prompt('Sold to (auction / dealer)') || '';
  if (!confirm(`Wholesale this unit for ${$$(amt)}? It comes off inventory and posts to the books.`)) return; await api(`/api/vehicle/${id}/wholesale`, { amount: num(amt), buyer }); bust('vehicle'); toast('Wholesaled'); go('inventory/' + id); });
window.printTag = () => { const d = VD; $('#tag').innerHTML = `<div style="border:3px solid #000;padding:24px;max-width:520px;font-family:Arial"><div style="font-size:28px;font-weight:800">${esc([d.year, d.make, d.model].join(' '))}</div><div style="font-size:18px">${esc(d.trim || '')} · ${num(d.miles).toLocaleString()} miles · ${esc(d.color || '')}</div><div style="font-size:56px;font-weight:900;margin:16px 0">${$$(d.price, 0)}</div><div>Stock ${esc(d.stock)} · VIN ${esc(d.vin || '')}</div><div style="margin-top:10px;font-size:13px">${esc(S.settings.dealer_name || '')} ${esc(S.settings.phone || '')}</div></div>`; window.print(); };
window.delRec = run(async (id, back) => { if (!confirm('Delete this record?')) return; await api('/api/delete/' + id, {}); Object.keys(cache).forEach(k => delete cache[k]); toast('Deleted'); go(back); });

// ---------- customers ----------
VIEWS.customers = async (id) => {
  if (id) return customerForm(id);
  const cs = await L('customer', true), q = (sessionStorage.cq || '').toLowerCase();
  const show = cs.filter(c => !q || JSON.stringify(c.data).toLowerCase().includes(q)).slice(0, 300);
  view(`<h1>Customers</h1><div class="bar"><input class="grow" placeholder="Search name, phone, email" value="${esc(sessionStorage.cq || '')}" oninput="sessionStorage.cq=this.value;clearTimeout(window._q);window._q=setTimeout(route,300)">
  ${can('customer') ? `<a class="btn" href="#customers/new">+ Add customer</a>` : ''}</div>
  <div class="grid">${show.map(c => `<a class="item" href="#customers/${c.id}"><div class="t">${esc(custName(c))}</div><div class="s">${esc(c.data.phone || '')} ${c.data.email ? '· ' + esc(c.data.email) : ''}</div><div class="s">${esc(c.data.city || '')}</div></a>`).join('') || '<p class="mut">No customers yet.</p>'}</div>`);
};
async function customerForm(id, back) {
  const c = id === 'new' ? { data: {} } : await api('/api/rec/' + id), d = c.data;
  let hist = '';
  if (id !== 'new') {
    const [deals, loans, ros] = await Promise.all([L('deal', true), api('/api/loans'), L('ro', true)]);
    const mine = x => String(x.data.customer_id) === String(id);
    hist = `<h2>History</h2><div class="grid">${deals.filter(mine).map(x => `<a class="item" href="#deals/${x.id}"><div class="t">Deal ${esc(x.data.number)}</div><div class="s">${esc(x.data.type)} · ${esc(x.data.status)}</div></a>`).join('')}
    ${loans.filter(mine).map(x => `<a class="item" href="#accounts/${x.id}"><div class="t">Account ${esc(x.data.account)}</div><div class="s">${esc(x.data.status)} · balance ${$$(x.status.balance)}</div></a>`).join('')}
    ${ros.filter(mine).map(x => `<a class="item" href="#service/${x.id}"><div class="t">${esc(x.data.number)}</div><div class="s">${esc(x.data.vehicle_label || '')} · ${esc(x.data.status)}</div></a>`).join('')}</div>`;
  }
  view(`<div class="bar"><a href="#${back || 'customers'}" class="btn sec sm">← Back</a></div><h1>${id === 'new' ? 'Add customer' : esc(custName(c))}</h1>
  <div class="card" id="cf"><div class="f">${field('First name', 'first', d.first)}${field('Last name', 'last', d.last)}${field('Mobile phone', 'phone', d.phone, 'tel')}${field('Email', 'email', d.email, 'email')}
  ${field('Address', 'address', d.address)}${field('City', 'city', d.city)}${field('State', 'state', d.state)}${field('ZIP', 'zip', d.zip)}
  ${typeof scanBtn === 'function' ? scanBtn() : ''}${field("Driver's license #", 'dl', d.dl)}${field('DL state', 'dl_state', d.dl_state)}${field('Date of birth', 'dob', d.dob, 'date')}
  ${field('Employer', 'employer', d.employer)}${field('Monthly income', 'income', d.income, 'number')}${field('Pay frequency', 'pay_freq', d.pay_freq, 'select', { options: ['', 'weekly', 'biweekly', 'semimonthly', 'monthly'] })}
  ${field('Time on job', 'job_time', d.job_time)}${field('Housing (rent/own) & payment', 'housing', d.housing)}
  ${field('Reference 1 (name, phone)', 'ref1', d.ref1)}${field('Reference 2 (name, phone)', 'ref2', d.ref2)}
  ${field('Co-buyer name', 'cobuyer', d.cobuyer)}${field('OK to text', 'sms_ok', d.sms_ok !== false, 'check')}
  ${field('ID verified (Red Flags check)', 'id_verified', d.id_verified, 'check')}${field('OFAC checked', 'ofac', d.ofac, 'check')}
  ${field('Notes', 'notes', d.notes, 'textarea', { wide: true })}</div></div>
  <div class="sticky">${can('customer') ? `<button class="btn" onclick="saveCustomer(${id === 'new' ? 'null' : id})">Save</button>` : ''}${d.phone ? `<a class="btn sec" href="${telLink(d.phone)}">Call</a><a class="btn sec" href="${smsLink(d.phone, '')}">Text</a>` : ''}
  ${id !== 'new' && can('deal') ? `<a class="btn ok" href="#deals/new//${id}">Start a deal</a>` : ''}${id !== 'new' && can('ro') ? `<a class="btn sec" href="#service/new//${id}">New RO</a>` : ''}</div>${hist}`);
  window.CD = d;
}
window.saveCustomer = run(async id => {
  const data = readForm($('#cf'), CD); if (!data.first && !data.last) throw new Error('Enter a name');
  const r = await api('/api/save/customer', { id, data }); bust('customer'); toast('Saved'); go('customers/' + r.id);
});
async function quickCustomer() {
  const first = prompt('First name'); if (!first) return null; const last = prompt('Last name') || ''; const phone = prompt('Mobile phone') || '';
  const r = await api('/api/save/customer', { data: { first, last, phone, sms_ok: true } }); bust('customer'); return r;
}

// ---------- leads ----------
const LSTAT = [['new', 'New'], ['contacted', 'Contacted'], ['appointment', 'Appointment set'], ['showed', 'Showed'], ['working', 'Working a deal'], ['sold', 'Sold'], ['lost', 'Lost']];
VIEWS.leads = async (id) => {
  if (id) return leadForm(id);
  const [ls, cs] = await Promise.all([L('lead', true), L('customer')]); const st = sessionStorage.lf || 'open', t = today();
  const show = ls.filter(inStore).filter(l => st === 'open' ? !['sold', 'lost'].includes(l.data.status) : st === 'due' ? (!['sold', 'lost'].includes(l.data.status) && l.data.next_followup && l.data.next_followup <= t) : l.data.status === st);
  const cn = l => custName(cs.find(c => String(c.id) === String(l.data.customer_id))) || l.data.name || 'Lead';
  view(`<h1>Leads</h1><div class="bar"><select onchange="sessionStorage.lf=this.value;route()">${[['open', 'All open'], ['due', 'Follow-up due'], ...LSTAT].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="grow"></span>${can('lead') ? `<a class="btn" href="#leads/new">+ Add lead</a>` : ''}</div>
  <div class="grid">${show.map(l => { const due = l.data.next_followup && l.data.next_followup <= t && !['sold', 'lost'].includes(l.data.status);
    return `<a class="item" href="#leads/${l.id}"><div class="row"><span class="t">${esc(cn(l))}</span><span class="chip ${due ? 'bad' : 'acc'}">${esc((LSTAT.find(x => x[0] === l.data.status) || [, l.data.status])[1])}</span></div>
    <div class="s">${esc(l.data.source || '')} · ${esc(l.data.interest || '')}</div><div class="s">${l.data.next_followup ? (due ? '⚠ ' : '') + 'Follow up ' + fmtD(l.data.next_followup) : 'No follow-up set'} · ${esc(l.data.owner || '')}</div></a>`; }).join('') || '<p class="mut">No leads here.</p>'}</div>`);
};
async function leadForm(id) {
  const l = id === 'new' ? { data: { status: 'new', owner: ME.user.name, next_followup: today(), log: [] } } : await api('/api/rec/' + id);
  const d = l.data, [cs, vs] = await Promise.all([L('customer', true), L('vehicle')]); const cu = cs.find(c => String(c.id) === String(d.customer_id));
  const veh = vs.find(v => String(v.id) === String(d.vehicle_id));
  const reply = fillTpl(S.settings.lead_reply, { first: cu ? cu.data.first : '', vehicle: veh ? [veh.data.year, veh.data.make, veh.data.model].join(' ') : 'vehicle', dealer: S.settings.dealer_name });
  view(`<div class="bar"><a href="#leads" class="btn sec sm">← Leads</a></div><h1>${id === 'new' ? 'New lead' : 'Lead — ' + esc(custName(cu) || d.name || '')}</h1>
  <div class="card" id="lf"><div class="f">
  ${field('Customer', 'customer_id', d.customer_id, 'select', { options: opts(cs, custName) })}<label class="l">&nbsp;<button class="btn sec" type="button" onclick="newCustFor('lf')">+ New customer</button></label>
  ${field('Source', 'source', d.source, 'select', { options: ['', 'Walk-in', 'Phone', 'Website', 'Facebook Marketplace', 'CarGurus', 'Autotrader', 'Cars.com', 'Craigslist', 'Referral', 'Repeat customer', 'Service drive', 'Other'] })}
  ${field('Status', 'status', d.status, 'select', { options: LSTAT })}${field('Salesperson', 'owner', d.owner)}
  ${field('Vehicle of interest', 'vehicle_id', d.vehicle_id, 'select', { options: opts(vs.filter(v => v.data.status === 'in_stock'), vehLabel, '— any —') })}
  ${field('Looking for', 'interest', d.interest)}${field('Budget / down payment', 'budget', d.budget)}${field('Next follow-up', 'next_followup', d.next_followup, 'date')}
  ${field('Appointment', 'appt', d.appt, 'datetime-local')}${field('Lost reason', 'lost_reason', d.lost_reason)}${storeSel(l.store_id)}
  ${field('Notes', 'notes', d.notes, 'textarea', { wide: true })}</div>
  <h3>Activity</h3>${(d.log || []).slice().reverse().map(x => `<div class="kv"><span>${fmtD(x.at)} · ${esc(x.by)}</span><b style="font-weight:500;text-align:left;flex:1;margin-left:10px">${esc(x.note)}</b></div>`).join('') || '<p class="mut small">No activity yet.</p>'}
  <div class="bar" style="margin-top:8px"><input class="grow" id="lognote" placeholder="Log a call, text or visit"><button class="btn sec" onclick="logLead()">Log</button></div></div>
  <div class="sticky">${can('lead') ? `<button class="btn" onclick="saveLead(${id === 'new' ? 'null' : id})">Save</button>` : ''}
  ${cu && cu.data.phone ? `<a class="btn sec" href="${telLink(cu.data.phone)}">Call</a><a class="btn sec" href="${smsLink(cu.data.phone, reply)}">Text auto-reply</a>` : ''}
  ${id !== 'new' && can('deal') && d.customer_id ? `<a class="btn ok" href="#deals/new/${d.vehicle_id || ''}/${d.customer_id}">Start a deal</a>` : ''}${id !== 'new' && isMgr() ? `<button class="btn sec" onclick="delRec(${id},'leads')">Delete</button>` : ''}</div>`);
  window.LD = d; window.LID = id;
}
window.newCustFor = run(async formId => { const c = await quickCustomer(); if (!c) return; const sel = document.querySelector(`#${formId} [data-f=customer_id]`); sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(custName(c))}</option>`); sel.value = c.id; sel.dispatchEvent(new Event('change')); });
window.logLead = () => { const n = $('#lognote').value.trim(); if (!n) return; (LD.log = LD.log || []).push({ at: new Date().toISOString(), by: ME.user.name, note: n }); $('#lognote').value = ''; saveLead(LID === 'new' ? null : LID); };
window.saveLead = run(async id => {
  const data = readForm($('#lf'), LD); const st = data._store; delete data._store;
  const r = await api('/api/save/lead', { id, store_id: st || STORE || (S.stores[0] && S.stores[0].id), data }); bust('lead'); toast('Saved'); go('leads/' + r.id);
});

// ---------- deals ----------
const DTYPE = { cash: 'Cash', bhph: 'In-house (BHPH)', outside: 'Outside lender' };
VIEWS.deals = async (id, extra) => {
  if (id) return dealForm(id, extra);
  const [ds, cs] = await Promise.all([L('deal', true), L('customer')]); const st = sessionStorage.df || 'pending';
  const show = ds.filter(inStore).filter(d => st === 'all' || (st === 'funding' ? d.data.type === 'outside' && d.data.status === 'delivered' && d.data.funding !== 'funded' : d.data.status === st));
  view(`<h1>Deals</h1><div class="bar"><select onchange="sessionStorage.df=this.value;route()">${[['pending', 'Pending'], ['delivered', 'Delivered'], ['funding', 'Awaiting funding'], ['unwound', 'Unwound'], ['all', 'All']].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="grow"></span>${can('deal') ? `<a class="btn" href="#deals/new">+ New deal</a>` : ''}</div>
  <div class="grid">${show.map(d => { const c = cs.find(x => String(x.id) === String(d.data.customer_id)); const k = d.data.calc || {};
    return `<a class="item" href="#deals/${d.id}"><div class="row"><span class="t">${esc(d.data.number)} · ${esc(custName(c))}</span><span class="chip ${d.data.status === 'delivered' ? 'ok' : d.data.status === 'unwound' ? 'bad' : 'warn'}">${esc(d.data.status)}</span></div>
    <div class="s">${esc(DTYPE[d.data.type] || '')} · ${esc(d.data.vehicle_label || '')}</div>${k.gross != null ? `<div class="s">Gross ${$$(k.gross, 0)} · ${k.payment ? $$(k.payment) + ' ' + esc(k.freq) : 'cash'}</div>` : ''}
    ${d.data.type === 'outside' && d.data.status === 'delivered' ? `<div class="s">Funding: <b>${esc(d.data.funding)}</b></div>` : ''}</a>`; }).join('') || '<p class="mut">No deals here.</p>'}</div>`);
};
async function dealForm(id, vehPre) {
  const custPre = location.hash.split('/')[3];
  const deal = id === 'new' ? { data: { type: '', frequency: '', term: '', apr: '', interest_method: '', vehicle_id: vehPre || '', customer_id: custPre || '', products: [], trade: {}, salesperson: ME.user.name, first_due: '' } } : await api('/api/rec/' + id);
  const d = deal.data, locked = d.status !== 'pending' && id !== 'new';
  const [cs, vs, prods, lenders] = await Promise.all([L('customer', true), L('vehicle', true), L('product', true), L('lender', true)]);
  const avail = vs.filter(v => v.data.status === 'in_stock' || String(v.id) === String(d.vehicle_id));
  const veh = vs.find(v => String(v.id) === String(d.vehicle_id));
  if (id === 'new' && veh && !d.price) d.price = veh.data.price;
  const store = S.stores.find(s => String(s.id) === String(deal.store_id || STORE)) || curStore();
  const pick = new Set((d.products || []).map(p => String(p.id)));
  view(`<div class="bar"><a href="#deals" class="btn sec sm">← Deals</a><span class="grow"></span>${id !== 'new' ? `<button class="btn sec sm" onclick="printDeal('sale')">Bill of sale</button><button class="btn sec sm" onclick="printDeal('tila')">Finance disclosure</button><button class="btn sec sm" onclick="printDeal('menu')">F&I menu</button><button class="btn sm" onclick="dealForms()">Forms & e-sign</button>` : ''}</div>
  <h1>${id === 'new' ? 'New deal' : 'Deal ' + esc(d.number)} ${locked ? `<span class="chip ${d.status === 'delivered' ? 'ok' : 'bad'}">${esc(d.status)}</span>` : ''}</h1>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div>
  <div class="card" id="df"><h3>Buyer & vehicle</h3><div class="f">
  ${field('Customer', 'customer_id', d.customer_id, 'select', { options: opts(cs, custName) })}<label class="l">&nbsp;<button class="btn sec" type="button" onclick="newCustFor('df')" ${locked ? 'disabled' : ''}>+ New customer</button></label>
  ${field('Vehicle', 'vehicle_id', d.vehicle_id, 'select', { options: opts(avail, vehLabel) })}${field('Deal type', 'type', d.type, 'select', { options: [['', '— pick —'], ...Object.entries(DTYPE)] })}
  ${field('Sale date', 'sale_date', d.sale_date || today(), 'date')}${field('Salesperson', 'salesperson', d.salesperson)}${storeSel(deal.store_id)}</div>
  <h3>Price</h3><div class="f">${field('Selling price', 'price', d.price, 'number')}${field('Cash down', 'down', d.down, 'number')}
  ${field('Doc fee', 'doc_fee', d.doc_fee ?? (store && store.data.doc_fee), 'number')}${field('Title / registration / plates', 'title_fees', d.title_fees, 'number')}${typeof feeBtn === 'function' ? feeBtn() : ''}${field('Sales tax rate %', 'tax_rate', d.tax_rate ?? (store && store.data.tax_rate), 'number')}</div>
  <h3>Trade-in</h3>${typeof apprPick === 'function' ? apprPick(d) : ''}<div class="f">${field('Trade VIN', 'trade.vin', d.trade.vin)}${field('Year', 'trade.year', d.trade.year)}${field('Make', 'trade.make', d.trade.make)}${field('Model', 'trade.model', d.trade.model)}${field('Miles', 'trade.miles', d.trade.miles, 'number')}
  ${field('Trade allowance', 'trade.allowance', d.trade.allowance, 'number')}${field('Actual cash value (ACV)', 'trade.acv', d.trade.acv, 'number')}${field('Payoff owed', 'trade.payoff', d.trade.payoff, 'number')}${field('Payoff lender', 'trade.lienholder', d.trade.lienholder)}</div>
  <h3>Financing</h3><div class="f">${field('APR %', 'apr', d.apr, 'number')}${field('Number of payments', 'term', d.term, 'number')}${field('Payment schedule', 'frequency', d.frequency, 'select', { options: [['', '— pick —'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']] })}
  ${field('Interest method (in-house)', 'interest_method', d.interest_method, 'select', { options: [['', '— pick —'], ['simple', 'Simple interest, daily'], ['precomputed', 'Precomputed (actuarial refund on payoff)']] })}
  ${field('First payment due', 'first_due', d.first_due, 'date')}${field('Outside lender', 'lender', d.lender, 'select', { options: [['', '—'], ...lenders.filter(l => !l.data.floorplan).map(l => [l.data.name, l.data.name])] })}
  ${field('Dealer reserve % (outside)', 'reserve_pct', d.reserve_pct ?? '', 'number')}${field('Lender approval / stip notes', 'stips', d.stips)}
  ${field('GPS device # (BHPH)', 'gps.device', d.gps && d.gps.device)}${field('GPS provider', 'gps.provider', d.gps && d.gps.provider, 'select', { options: ['', 'PassTime', 'Spireon / GoldStar', 'iMetrik', 'Ituran', 'Other'] })}</div>
  <h3>F&I products</h3><div>${prods.map(p => `<label class="sub" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-prod="${p.id}" ${pick.has(String(p.id)) ? 'checked' : ''}><span style="flex:1"><b>${esc(p.data.name)}</b><br><span class="mut small">${esc(p.data.provider || '')} ${esc(p.data.term || '')}</span></span><input type="number" step="any" data-pprice="${p.id}" style="max-width:110px" value="${esc(((d.products || []).find(x => String(x.id) === String(p.id)) || {}).price ?? p.data.price)}"></label>`).join('') || '<p class="mut small">Add F&I products in Settings.</p>'}</div>
  ${field('Deal notes', 'notes', d.notes, 'textarea', { wide: true })}
  </div></div>
  <div><div class="calc" id="calc">Working…</div>
  <div class="card" style="margin-top:10px"><h3>Payment options</h3><div id="grid"></div></div>
  ${d.status === 'delivered' && d.loan_id ? `<a class="btn ok" href="#accounts/${d.loan_id}">Open account →</a>` : ''}</div></div>
  <div class="sticky">${!locked && can('deal') ? `<button class="btn" onclick="saveDeal(${id === 'new' ? 'null' : id})">Save</button>` : ''}
  ${!locked && id !== 'new' && can('deal') && ME.user.role !== 'sales' ? `<button class="btn ok" onclick="deliverDeal(${id})">Deliver & post</button>` : ''}
  ${d.status === 'delivered' && d.type === 'outside' && d.funding !== 'funded' && ME.user.role !== 'sales' ? `<button class="btn ok" onclick="fundDeal(${id})">Mark funded</button>` : ''}
  ${d.status === 'delivered' && isMgr() ? `<button class="btn bad" onclick="unwindDeal(${id})">Unwind</button>` : ''}
  ${!locked && id !== 'new' && isMgr() ? `<button class="btn sec" onclick="delRec(${id},'deals')">Delete</button>` : ''}</div>
  <div class="print-only" id="dprint"></div>`);
  window.DD = d; window.DID = id; window.DSTORE = deal.store_id;
  if (locked) $('#df').querySelectorAll('input,select,textarea').forEach(e => e.disabled = true);
  $('#df').addEventListener('input', () => { clearTimeout(window._dc); window._dc = setTimeout(dealCalc, 350); });
  $('#df').querySelector('[data-f=vehicle_id]').addEventListener('change', e => { const v = vs.find(x => String(x.id) === e.target.value); if (v) $('#df').querySelector('[data-f=price]').value = v.data.price || ''; });
  dealCalc();
}
function readDeal() {
  const root = $('#df'); const data = readForm(root, DD);
  data.products = [...root.querySelectorAll('[data-prod]')].filter(x => x.checked).map(x => ({ id: x.dataset.prod, price: num(root.querySelector(`[data-pprice="${x.dataset.prod}"]`).value) }));
  return data;
}
const pmtC = (p, apr, n, f) => { const r = num(apr) / 100 / ({ weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[f] || 12); if (!n) return 0; return !r ? p / n : p * r / (1 - Math.pow(1 + r, -n)); };
window.dealCalc = run(async () => {
  const data = DD.status === 'delivered' && DD.calc ? null : readDeal();
  const k = data ? await api('/api/deal/calc', { store_id: data._store || DSTORE || STORE, data }) : DD.calc; window.DK = k;
  const kv = (a, b, strong) => `<div class="kv"><span>${a}</span><b style="${strong ? 'font-size:18px' : ''}">${b}</b></div>`;
  $('#calc').innerHTML = `${k.missing && k.missing.length ? `<div style="background:#5a3a00;border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px">Still needed: ${esc(k.missing.join(', '))}</div>` : ''}${kv('Selling price', $$(k.price))}${kv('Doc fee', $$(k.doc))}${kv('Title & fees', $$(k.fees))}${kv(`Sales tax (${k.taxRate}% on ${$$(k.taxable, 0)})`, $$(k.tax))}${kv('F&I products', $$(k.prodPrice))}
  ${kv('Total', $$(k.total))}${kv('Trade allowance', '−' + $$(k.allow))}${kv('Trade payoff', $$(k.payoff))}${kv('Cash down', '−' + $$(k.down))}
  ${(data || DD).type === 'cash' ? (k.cashDue < 0 ? kv('Owed to buyer', $$(-k.cashDue), 1) : kv('Cash due from buyer', $$(k.cashDue), 1)) : !(data || DD).type ? '' : kv('Amount financed', $$(k.financed), 1) + (k.n && k.freq ? kv(`Payment (${k.n} × ${k.freq})`, $$(k.payment), 1) + kv('Finance charge', $$(k.financeCharge)) + kv('Total of payments', $$(k.totalPayments)) + kv('Total sale price', $$(k.totalSale)) : '')}
  <div style="height:8px"></div>${kv('Front gross', $$(k.front))}${kv('Back gross (F&I, doc, reserve)', $$(k.back))}${kv('Total gross', $$(k.gross), 1)}`;
  const d = data || DD; if (d.type === 'cash' || !k.financed || !d.frequency || !(d.apr !== '' && d.apr != null)) { $('#grid').innerHTML = `<p class="mut small">${d.type === 'cash' ? 'Cash deal.' : 'Enter APR and payment schedule to see options.'}</p>`; return; }
  const downs = [0, 500, 1000, 2000].map(x => x + num(d.down)), terms = d.frequency === 'monthly' ? [24, 36, 48] : d.frequency === 'weekly' ? [104, 156, 208] : [52, 78, 104];
  $('#grid').innerHTML = `<table class="tbl"><tr><th>Down</th>${terms.map(t => `<th class="n">${t} pmts</th>`).join('')}</tr>${downs.map(dn => `<tr><td>${$$(dn, 0)}</td>${terms.map(t => `<td class="n">${$$(pmtC(k.financed + num(d.down) - dn, d.apr, t, d.frequency))}</td>`).join('')}</tr>`).join('')}</table><p class="mut small">${esc(d.frequency)} payments at ${esc(d.apr)}% APR</p>`;
});
window.saveDeal = run(async id => {
  const data = readDeal(); const v = (await L('vehicle')).find(x => String(x.id) === String(data.vehicle_id)); data.vehicle_label = v ? vehLabel(v) : '';
  data.calc = window.DK; const st = data._store; delete data._store;
  const r = await api('/api/save/deal', { id, store_id: st || DSTORE || STORE || (S.stores[0] && S.stores[0].id), data }); bust('deal'); toast('Saved'); go('deals/' + r.id);
});
window.deliverDeal = run(async id => {
  await saveDealQuiet(id);
  if (!confirm('Deliver this deal? The car is marked sold and the sale is posted to the books.')) return;
  const r = await api(`/api/deal/${id}/deliver`, {}); bust('deal', 'vehicle', 'loan'); toast('Delivered' + (r.loan ? ' — account ' + r.loan.data.account + ' opened' : '')); go('deals/' + id);
});
async function saveDealQuiet(id) { const data = readDeal(); const v = (await L('vehicle')).find(x => String(x.id) === String(data.vehicle_id)); data.vehicle_label = v ? vehLabel(v) : ''; const st = data._store; delete data._store; await api('/api/save/deal', { id, store_id: st || DSTORE || STORE, data }); }
window.fundDeal = run(async id => { const dt = prompt('Funding date', today()); if (!dt) return; await api(`/api/deal/${id}/fund`, { date: dt }); bust('deal'); toast('Funded'); go('deals/' + id); });
window.unwindDeal = run(async id => { if (!confirm('Unwind this deal? Every entry it posted is reversed and the car goes back in stock.')) return; await api(`/api/deal/${id}/unwind`, {}); bust('deal', 'vehicle'); toast('Unwound'); go('deals/' + id); });
window.printDeal = async kind => {
  const d = DD, k = window.DK || d.calc || {}; const c = (await L('customer')).find(x => String(x.id) === String(d.customer_id)); const v = (await L('vehicle')).find(x => String(x.id) === String(d.vehicle_id));
  const st = S.stores.find(s => String(s.id) === String(DSTORE)) || curStore(); const dn = (st && st.data.name) || S.settings.dealer_name;
  const head = `<div style="font-family:Arial;max-width:760px"><div style="display:flex;justify-content:space-between"><div><b style="font-size:20px">${esc(dn)}</b><br>${esc((st && st.data.address) || '')}</div><div style="text-align:right">Deal ${esc(d.number || '')}<br>${fmtD(d.sale_date || today())}</div></div><hr>
  <p><b>Buyer:</b> ${esc(custName(c))} — ${esc(c ? [c.data.address, c.data.city, c.data.state, c.data.zip].filter(Boolean).join(', ') : '')}<br><b>Vehicle:</b> ${esc(v ? [v.data.year, v.data.make, v.data.model, v.data.trim].join(' ') : '')} · VIN ${esc(v ? v.data.vin : '')} · ${v ? num(v.data.miles).toLocaleString() : ''} miles · Stock ${esc(v ? v.data.stock : '')}</p>`;
  const row = (a, b) => `<tr><td style="padding:4px 0">${a}</td><td style="text-align:right">${b}</td></tr>`;
  let body = '';
  if (kind === 'sale') body = `<h2>Bill of Sale</h2><table style="width:100%">${row('Selling price', $$(k.price))}${row('Doc fee', $$(k.doc))}${row('Title / registration', $$(k.fees))}${row('Sales tax', $$(k.tax))}${row('Service & protection products', $$(k.prodPrice))}${row('<b>Total</b>', '<b>' + $$(k.total) + '</b>')}${row('Trade allowance', '−' + $$(k.allow))}${row('Trade payoff', $$(k.payoff))}${row('Cash down', '−' + $$(k.down))}${row('<b>Balance</b>', '<b>' + $$(d.type === 'cash' ? k.cashDue : k.financed) + '</b>')}</table>
    ${d.trade && d.trade.vin ? `<p><b>Trade-in:</b> ${esc([d.trade.year, d.trade.make, d.trade.model].join(' '))} VIN ${esc(d.trade.vin)} · ${num(d.trade.miles).toLocaleString()} mi · payoff to ${esc(d.trade.lienholder || '—')}</p>` : ''}
    <p style="font-size:12px">Odometer reading is ${v ? num(v.data.miles).toLocaleString() : '____'} miles and to the best of the seller's knowledge reflects actual mileage. Vehicle is sold as described on the window Buyers Guide, which is part of this contract.</p><br><br>
    <div style="display:flex;justify-content:space-between;gap:30px"><div style="flex:1;border-top:1px solid #000">Buyer</div><div style="flex:1;border-top:1px solid #000">Dealer</div></div>`;
  if (kind === 'tila') body = `<h2>Truth-in-Lending Disclosure — worksheet</h2><table style="width:100%;border-collapse:collapse;text-align:center" border="1"><tr><td style="padding:8px"><b>ANNUAL PERCENTAGE RATE</b><br>The cost of your credit as a yearly rate<br><b style="font-size:20px">${num(k.apr).toFixed(2)}%</b></td><td><b>FINANCE CHARGE</b><br>The dollar amount the credit will cost you<br><b style="font-size:20px">${$$(k.financeCharge)}</b></td><td><b>Amount Financed</b><br>The amount of credit provided to you<br><b style="font-size:20px">${$$(k.financed)}</b></td><td><b>Total of Payments</b><br>What you will have paid after all payments<br><b style="font-size:20px">${$$(k.totalPayments)}</b></td><td><b>Total Sale Price</b><br>Including your down payment of ${$$(k.down)}<br><b style="font-size:20px">${$$(k.totalSale)}</b></td></tr></table>
    <p><b>Payment schedule:</b> ${k.n} payments of ${$$(k.payment)}, ${esc(k.freq)}, first payment due ${fmtD(d.first_due)}.</p><p><b>Late charge:</b> ${st && st.data.late_fee != null && st.data.late_fee !== '' && st.data.grace_days != null && st.data.grace_days !== '' ? `${$$(st.data.late_fee)} if a payment is more than ${esc(st.data.grace_days)} days late.` : 'See contract (late fee not set up for this store).'} <b>Security:</b> the vehicle being purchased.</p>
    <p style="font-size:12px;border:1px solid #999;padding:8px">This worksheet shows the numbers for this deal. Sign your state-approved retail installment contract form (for example, the Texas OCCC-approved form) — this page does not replace it.</p>`;
  if (kind === 'menu') { const prods = await L('product'); body = `<h2>Protection options</h2><p>Payment without products: <b>${$$(pmtC(k.financed - k.prodPrice, k.apr, k.n, k.freq))}</b> ${esc(k.freq)}</p><table style="width:100%">${prods.map(p => row(`<b>${esc(p.data.name)}</b> — ${esc(p.data.term || '')}<br><span style="font-size:12px">${esc(p.data.description || '')}</span>`, `${$$(p.data.price)}<br><span style="font-size:12px">+${$$(pmtC(num(p.data.price), k.apr, k.n, k.freq))} per payment</span>`)).join('')}</table><p>I accept / decline the products above: ______________________</p>`; }
  $('#dprint').innerHTML = head + body + '</div>'; window.print();
};

// ---------- BHPH accounts ----------
const LST = { active: ['Active', 'ok'], paid: ['Paid off', 'acc'], repo: ['In repo', 'bad'], closed_repo: ['Repo closed', ''], charged_off: ['Charged off', 'bad'], unwound: ['Unwound', ''] };
VIEWS.accounts = async (id) => {
  if (id) return accountView(id);
  const ls = (await api('/api/loans')).filter(inStore); const st = sessionStorage.af || 'active', q = (sessionStorage.aq || '').toLowerCase();
  const show = ls.filter(l => (st === 'all' || l.data.status === st || (st === 'late' && l.data.status === 'active' && l.status.daysLate > 0)) && (!q || (l.data.account + ' ' + l.data.customer_label + ' ' + l.data.vehicle_label).toLowerCase().includes(q)));
  const tot = show.reduce((s, l) => s + (['active', 'repo'].includes(l.data.status) ? l.status.balance : 0), 0);
  view(`<h1>BHPH Accounts</h1><div class="bar"><input class="grow" placeholder="Account #, name, vehicle" value="${esc(sessionStorage.aq || '')}" oninput="sessionStorage.aq=this.value;clearTimeout(window._q);window._q=setTimeout(route,300)">
  <select onchange="sessionStorage.af=this.value;route()">${[['active', 'Active'], ['late', 'Late'], ['repo', 'In repo'], ['paid', 'Paid off'], ['charged_off', 'Charged off'], ['all', 'All']].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <p class="mut">${show.length} accounts · balance ${$$(tot)}</p>
  <div class="grid">${show.map(l => `<a class="item" href="#accounts/${l.id}"><div class="row"><span class="t">${esc(l.data.customer_label)}</span><span class="chip ${l.data.status === 'active' ? (l.status.daysLate ? (l.status.daysLate > 30 ? 'bad' : 'warn') : 'ok') : (LST[l.data.status] || [])[1] || ''}">${l.data.status === 'active' ? (l.status.daysLate ? l.status.daysLate + ' days late' : 'Current') : (LST[l.data.status] || [l.data.status])[0]}</span></div>
  <div class="s">#${esc(l.data.account)} · ${esc(l.data.vehicle_label)}</div><div class="row" style="margin-top:4px"><span class="small">Balance <b>${$$(l.status.balance)}</b></span><span class="small mut">${$$(l.data.payment)} ${esc(l.data.frequency)} · next ${fmtD(l.status.nextDue)}</span></div></a>`).join('') || '<p class="mut">No accounts here. Accounts open when an in-house deal is delivered.</p>'}</div>`);
};
async function accountView(id) {
  const l = await api('/api/loan/' + id), d = l.data, s = l.status; const cu = await api('/api/rec/' + d.customer_id).catch(() => ({ data: {} }));
  const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
  const reminder = fillTpl(S.settings.sms_reminder, { first: cu.data.first, dealer: S.settings.dealer_name, amount: $$(s.pastDue || d.payment), due: fmtD(s.nextDue), paylink: location.origin + '/pay', phone: S.settings.phone });
  const tab = sessionStorage.at || 'history';
  view(`<div class="bar"><a href="#accounts" class="btn sec sm">← Accounts</a><span class="grow"></span><a class="btn sec sm" href="#customers/${d.customer_id}">Customer</a><a class="btn sec sm" href="#deals/${d.deal_id}">Deal</a></div>
  <h1>${esc(d.customer_label)} <span class="chip ${(LST[d.status] || [])[1] || ''}">${(LST[d.status] || [d.status])[0]}</span></h1>
  <p class="mut">Account #${esc(d.account)} · ${esc(d.vehicle_label)}</p>
  <div class="grid"><div class="card">${kv('Balance', $$(s.balance))}${kv('Payoff today (with interest & fees)', $$(s.payoff))}${kv('Payment', $$(d.payment) + ' ' + esc(d.frequency))}${kv('Next due', fmtD(s.nextDue))}${kv('Past due', `<span style="color:${s.pastDue ? 'var(--bad)' : 'inherit'}">${$$(s.pastDue)}</span>`)}${kv('Days late', s.daysLate)}${kv('Fees owed', $$(s.feesOwed))}${kv('Payments made', d.status === 'paid' ? 'Paid off' + (d.paid_off ? ' ' + fmtD(d.paid_off) : '') : `${s.paidCount} of ${d.term}`)}${kv('APR', d.apr + '%')}${kv('Interest method', s.method === 'precomputed' ? 'Precomputed (actuarial)' : 'Simple interest, daily')}${s.contractBalance != null ? kv('Contract balance (payments left)', $$(s.contractBalance)) : ''}${kv('Last paid', fmtD(s.lastPaid) || '—')}</div>
  ${d.status === 'active' && can('payment') ? `<div class="card" id="payf"><h3>Take a payment</h3><div class="f">${field('Amount', 'amount', s.pastDue || d.payment, 'number')}${field('Method', 'method', 'cash', 'select', { options: [['cash', 'Cash'], ['card', 'Card'], ['ach', 'ACH / bank'], ['check', 'Check'], ['money_order', 'Money order'], ['online', 'Online']] })}${field('Date', 'date', today(), 'date')}${field('Reference #', 'ref', '')}</div>
  <div class="bar" style="margin-top:10px"><button class="btn ok" onclick="takePay(${id})">Post payment</button><button class="btn sec" onclick="payoffQuote(${id})">Payoff amount</button></div></div>` : ''}</div>
  <div class="bar">${cu.data.phone ? `<a class="btn sec" href="${telLink(cu.data.phone)}">Call</a><a class="btn sec" href="${smsLink(cu.data.phone, reminder)}">Text reminder</a>` : ''}
  ${can('loan') && d.status === 'active' ? `<button class="btn sec" onclick="addFee(${id})">Assess late fee</button>` : ''}${isMgr() && d.status === 'active' ? `<button class="btn sec" onclick="defer(${id})">Defer / move due date</button>` : ''}</div>
  <div class="tabs">${[['history', 'Payments'], ['notes', 'Collection notes'], ['schedule', 'Schedule'], ['gps', 'GPS & insurance'], ['repo', 'Repo / close out']].map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" onclick="sessionStorage.at='${k}';route()">${t}</a>`).join('')}</div>
  <div class="card" id="atab"></div><div class="print-only" id="rprint"></div>`);
  window.LOAN = l; window.LCU = cu;
  const T = $('#atab');
  if (tab === 'history') T.innerHTML = l.payments.length ? `<table class="tbl"><tr><th>Date</th><th>Receipt</th><th class="n">Amount</th><th class="n">Principal</th><th class="n">Interest</th><th class="n">Fees</th><th></th></tr>${l.payments.map(p => `<tr><td>${fmtD(p.data.date)}<br><span class="mut small">${esc(p.data.method)} · ${esc(p.data.cashier)}</span></td><td>${esc(p.data.receipt)}</td><td class="n">${$$(p.data.amount)}</td><td class="n">${$$(p.data.principal)}</td><td class="n">${$$(p.data.interest)}</td><td class="n">${$$(p.data.fees)}</td><td><button class="btn sec sm" onclick="printReceipt(${p.id})">Receipt</button></td></tr>`).join('')}</table>` : '<p class="mut">No payments yet.</p>';
  if (tab === 'notes') T.innerHTML = `${can('cnote') ? `<div class="f" id="nf">${field('Type', 'type', 'call', 'select', { options: [['call', 'Call'], ['text', 'Text'], ['visit', 'Visit'], ['promise', 'Promise to pay'], ['letter', 'Letter'], ['note', 'Note']] })}${field('Result', 'result', '', 'select', { options: ['', 'Reached customer', 'Left message', 'No answer', 'Wrong number', 'Disconnected', 'Refused'] })}${field('Promise date', 'promise_date', '', 'date')}${field('Promise amount', 'promise_amount', '', 'number')}${field('Note', 'note', '', 'textarea', { wide: true })}</div><button class="btn" style="margin:8px 0" onclick="addNote(${id})">Add note</button>` : ''}
    ${l.notes.map(n => `<div class="sub"><div class="row"><b>${esc(n.data.type)}${n.data.result ? ' — ' + esc(n.data.result) : ''}</b><span class="mut small">${new Date(n.data.at).toLocaleString()} · ${esc(n.data.by)}</span></div>${n.data.type === 'promise' ? `<div>Promised ${$$(n.data.promise_amount)} by ${fmtD(n.data.promise_date)} ${n.data.kept ? `<span class="chip ok">kept: ${esc(n.data.kept)}</span>` : ''}</div>` : ''}<div>${esc(n.data.note)}</div></div>`).join('') || '<p class="mut">No notes yet.</p>'}`;
  if (tab === 'schedule') T.innerHTML = `<table class="tbl"><tr><th>#</th><th>Due</th><th class="n">Payment</th><th class="n">Principal</th><th class="n">Interest</th><th class="n">Balance</th></tr>${l.schedule.map(x => `<tr style="${x.n <= s.paidCount ? 'color:var(--mut)' : ''}"><td>${x.n}</td><td>${fmtD(x.due)}</td><td class="n">${$$(x.payment)}</td><td class="n">${$$(x.principal)}</td><td class="n">${$$(x.interest)}</td><td class="n">${$$(x.balance)}</td></tr>`).join('')}</table><p class="mut small">${s.method === 'precomputed' ? 'Precomputed: each payment earns the interest shown. Paying off early refunds the unearned interest (actuarial).' : 'Planned schedule. Interest is charged on the actual balance by the day, so early or late payments shift the split.'}</p>${(d.deferments || []).length ? '<h3>Deferments</h3>' + d.deferments.map(x => `<div class="kv"><span>${fmtD(x.date)} · ${esc(x.by)}</span><b>${fmtD(x.from)} → ${fmtD(x.to)}</b></div>`).join('') : ''}`;
  if (tab === 'gps') T.innerHTML = `<div class="f" id="gf">${field('GPS provider', 'gps.provider', d.gps && d.gps.provider, 'select', { options: ['', 'PassTime', 'Spireon / GoldStar', 'iMetrik', 'Ituran', 'Other'] })}${field('Device #', 'gps.device', d.gps && d.gps.device)}${field('Insurance company', 'cpi.company', d.cpi && d.cpi.company)}${field('Policy #', 'cpi.policy', d.cpi && d.cpi.policy)}${field('Insurance expires', 'cpi.expires', d.cpi && d.cpi.expires, 'date')}${field('Collector', 'collector', d.collector)}</div>
    <div class="bar" style="margin-top:8px">${can('loan') ? `<button class="btn" onclick="saveLoanInfo(${id})">Save</button>` : ''}<button class="btn sec" onclick="gps(${id},'locate')">Locate</button><button class="btn sec" onclick="gps(${id},'tone')">Payment reminder tone</button>${isMgr() ? `<button class="btn bad" onclick="gps(${id},'disable')">Starter disable</button><button class="btn sec" onclick="gps(${id},'enable')">Re-enable</button>` : ''}</div>
    ${d.cpi && d.cpi.expires && d.cpi.expires < today() ? '<p class="chip bad">Insurance has expired</p>' : ''}<h3>Device log</h3>${(d.gps_log || []).slice().reverse().map(x => `<div class="kv"><span>${new Date(x.at).toLocaleString()} · ${esc(x.by)}</span><b>${esc(x.action)} ${x.sent ? '' : '(logged)'}</b></div>`).join('') || '<p class="mut small">Nothing yet.</p>'}`;
  if (tab === 'repo') T.innerHTML = `<p class="mut small">Steps: assign to agent → recovered (enter vehicle value) → notice sent → redeemed by customer, or sold (enter sale price). Charge off writes off an active balance without a repo.</p>
    <div class="f" id="rf">${field('Step', 'step', 'assigned', 'select', { options: [['assigned', 'Assigned to repo agent'], ['recovered', 'Vehicle recovered'], ['notice_sent', 'Notice of intent sent'], ['redeemed', 'Redeemed by customer'], ['sold', 'Repo vehicle sold'], ['charged_off', 'Charge off balance']] })}${field('Repo agent', 'agent', d.repo && d.repo.agent)}${field('Date', 'date', today(), 'date')}${field('Amount (value at recovery / redemption / sale price)', 'amount', '', 'number')}${field('Cost (tow, storage, agent fee)', 'cost', '', 'number')}${field('Note', 'note', '', 'textarea', { wide: true })}</div>
    <button class="btn bad" style="margin:8px 0" onclick="repoStep(${id})">Record step</button>
    ${d.repo ? `<h3>Repo history</h3>${d.repo.steps.map(x => `<div class="kv"><span>${fmtD(x.date)} · ${esc(x.by)} ${esc(x.note || '')}</span><b>${esc(x.step)} ${x.amount ? $$(x.amount) : ''} ${x.cost ? '(cost ' + $$(x.cost) + ')' : ''}</b></div>`).join('')}${d.repo.deficiency != null ? `<div class="kv"><span>Deficiency balance</span><b>${$$(d.repo.deficiency)}</b></div>` : ''}` : ''}`;
}
window.takePay = run(async id => { const b = readForm($('#payf')); const p = await api(`/api/loan/${id}/pay`, b); toast(`Posted ${p.data.receipt}: principal ${$$(p.data.principal)}, interest ${$$(p.data.interest)}, fees ${$$(p.data.fees)}`); sessionStorage.at = 'history'; await route(); if (typeof afterPay === 'function') afterPay(p); else setTimeout(() => printReceipt(p.id), 400); });
window.payoffQuote = run(async id => { const dt = document.querySelector('#payf [data-f=date]').value || today(); const q = await api(`/api/loan/${id}/payoff?date=${dt}`); document.querySelector('#payf [data-f=amount]').value = q.payoff; toast(`Payoff on ${fmtD(dt)}: ${$$(q.payoff)}`); });
window.printReceipt = async pid => { const p = LOAN.payments.find(x => x.id === pid) || (await api('/api/rec/' + pid)); const d = p.data;
  $('#rprint').innerHTML = `<div style="font-family:Arial;max-width:320px"><b>${esc(S.settings.dealer_name || '')}</b><br>Payment receipt ${esc(d.receipt)}<br>${fmtD(d.date)}<hr>Account #${esc(d.account)}<br>${esc(d.customer_label)}<hr><table style="width:100%"><tr><td>Amount</td><td align="right">${$$(d.amount)}</td></tr><tr><td>Principal</td><td align="right">${$$(d.principal)}</td></tr><tr><td>Interest</td><td align="right">${$$(d.interest)}</td></tr><tr><td>Fees</td><td align="right">${$$(d.fees)}</td></tr></table><hr>Paid by ${esc(d.method)} · ${esc(d.cashier)}<br>Balance after posting: ${$$(LOAN.status.balance)}</div>`; window.print(); };
window.addFee = run(async id => { const st = S.stores.find(x => String(x.id) === String(LOAN.store_id)); const a = prompt('Late fee amount', st && st.data.late_fee != null ? st.data.late_fee : ''); if (!a) return; await api(`/api/loan/${id}/fee`, { amount: num(a), reason: 'Late fee' }); toast('Fee added'); route(); });
window.defer = run(async id => { const nd = prompt('New FIRST payment date for the whole schedule (YYYY-MM-DD). This shifts every future due date.', LOAN.data.first_due); if (!nd) return; await api(`/api/loan/${id}/update`, { first_due: nd }); toast('Schedule moved'); route(); });
window.addNote = run(async id => { await api(`/api/loan/${id}/note`, readForm($('#nf'))); toast('Note added'); route(); });
window.saveLoanInfo = run(async id => { await api(`/api/loan/${id}/update`, readForm($('#gf'))); toast('Saved'); route(); });
window.gps = run(async (id, action) => { const reason = action === 'disable' ? prompt('Reason for starter disable (required)') : ''; if (action === 'disable' && !reason) return; const r = await api(`/api/loan/${id}/gps`, { action, reason }); toast(r.note); route(); });
window.repoStep = run(async id => { const b = readForm($('#rf')); if (!confirm(`Record "${b.step}"? This posts to the books.`)) return; await api(`/api/loan/${id}/repo`, b); bust('vehicle'); toast('Recorded'); route(); });

// ---------- collections ----------
VIEWS.collections = async () => {
  const c = await api('/api/collections'); const b = sessionStorage.cb || 'all';
  const q = c.queue.filter(inStore).filter(x => b === 'all' || (b === 'promise' ? x.promise : b === 'today' ? x.nextDue === today() && !x.daysLate : x.bucket === b));
  const cnt = k => c.queue.filter(inStore).filter(x => x.bucket === k).length;
  view(`<h1>Collections</h1><div class="tabs">${[['all', 'All (' + c.queue.filter(inStore).length + ')'], ['today', 'Due today'], ['1-15', '1–15 days (' + cnt('1-15') + ')'], ['16-30', '16–30 (' + cnt('16-30') + ')'], ['31-60', '31–60 (' + cnt('31-60') + ')'], ['60+', '60+ (' + cnt('60+') + ')'], ['promise', 'Promises']].map(([k, t]) => `<a class="${k === b ? 'on' : ''}" onclick="sessionStorage.cb='${k}';route()">${t}</a>`).join('')}</div>
  <div class="grid">${q.map(x => { const msg = fillTpl(S.settings.sms_reminder, { first: (x.name || '').split(' ')[0], dealer: S.settings.dealer_name, amount: $$(x.pastDue || x.payment), due: fmtD(x.nextDue), paylink: location.origin + '/pay', phone: S.settings.phone });
    return `<div class="card"><div class="row"><a href="#accounts/${x.id}" class="t" style="font-weight:800;color:inherit">${esc(x.name)}</a><span class="chip ${x.daysLate > 30 ? 'bad' : x.daysLate ? 'warn' : 'acc'}">${x.daysLate ? x.daysLate + ' days' : 'Due today'}</span></div>
    <div class="s mut small">#${esc(x.account)} · ${esc(x.vehicle)} ${x.gps ? '· GPS' : ''}</div>
    <div class="kv"><span>Past due</span><b>${$$(x.pastDue)}</b></div><div class="kv"><span>Balance</span><b>${$$(x.balance)}</b></div>
    ${x.promise ? `<div class="kv"><span>Promise</span><b>${$$(x.promise.amount)} by ${fmtD(x.promise.date)}</b></div>` : ''}
    ${x.lastNote ? `<div class="small mut" style="margin-top:4px">Last: ${esc(x.lastNote.type)} ${new Date(x.lastNote.at).toLocaleDateString()} — ${esc((x.lastNote.note || '').slice(0, 80))}</div>` : '<div class="small mut">No contact logged</div>'}
    <div class="bar" style="margin:8px 0 0">${x.phone ? `<a class="btn sec sm" href="${telLink(x.phone)}">Call</a><a class="btn sec sm" href="${smsLink(x.phone, msg)}">Text</a>` : ''}<a class="btn sm" href="#accounts/${x.id}" onclick="sessionStorage.at='notes'">Note / promise</a>${x.touchedToday ? '<span class="chip ok">worked today</span>' : ''}</div></div>`; }).join('') || '<p class="mut">Nothing in this queue. 🎉</p>'}</div>
  <h2>Collector scorecard — last 30 days</h2><div class="card"><table class="tbl"><tr><th>Who</th><th class="n">Contacts</th><th class="n">Promises</th><th class="n">Kept</th><th class="n">Collected</th></tr>${c.scorecard.map(x => `<tr><td>${esc(x.who)}</td><td class="n">${x.contacts}</td><td class="n">${x.promises}</td><td class="n">${x.kept}</td><td class="n">${$$(x.collected || 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="mut">No activity yet.</td></tr>'}</table></div>`);
};

// ---------- service ----------
const ROSTAT = [['open', 'Open'], ['waiting_approval', 'Waiting on customer approval'], ['in_progress', 'In progress'], ['waiting_parts', 'Waiting on parts'], ['ready', 'Ready for pickup']];
VIEWS.service = async (id, extra) => {
  if (id === 'appt') return apptForm(extra);
  if (id) return roForm(id, extra);
  const [ros, appts] = await Promise.all([L('ro', true), L('appt', true)]); const st = sessionStorage.sf || 'open';
  const show = ros.filter(inStore).filter(r => st === 'open' ? r.data.status !== 'closed' : st === 'unpaid' ? r.data.status === 'closed' && !r.data.paid && r.data.totals && r.data.totals.customer > 0 : r.data.status === st);
  const t = today(), upc = appts.filter(inStore).filter(a => (a.data.when || '').slice(0, 10) >= t && a.data.status !== 'done').sort((a, b) => (a.data.when > b.data.when ? 1 : -1));
  view(`<h1>Service</h1><div class="bar"><select onchange="sessionStorage.sf=this.value;route()">${[['open', 'All open'], ...ROSTAT, ['closed', 'Closed'], ['unpaid', 'Closed — not paid']].map(([v, x]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${x}</option>`).join('')}</select><span class="grow"></span>
  ${can('appt') ? `<a class="btn sec" href="#service/appt/new">+ Appointment</a>` : ''}${can('ro') ? `<a class="btn" href="#service/new">+ Repair order</a>` : ''}</div>
  <h3>Appointments</h3><div class="grid">${upc.slice(0, 30).map(a => `<a class="item" href="#service/appt/${a.id}"><div class="row"><span class="t">${new Date(a.data.when).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span class="chip">${esc(a.data.bay || '')}</span></div><div class="s">${esc(a.data.customer_label || '')} · ${esc(a.data.vehicle_label || '')}</div><div class="s">${esc(a.data.concern || '')}</div></a>`).join('') || '<p class="mut small">No upcoming appointments.</p>'}</div>
  <h3>Repair orders</h3><div class="grid">${show.map(r => { const tt = r.data.totals; return `<a class="item" href="#service/${r.id}"><div class="row"><span class="t">${esc(r.data.number)} · ${esc(r.data.customer_label || 'Internal')}</span><span class="chip ${r.data.status === 'closed' ? (r.data.paid || !(tt && tt.customer) ? 'ok' : 'warn') : r.data.status === 'ready' ? 'ok' : 'acc'}">${esc((ROSTAT.find(x => x[0] === r.data.status) || [, r.data.status])[1])}</span></div>
    <div class="s">${esc(r.data.vehicle_label || '')} · ${esc(r.data.dept === 'body' ? 'Body shop' : 'Service')}</div><div class="s">${esc((r.data.concern || '').slice(0, 80))}</div>${tt ? `<div class="s">Customer ${$$(tt.customer)} · warranty ${$$(tt.warranty)}</div>` : ''}</a>`; }).join('') || '<p class="mut">No repair orders here.</p>'}</div>`);
};
async function apptForm(id) {
  const a = id === 'new' ? { data: { when: today() + 'T09:00', status: 'booked' } } : await api('/api/rec/' + id), d = a.data, cs = await L('customer', true);
  const appts = (await L('appt')).filter(x => x.id !== a.id && (x.data.when || '').slice(0, 10) === (d.when || '').slice(0, 10));
  view(`<div class="bar"><a href="#service" class="btn sec sm">← Service</a></div><h1>${id === 'new' ? 'New appointment' : 'Appointment'}</h1>
  <div class="card" id="apf"><div class="f">${field('Customer', 'customer_id', d.customer_id, 'select', { options: opts(cs, custName) })}<label class="l">&nbsp;<button class="btn sec" type="button" onclick="newCustFor('apf')">+ New customer</button></label>
  ${field('Date & time', 'when', d.when, 'datetime-local')}${field('Hours booked', 'hours', d.hours || 1, 'number')}${field('Bay / lift', 'bay', d.bay)}${field('Technician', 'tech', d.tech)}${field('Advisor', 'advisor', d.advisor || ME.user.name)}
  ${field('Vehicle (year make model)', 'vehicle_label', d.vehicle_label)}${field('VIN', 'vin', d.vin)}${field('Miles', 'miles', d.miles, 'number')}${field('Status', 'status', d.status, 'select', { options: [['booked', 'Booked'], ['confirmed', 'Confirmed'], ['arrived', 'Arrived'], ['no_show', 'No-show'], ['done', 'Done']] })}
  ${field('Customer concern', 'concern', d.concern, 'textarea', { wide: true })}${field('Parts to have ready', 'parts_needed', d.parts_needed, 'textarea', { wide: true })}${storeSel(a.store_id)}</div>
  ${appts.length ? `<h3>Same day</h3>${appts.map(x => `<div class="kv"><span>${new Date(x.data.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${esc(x.data.bay || '')} ${esc(x.data.tech || '')}</span><b>${esc(x.data.customer_label || '')} (${num(x.data.hours)}h)</b></div>`).join('')}` : ''}</div>
  <div class="sticky"><button class="btn" onclick="saveAppt(${id === 'new' ? 'null' : id})">Save</button>${id !== 'new' && can('ro') ? `<button class="btn ok" onclick="apptToRo(${id})">Open RO</button>` : ''}${id !== 'new' && isMgr() ? `<button class="btn sec" onclick="delRec(${id},'service')">Delete</button>` : ''}</div>`);
  window.AD = d; window.ACS = cs;
}
window.saveAppt = run(async (id, quiet) => { const data = readForm($('#apf'), AD); const c = ACS.find(x => String(x.id) === String(data.customer_id)); data.customer_label = custName(c); const st = data._store; delete data._store;
  const r = await api('/api/save/appt', { id, store_id: st || STORE || (S.stores[0] && S.stores[0].id), data }); bust('appt'); if (!quiet) { toast('Saved'); go('service/appt/' + r.id); } return r; });
window.apptToRo = run(async id => { const a = await saveAppt(id, true); sessionStorage.fromAppt = JSON.stringify(a); go('service/new'); });
async function roForm(id, unused) {
  const custPre = location.hash.split('/')[3];
  let ro;
  if (id === 'new') { const ap = sessionStorage.fromAppt ? JSON.parse(sessionStorage.fromAppt) : null; sessionStorage.removeItem('fromAppt');
    const st = curStore(); ro = { data: { status: 'open', dept: 'service', lines: [{ pay_type: 'customer', rate: st && st.data.labor_rate !== '' ? st.data.labor_rate : '', parts: [] }], inspection: [], tax_rate: st ? st.data.tax_rate : '', customer_id: (ap && ap.data.customer_id) || custPre || '', vehicle_label: ap && ap.data.vehicle_label, vin: ap && ap.data.vin, miles: ap && ap.data.miles, concern: ap && ap.data.concern, appt_id: ap && ap.id } };
    if (ap) await api('/api/save/appt', { id: ap.id, store_id: ap.store_id, data: { ...ap.data, status: 'arrived' } }).catch(() => {}); }
  else ro = await api('/api/rec/' + id);
  const d = ro.data, locked = d.status === 'closed'; const [cs, parts, vs] = await Promise.all([L('customer', true), L('part', true), L('vehicle')]);
  window.RD = d; window.RID = id; window.RPARTS = parts; window.RSTORE = ro.store_id;
  view(`<div class="bar"><a href="#service" class="btn sec sm">← Service</a><span class="grow"></span>${id !== 'new' ? `<button class="btn sec sm" onclick="printRo()">Print ${locked ? 'invoice' : 'RO'}</button>` : ''}</div>
  <h1>${id === 'new' ? 'New repair order' : esc(d.number)} ${locked ? `<span class="chip ${d.paid || !(d.totals && d.totals.customer) ? 'ok' : 'warn'}">closed${d.paid ? ' · paid' : ''}</span>` : ''}</h1>
  <div class="card" id="rof"><div class="f">${field('Customer', 'customer_id', d.customer_id, 'select', { options: opts(cs, custName, '— internal / none —') })}<label class="l">&nbsp;<button class="btn sec" type="button" onclick="newCustFor('rof')" ${locked ? 'disabled' : ''}>+ New customer</button></label>
  ${field('Department', 'dept', d.dept, 'select', { options: [['service', 'Service'], ['body', 'Body shop'], ['quick', 'Quick lube']] })}${field('Status', 'status', d.status, 'select', { options: locked ? [['closed', 'Closed']] : ROSTAT })}
  ${field('VIN', 'vin', d.vin)}${field('Year', 'year', d.year)}${field('Vehicle (make model)', 'vehicle_label', d.vehicle_label)}${field('Miles in', 'miles', d.miles, 'number')}${field('Tag / hat #', 'tag', d.tag)}${field('Promised time', 'promised', d.promised, 'datetime-local')}
  ${field('Advisor', 'advisor', d.advisor || ME.user.name)}${field('Our stock vehicle (internal recon)', 'stock_vehicle_id', d.stock_vehicle_id, 'select', { options: opts(vs.filter(v => v.data.status === 'in_stock'), vehLabel, '— not a stock unit —') })}
  ${field('Manufacturer (for warranty)', 'oem', d.oem)}${field('Insurance co. (body)', 'insurer', d.insurer)}${field('Claim # (body)', 'ins_claim', d.ins_claim)}${field('Deductible', 'deductible', d.deductible, 'number')}
  ${field('Customer concern', 'concern', d.concern, 'textarea', { wide: true })}${storeSel(ro.store_id)}</div>
  <h3>Labor & parts lines</h3><div id="lines">${(d.lines || []).map((l, i) => roLine(l, i)).join('')}</div>${!locked ? `<button class="btn sec sm" type="button" onclick="addLine()">+ Add line</button>` : ''}
  ${typeof roMedia === 'function' ? roMedia(id, d) : ''}<h3>Multi-point inspection</h3><div id="insp">${(d.inspection || []).map((x, i) => inspRow(x, i)).join('')}</div>${!locked ? `<button class="btn sec sm" type="button" onclick="addInsp()">+ Add item</button> <button class="btn sec sm" type="button" onclick="stdInsp()">Load standard checklist</button>` : ''}
  <div class="f" style="margin-top:10px">${field('Shop supplies', 'shop_supplies', d.shop_supplies, 'number')}${field('Tax rate on parts %', 'tax_rate', d.tax_rate, 'number')}</div>
  <div class="calc" id="rotot" style="margin-top:10px"></div></div>
  <div class="sticky">${!locked && can('ro') ? `<button class="btn" onclick="saveRo(${id === 'new' ? 'null' : id})">Save</button>` : ''}
  ${!locked && id !== 'new' && can('ro') ? `<button class="btn sec" onclick="sendApproval(${id})">Text approval link</button><button class="btn ok" onclick="closeRo(${id})">Close RO</button>` : ''}
  ${locked && !d.paid && d.totals && d.totals.customer > 0 ? `<button class="btn ok" onclick="collectRo(${id})">Mark paid</button>` : ''}${!locked && id !== 'new' && isMgr() ? `<button class="btn sec" onclick="delRec(${id},'service')">Delete</button>` : ''}</div>
  <div class="print-only" id="roprint"></div>`);
  if (locked) $('#rof').querySelectorAll('input,select,textarea').forEach(e => e.disabled = true);
  $('#rof').addEventListener('input', () => { clearTimeout(window._rt); window._rt = setTimeout(roTot, 300); }); roTot();
}
const partOpts = () => [['', '— part —'], ...RPARTS.map(p => [p.id, `${p.data.number} ${p.data.description || ''} (${num(p.data.qty)} on hand)`])];
const roLine = (l, i) => `<div class="sub" data-sub data-line="${i}"><div class="f">${field('Op code', 'op', l.op)}${field('Description', 'desc', l.desc)}${field('Pay type', 'pay_type', l.pay_type, 'select', { options: [['customer', 'Customer pay'], ['warranty', 'Warranty'], ['internal', 'Internal']] })}${field('Technician', 'tech', l.tech)}
  ${field('Flag hours', 'hours', l.hours, 'number')}${field('Labor rate', 'rate', l.rate, 'number')}${field('Actual clock hours', 'actual_hours', l.actual_hours, 'number')}${field('Line status', 'line_status', l.line_status, 'select', { options: [['', 'Not started'], ['working', 'Working'], ['done', 'Done']] })}
  ${field('Cause / correction', 'story', l.story, 'textarea', { wide: true })}</div>
  <div class="small mut" style="margin-top:6px">Parts on this line</div><div data-plines>${(l.parts || []).map(p => partLine(p)).join('')}</div><button class="btn sec sm" type="button" onclick="addPart(this)">+ Part</button></div>`;
const partLine = p => `<div class="f" data-sub data-pline style="margin-top:6px">${field('Part', 'part_id', p.part_id, 'select', { options: partOpts(), attrs: 'onchange="partPick(this)"' })}${field('Qty', 'qty', p.qty || 1, 'number')}${field('Price each', 'price', p.price, 'number')}</div>`;
const inspRow = (x, i) => `<div class="sub f insp-${x.status || 'green'}" data-sub data-insp="${i}" data-iid="${esc(x.id || '')}">${field('Item', 'item', x.item)}${field('Condition', 'status', x.status || 'green', 'select', { options: [['green', 'Good'], ['yellow', 'Needs attention soon'], ['red', 'Needs repair now']] })}${field('Recommendation / note', 'note', x.note)}${field('Price to fix', 'price', x.price, 'number')}${typeof inspMedia === 'function' ? inspMedia(x) : ''}${x.approved != null && x.status !== 'green' ? `<span class="chip ${x.approved ? 'ok' : 'bad'}" style="align-self:end">Customer ${x.approved ? 'approved' : 'declined'}</span>` : ''}</div>`;
window.addLine = () => { const box = $('#lines'); const st = curStore(); box.insertAdjacentHTML('beforeend', roLine({ pay_type: 'customer', rate: st && st.data.labor_rate !== '' ? st.data.labor_rate : '', parts: [] }, box.children.length)); };
window.addPart = btn => btn.previousElementSibling.insertAdjacentHTML('beforeend', partLine({}));
window.partPick = sel => { const p = RPARTS.find(x => String(x.id) === sel.value); const pr = sel.closest('[data-pline]').querySelector('[data-f=price]'); if (p && !pr.value) pr.value = p.data.price; roTot(); };
window.addInsp = () => { const box = $('#insp'); box.insertAdjacentHTML('beforeend', inspRow({}, box.children.length)); };
window.stdInsp = () => { ['Front brakes', 'Rear brakes', 'Tires / tread depth', 'Battery test', 'Wiper blades', 'Engine air filter', 'Cabin air filter', 'Belts & hoses', 'Coolant', 'Brake fluid', 'Lights', 'Suspension / steering', 'Leaks'].forEach(item => { const box = $('#insp'); box.insertAdjacentHTML('beforeend', inspRow({ item, status: 'green' }, box.children.length)); }); };
function readRo() {
  const root = $('#rof'); const data = readForm(root, RD);
  data.lines = [...root.querySelectorAll('[data-line]')].map((el, i) => ({ ...readForm(el, (RD.lines || [])[i] || {}), parts: [...el.querySelectorAll('[data-pline]')].map(pl => readForm(pl)).filter(p => p.part_id) })).filter(l => l.desc || l.op || num(l.hours) || l.parts.length);
  data.inspection = [...root.querySelectorAll('[data-insp]')].map(el => ({ ...((RD.inspection || []).find(x => x.id && x.id === el.dataset.iid) || {}), ...readForm(el), id: el.dataset.iid || undefined })).filter(x => x.item);
  const c = (cache.customer || []).find(x => String(x.id) === String(data.customer_id)); data.customer_label = custName(c);
  return data;
}
window.roTot = run(async () => { const d = RD.status === 'closed' ? RD : readRo(); const t = d.status === 'closed' && d.totals ? d.totals : await api('/api/ro/totals', { data: d }); window.RT = t;
  const kv = (a, b, s) => `<div class="kv"><span>${a}</span><b style="${s ? 'font-size:18px' : ''}">${b}</b></div>`;
  $('#rotot').innerHTML = `${kv('Customer labor', $$(t.labor.customer))}${kv('Customer parts', $$(t.parts.customer))}${kv('Shop supplies', $$(t.supplies))}${kv('Tax', $$(t.tax))}${kv('Customer pays', $$(t.customer), 1)}${kv('Warranty (bills to manufacturer)', $$(t.warranty))}${kv('Internal', $$(t.internal))}${kv('Tech hours: flagged / clocked', `${t.flagged} / ${t.actual}${t.actual ? ' (' + Math.round(t.flagged / t.actual * 100) + '%)' : ''}`)}`; });
window.saveRo = run(async (id, quiet) => { const data = readRo(); const st = data._store; delete data._store;
  const r = await api('/api/save/ro', { id, store_id: st || RSTORE || STORE || (S.stores[0] && S.stores[0].id), data }); bust('ro'); if (!quiet) { toast('Saved'); go('service/' + r.id); } return r; });
window.sendApproval = run(async id => { await saveRo(id, true); const r = await api(`/api/ro/${id}/link`, {}); const c = (cache.customer || []).find(x => String(x.id) === String(RD.customer_id));
  const msg = `${S.settings.dealer_name || 'Service'}: your vehicle inspection is ready. Review and approve recommended work here: ${r.url}`;
  if (c && c.data.phone) location.href = smsLink(c.data.phone, msg); else { await navigator.clipboard.writeText(r.url).catch(() => {}); prompt('Approval link (copied):', r.url); } });
window.closeRo = run(async id => { await saveRo(id, true); const paid = confirm('Close this RO.\n\nOK = customer paid now\nCancel = charge to their account (pay later)');
  await api(`/api/ro/${id}/close`, { paid }); bust('ro', 'part', 'claim'); toast('RO closed and posted'); go('service/' + id); });
window.collectRo = run(async id => { await api(`/api/ro/${id}/collect`, {}); bust('ro'); toast('Marked paid'); go('service/' + id); });
window.printRo = () => { const d = RD.status === 'closed' ? RD : readRo(), t = window.RT || {}; const pn = id => (RPARTS.find(p => String(p.id) === String(id)) || { data: {} }).data;
  $('#roprint').innerHTML = `<div style="font-family:Arial;max-width:760px"><div style="display:flex;justify-content:space-between"><b style="font-size:20px">${esc(S.settings.dealer_name || '')}</b><div style="text-align:right">${esc(d.number || 'Repair order')}<br>${fmtD(d.closed || d.opened || today())}</div></div><hr>
  <p><b>${esc(d.customer_label || '')}</b> · ${esc(d.year || '')} ${esc(d.vehicle_label || '')} · VIN ${esc(d.vin || '')} · ${num(d.miles).toLocaleString()} mi</p><p><b>Concern:</b> ${esc(d.concern || '')}</p>
  ${(d.lines || []).map(l => `<div style="border-top:1px solid #ccc;padding:6px 0"><b>${esc(l.op || '')} ${esc(l.desc || '')}</b> <i>(${esc(l.pay_type)})</i><div>${esc(l.story || '')}</div><div style="text-align:right">Labor ${$$(num(l.hours) * num(l.rate))}</div>${(l.parts || []).map(p => `<div style="display:flex;justify-content:space-between;font-size:13px"><span>${num(p.qty)} × ${esc(pn(p.part_id).number || '')} ${esc(pn(p.part_id).description || '')}</span><span>${$$(num(p.qty) * num(p.price))}</span></div>`).join('')}</div>`).join('')}
  ${(d.inspection || []).filter(x => x.status !== 'green').map(x => `<div style="font-size:13px">${x.status === 'red' ? '🔴' : '🟡'} ${esc(x.item)} — ${esc(x.note || '')} ${x.price ? $$(x.price) : ''} ${x.approved ? '(approved)' : x.approved === false ? '(declined)' : ''}</div>`).join('')}
  <hr><div style="text-align:right">Shop supplies ${$$(t.supplies)}<br>Tax ${$$(t.tax)}<br><b style="font-size:18px">Customer total ${$$(t.customer)}</b></div><br><div style="border-top:1px solid #000;width:280px">Customer signature</div></div>`; window.print(); };

// ---------- parts ----------
VIEWS.parts = async (id) => {
  if (id === 'counter') return counterTicket();
  if (id) return partForm(id);
  const ps = (await L('part', true)).filter(inStore); const q = (sessionStorage.pq || '').toLowerCase(), low = sessionStorage.pl === '1';
  const show = ps.filter(p => (!q || (p.data.number + ' ' + p.data.description + ' ' + (p.data.bin || '')).toLowerCase().includes(q)) && (!low || num(p.data.qty) <= num(p.data.min)));
  const val = ps.reduce((s, p) => s + Math.max(0, num(p.data.qty)) * num(p.data.cost), 0);
  view(`<h1>Parts</h1><div class="bar"><input class="grow" placeholder="Part #, description, bin" value="${esc(sessionStorage.pq || '')}" oninput="sessionStorage.pq=this.value;clearTimeout(window._q);window._q=setTimeout(route,300)">
  <label class="chip" style="cursor:pointer"><input type="checkbox" ${low ? 'checked' : ''} onchange="sessionStorage.pl=this.checked?'1':'';route()"> Reorder list</label>
  ${can('part') ? `<a class="btn sec" href="#parts/counter">Counter ticket</a><a class="btn" href="#parts/new">+ Add part</a>` : ''}</div>
  <p class="mut">${ps.length} parts · inventory at cost ${$$(val)}</p>
  <div class="grid">${show.map(p => { const d = p.data, lowq = num(d.qty) <= num(d.min); return `<a class="item" href="#parts/${p.id}"><div class="row"><span class="t">${esc(d.number)}</span><span class="chip ${lowq ? 'bad' : 'ok'}">${num(d.qty)} on hand</span></div><div class="s">${esc(d.description || '')}</div><div class="s">Bin ${esc(d.bin || '—')} · cost ${$$(d.cost)} · price ${$$(d.price)}${lowq ? ' · reorder ' + Math.max(0, num(d.max || d.min * 2) - num(d.qty)) : ''}</div></a>`; }).join('') || '<p class="mut">No parts here.</p>'}</div>`);
};
async function partForm(id) {
  const p = id === 'new' ? { data: { qty: 0 } } : await api('/api/rec/' + id), d = p.data;
  view(`<div class="bar"><a href="#parts" class="btn sec sm">← Parts</a></div><h1>${id === 'new' ? 'Add part' : esc(d.number)}</h1>
  <div class="card" id="pf"><div class="f">${field('Part #', 'number', d.number)}${field('Description', 'description', d.description)}${field('Manufacturer / brand', 'brand', d.brand)}${field('Bin', 'bin', d.bin)}
  ${field('List price', 'price', d.price, 'number')}${field('Reorder at (min)', 'min', d.min, 'number')}${field('Stock up to (max)', 'max', d.max, 'number')}
  ${field('Vendor', 'vendor', d.vendor)}${field('Source', 'source', d.source, 'select', { options: ['', 'OEM stock order', 'Aftermarket', 'Special order', 'Local buy'] })}${field('Special order for (customer / RO)', 'special_for', d.special_for)}${storeSel(p.store_id)}</div>
  ${id !== 'new' ? `<div class="kv" style="margin-top:10px"><span>Average cost (set by receiving)</span><b>${$$(d.cost)}</b></div><div class="kv"><span>On hand</span><b>${num(d.qty)}</b></div><div class="kv"><span>Last received</span><b>${fmtD(d.last_received) || '—'}</b></div>` : ''}</div>
  <div class="sticky">${can('part') ? `<button class="btn" onclick="savePart(${id === 'new' ? 'null' : id})">Save</button>` : ''}${id !== 'new' && can('part') ? `<button class="btn ok" onclick="receive(${id},1)">Receive stock</button><button class="btn sec" onclick="receive(${id},-1)">Count adjustment</button>` : ''}</div>`);
  window.PD = d;
}
window.savePart = run(async id => { const data = readForm($('#pf'), PD); delete data.qty; data.qty = PD.qty || 0; if (!data.number) throw new Error('Enter a part #'); const st = data._store; delete data._store;
  const r = await api('/api/save/part', { id, store_id: st || STORE || (S.stores[0] && S.stores[0].id), data }); bust('part'); toast('Saved'); go('parts/' + r.id); });
window.receive = run(async (id, sign) => {
  if (sign > 0) { const q = prompt('Quantity received'); if (!q) return; const c = prompt('Cost each'); if (c === null || c === '') return; await api(`/api/part/${id}/receive`, { qty: num(q), cost: num(c) }); }
  else { const q = prompt('Count adjustment: how many to add (+) or remove (−)? Posted at average cost.'); if (!q) return; await api(`/api/part/${id}/receive`, { qty: num(q), mode: 'adjust' }); }
  bust('part'); toast('Updated'); go('parts/' + id); });
async function counterTicket() {
  const ps = await L('part', true); window.RPARTS = ps; const st = curStore();
  view(`<div class="bar"><a href="#parts" class="btn sec sm">← Parts</a></div><h1>Counter ticket</h1><div class="card" id="ct"><div class="f">${field('Customer / shop name', 'customer', '')}${field('Tax rate %', 'tax_rate', st && st.data.tax_rate, 'number')}</div>
  <div data-plines>${partLine({})}</div><button class="btn sec sm" type="button" onclick="addPart(this)">+ Part</button></div><div class="sticky"><button class="btn ok" onclick="sellCounter()">Sell & post</button></div>`);
}
window.sellCounter = run(async () => { const root = $('#ct'); const lines = [...root.querySelectorAll('[data-pline]')].map(pl => readForm(pl)).filter(p => p.part_id);
  const top = { customer: root.querySelector('[data-f=customer]').value, tax_rate: num(root.querySelector('[data-f=tax_rate]').value) };
  const r = await api('/api/parts/counter', { ...top, lines, store_id: STORE || null }); bust('part'); toast(`Ticket ${r.invoice}: ${$$(r.total)} collected`); go('parts'); });

// ---------- warranty ----------
VIEWS.warranty = async () => {
  const cl = (await L('claim', true)).filter(inStore); const st = sessionStorage.wf || 'open';
  const show = cl.filter(c => st === 'open' ? ['to_submit', 'submitted'].includes(c.data.status) : st === 'all' || c.data.status === st);
  const sum = s => cl.filter(c => c.data.status === s).reduce((a, c) => a + num(c.data.amount), 0);
  view(`<h1>Warranty claims</h1><div class="tiles"><div class="tile"><span>To submit</span><b>${$$(sum('to_submit'), 0)}</b></div><div class="tile"><span>Submitted, waiting</span><b>${$$(sum('submitted'), 0)}</b></div><div class="tile"><span>Chargebacks (all time)</span><b>${$$(cl.reduce((a, c) => a + num(c.data.chargeback), 0), 0)}</b></div></div>
  <div class="bar"><select onchange="sessionStorage.wf=this.value;route()">${[['open', 'Open'], ['to_submit', 'To submit'], ['submitted', 'Submitted'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['all', 'All']].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <div class="grid">${show.map(c => { const d = c.data; return `<div class="card"><div class="row"><b>${esc(d.ro)} · ${esc(d.oem || 'OEM')}</b><span class="chip ${d.status === 'paid' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}">${esc(d.status.replace('_', ' '))}</span></div>
  <div class="small mut">${esc(d.line || '')} · ${esc(d.op || '')} · VIN ${esc(d.vin || '')}</div><div class="kv"><span>Claim amount</span><b>${$$(d.amount)}</b></div>${d.claim_no ? `<div class="kv"><span>Claim #</span><b>${esc(d.claim_no)}</b></div>` : ''}${d.paid_amount != null ? `<div class="kv"><span>Paid / chargeback</span><b>${$$(d.paid_amount)} / ${$$(d.chargeback)}</b></div>` : ''}
  ${can('claim') && ['to_submit', 'submitted'].includes(d.status) ? `<div class="bar" style="margin:8px 0 0">${d.status === 'to_submit' ? `<button class="btn sm" onclick="claim(${c.id},'submitted')">Mark submitted</button>` : ''}<button class="btn ok sm" onclick="claim(${c.id},'paid')">Paid</button><button class="btn bad sm" onclick="claim(${c.id},'rejected')">Rejected</button></div>` : ''}</div>`; }).join('') || '<p class="mut">No claims here. Claims are created when an RO with warranty lines is closed.</p>'}</div>
  <p class="mut small">Submitting directly to a manufacturer's warranty system requires that manufacturer's DMS certification. Until then, enter claims in the OEM portal and track them here.</p>`);
};
window.claim = run(async (id, status) => { const b = { status }; if (status === 'submitted') { b.claim_no = prompt('OEM claim #') || ''; } if (status === 'paid') { const a = prompt('Amount paid'); if (a === null) return; b.paid_amount = num(a); } if (status === 'rejected') { b.note = prompt('Reason') || ''; if (!confirm('Reject this claim? The full amount becomes a chargeback.')) return; }
  await api('/api/claim/' + id, b); bust('claim'); toast('Updated'); route(); });

// ---------- accounting ----------
VIEWS.books = async () => {
  const tab = sessionStorage.bt || 'pl', m = today().slice(0, 8) + '01';
  const from = sessionStorage.bfrom || m, to = sessionStorage.bto || today();
  const qs = `?from=${from}&to=${to}${STORE ? '&store=' + STORE : ''}`;
  view(`<h1>Accounting</h1><div class="tabs">${[['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['jr', 'Journal'], ['je', 'Manual entry'], ['fp', 'Floorplan'], ['coa', 'Chart of accounts'], ['bills', 'Bills & vendors'], ['bank', 'Bank reconciliation'], ['oem', 'Factory statement'], ['close', 'Close the books']].map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" onclick="sessionStorage.bt='${k}';route()">${t}</a>`).join('')}</div>
  ${['pl', 'tb', 'jr', 'oem'].includes(tab) ? `<div class="bar"><label class="l">From<input type="date" value="${from}" onchange="sessionStorage.bfrom=this.value;route()"></label><label class="l">To<input type="date" value="${to}" onchange="sessionStorage.bto=this.value;route()"></label></div>` : ''}<div class="card" id="bk">Loading…</div>`);
  const B = $('#bk');
  if (tab === 'pl') { const tb = await api('/api/trial' + qs); const depts = {};
    tb.filter(r => ['income', 'expense'].includes(r.type)).forEach(r => { const k = r.dept || 'Other'; (depts[k] = depts[k] || []).push(r); });
    let tot = 0; B.innerHTML = Object.entries(depts).map(([dpt, rs]) => { const g = rs.reduce((s, r) => s - r.bal, 0); tot += g; return `<h3>${esc(dpt)}</h3><table class="tbl">${rs.map(r => `<tr><td>${esc(r.acct)} ${esc(r.name)}</td><td class="n">${$$(-r.bal)}</td></tr>`).join('')}<tr><td><b>${esc(dpt)} net</b></td><td class="n"><b>${$$(g)}</b></td></tr></table>`; }).join('') + `<div class="kv" style="margin-top:12px"><span><b>Net profit</b></span><b style="font-size:18px">${$$(tot)}</b></div><p class="mut small">Grouped by department to match the way manufacturers and lenders ask for statements. Map accounts to an OEM's statement lines in the chart of accounts.</p>`; }
  if (tab === 'bs') { const tb = await api('/api/trial?to=' + today() + (STORE ? '&store=' + STORE : '')); const sec = t => tb.filter(r => r.type === t);
    const ni = tb.filter(r => ['income', 'expense'].includes(r.type)).reduce((s, r) => s - r.bal, 0);
    const blk = (t, sign, extra) => { const rs = sec(t); const s = rs.reduce((a, r) => a + sign * r.bal, 0) + (extra || 0); return [`<h3>${t}</h3><table class="tbl">${rs.map(r => `<tr><td>${esc(r.acct)} ${esc(r.name)}</td><td class="n">${$$(sign * r.bal)}</td></tr>`).join('')}${extra != null ? `<tr><td>Current earnings</td><td class="n">${$$(extra)}</td></tr>` : ''}<tr><td><b>Total ${t}</b></td><td class="n"><b>${$$(s)}</b></td></tr></table>`, s]; };
    const [a, as] = blk('asset', 1), [l, ls] = blk('liability', -1), [e, es] = blk('equity', -1, ni);
    B.innerHTML = a + l + e + `<div class="kv"><span>Liabilities + equity</span><b>${$$(ls + es)}</b></div>${Math.abs(as - ls - es) > 0.01 ? '<p class="chip bad">Out of balance — check manual entries</p>' : '<p class="chip ok">Balanced</p>'}`; }
  if (tab === 'tb') { const tb = await api('/api/trial' + qs); const D = tb.reduce((s, r) => s + r.d, 0), K = tb.reduce((s, r) => s + r.k, 0);
    B.innerHTML = `<table class="tbl"><tr><th>Account</th><th class="n">Debits</th><th class="n">Credits</th><th class="n">Net</th></tr>${tb.map(r => `<tr><td>${esc(r.acct)} ${esc(r.name)}</td><td class="n">${$$(r.d)}</td><td class="n">${$$(r.k)}</td><td class="n">${$$(r.bal)}</td></tr>`).join('')}<tr><td><b>Totals</b></td><td class="n"><b>${$$(D)}</b></td><td class="n"><b>${$$(K)}</b></td><td></td></tr></table>`; }
  if (tab === 'jr') { const j = await api('/api/journal' + qs); const by = {}; j.forEach(x => (by[x.entry] = by[x.entry] || []).push(x));
    B.innerHTML = Object.entries(by).slice(0, 300).map(([e, ls]) => `<div class="sub"><div class="row"><b>${esc(e)} · ${fmtD(ls[0].date.slice ? ls[0].date.slice(0, 10) : ls[0].date)}</b><span class="mut small">${esc(ls[0].src)} · ${esc(ls[0].by_user || '')}</span></div><div class="small">${esc(ls[0].memo)}</div><table class="tbl"><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th></tr>${ls.map(x => `<tr><td>${esc(x.acct)}</td><td class="n">${num(x.debit) ? $$(x.debit) : ''}</td><td class="n">${num(x.credit) ? $$(x.credit) : ''}</td></tr>`).join('')}</table></div>`).join('') || '<p class="mut">No entries in this range.</p>'; }
  if (tab === 'je') { const accts = await L('account'); const ao = accts.map(a => [a.data.no, a.data.no + ' ' + a.data.name]).sort();
    const line = () => `<div class="f" data-sub data-jl>${field('Account', 'acct', '', 'select', { options: [['', '— account —'], ...ao] })}${field('Debit', 'debit', '', 'number')}${field('Credit', 'credit', '', 'number')}</div>`;
    window._jl = line; B.innerHTML = can('journal') ? `<div class="f" id="jh">${field('Date', 'date', today(), 'date')}${field('Memo', 'memo', '')}</div><div id="jls">${line()}${line()}</div><button class="btn sec sm" onclick="$('#jls').insertAdjacentHTML('beforeend',_jl())">+ Line</button> <button class="btn" onclick="postJE()">Post entry</button>` : '<p class="mut">Your role can’t post entries.</p>'; }
  if (tab === 'fp') { const vs = (await L('vehicle', true)).filter(inStore).filter(v => v.data.floorplan_lender && v.data.status === 'in_stock');
    const rows = vs.map(v => { const days = Math.round((Date.now() - new Date((v.data.acquired || today()) + 'T12:00:00')) / 864e5); const int = num(v.data.floorplan_amount) * num(v.data.floorplan_rate) / 100 / 365 * days; return { v, days, int }; }).sort((a, b) => b.days - a.days);
    B.innerHTML = `<table class="tbl"><tr><th>Unit</th><th class="n">Days</th><th class="n">Floored</th><th class="n">Interest so far</th></tr>${rows.map(r => `<tr><td><a href="#inventory/${r.v.id}">${esc(vehLabel(r.v))}</a><br><span class="mut small">${esc(r.v.data.floorplan_lender)}</span></td><td class="n" style="color:${r.days > 90 ? 'var(--bad)' : 'inherit'}">${r.days}</td><td class="n">${$$(r.v.data.floorplan_amount)}</td><td class="n">${$$(r.int)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td class="n"><b>${$$(rows.reduce((s, r) => s + num(r.v.data.floorplan_amount), 0))}</b></td><td class="n"><b>${$$(rows.reduce((s, r) => s + r.int, 0))}</b></td></tr></table><p class="mut small">Units past 90 days usually owe a curtailment payment — check your lender's terms. Floorplan is paid off and interest posted automatically when the unit is delivered.</p>`; }
  if (typeof booksExtra === 'function' && await booksExtra(tab, B, qs, from, to)) return;
  if (tab === 'coa') { const accts = (await L('account', true)).sort((a, b) => a.data.no > b.data.no ? 1 : -1);
    B.innerHTML = `${accts.map(a => `<div class="kv"><span>${esc(a.data.no)} ${esc(a.data.name)}</span><b>${esc(a.data.type)} · ${esc(a.data.dept || '')}${a.data.oem_line ? ' · OEM ' + esc(a.data.oem_line) : ''}</b></div>`).join('')}
    ${can('account') ? `<h3>Add account</h3><div class="f" id="coaf">${field('Number', 'no', '')}${field('Name', 'name', '')}${field('Type', 'type', 'expense', 'select', { options: ['asset', 'liability', 'equity', 'income', 'expense'] })}${field('Department', 'dept', '', 'select', { options: ['', 'New', 'Used', 'F&I', 'BHPH', 'Service', 'Parts', 'Body', 'Overhead'] })}${field('OEM statement line', 'oem_line', '')}</div><button class="btn" style="margin-top:8px" onclick="addAcct()">Add</button>` : ''}`; }
};
window.postJE = run(async () => { const h = readForm($('#jh')); const lines = [...document.querySelectorAll('[data-jl]')].map(el => readForm(el)).filter(l => l.acct);
  const r = await api('/api/journal', { ...h, lines, store_id: STORE || null }); toast('Posted ' + r.entry); sessionStorage.bt = 'jr'; route(); });
window.addAcct = run(async () => { const d = readForm($('#coaf')); if (!d.no || !d.name) throw new Error('Number and name'); if ((cache.account || []).some(a => a.data.no === d.no)) throw new Error('That number is used'); await api('/api/save/account', { data: d }); bust('account'); toast('Added'); route(); });

// ---------- reports ----------
VIEWS.reports = async () => {
  const tab = sessionStorage.rt || 'gross';
  view(`<h1>Reports</h1><div class="tabs">${[['gross', 'Deal gross log'], ['aging', 'Inventory aging'], ['deliq', 'Delinquency'], ['tech', 'Tech efficiency'], ['opp', 'Sales opportunities'], ['audit', 'Audit log'], ['export', 'Export data']].map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" onclick="sessionStorage.rt='${k}';route()">${t}</a>`).join('')}</div><div class="card" id="rp">Loading…</div>`);
  const R = $('#rp');
  if (tab === 'gross') { const ds = (await L('deal', true)).filter(inStore).filter(d => d.data.status === 'delivered').slice(0, 300); const cs = await L('customer');
    const T = ds.reduce((a, d) => { const k = d.data.calc || {}; a.f += num(k.front); a.b += num(k.back); return a; }, { f: 0, b: 0 });
    R.innerHTML = `<table class="tbl"><tr><th>Deal</th><th class="n">Front</th><th class="n">Back</th><th class="n">Total</th></tr>${ds.map(d => { const k = d.data.calc || {}; return `<tr><td><a href="#deals/${d.id}">${esc(d.data.number)}</a> ${fmtD(d.data.delivered)}<br><span class="mut small">${esc(custName(cs.find(c => String(c.id) === String(d.data.customer_id))))} · ${esc(d.data.salesperson || '')} · ${esc(DTYPE[d.data.type])}</span></td><td class="n">${$$(k.front, 0)}</td><td class="n">${$$(k.back, 0)}</td><td class="n">${$$(k.gross, 0)}</td></tr>`; }).join('')}<tr><td><b>${ds.length} deals</b></td><td class="n"><b>${$$(T.f, 0)}</b></td><td class="n"><b>${$$(T.b, 0)}</b></td><td class="n"><b>${$$(T.f + T.b, 0)}</b></td></tr></table>`; }
  if (tab === 'aging') { const vs = (await L('vehicle', true)).filter(inStore).filter(v => v.data.status === 'in_stock').map(v => ({ v, days: Math.round((Date.now() - new Date((v.data.acquired || today()) + 'T12:00:00')) / 864e5), cost: num(v.data.cost) + (v.data.recon || []).reduce((s, x) => s + num(x.cost), 0) })).sort((a, b) => b.days - a.days);
    R.innerHTML = `<table class="tbl"><tr><th>Unit</th><th class="n">Days</th><th class="n">Cost</th><th class="n">Price</th><th class="n">Spread</th></tr>${vs.map(x => `<tr><td><a href="#inventory/${x.v.id}">${esc(vehLabel(x.v))}</a></td><td class="n" style="color:${x.days > 60 ? 'var(--bad)' : 'inherit'}">${x.days}</td><td class="n">${$$(x.cost, 0)}</td><td class="n">${$$(x.v.data.price, 0)}</td><td class="n">${$$(num(x.v.data.price) - x.cost, 0)}</td></tr>`).join('')}</table>`; }
  if (tab === 'deliq') { const ls = (await api('/api/loans')).filter(inStore).filter(l => l.data.status === 'active'); const bk = {};
    ls.forEach(l => { const b = bk[l.status.bucket] = bk[l.status.bucket] || { n: 0, bal: 0, pd: 0 }; b.n++; b.bal += l.status.balance; b.pd += l.status.pastDue; }); const tot = ls.reduce((s, l) => s + l.status.balance, 0);
    R.innerHTML = `<table class="tbl"><tr><th>Days late</th><th class="n">Accounts</th><th class="n">Balance</th><th class="n">% of book</th><th class="n">Past due</th></tr>${['current', '1-15', '16-30', '31-60', '60+'].map(k => { const b = bk[k] || { n: 0, bal: 0, pd: 0 }; return `<tr><td>${k}</td><td class="n">${b.n}</td><td class="n">${$$(b.bal, 0)}</td><td class="n">${tot ? (b.bal / tot * 100).toFixed(1) : 0}%</td><td class="n">${$$(b.pd, 0)}</td></tr>`; }).join('')}<tr><td><b>Total</b></td><td class="n"><b>${ls.length}</b></td><td class="n"><b>${$$(tot, 0)}</b></td><td></td><td></td></tr></table>`; }
  if (tab === 'tech') { const ros = (await L('ro', true)).filter(inStore).filter(r => r.data.status === 'closed'); const t = {};
    ros.forEach(r => (r.data.lines || []).forEach(l => { const k = l.tech || '(none)'; const x = t[k] = t[k] || { f: 0, a: 0, n: 0 }; x.f += num(l.hours); x.a += num(l.actual_hours); x.n++; }));
    R.innerHTML = `<table class="tbl"><tr><th>Technician</th><th class="n">Lines</th><th class="n">Flagged hrs</th><th class="n">Clocked hrs</th><th class="n">Efficiency</th></tr>${Object.entries(t).map(([k, x]) => `<tr><td>${esc(k)}</td><td class="n">${x.n}</td><td class="n">${x.f.toFixed(1)}</td><td class="n">${x.a.toFixed(1)}</td><td class="n">${x.a ? Math.round(x.f / x.a * 100) + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="mut">No closed ROs yet.</td></tr>'}</table>`; }
  if (tab === 'opp') { const o = await api('/api/opportunities');
    R.innerHTML = `<h3>In-house customers in good standing, more than half paid</h3>${o.equity.map(x => `<div class="kv"><span><a href="#accounts/${x.loan_id}">${esc(x.name)}</a> · ${esc(x.vehicle)} ${x.phone ? `· <a href="${telLink(x.phone)}">${esc(x.phone)}</a>` : ''}</span><b>${x.paidPct}% paid · payoff ${$$(x.payoff, 0)}</b></div>`).join('') || '<p class="mut small">None yet.</p>'}
    <h3>Service customers with older or high-mile vehicles</h3>${o.service.map(x => `<div class="kv"><span>${esc(x.name)} · ${esc(x.vehicle)} ${x.phone ? `· <a href="${telLink(x.phone)}">${esc(x.phone)}</a>` : ''}</span><b>${num(x.miles).toLocaleString()} mi · ${esc(x.ro)}</b></div>`).join('') || '<p class="mut small">None yet.</p>'}`; }
  if (tab === 'audit') { if (!isMgr()) { R.innerHTML = '<p class="mut">Managers only.</p>'; return; } const a = await api('/api/audit');
    R.innerHTML = a.map(x => `<div class="kv"><span>${new Date(x.at).toLocaleString()} · ${esc(x.who)}</span><b style="font-weight:500">${esc(x.action)} ${esc(x.kind || '')} ${x.ref || ''}</b></div>`).join(''); }
  if (tab === 'export' && typeof exportExtra === 'function') { R.innerHTML = exportExtra(); return; }
  if (tab === 'export') R.innerHTML = `<p>Your data is yours. Download everything — every record and every journal line — as one file you can keep, load into another system or hand to your accountant.</p><a class="btn" href="/api/export">Download all data (JSON)</a>`;
};

// ---------- settings ----------
VIEWS.settings = async () => {
  if (!isMgr()) { view('<p class="mut">Managers only.</p>'); return; }
  const tab = sessionStorage.st || 'dealer';
  view(`<h1>Settings</h1><div class="tabs">${[['dealer', 'Dealership'], ['stores', 'Stores'], ['users', 'Users'], ['products', 'F&I products'], ['lenders', 'Lenders'], ['website', 'Website & leads'], ['integrations', 'Integrations']].map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" onclick="sessionStorage.st='${k}';route()">${t}</a>`).join('')}</div><div id="sp" class="card">Loading…</div>`);
  const P = $('#sp');
  if (tab === 'dealer') { const s = (await L('settings', true))[0]; window.SET = s;
    P.innerHTML = `<div class="f" id="setf">${field('Dealer / group name', 'dealer_name', s.data.dealer_name)}${field('Main phone', 'phone', s.data.phone, 'tel')}${field('Owner mobile (for sign-in code)', 'owner_phone', s.data.owner_phone, 'tel')}${field('Online payment link (from your processor)', 'pay_link', s.data.pay_link, 'url', { wide: true })}
    ${field('Payment reminder text', 'sms_reminder', s.data.sms_reminder, 'textarea', { wide: true })}${field('Lead auto-reply text', 'lead_reply', s.data.lead_reply, 'textarea', { wide: true })}</div>
    <p class="mut small">Text fill-ins: {first} {dealer} {amount} {due} {paylink} {phone} {vehicle}. Customers check their balance at <b>${location.origin}/pay</b> with their account # and last name.</p><button class="btn" onclick="saveSet()">Save</button>`; }
  if (tab === 'stores') { const ss = await L('store', true);
    P.innerHTML = ss.map(s => storeBox(s)).join('') + (ME.user.role === 'owner' ? `<button class="btn sec" onclick="$('#sp').insertAdjacentHTML('beforeend',storeBox({data:{}}))">+ Add store</button>` : ''); }
  if (tab === 'users') { const us = await L('user', true);
    P.innerHTML = `<p class="mut small">Each person signs in with their own PIN. The owner PIN set on the server always works.</p>${us.map(u => userBox(u)).join('')}<button class="btn sec" onclick="$('#sp').insertAdjacentHTML('beforeend',userBox({data:{role:'sales',active:true}}))">+ Add user</button>`; }
  if (tab === 'products') { const ps = await L('product', true);
    P.innerHTML = ps.map(p => prodBox(p)).join('') + `<button class="btn sec" onclick="$('#sp').insertAdjacentHTML('beforeend',prodBox({data:{}}))">+ Add product</button>`; }
  if (tab === 'lenders') { const ls = await L('lender', true);
    P.innerHTML = ls.map(l => lenderBox(l)).join('') + `<button class="btn sec" onclick="$('#sp').insertAdjacentHTML('beforeend',lenderBox({data:{}}))">+ Add lender</button>`; }
  if (typeof settingsExtra === 'function' && await settingsExtra(tab, P)) return;
  if (tab === 'integrations') P.innerHTML = `<p>These connect once you have an account with the provider. Everything else in the app works without them.</p>
    ${[['Card & ACH payments', 'Stripe, Repay, or your processor. Paste a payment link under Dealership now; full autopay needs an API key.'], ['Texting', 'Today the app opens your phone’s messaging app with the text filled in. Two-way texting from the app needs Twilio.'], ['Credit bureau reporting (Metro 2)', 'Needs a data-furnisher agreement with Equifax, Experian and TransUnion.'], ['Credit pulls', '700Credit or a bureau reseller account.'], ['Lender submission', 'RouteOne or Dealertrack dealer account.'], ['GPS / starter interrupt', 'PassTime, Spireon/GoldStar, iMetrik — API keys from your provider. Actions are logged now and sent once connected.'], ['Website & listings', 'Inventory feed to CarGurus, Autotrader, Facebook Marketplace.'], ['Manufacturer (OEM) systems', 'Warranty submission, parts ordering and incentives need certification by each manufacturer.'], ['E-sign', 'DocuSign or similar for contracts.'], ['QuickBooks', 'Export journal from Reports → Export data, or connect the QuickBooks API.']].map(([a, b]) => `<div class="kv"><span><b>${a}</b><br><span class="small">${b}</span></span><b><span class="chip warn">Not connected</span></b></div>`).join('')}
    <h3>Open API</h3><p class="small">Other systems can read and write records with the API token set on the server (header <code>Authorization: Bearer …</code>). No integration fees.</p>`;
};
window.storeBox = s => `<div class="sub" data-store="${s.id || ''}"><div class="f">${field('Store name', 'name', s.data.name)}${field('Address', 'address', s.data.address)}${field('Phone', 'phone', s.data.phone)}${field('State', 'state', s.data.state)}${field('Dealer license #', 'license', s.data.license)}
  ${field('Sales tax %', 'tax_rate', s.data.tax_rate, 'number')}${field('Doc fee', 'doc_fee', s.data.doc_fee, 'number')}${field('Late fee', 'late_fee', s.data.late_fee, 'number')}${field('Grace days', 'grace_days', s.data.grace_days, 'number')}${field('Shop labor rate', 'labor_rate', s.data.labor_rate, 'number')}
${typeof storeExtra === 'function' ? storeExtra(s) : ''}  ${field('Trade-in reduces taxable price?', 'trade_tax_credit', s.data.trade_tax_credit === true ? 'yes' : s.data.trade_tax_credit === false ? 'no' : '', 'select', { options: [['', '— pick —'], ['yes', 'Yes'], ['no', 'No']] })}
  ${field('In-house payment order', 'pay_order', s.data.pay_order, 'select', { options: [['', '— pick —'], ['fees_first', 'Fees, then interest, then principal'], ['fees_last', 'Interest, then principal, then fees']] })}</div>${ME.user.role === 'owner' ? `<button class="btn sm" style="margin-top:8px" onclick="saveBox(this,'store')">Save store</button>` : ''}</div>`;
window.userBox = u => `<div class="sub" data-uid="${u.id || ''}"><div class="f">${field('Name', 'name', u.data.name)}${field('Role', 'role', u.data.role, 'select', { options: ME.roles.filter(r => r !== 'owner' || ME.user.role === 'owner') })}${field(u.id ? 'New PIN (leave blank to keep)' : 'PIN (4–8 digits)', 'pin', '', 'password', { attrs: 'inputmode="numeric" autocomplete="new-password"' })}
  ${field('Mobile (for sign-in code)', 'phone', u.data.phone, 'tel')}${field('Limit to store', 'store_id', u.data.store_id, 'select', { options: [['', 'All stores'], ...S.stores.map(s => [s.id, s.data.name || 'Unnamed store'])] })}${field('Active', 'active', u.data.active !== false, 'check')}</div><button class="btn sm" style="margin-top:8px" onclick="saveBox(this,'user')">Save user</button></div>`;
window.prodBox = p => `<div class="sub" data-pid="${p.id || ''}"><div class="f">${field('Product', 'name', p.data.name)}${field('Provider', 'provider', p.data.provider)}${field('Term / coverage', 'term', p.data.term)}${field('Price to customer', 'price', p.data.price, 'number')}${field('Dealer cost', 'cost', p.data.cost, 'number')}${field('Menu description', 'description', p.data.description, 'text', { wide: true })}</div><button class="btn sm" style="margin-top:8px" onclick="saveBox(this,'product')">Save product</button></div>`;
window.lenderBox = l => `<div class="sub" data-lid="${l.id || ''}"><div class="f">${field('Lender', 'name', l.data.name)}${field('Contact / rep', 'contact', l.data.contact)}${field('Phone', 'phone', l.data.phone)}${field('Typical buy rate %', 'buy_rate', l.data.buy_rate, 'number')}${field('Max reserve %', 'reserve', l.data.reserve, 'number')}${field('Floorplan lender', 'floorplan', l.data.floorplan, 'check')}${field('Notes (stips, programs)', 'notes', l.data.notes, 'text', { wide: true })}</div><button class="btn sm" style="margin-top:8px" onclick="saveBox(this,'lender')">Save lender</button></div>`;
window.saveBox = run(async (btn, kind) => { const box = btn.closest('.sub'); const id = box.dataset.store || box.dataset.uid || box.dataset.pid || box.dataset.lid || null; const old = (cache[kind] || []).find(x => String(x.id) === String(id));
  const data = readForm(box, old ? old.data : {}); if (kind === 'store') data.trade_tax_credit = data.trade_tax_credit === 'yes' ? true : data.trade_tax_credit === 'no' ? false : null;
  if (kind === 'user' && data.store_id) data.store_id = Number(data.store_id); if (kind === 'user' && !data.pin) delete data.pin;
  await api('/api/save/' + kind, { id: id ? Number(id) : null, data }); bust(kind); if (kind === 'store') S.stores = await L('store', true); toast('Saved'); route(); });
window.saveSet = run(async () => { const data = readForm($('#setf'), SET.data); await api('/api/save/settings', { id: SET.id, data }); bust('settings'); S.settings = data; toast('Saved'); });

// start after every script on the page (app2.js adds pages) has loaded
window.addEventListener('DOMContentLoaded', () => boot().catch(e => { $('#main').innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p>`; }));
