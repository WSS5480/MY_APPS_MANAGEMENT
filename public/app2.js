// Dealer System add-on screens: appraisals, forms & e-signatures, license scan, cashier drawer, insurance alerts,
// bills, bank reconciliation, factory statement, closing the books, exports, payroll & time clock, website & feeds,
// integrations, shop capacity, inspection photos/video, offline notice.
'use strict';
const fileToJpeg = async (f, max = 900) => { const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = URL.createObjectURL(f); });
  const c = document.createElement('canvas'), s = Math.min(1, max / Math.max(img.width, img.height)); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.72); };
const sumFees = st => ['title_fee', 'registration_fee', 'inspection_fee', 'other_fees'].reduce((a, k) => a + num(st && st.data[k]), 0);
const storeOf = id => S.stores.find(s => String(s.id) === String(id)) || curStore();

// ---------- vehicle: Buyers Guide details, website listing, market price, history, transfer ----------
window.vehExtra = d => `<h3>Buyers Guide (FTC)</h3><div class="f">
  ${field('Warranty', 'warranty', d.warranty || '', 'select', { options: [['', '— pick —'], ['as_is', 'As is — no dealer warranty'], ['implied', 'Implied warranties only'], ['warranty', 'Dealer warranty']] })}
  ${field('Dealer warranty type', 'bg.type', d.bg && d.bg.type, 'select', { options: ['', 'Full', 'Limited'] })}${field('Dealer pays % labor', 'bg.labor', d.bg && d.bg.labor, 'number')}${field('Dealer pays % parts', 'bg.parts', d.bg && d.bg.parts, 'number')}
  ${field('Systems covered', 'bg.systems', d.bg && d.bg.systems)}${field('Duration', 'bg.duration', d.bg && d.bg.duration)}
  ${field("Manufacturer's warranty still applies", 'bg.mfr', d.bg && d.bg.mfr, 'check')}${field("Manufacturer's used-car warranty applies", 'bg.mfr_used', d.bg && d.bg.mfr_used, 'check')}${field('Other used-car warranty applies', 'bg.other', d.bg && d.bg.other, 'check')}${field('Service contract available', 'bg.service_contract', d.bg && d.bg.service_contract, 'check')}</div>
  <h3>Website listing</h3><div class="f">${field('Hide from website & listing feeds', 'hide_web', d.hide_web, 'check')}${field('Website description', 'web_notes', d.web_notes, 'textarea', { wide: true })}</div>
  ${d.market ? `<div class="kv"><span>Market price (MarketCheck, ${fmtD(d.market.checked)})</span><b>${$$(d.market.price, 0)} · ${d.market.price ? Math.round(num(d.price) / d.market.price * 100) + '% to market' : ''}</b></div>` : ''}`;
window.vehButtons = (id, d) => id === 'new' ? '' : `<button class="btn sec" onclick="marketPrice(${id})">Market price</button><button class="btn sec" data-vin="${esc(d.vin || '')}" onclick="vehHistory(this.dataset.vin)">History report</button><button class="btn sec" onclick="buyersGuide()">Buyers Guide sheet</button>${isMgr() && !ME.user.store_id && S.stores.length > 1 && ['in_stock', 'hold', 'in_transit'].includes(d.status) ? `<button class="btn sec" onclick="transferUnit(${id})">Move to store</button>` : ''}`;
window.marketPrice = run(async id => { const r = await api('/api/market/vehicle/' + id, {}); toast(`Market ${$$(r.price, 0)}${r.toMarket ? ' · you’re at ' + r.toMarket + '%' : ''}`); route(); });
window.vehHistory = run(async vin => { if (!vin) throw new Error('Add the VIN first'); const r = await api('/api/history/' + encodeURIComponent(vin));
  const w = window.open('', '_blank'); w.document.write(`<pre style="white-space:pre-wrap;font:13px monospace">${esc(JSON.stringify(r, null, 2))}</pre>`); });
window.transferUnit = run(async id => { const cur = (await api('/api/rec/' + id)).store_id; const others = S.stores.filter(s => String(s.id) !== String(cur));
  const pick = prompt('Move to which store?\n' + others.map((s, i) => `${i + 1}. ${s.data.name || 'Unnamed store'}`).join('\n')); const s = others[num(pick) - 1]; if (!s) return;
  await api(`/api/vehicle/${id}/transfer`, { to_store: s.id }); bust('vehicle'); toast('Moved — intercompany entries posted'); route(); });
window.buyersGuide = () => { const d = readForm($('#vf'), VD); const b = d.bg || {};
  const html = `<div style="font-family:Arial;max-width:700px"><h2>Buyers Guide — fill-in details</h2><p>Copy these onto the official FTC Buyers Guide (English, and Spanish when the sale is conducted in Spanish). The FTC sets the form's wording and layout, so use the official form: <b>ftc.gov → "Dealer's Guide to the Used Car Rule"</b>.</p>
  <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr><td>Make / Model / Year</td><td>${esc([d.make, d.model, d.year].join(' / '))}</td></tr><tr><td>VIN</td><td>${esc(d.vin || '')}</td></tr><tr><td>Stock #</td><td>${esc(d.stock || '')}</td></tr>
  <tr><td>Box to check</td><td><b>${{ as_is: 'AS IS – NO DEALER WARRANTY', implied: 'IMPLIED WARRANTIES ONLY', warranty: 'DEALER WARRANTY' + (b.type ? ' – ' + b.type.toUpperCase() : '') }[d.warranty] || '— not chosen —'}</b></td></tr>
  ${d.warranty === 'warranty' ? `<tr><td>Dealer pays</td><td>${esc(b.labor || '')}% of labor, ${esc(b.parts || '')}% of parts</td></tr><tr><td>Systems covered / duration</td><td>${esc(b.systems || '')} / ${esc(b.duration || '')}</td></tr>` : ''}
  <tr><td>Non-dealer warranties</td><td>${[b.mfr && "Manufacturer's warranty still applies", b.mfr_used && "Manufacturer's used car warranty applies", b.other && 'Other used car warranty applies'].filter(Boolean).join('; ') || 'None checked'}</td></tr>
  <tr><td>Service contract</td><td>${b.service_contract ? 'Available' : 'Not offered'}</td></tr></table></div>`;
  printHtml(html); };
function printHtml(html) { let box = document.getElementById('xprint'); if (!box) { box = document.createElement('div'); box.id = 'xprint'; box.className = 'print-only'; document.body.appendChild(box); } box.innerHTML = html; window.print(); }

// ---------- driver's license scan (PDF417 barcode, AAMVA standard) ----------
function parseAamva(t) { const g = c => { const m = new RegExp('(?:^|[\\n\\r\\x1e]|DL)' + c + '([^\\n\\r\\x1e]*)').exec(t); return m ? m[1].trim() : ''; };
  const dob = g('DBB'); const d = /^\d{8}$/.test(dob) ? (Number(dob.slice(0, 4)) > 1900 && Number(dob.slice(4, 6)) <= 12 ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6)}` : `${dob.slice(4)}-${dob.slice(0, 2)}-${dob.slice(2, 4)}`) : '';
  const cap = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return { first: cap(g('DAC') || (g('DCT').split(/[ ,]/)[0] || '')), last: cap(g('DCS')), dl: g('DAQ'), dl_state: g('DAJ'), dob: d, address: cap(g('DAG')), city: cap(g('DAI')), state: g('DAJ'), zip: g('DAK').slice(0, 5) }; }
window.scanBtn = () => `<label class="l wide" style="flex-direction:row;gap:8px;flex-wrap:wrap"><button type="button" class="btn sec" onclick="scanLicense()">📷 Scan driver's license</button><button type="button" class="btn sec" onclick="pasteLicense()">Paste from a license scanner</button></label>`;
function fillCustomer(x) { const set = (k, v) => { const el = document.querySelector(`#cf [data-f="${k}"]`); if (el && v) el.value = v; };
  Object.entries(x).forEach(([k, v]) => set(k, v)); toast(x.last ? `Filled in ${x.first} ${x.last}` : 'Couldn’t read that barcode', !x.last); }
window.pasteLicense = () => { const t = prompt('Scan the back of the license with a USB/Bluetooth scanner into this box, then OK'); if (t) fillCustomer(parseAamva(t)); };
window.scanLicense = run(async () => {
  if (!window.ZXing) await new Promise((r, j) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'; s.onload = r; s.onerror = () => j(new Error('Scanner couldn’t load — use “Paste from a license scanner”')); document.head.appendChild(s); });
  const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px';
  ov.innerHTML = '<video id="lv" style="width:min(96vw,640px);border-radius:10px" playsinline></video><div style="color:#fff">Point at the barcode on the back of the license</div><button class="btn sec">Cancel</button>'; document.body.appendChild(ov);
  const hints = new Map(); hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]); hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.BrowserMultiFormatReader(hints); const stop = () => { reader.reset(); ov.remove(); };
  ov.querySelector('button').onclick = stop;
  reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, 'lv', (res) => { if (res) { stop(); fillCustomer(parseAamva(res.getText())); } }).catch(e => { stop(); toast('Camera not available: ' + e.message, true); });
});

// ---------- deals: appraisal as trade, fee table, forms & e-signatures ----------
window.apprPick = d => { const list = (cache.appraisal || []).filter(a => a.data.status === 'open'); if (!cache.appraisal) L('appraisal').then(() => { const el = document.getElementById('apprpick'); if (el) el.outerHTML = apprPick(d); });
  return `<div id="apprpick" class="bar">${list.length ? `<select onchange="useAppraisal(this.value)"><option value="">Use an appraisal as the trade…</option>${list.map(a => `<option value="${a.id}" ${String(a.id) === String(d.appraisal_id || '') ? 'selected' : ''}>${esc(a.data.number)} · ${esc([a.data.year, a.data.make, a.data.model].join(' '))} · offer ${$$(a.data.offer, 0)}</option>`).join('')}</select>` : ''}</div>`; };
window.useAppraisal = id => { const a = (cache.appraisal || []).find(x => String(x.id) === String(id)); if (!a) return; const set = (k, v) => { const el = document.querySelector(`#df [data-f="${k}"]`); if (el && v != null) el.value = v; };
  set('trade.vin', a.data.vin); set('trade.year', a.data.year); set('trade.make', a.data.make); set('trade.model', a.data.model); set('trade.miles', a.data.miles); set('trade.acv', a.data.offer); set('trade.payoff', a.data.payoff);
  DD.appraisal_id = a.id; dealCalc(); toast('Trade filled from ' + a.data.number); };
window.feeBtn = () => `<label class="l">&nbsp;<button type="button" class="btn sec" onclick="fillFees()">Fill from fee table</button></label>`;
window.fillFees = () => { const st = storeOf(DSTORE || STORE); const t = sumFees(st); if (!t) { toast('No fee table set for this store (Settings → Stores)', true); return; } document.querySelector('#df [data-f=title_fees]').value = t.toFixed(2); dealCalc(); };
const _deliver = window.deliverDeal; window.deliverDeal = async id => { await _deliver(id); bust('appraisal'); };
async function captureDoc(kind) { const orig = window.print; window.print = () => {}; try { await printDeal(kind); } finally { window.print = orig; } return $('#dprint').innerHTML; }
async function extraDoc(kind) {
  const d = DD, k = window.DK || d.calc || {}; const c = (await L('customer')).find(x => String(x.id) === String(d.customer_id)); const v = (await L('vehicle')).find(x => String(x.id) === String(d.vehicle_id));
  const st = storeOf(DSTORE); const dn = (st && st.data.name) || S.settings.dealer_name || ''; const state = (st && st.data.state) || '';
  const who = custName(c), veh = v ? [v.data.year, v.data.make, v.data.model].join(' ') : '', vin = v ? v.data.vin || '' : '', miles = v ? num(v.data.miles).toLocaleString() : '';
  const sig = '<br><br><div style="display:flex;gap:30px"><div style="flex:1;border-top:1px solid #000">Buyer</div><div style="flex:1;border-top:1px solid #000">Dealer</div></div>';
  const head = t => `<div style="font-family:Arial;max-width:760px"><b style="font-size:18px">${esc(dn)}</b> ${state ? '· ' + esc(state) : ''}<h2>${t}</h2>`;
  if (kind === 'odometer') return head('Odometer Disclosure Statement') + `<p>Federal law (and State law, if applicable) requires that you state the mileage upon transfer of ownership. Failure to complete or providing a false statement may result in fines and/or imprisonment.</p>
    <p>I, <b>${esc(dn)}</b>, state that the odometer now reads <b>${miles}</b> miles and to the best of my knowledge it reflects the actual mileage of the vehicle described below, unless one of the following is checked:</p>
    <p>☐ The mileage stated is in excess of its mechanical limits. &nbsp; ☐ The odometer reading is NOT the actual mileage. WARNING – ODOMETER DISCREPANCY.</p>
    <p>Vehicle: ${esc(veh)} · VIN ${esc(vin)}<br>Buyer: ${esc(who)} — ${esc(c ? [c.data.address, c.data.city, c.data.state, c.data.zip].filter(Boolean).join(', ') : '')}<br>Date: ${fmtD(d.sale_date || today())}</p>
    <p style="font-size:12px">Where your state requires the disclosure on the title or a state secure form, complete that form too.</p>${sig}</div>`;
  if (kind === 'poa') return head('Limited Power of Attorney — Title & Registration') + `<p>I, <b>${esc(who)}</b>, appoint <b>${esc(dn)}</b> and its employees as my attorney-in-fact, only to sign and file documents needed to title and register the vehicle below${d.trade && d.trade.vin ? ' and to transfer the title of my trade-in' : ''} in the State of ${esc(state || '________')}.</p>
    <p>Vehicle: ${esc(veh)} · VIN ${esc(vin)}${d.trade && d.trade.vin ? `<br>Trade-in: ${esc([d.trade.year, d.trade.make, d.trade.model].join(' '))} · VIN ${esc(d.trade.vin)}` : ''}</p>
    <p style="font-size:12px">Some states require their own power-of-attorney form or notarization — check the store's state forms list.</p>${sig}</div>`;
  if (kind === 'weowe') { const items = prompt('We-owe items (one per line or separated by ;)', (d.we_owe || []).join('; ')); if (items === null) return null; d.we_owe = items.split(/;|\n/).map(x => x.trim()).filter(Boolean);
    return head('Due Bill / We Owe') + `<p>Buyer: ${esc(who)} · Vehicle: ${esc(veh)} · VIN ${esc(vin)}</p><ol>${d.we_owe.map(x => `<li>${esc(x)}</li>`).join('') || '<li>Nothing owed</li>'}</ol><p style="font-size:12px">Anything not listed here was not promised.</p>${sig}</div>`; }
  if (kind === 'stateforms') { const lines = String((st && st.data.state_forms) || '').split('\n').map(l => l.split('|')).filter(x => x[0] && x[1]);
    return head('Official state forms for ' + esc(state || 'this store')) + (lines.length ? `<ul>${lines.map(([n, u]) => `<li>${esc(n.trim())}: ${esc(u.trim())}</li>`).join('')}</ul>` : '<p>No state forms listed yet — add them under Settings → Stores.</p>') + '</div>';
  }
  return captureDoc(kind);
}
const DOCS = [['sale', 'Bill of sale'], ['tila', 'Finance disclosure worksheet'], ['menu', 'F&I product menu'], ['odometer', 'Odometer disclosure'], ['poa', 'Power of attorney'], ['weowe', 'We owe / due bill'], ['stateforms', 'Official state forms list']];
window.dealForms = run(async () => { if (DID === 'new') throw new Error('Save the deal first'); const signed = await api('/api/sign/list/' + DID).catch(() => []); window.DUPD = (await api('/api/rec/' + DID).catch(() => ({}))).updated_at;
  const ov = document.createElement('div'); ov.id = 'formsov'; ov.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:80;overflow:auto;padding:16px';
  ov.innerHTML = `<div class="card" style="max-width:640px;margin:20px auto"><div class="row"><b style="font-size:17px">Forms & e-signatures — ${esc(DD.number || '')}</b><button class="btn sec sm" onclick="this.closest('#formsov').remove()">Close</button></div>
  ${DOCS.map(([k, t]) => `<div class="kv"><span>${t}</span><b style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn sec sm" onclick="printDoc('${k}')">Print</button>${k !== 'stateforms' ? `<button class="btn sm" onclick="signDoc('${k}','${esc(t)}')">Send to sign</button>` : ''}</b></div>`).join('')}
  <h3>Signed and sent</h3>${signed.map(s => `<div class="kv"><span>${s.signed_at && window.DUPD && new Date(window.DUPD) > new Date(s.signed_at) ? '<span class="chip bad">Deal changed after signing</span> ' : ''}${esc(s.title)} · sent ${new Date(s.created_at).toLocaleDateString()} by ${esc(s.created_by)}</span><b>${s.signed_at ? `<button class="btn ok sm" onclick="viewSigned('${s.token}')">Signed ${new Date(s.signed_at).toLocaleDateString()}</button>` : `<span class="chip warn">waiting</span> <button class="btn sec sm" onclick="copyLink('${location.origin}/sign/${s.token}')">Link</button>`}</b></div>`).join('') || '<p class="mut small">Nothing sent yet.</p>'}
  <p class="mut small">The customer signs on their phone or a store tablet, agrees to sign electronically first, and the app keeps the exact document, signature, time, IP address and a fingerprint (hash) of the document.</p></div>`;
  document.body.appendChild(ov); });
window.printDoc = run(async k => { const h = await extraDoc(k); if (h) printHtml(h); });
window.signDoc = run(async (k, title) => { const h = await extraDoc(k); if (!h) return; const r = await api('/api/sign/request', { ref: DID, title: title + ' — ' + (DD.number || ''), html: h });
  const cu = (cache.customer || []).find(x => String(x.id) === String(DD.customer_id));
  const ch = await choose('Signing link is ready', [['here', 'Customer signs on this device'], ...(cu && cu.data.phone ? [['text', 'Text it to ' + (cu.data.first || 'the customer')]] : []), ['copy', 'Copy the link']]);
  if (ch === 'here') window.open(r.url, '_blank'); else if (ch === 'text') location.href = smsLink(cu.data.phone, `${S.settings.dealer_name || ''}: please review and sign: ${r.url}`); else if (ch === 'copy') copyLink(r.url);
  document.getElementById('formsov')?.remove(); dealForms(); });
window.copyLink = u => { navigator.clipboard.writeText(u).then(() => toast('Link copied'), () => prompt('Copy this link:', u)); };
window.viewSigned = run(async t => { const s = await api('/api/sign/doc/' + t);
  const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:85;padding:12px;display:flex;flex-direction:column;gap:8px';
  const fr = document.createElement('iframe'); fr.setAttribute('sandbox', 'allow-same-origin allow-modals'); fr.style.cssText = 'flex:1;width:100%;border:0;border-radius:10px;background:#fff';
  fr.srcdoc = '<!DOCTYPE html><meta charset="utf-8"><body style="font-family:Arial;padding:12px">' + s.html + `<div style="margin-top:20px;border-top:2px solid #000;padding-top:10px"><img src="${esc(s.sig)}" style="max-width:300px;height:auto"><br>Signed electronically by <b>${esc(s.signer)}</b> on ${esc(new Date(s.signed_at).toLocaleString())}<br><span style="font-size:11px">IP ${esc(s.ip)} · consent to e-sign given · document fingerprint ${esc(s.doc_hash)}</span></div></body>`;
  const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = '<button class="btn">Print</button><button class="btn sec">Close</button>';
  bar.children[0].onclick = () => fr.contentWindow.print(); bar.children[1].onclick = () => ov.remove(); ov.append(bar, fr); document.body.appendChild(ov); });
// ---------- payments: receipt by print or text ----------
window.afterPay = p => { const cu = window.LCU; const d = p.data;
  const msg = `${S.settings.dealer_name || ''} receipt ${d.receipt}: ${$$(d.amount)} paid ${fmtD(d.date)} on acct ${d.account}. Thank you!`;
  choose('Payment posted. Receipt?', [['print', 'Print it'], ...(cu && cu.data && cu.data.phone ? [['text', 'Text it to ' + (cu.data.first || 'the customer')]] : [])]).then(ch => { if (ch === 'text') location.href = smsLink(cu.data.phone, msg); else if (ch === 'print') printReceipt(p.id); }); };

// ---------- service: inspection photos, video, shop capacity ----------
window.inspMedia = x => !x.id ? '' : `<div class="photos" style="grid-column:1/-1">${(x.photos || []).map(p => `<img src="${esc(p)}">`).join('')}${RD.status !== 'closed' ? `<label class="btn sec sm" style="cursor:pointer">📷 Photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="addInspPhoto('${esc(x.id)}', this.files)"></label>` : ''}</div>`;
window.addInspPhoto = run(async (iid, files) => { const it = (RD.inspection || []).find(x => String(x.id) === String(iid)); if (!it) return; it.photos = it.photos || [];
  for (const f of files) { if (it.photos.length >= 4) break; it.photos.push(await fileToJpeg(f, 800)); } await saveRo(RID, true); bust('ro'); route(); });
window.roMedia = (id, d) => id === 'new' ? '' : `<h3>Videos</h3><div>${(d.videos || []).map((v, i) => `<button type="button" class="btn sec sm" data-key="${esc(v.key)}" onclick="viewVideo(this.dataset.key)">▶ Video ${i + 1}</button> `).join('') || '<span class="mut small">No videos.</span>'}
  ${d.status !== 'closed' ? `<label class="btn sec sm" style="cursor:pointer">🎥 Upload video<input type="file" accept="video/*" capture="environment" style="display:none" onchange="uploadVideo(${id}, this.files[0])"></label>` : ''}</div>`;
window.uploadVideo = run(async (id, f) => { if (!f) return; if (f.size > 300e6) throw new Error('Video is over 300 MB'); toast('Uploading…');
  const ext = (f.name.split('.').pop() || 'mp4').toLowerCase(); const u = await api('/api/media/upload-url', { ro_id: id, ext });
  const r = await fetch(u.url, { method: 'PUT', body: f, headers: { 'Content-Type': f.type || 'video/mp4' } }); if (!r.ok) throw new Error('Upload failed (' + r.status + ')');
  (RD.videos = RD.videos || []).push({ key: u.key, at: new Date().toISOString(), by: ME.user.name }); await saveRo(id, true); bust('ro'); toast('Video saved'); route(); });
window.viewVideo = run(async key => { const r = await api('/api/media/view?key=' + encodeURIComponent(key)); window.open(r.url, '_blank'); });
const _service = VIEWS.service;
VIEWS.service = async (id, extra) => { await _service(id, extra);
  if (id === 'appt') { const el = document.querySelector('#apf [data-f=when]'); if (!el) return; const box = document.createElement('div'); box.className = 'card'; box.id = 'capbox'; el.closest('.card').after(box);
    const draw = async () => { const day = (el.value || '').slice(0, 10); if (!day) return; const sid = (document.querySelector('#apf [data-f=_store]') || {}).value || STORE; const c = await api(`/api/capacity?from=${day}&days=1${sid ? '&store=' + sid : ''}`); const x = c.days[0];
      box.innerHTML = c.set ? `<b>Shop capacity ${fmtD(day)}:</b> ${x.booked} of ${x.capacity} tech hours booked — <span style="color:${x.open < 0 ? 'var(--bad)' : 'var(--ok)'}">${x.open < 0 ? 'overbooked by ' + (-x.open) : x.open + ' open'}</span>` : '<span class="mut small">Set tech count and hours per day under Settings → Stores to see shop capacity.</span>'; };
    el.addEventListener('change', draw); document.querySelector('#apf [data-f=_store]')?.addEventListener('change', draw); draw(); }
  else if (!id) { const c = await api(`/api/capacity?days=7${STORE ? '&store=' + STORE : ''}`).catch(() => null); if (!c || !c.set) return;
    const h = document.querySelector('#main h3'); if (!h) return; const box = document.createElement('div'); box.className = 'card';
    box.innerHTML = `<b>Shop capacity — next 7 days</b>${c.days.map(x => `<div class="kv"><span>${fmtD(x.date)}</span><b style="color:${x.open < 0 ? 'var(--bad)' : 'inherit'}">${x.booked} / ${x.capacity} hrs</b></div>`).join('')}`; h.before(box); } };

// ---------- store settings: late fees, shop capacity, fee table, state forms ----------
window.storeExtra = s => `${field('Charge late fees automatically', 'auto_late_fee', s.data.auto_late_fee === true, 'check')}${field('Technicians', 'tech_count', s.data.tech_count, 'number')}${field('Hours per tech per day', 'tech_hours', s.data.tech_hours, 'number')}
  ${field('Title fee', 'title_fee', s.data.title_fee, 'number')}${field('Registration fee', 'registration_fee', s.data.registration_fee, 'number')}${field('Inspection fee', 'inspection_fee', s.data.inspection_fee, 'number')}${field('Other state fees', 'other_fees', s.data.other_fees, 'number')}
  ${field('Official state forms (one per line: Form name | link)', 'state_forms', s.data.state_forms, 'textarea', { wide: true })}`;

// ---------- appraisals ----------
VIEWS.appraisals = async (id) => {
  if (id) return appraisalForm(id);
  const as = (await L('appraisal', true)).filter(inStore); const st = sessionStorage.apf || 'open';
  const show = as.filter(a => st === 'all' || a.data.status === st);
  view(`<h1>Appraisals</h1><div class="bar"><select onchange="sessionStorage.apf=this.value;route()">${[['open', 'Open'], ['bought', 'Bought'], ['traded', 'Traded in'], ['all', 'All']].map(([v, t]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="grow"></span>${can('appraisal') ? '<a class="btn" href="#appraisals/new">+ New appraisal</a>' : ''}</div>
  <div class="grid">${show.map(a => `<a class="item" href="#appraisals/${a.id}"><div class="row"><span class="t">${esc(a.data.number)} · ${esc([a.data.year, a.data.make, a.data.model].join(' '))}</span><span class="chip ${a.data.status === 'open' ? 'acc' : 'ok'}">${esc(a.data.status)}</span></div>
    <div class="s">${num(a.data.miles).toLocaleString()} mi · ${esc(a.data.customer || '')}</div><div class="s">Offer ${$$(a.data.offer, 0)}${a.data.market ? ' · market ' + $$(a.data.market.price, 0) : ''}</div></a>`).join('') || '<p class="mut">No appraisals here.</p>'}</div>`);
};
async function appraisalForm(id) {
  const a = id === 'new' ? { data: { photos: [], comps: [] } } : await api('/api/rec/' + id), d = a.data, locked = d.status && d.status !== 'open';
  const COND = ['Exterior', 'Interior', 'Tires', 'Brakes', 'Engine', 'Transmission', 'Frame / accident', 'Electrical', 'A/C', 'Warning lights'];
  view(`<div class="bar"><a href="#appraisals" class="btn sec sm">← Appraisals</a></div><h1>${id === 'new' ? 'New appraisal' : esc(d.number)} ${locked ? `<span class="chip ok">${esc(d.status)}</span>` : ''}</h1>
  <div class="card" id="af"><div class="f">${field('VIN', 'vin', d.vin)}<label class="l">&nbsp;<button type="button" class="btn sec" onclick="apDecode()">Decode VIN</button></label>
  ${field('Year', 'year', d.year)}${field('Make', 'make', d.make)}${field('Model', 'model', d.model)}${field('Trim', 'trim', d.trim)}${field('Miles', 'miles', d.miles, 'number')}${field('Color', 'color', d.color)}
  ${field('Customer / seller', 'customer', d.customer)}${field('Phone', 'phone', d.phone, 'tel')}${field('Payoff owed', 'payoff', d.payoff, 'number')}${field('Lienholder', 'lienholder', d.lienholder)}${storeSel(a.store_id)}</div>
  <h3>Condition</h3><div class="f">${COND.map(c => field(c, 'cond.' + c.replace(/\W+/g, '_'), (d.cond || {})[c.replace(/\W+/g, '_')], 'select', { options: ['', 'Good', 'Fair', 'Needs work', 'Bad'] })).join('')}${field('Notes', 'notes', d.notes, 'textarea', { wide: true })}</div>
  <h3>Values</h3><div class="f">${field('Book value (wholesale)', 'book_wholesale', d.book_wholesale, 'number')}${field('Book value (retail)', 'book_retail', d.book_retail, 'number')}${field('Estimated recon', 'recon_estimate', d.recon_estimate, 'number')}${field('Target retail price', 'retail_target', d.retail_target, 'number')}${field('Offer / ACV', 'offer', d.offer, 'number')}</div>
  ${d.market ? `<div class="kv"><span>MarketCheck market price (${fmtD(d.market.checked)})</span><b>${$$(d.market.price, 0)}</b></div>` : ''}
  <div class="kv"><span>Target retail − recon − offer</span><b>${$$(num(d.retail_target) - num(d.recon_estimate) - num(d.offer), 0)} margin</b></div>
  <h3>Photos</h3><div class="photos" id="aphotos">${(d.photos || []).map(p => `<img src="${esc(p)}">`).join('')}</div>${!locked ? '<input type="file" accept="image/*" multiple capture="environment" onchange="apPhotos(this.files)">' : ''}</div>
  <div class="sticky">${!locked && can('appraisal') ? `<button class="btn" onclick="saveAppraisal(${id === 'new' ? 'null' : id})">Save</button>` : ''}${id !== 'new' && !locked ? `<button class="btn sec" onclick="apMarket(${id})">Get market price</button>${['owner', 'manager', 'finance'].includes(ME.user.role) ? `<button class="btn ok" onclick="apBuy(${id})">Buy into inventory</button>` : ''}` : ''}${d.vehicle_id ? `<a class="btn sec" href="#inventory/${d.vehicle_id}">Open vehicle</a>` : ''}</div>`);
  window.AD2 = d; window.AP = [...(d.photos || [])]; if (locked) $('#af').querySelectorAll('input,select,textarea,button').forEach(e => e.disabled = true);
}
window.apDecode = run(async () => { const vin = document.querySelector('#af [data-f=vin]').value.trim(); const x = await api('/api/vin/' + encodeURIComponent(vin));
  for (const k of ['year', 'make', 'model', 'trim']) { const el = document.querySelector(`#af [data-f=${k}]`); if (el && x[k] && !el.value) el.value = x[k]; } toast(x.make ? 'Decoded' : 'VIN not found', !x.make); });
window.apPhotos = async files => { for (const f of files) { if (AP.length >= 12) break; AP.push(await fileToJpeg(f)); } $('#aphotos').innerHTML = AP.map(p => `<img src="${esc(p)}">`).join(''); };
window.saveAppraisal = run(async id => { const data = readForm($('#af'), AD2); data.photos = AP; const st = data._store; delete data._store;
  const r = await api('/api/save/appraisal', { id, store_id: st || STORE || (S.stores[0] && S.stores[0].id), data }); bust('appraisal'); toast('Saved'); go('appraisals/' + r.id); });
window.apMarket = run(async id => { await saveAppraisal(id); const m = await api(`/api/appraisal/${id}/market`, {}); toast('Market price ' + $$(m.price, 0)); route(); });
window.apBuy = run(async id => { const f = readForm($('#af'), AD2); const st = f._store; delete f._store; await api('/api/save/appraisal', { id, store_id: st || null, data: { ...f, photos: AP } });
  const ap = await choose(`Buy this vehicle into inventory for ${$$(f.offer, 0)}? It posts to the books.`, [['cash', 'Paid now (cash / check)'], ['ap', 'On account (pay later)']]); if (!ap) return;
  const v = await api(`/api/appraisal/${id}/buy`, { paid_with: ap }); bust('appraisal', 'vehicle'); toast('Added to inventory as ' + v.data.stock); go('inventory/' + v.id); });

// ---------- cashier drawer ----------
VIEWS.cashier = async () => {
  const date = sessionStorage.cdate || today(); const who = isMgr() ? (sessionStorage.ccash || ME.user.name) : ME.user.name;
  const users = isMgr() ? await L('user') : []; const d = await api(`/api/drawer?date=${date}&cashier=${encodeURIComponent(who)}${STORE ? '&store=' + STORE : ''}`);
  view(`<h1>Cashier drawer</h1><div class="bar"><label class="l">Date<input type="date" value="${date}" onchange="sessionStorage.cdate=this.value;route()"></label>
  ${isMgr() ? `<label class="l">Cashier<select onchange="sessionStorage.ccash=this.value;route()">${[ME.user.name, ...users.map(u => u.data.name)].filter((v, i, a) => a.indexOf(v) === i).map(n => `<option ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}</div>
  <div class="card">${Object.entries(d.byMethod).map(([m, v]) => `<div class="kv"><span>${esc(m)} payments</span><b>${$$(v)}</b></div>`).join('') || '<p class="mut small">No in-house payments.</p>'}
  <div class="kv"><span><b>Cash expected in drawer</b> (in-house cash payments)</span><b style="font-size:18px">${$$(d.expectedCash)}</b></div>
  <div class="kv"><span class="small">For reference: other receipts you posted to cash today (parts, service, deals — any payment type)</span><b>${$$(d.otherCash)}</b></div></div>
  ${d.closed ? `<div class="card"><b>Closed by ${esc(d.closed.closed_by)}</b><div class="kv"><span>Counted</span><b>${$$(d.closed.counted_cash)}</b></div><div class="kv"><span>Over / short</span><b style="color:${d.closed.over_short < 0 ? 'var(--bad)' : 'inherit'}">${$$(d.closed.over_short)}</b></div></div>`
    : `<div class="card" id="drf"><div class="f">${field('Cash counted', 'counted_cash', '', 'number')}${field('Note', 'note', '')}</div><button class="btn" style="margin-top:8px" data-who="${esc(who)}" onclick="closeDrawer(this.dataset.who,'${date}')">Close drawer</button></div>`}`);
};
window.closeDrawer = run(async (who, date) => { const b = readForm($('#drf')); if (!confirm('Close this drawer? Any over/short posts to the books.')) return; const r = await api('/api/drawer/close', { ...b, cashier: who, date, store_id: STORE || null }); toast('Closed — over/short ' + $$(r.over_short)); route(); });

// ---------- insurance alerts ----------
VIEWS.insurance = async () => { const a = await api('/api/insurance-alerts');
  view(`<h1>Insurance alerts</h1><p class="mut">In-house accounts with no insurance on file, or insurance expiring within 15 days.</p><div class="grid">${a.map(x => `<a class="item" href="#accounts/${x.id}" onclick="sessionStorage.at='gps'"><div class="row"><span class="t">${esc(x.name)}</span><span class="chip ${!x.expires || x.expires < today() ? 'bad' : 'warn'}">${!x.expires ? 'None on file' : x.expires < today() ? 'Expired ' + fmtD(x.expires) : 'Expires ' + fmtD(x.expires)}</span></div><div class="s">#${esc(x.account)} · ${esc(x.vehicle)}</div><div class="s">${esc(x.company || '')}</div></a>`).join('') || '<p class="mut">All covered. 👍</p>'}</div>`); };

// ---------- time clock ----------
VIEWS.clock = async () => { if (ME.user.id === 'owner' || !ME.user.id) { view('<h1>Time clock</h1><p class="mut">The owner login doesn’t use the time clock. Each employee clocks in with their own PIN.</p>'); return; } const mine = await api('/api/clock/me'); const open = mine.find(x => !x.out);
  view(`<h1>Time clock</h1><div class="card" style="text-align:center"><p>${open ? 'Clocked in since <b>' + new Date(open.in).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</b>' : 'You are clocked out.'}</p>
  <button class="btn ${open ? 'bad' : 'ok'}" style="font-size:18px;padding:14px 28px" onclick="clockAct('${open ? 'out' : 'in'}')">Clock ${open ? 'out' : 'in'}</button></div>
  <h3>Recent</h3><div class="card">${mine.map(x => `<div class="kv"><span>${new Date(x.in).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><b>${x.out ? x.hours + ' h' : 'open'}</b></div>`).join('') || '<p class="mut small">No punches yet.</p>'}</div>`); };
window.clockAct = run(async a => { await api('/api/clock', { action: a }); toast('Clocked ' + a); route(); });

// ---------- payroll: pay plans + period report + export ----------
VIEWS.payroll = async () => {
  if (!['owner', 'manager', 'accounting'].includes(ME.user.role)) { view('<p class="mut">Managers and accounting only.</p>'); return; }
  const tab = sessionStorage.pt || 'report'; const m = today().slice(0, 8) + '01'; const from = sessionStorage.pfrom || m, to = sessionStorage.pto || today();
  view(`<h1>Payroll</h1><div class="tabs">${[['report', 'Pay period'], ['plans', 'Pay plans']].map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" onclick="sessionStorage.pt='${k}';route()">${t}</a>`).join('')}</div><div id="pp" class="card">Loading…</div>`);
  const P = $('#pp');
  if (tab === 'report') { const rows = await api(`/api/payroll?from=${from}&to=${to}`);
    P.innerHTML = `<div class="bar"><label class="l">From<input type="date" value="${from}" onchange="sessionStorage.pfrom=this.value;route()"></label><label class="l">To<input type="date" value="${to}" onchange="sessionStorage.pto=this.value;route()"></label><a class="btn sec" href="/api/payroll.csv?from=${from}&to=${to}">Export for payroll company (CSV)</a></div>
    <table class="tbl"><tr><th>Employee</th><th class="n">Hours</th><th class="n">Units</th><th class="n">Commission</th><th class="n">Flag hrs</th><th class="n">Tech pay</th><th class="n">Total</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}<br><span class="mut small">${esc(r.role)}${r.hasPlan ? '' : ' · no pay plan'}</span></td><td class="n">${r.hours}</td><td class="n">${r.units}</td><td class="n">${$$(r.commission)}</td><td class="n">${r.flagHours}</td><td class="n">${$$(r.techPay)}</td><td class="n"><b>${$$(r.total)}</b></td></tr>`).join('')}</table>
    <p class="mut small">Commission counts delivered deals where the salesperson name matches; tech pay counts closed RO lines where the technician name matches. Taxes and deductions are handled by your payroll company.</p>`; }
  if (tab === 'plans') { const [plans, users] = await Promise.all([api('/api/payplans'), L('user', true)]);
    P.innerHTML = `${users.filter(u => u.data.active !== false).map(u => { const p = (plans.find(x => String(x.data.user_id) === String(u.id)) || { data: {} }).data;
      return `<div class="sub" data-pu="${u.id}"><b>${esc(u.data.name)}</b> <span class="mut small">${esc(u.data.role)}</span><div class="f">${field('Hourly rate', 'hourly', p.hourly, 'number')}${field('Salary per period', 'salary', p.salary, 'number')}${field('Flat per unit sold', 'per_unit', p.per_unit, 'number')}${field('% of front gross', 'pct_front', p.pct_front, 'number')}${field('% of back gross', 'pct_back', p.pct_back, 'number')}${field('Minimum per unit (mini)', 'min_per_unit', p.min_per_unit, 'number')}${field('Per flag hour (techs)', 'per_flag_hour', p.per_flag_hour, 'number')}${field('Notes', 'notes', p.notes)}</div>${isMgr() ? `<button class="btn sm" style="margin-top:6px" onclick="savePlan(${u.id})">Save plan</button>` : ''}</div>`; }).join('') || '<p class="mut">Add users first (Settings → Users).</p>'}`; }
};
window.savePlan = run(async uid => { await api('/api/payplans', { user_id: uid, ...readForm(document.querySelector(`[data-pu="${uid}"]`)) }); toast('Saved'); });

// ---------- accounting add-ons ----------
window.booksExtra = async (tab, B, qs, from, to) => {
  if (tab === 'bills') { const [bills, vendors, accts] = await Promise.all([L('bill', true), L('vendor', true), L('account')]); const ao = accts.map(a => [a.data.no, a.data.no + ' ' + a.data.name]).sort();
    const vn = id => (vendors.find(v => String(v.id) === String(id)) || { data: { name: '' } }).data.name;
    B.innerHTML = `<div class="bar"><button class="btn" onclick="newBill()">+ New bill</button><button class="btn sec" onclick="newVendor()">+ Vendor</button></div>
    ${bills.filter(inStore).map(b => `<div class="sub"><div class="row"><b>${esc(vn(b.data.vendor_id))} · ${esc(b.data.number || '')}</b><span class="chip ${b.data.status === 'paid' ? 'ok' : b.data.posted ? 'warn' : ''}">${b.data.posted ? esc(b.data.status) : 'draft'}</span></div>
      <div class="kv"><span>Due ${fmtD(b.data.due)}</span><b>${$$(b.data.posted ? b.data.balance : (b.data.lines || []).reduce((s, l) => s + num(l.amount), 0))}${b.data.posted ? ' left of ' + $$(b.data.total) : ''}</b></div>
      <div class="bar" style="margin:6px 0 0">${!b.data.posted ? `<button class="btn sm" onclick="postBill(${b.id})">Post</button><button class="btn sec sm" onclick="delRec(${b.id},'books')">Delete</button>` : b.data.status !== 'paid' ? `<button class="btn ok sm" onclick="payBill(${b.id},${b.data.balance})">Pay</button>` : ''}</div></div>`).join('') || '<p class="mut">No bills yet.</p>'}
    <div id="billf"></div>`; window._ao = ao; window._vendors = vendors; return true; }
  if (tab === 'bank') { const r = await api('/api/bank/rec' + (STORE ? '?store=' + STORE : ''));
    if (r.pickStore) { B.innerHTML = '<p>Each store banks on its own account. Pick a store in the picker at the top to reconcile it.</p>'; return true; }
    B.innerHTML = `<div class="kv"><span>Cash per books</span><b>${$$(r.book)}</b></div><div class="kv"><span>Cleared by the bank</span><b>${$$(r.cleared)}</b></div><div class="kv"><span>Outstanding (not yet at the bank)</span><b>${$$(r.outstanding)}</b></div>
    <h3>Import bank statement</h3><textarea id="bankcsv" placeholder="Paste the bank's CSV export here (with its header row)"></textarea><div class="bar" style="margin-top:6px"><input type="file" accept=".csv,text/csv" onchange="this.files[0].text().then(t=>document.getElementById('bankcsv').value=t)"><button class="btn" onclick="bankImport()">Import</button><button class="btn sec" onclick="bankAuto()">Auto-match</button></div>
    <h3>Bank lines not matched (${r.bankUnmatched.length})</h3>${r.bankUnmatched.map(b => `<div class="sub"><div class="kv"><span>${fmtD(b.date)} · ${esc(b.desc)}</span><b>${$$(b.amount)}</b></div>
      <select multiple size="3" data-bm="${b.id}" style="height:auto">${r.bookUncleared.filter(x => Math.abs(ctxDays(x.date, b.date)) <= 30).map(x => `<option value="${x.id}">${fmtD(x.date)} · ${esc(x.entry)} ${esc(x.memo || '').slice(0, 40)} · ${$$(x.amount)}</option>`).join('')}</select>
      <button class="btn sm" style="margin-top:4px" onclick="bankMatch(${b.id})">Match selected</button></div>`).join('') || '<p class="mut small">All matched.</p>'}
    <h3>Book entries not at the bank yet (${r.bookUncleared.length})</h3>${r.bookUncleared.slice(0, 200).map(x => `<div class="kv"><span>${fmtD(x.date)} · ${esc(x.entry)} ${esc(x.memo || '')}</span><b>${$$(x.amount)}</b></div>`).join('')}`; return true; }
  if (tab === 'oem') { const [lines, accts] = await Promise.all([api('/api/report/oem' + qs), L('account', true)]);
    B.innerHTML = `<table class="tbl"><tr><th>Statement line</th><th class="n">Amount</th></tr>${lines.map(l => `<tr><td>${esc(l.line)}<br><span class="mut small">${esc(l.accounts.join(', '))}</span></td><td class="n">${$$(l.amount)}</td></tr>`).join('')}</table>
    <h3>Map accounts to the manufacturer's statement lines</h3>${accts.sort((a, b) => a.data.no > b.data.no ? 1 : -1).map(a => `<div class="kv"><span>${esc(a.data.no)} ${esc(a.data.name)}</span><b><input style="max-width:160px" value="${esc(a.data.oem_line || '')}" placeholder="e.g. Page 3 Line 12" onchange="mapOem(${a.id}, this.value)"></b></div>`).join('')}
    <p class="mut small">Amounts are debits minus credits. Each manufacturer has its own statement layout — enter its line codes here.</p>`; return true; }
  if (tab === 'close') { const lock = S.settings.closed_through;
    B.innerHTML = `<p>Books are ${lock ? `closed through <b>${fmtD(lock)}</b>. Nothing can post on or before that date.` : '<b>open</b> — any date can be posted.'}</p>
    ${ME.user.role === 'owner' ? `<div class="bar"><label class="l">Close through<input type="date" id="closedt" value="${lock || ''}"></label><button class="btn" onclick="closeBooks()">Close the books</button>${lock ? '<button class="btn sec" onclick="closeBooks(true)">Reopen all</button>' : ''}</div>` : '<p class="mut small">Only the owner can close or reopen the books.</p>'}`; return true; }
  return false;
};
const ctxDays = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
window.newVendor = run(async () => { const name = prompt('Vendor name'); if (!name) return; const terms = prompt('Terms (e.g. Net 30)') || ''; await api('/api/save/vendor', { data: { name, terms } }); bust('vendor'); route(); });
window.newBill = () => { $('#billf').innerHTML = `<div class="card" id="bf"><h3>New bill</h3><div class="f">${field('Vendor', 'vendor_id', '', 'select', { options: opts(_vendors, v => v.data.name) })}${field('Bill #', 'number', '')}${field('Bill date', 'date', today(), 'date')}${field('Due', 'due', '', 'date')}</div>
  <div id="bls">${billLine()}</div><button class="btn sec sm" onclick="$('#bls').insertAdjacentHTML('beforeend',billLine())">+ Line</button> <button class="btn" onclick="saveBill()">Save draft</button></div>`; };
const billLine = () => `<div class="f" data-sub data-bl>${field('Expense / asset account', 'acct', '', 'select', { options: [['', '— account —'], ..._ao] })}${field('Amount', 'amount', '', 'number')}${field('Memo', 'memo', '')}</div>`;
window.saveBill = run(async () => { const root = $('#bf'); const data = readForm(root); data.lines = [...root.querySelectorAll('[data-bl]')].map(el => readForm(el)).filter(l => l.acct && num(l.amount));
  if (!data.vendor_id) throw new Error('Pick a vendor'); await api('/api/save/bill', { store_id: STORE || (S.stores[0] && S.stores[0].id), data }); bust('bill'); toast('Saved'); route(); });
window.postBill = run(async id => { if (!confirm('Post this bill to the books?')) return; await api(`/api/bill/${id}/post`, {}); bust('bill'); toast('Posted'); route(); });
window.payBill = run(async (id, bal) => { const a = prompt('Amount to pay', bal); if (!a) return; const ref = prompt('Check # / reference') || ''; await api(`/api/bill/${id}/pay`, { amount: num(a), ref }); bust('bill'); toast('Paid'); route(); });
window.bankImport = run(async () => { const r = await api('/api/bank/import', { csv: $('#bankcsv').value, store_id: STORE || null }); toast(`${r.added} lines added, ${r.skipped} skipped`); route(); });
window.bankAuto = run(async () => { const r = await api('/api/bank/auto', { store_id: STORE || null }); toast(r.matched + ' matched'); route(); });
window.bankMatch = run(async id => { const sel = document.querySelector(`[data-bm="${id}"]`); const ids = [...sel.selectedOptions].map(o => Number(o.value)); await api('/api/bank/match', { bankline_id: id, jrnl_ids: ids }); toast('Matched'); route(); });
window.mapOem = run(async (id, v) => { const a = (cache.account || []).find(x => String(x.id) === String(id)); await api('/api/save/account', { id, data: { ...a.data, oem_line: v.trim() } }); bust('account'); toast('Saved'); });
window.closeBooks = run(async reopen => { const d = reopen ? null : $('#closedt').value; if (!reopen && !d) throw new Error('Pick a date'); if (!confirm(reopen ? 'Reopen all periods?' : `Close the books through ${d}?`)) return;
  const r = await api('/api/close-period', { through: d }); S.settings.closed_through = r.closed_through; toast(reopen ? 'Reopened' : 'Closed'); route(); });
window.exportExtra = () => { const m = today().slice(0, 8) + '01';
  return `<p>Your data is yours. Download everything, or send the journal to QuickBooks or your accountant.</p><div class="bar"><a class="btn" href="/api/export">All data (JSON)</a></div>
  <div class="bar"><label class="l">From<input type="date" id="exf" value="${m}"></label><label class="l">To<input type="date" id="ext" value="${today()}"></label></div>
  <div class="bar"><button class="btn sec" onclick="location.href='/api/export/qb?from='+exf.value+'&to='+ext.value">QuickBooks (IIF)</button><button class="btn sec" onclick="location.href='/api/export/journal.csv?from='+exf.value+'&to='+ext.value">Journal (CSV)</button></div>
  <p class="mut small">QuickBooks Desktop imports IIF files (File → Utilities → Import). Account names come across as "number name" — map them once in QuickBooks.</p>`; };

// ---------- settings: website & leads, integrations ----------
window.settingsExtra = async (tab, P) => {
  if (tab === 'website') { const s = (await L('settings', true))[0]; window.SET = s; const tok = s.data.feed_token || '';
    P.innerHTML = `<p>Your public inventory site: <a href="/cars" target="_blank"><b>${location.origin}/cars</b></a> — every in-stock unit (unless hidden) with photos, a contact form and a credit application. Forms land in Leads.</p>
    <div class="f" id="setf">${field('Website headline', 'site_tagline', s.data.site_tagline)}${field('Show credit application', 'site_credit_app', s.data.site_credit_app !== false, 'check')}
    ${field('Assign new website leads', 'lead_routing', s.data.lead_routing || 'none', 'select', { options: [['none', 'Don’t assign (managers pick)'], ['round_robin', 'Rotate through all salespeople'], ['round_robin_store', 'Rotate through the store’s salespeople']] })}</div>
    <button class="btn" style="margin:8px 0" onclick="saveSet()">Save</button>
    <h3>Listing feeds</h3><p class="small">Give these addresses to CarGurus, Cars.com, Autotrader and Facebook (Commerce Manager → automotive catalog → data feed). They update on their own as inventory changes.</p>
    <div class="kv"><span>Listing sites (CSV)</span><b><button class="btn sec sm" onclick="copyLink('${location.origin}/feed/inventory.csv?token=${tok}')">Copy</button></b></div>
    <div class="kv"><span>Facebook automotive catalog (CSV)</span><b><button class="btn sec sm" onclick="copyLink('${location.origin}/feed/facebook.csv?token=${tok}')">Copy</button></b></div>
    <p class="mut small">Status page for your team: <a href="/status" target="_blank">${location.origin}/status</a></p>`; return true; }
  if (tab === 'integrations') { const k = await api('/api/integrations'); const own = ME.user.role === 'owner';
    const box = (name, title, desc, fields) => `<div class="sub" data-int="${name}"><b>${title}</b> ${Object.values(k[name] || {}).some(Boolean) ? '<span class="chip ok">Connected</span>' : '<span class="chip warn">Not connected</span>'}<p class="small">${desc}</p>
      <div class="f">${fields.map(([f, l]) => field(l, f, (k[name] || {})[f] || '', /pass|secret|key/.test(f) ? 'password' : 'text', { attrs: 'autocomplete="off"' })).join('')}</div>${own ? `<button class="btn sm" style="margin-top:6px" onclick="saveInt('${name}')">Save</button>` : ''}</div>`;
    P.innerHTML = `<p>Paste each provider's keys here when you have the account. Keys are stored on the server and never shown in full again.${own ? '' : ' Only the owner can change them.'}</p>
    ${box('marketcheck', 'MarketCheck — market prices & appraisals', 'Market price for inventory and appraisals.', [['api_key', 'API key'], ['zip', 'Your ZIP (for local market)']])}
    ${box('vinaudit', 'VinAudit — vehicle history', 'Federal title-database history reports on any VIN.', [['user', 'Username'], ['pass', 'Password'], ['key', 'API key']])}
    ${box('r2', 'Cloudflare R2 — inspection video storage', 'Service videos are stored here, not in the database.', [['account_id', 'Account ID'], ['access_key_id', 'Access key ID'], ['secret_access_key', 'Secret access key'], ['bucket', 'Bucket name']])}
    <h3>Pending — needs an account, contract or certification</h3>${[['Texting (Telnyx)', 'Sign-in codes, reminders, receipts, two-way texting. Today texts open your phone’s messaging app.'], ['Payments (Repay or Stripe)', 'Card/ACH and autopay. Today: the pay link under Dealership.'], ['Credit pulls (700Credit)', 'Hard and soft pulls.'], ['Lender submission (RouteOne / Dealertrack)', 'Needs DSP certification.'], ['GPS (PassTime)', 'Starter-interrupt actions are logged now and sent once connected.'], ['Book values (Black Book)', 'Wholesale / trade / retail values.'], ['Credit bureau reporting (Metro 2)', 'Needs a data-furnisher agreement with the bureaus.'], ['Manufacturer systems', 'Warranty submission and parts ordering need certification by each manufacturer.']].map(([a, b]) => `<div class="kv"><span><b>${a}</b><br><span class="small">${b}</span></span><b><span class="chip warn">Pending</span></b></div>`).join('')}
    <h3>Open API</h3><p class="small">Other systems can read and write records with the API token set on the server (header <code>Authorization: Bearer …</code>). No integration fees.</p>`; return true; }
  return false;
};
window.saveInt = run(async name => { const el = document.querySelector(`[data-int="${name}"]`); await api('/api/integrations', { name, values: readForm(el) }); toast('Saved'); route(); });

// ---------- dashboard: insurance and late-fee nudges ----------
const _home = VIEWS.home;
VIEWS.home = async () => { await _home(); if (!['owner', 'manager', 'finance', 'collector', 'accounting'].includes(ME.user.role)) return;
  const a = await api('/api/insurance-alerts').catch(() => []); if (!a.length) return; const h = document.querySelector('#main h1');
  const box = document.createElement('a'); box.href = '#insurance'; box.className = 'card'; box.style.cssText = 'display:block;color:inherit;text-decoration:none;border-color:#e3a500;background:var(--warnb)';
  box.innerHTML = `<b>${a.length} in-house account${a.length > 1 ? 's' : ''} missing or about to lose insurance →</b>`; h.after(box); };

// ---------- offline notice (the service worker shows the last data loaded) ----------
function netBanner() { let b = document.getElementById('offline'); if (navigator.onLine) { b && b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'offline'; b.style.cssText = 'position:sticky;top:0;z-index:40;background:#a85a00;color:#fff;padding:8px 12px;text-align:center;font-weight:700'; b.textContent = 'Offline — showing the last data loaded. Changes won’t save until you’re back online.'; document.body.prepend(b); } }
window.addEventListener('online', netBanner); window.addEventListener('offline', netBanner); window.addEventListener('DOMContentLoaded', netBanner);

// ---------- CSV downloads: a button on every list, and all of them on Reports → Export ----------
const CSV_LIST = [['inventory', 'Inventory', null], ['customers', 'Customers', ['sales', 'finance', 'collector', 'service', 'accounting']], ['leads', 'Leads', ['sales', 'finance']], ['appraisals', 'Appraisals', ['sales', 'finance']], ['deals', 'Deals', ['sales', 'finance', 'accounting']], ['accounts', 'In-house accounts', ['finance', 'collector', 'accounting']], ['payments', 'Payments', ['finance', 'collector', 'accounting']],
  ['collections', 'Collections queue', ['finance', 'collector', 'accounting']], ['repair_orders', 'Repair orders', ['service', 'parts', 'accounting']], ['parts', 'Parts', ['service', 'parts', 'accounting']], ['warranty_claims', 'Warranty claims', ['service', 'accounting']],
  ['bills', 'Bills', 'books'], ['vendors', 'Vendors', 'books'], ['bank_lines', 'Bank statement lines', 'books'], ['drawers', 'Cashier drawers', 'books'], ['time_clock', 'Time clock', 'books'],
  ['trial_balance', 'Trial balance', 'books'], ['chart_of_accounts', 'Chart of accounts', 'books'], ['audit_log', 'Audit log', 'mgr']];
const csvOk = need => !need || (Array.isArray(need) ? isMgr() || need.includes(ME.user.role) : need === 'books' ? ['owner', 'manager', 'accounting'].includes(ME.user.role) : need === 'mgr' ? isMgr() && !ME.user.store_id : true);
const csvHref = name => `/api/csv/${name}${STORE ? '?store=' + STORE : ''}`;
const PAGE_CSV = { inventory: 'inventory', customers: 'customers', leads: 'leads', appraisals: 'appraisals', deals: 'deals', accounts: 'accounts', collections: 'collections', service: 'repair_orders', parts: 'parts', warranty: 'warranty_claims' };
for (const [page, name] of Object.entries(PAGE_CSV)) { const orig = VIEWS[page]; VIEWS[page] = async (id, extra) => { await orig(id, extra); if (id) return;
  const a = document.createElement('a'); a.className = 'btn sec sm'; a.href = csvHref(name); a.textContent = '⬇ CSV'; a.title = 'Download this list as a spreadsheet file';
  const bar = document.querySelector('#main .bar') || document.querySelector('#main .tabs'); if (bar) bar.appendChild(a); else document.querySelector('#main h1').after(a); }; }
window.exportExtra = (prev => () => { const m = today().slice(0, 8) + '01';
  return `<p>Your data is yours. Download any list as a spreadsheet (CSV opens in Excel, Numbers or Google Sheets), send the journal to QuickBooks, or take everything.</p>
  <h3>Spreadsheets (CSV)</h3>${CSV_LIST.filter(x => csvOk(x[2])).map(([n, t]) => `<div class="kv"><span>${t}</span><b><a class="btn sec sm" href="${csvHref(n)}">⬇ Download</a></b></div>`).join('')}
  ${['owner', 'manager', 'accounting'].includes(ME.user.role) ? `<h3>Accounting files</h3><div class="bar"><label class="l">From<input type="date" id="exf" value="${m}"></label><label class="l">To<input type="date" id="ext" value="${today()}"></label></div>
  <div class="bar"><button class="btn sec" onclick="location.href='/api/export/journal.csv?from='+exf.value+'&to='+ext.value">Journal (CSV)</button><button class="btn sec" onclick="location.href='/api/csv/trial_balance?from='+exf.value+'&to='+ext.value">Trial balance (CSV)</button><button class="btn sec" onclick="location.href='/api/payroll.csv?from='+exf.value+'&to='+ext.value">Payroll (CSV)</button><button class="btn sec" onclick="location.href='/api/export/qb?from='+exf.value+'&to='+ext.value">QuickBooks (IIF)</button></div>
  <p class="mut small">QuickBooks Desktop imports IIF files (File → Utilities → Import).</p>` : ''}
  ${isMgr() || ME.user.role === 'accounting' ? `<h3>Everything</h3><div class="bar"><a class="btn" href="/api/export">All data (JSON backup)</a></div>` : ''}`; })(window.exportExtra);
VIEWS.downloads = async () => { view(`<h1>Downloads</h1><div class="card">${exportExtra()}</div>`); };
