/* 360 MEDICAL - SURGICAL CASE TRACKER · additions
   Barcode/UDI scan, price book, PO-to-paid pipeline, photo attachments, data checks, change history,
   commission statement, case calendar, surgeon preference cards, pathway visit log, hospital credentials,
   voice notes and notifications. Hooks into the tracker through window.SCT / window.SCTX. */
(function () {
  'use strict';
  var T = window.SCT; if (!T) return;
  var S = T.S, $ = T.$, el = T.el, money = T.money, dayName = T.dayName;
  var TODAY = T.TODAY;
  var X = { visits: [], prefs: [], creds: [], pricebook: { rows: [] }, settings: {}, closed: { months: {} }, db: null, built: {} };
  var DONE = ['Completed', 'PO received', 'Invoiced', 'Paid'];
  var STAMP = { 'Completed': 'completed_date', 'PO received': 'po_date', 'Invoiced': 'invoiced_date', 'Paid': 'paid_date' };
  var SYSTEMS = ['Vendormate (GHX)', 'symplr / Reptrax', 'IntelliCentrics (SEC³URE)', 'Hospital badge', 'Other'];
  var VISIT_TYPES = ['Office visit', 'Case observation', 'In-service', 'Lunch & learn', 'Phone / virtual', '360 Experience', 'Other'];
  var SERVICES = ['', 'General Surgery', 'Colorectal', 'Bariatric', 'Orthopedics', 'GYN', 'Urology', 'Endoscopy', 'Interventional Radiology'];
  var LABELS = { date: 'Date', time: 'Time', rep: 'Rep', surgeon: 'Surgeon', facility: 'Facility', service_line: 'Service line', product: 'Product', udi: 'Barcode', lot: 'Lot', expiry: 'Expiration', units: 'Units', net_sales: 'Net sales', surgeon_type: 'Surgeon type', status: 'Status', po: 'PO / Invoice #', notes: 'Notes', attachments: 'Photos', contract_price: 'Contract price', off_contract: 'Off contract', completed_date: 'Completed date', po_date: 'PO date', invoiced_date: 'Invoiced date', paid_date: 'Paid date' };

  var set = function () { return Object.assign({ po_alert_days: 3, invoice_alert_days: 7, stuck_step_days: 30, cred_warn_days: 30 }, X.settings || {}); };
  var lc = function (v) { return String(v || '').trim().toLowerCase(); };
  var norm = function (s) { return lc(s).replace(/^dr\.?\s*/, '').replace(/[^a-z ]/g, '').trim().split(' ').pop(); };
  var addDays = function (iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var daysBetween = function (a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); };
  var pl = T.pl, cnt = T.count;
  var viewRep = function () { return T.currentViewRep(); };
  var inView = function (r) { var v = viewRep(); return !v || r.rep === v; };
  var curCase = function () { return S.cases.find(function (c) { return c.id === S.editId; }); };
  var api = function (url, body, method) {
    return fetch(url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; }); });
  };
  var btn = function (txt, cls, fn) { var b = el('button', 'btn ' + (cls || ''), txt); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
  var opt = function (sel, list, value) { sel.replaceChildren.apply(sel, list.map(function (o) { return Array.isArray(o) ? new Option(o[1], o[0]) : new Option(o || '—', o); })); if (value != null) sel.value = value; return sel; };
  function save(kind, id, op, body) {
    var key = kind + ':' + id, ref = S.db.doc(kind + '/' + id);
    return T.run(key, function () { return op === 'delete' ? ref.delete() : op === 'set' ? ref.set(body) : ref.update(body); });
  }
  function armed(b, label, fn) {
    if (!b.dataset.armed) { var t = b.textContent; b.dataset.armed = '1'; b.textContent = label || 'Confirm'; setTimeout(function () { if (b.isConnected) { b.dataset.armed = ''; b.textContent = t; } }, 4000); return; }
    fn();
  }
  function closedMonth(date) { var m = String(date || '').slice(0, 7); return (X.closed.months || {})[m] ? m : null; }

  /* ---------- voice dictation ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function addMic(ta) {
    if (!SR || !ta || ta.dataset.mic) return;
    ta.dataset.mic = '1';
    var b = btn('🎤 Dictate', 'small x-mic'), rec = null;
    b.setAttribute('aria-label', 'Dictate into this note');
    b.addEventListener('click', function () {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = function (e) {
        var txt = ''; for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) txt += e.results[i][0].transcript;
        if (!txt) return; ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + ' ' : ta.value) + txt.trim();
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onend = function () { rec = null; b.classList.remove('on'); b.textContent = '🎤 Dictate'; };
      rec.onerror = function () { if (rec) rec.stop(); };
      try { rec.start(); b.classList.add('on'); b.textContent = '■ Stop dictation'; } catch (e) { rec = null; }
    });
    ta.insertAdjacentElement('afterend', b);
  }

  /* ---------- price book ---------- */
  function contractPrice(product, facility) {
    var rows = (X.pricebook && X.pricebook.rows) || [], p = lc(product), f = lc(facility);
    if (!p) return null;
    var hit = rows.find(function (r) { return lc(r.product) === p && f && lc(r.facility) === f; }) || rows.find(function (r) { return lc(r.product) === p && !lc(r.facility); });
    return hit && hit.price != null && hit.price !== '' ? Number(hit.price) : null;
  }
  function priceHint() {
    var box = $('#ce-price'); if (!box) return;
    var p = contractPrice($('#ce-product').value, $('#ce-facility').value), u = Number($('#ce-units').value || 0), s = $('#ce-sales').value;
    box.className = 'x-price';
    if (p == null) { box.textContent = (X.pricebook.rows || []).length && $('#ce-product').value ? 'No contract price on file for this product' : ''; return; }
    var total = Math.round(p * u * 100) / 100;
    if (s !== '' && Math.abs(Number(s) - total) > 0.5) { box.className = 'x-price bad'; box.textContent = '⚠ Off contract: ' + money(p) + ' × ' + u + ' = ' + money(total) + ' (' + (Number(s) > total ? '+' : '−') + money(Math.abs(Number(s) - total)) + ')'; }
    else { box.className = 'x-price ok'; box.textContent = 'Contract ' + money(p) + ' × ' + u + ' = ' + money(total); }
  }
  function autoPrice() {
    var p = contractPrice($('#ce-product').value, $('#ce-facility').value), sales = $('#ce-sales');
    if (p != null) {
      var total = String(Math.round(p * Number($('#ce-units').value || 0) * 100) / 100);
      if (sales.value === '' || sales.dataset.auto === sales.value) { sales.value = total; sales.dataset.auto = total; }
    }
    priceHint();
  }

  /* ---------- checks ---------- */
  var PHI = [/\b(dob|d\.o\.b|mrn|m\.r\.n|date of birth|medical record|ssn|social security)\b/i, /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/, /\b\d{7,}\b/, /\b(pt|patient)\s*(name)?\s*[:\-]\s*[A-Z]/i];
  function phiHit(text) { return PHI.some(function (re) { return re.test(String(text || '')); }); }
  function missing(d) {
    var m = [];
    if (!d.date) m.push('date'); if (!d.rep) m.push('rep'); if (!d.surgeon) m.push('surgeon'); if (!d.facility) m.push('facility'); if (!d.product) m.push('product');
    if (!(Number(d.units) > 0)) m.push('units'); if (d.net_sales == null || d.net_sales === '') m.push('net sales');
    return m;
  }
  function dupOf(d, id) {
    return S.cases.find(function (c) { return c.id !== id && c.rep === d.rep && c.date === d.date && norm(c.surgeon) && norm(c.surgeon) === norm(d.surgeon) && lc(c.product) === lc(d.product) && c.status !== 'Cancelled'; });
  }
  var blockMsg = '';
  function drawChecks(d, id) {
    var box = $('#ce-checks'); if (!box) return;
    var msgs = [], level = 'warn';
    if (blockMsg) { msgs.push(blockMsg); level = 'bad'; }
    if (phiHit(d.notes) || phiHit(d.surgeon)) { msgs.push('These notes look like they may include a date of birth, MRN or other patient identifier. Remove it: patient identifiers must never be entered here.'); level = 'bad'; }
    if (DONE.indexOf(d.status) >= 0) { var m = missing(d); if (m.length) msgs.push('Missing for a ' + d.status + ' case: ' + m.join(', ') + '.'); }
    if (['PO received', 'Invoiced', 'Paid'].indexOf(d.status) >= 0 && !d.po) msgs.push('Add the PO / Invoice # for a ' + d.status + ' case.');
    var dup = d.surgeon && d.product ? dupOf(d, id) : null;
    if (dup) msgs.push('Possible duplicate: another ' + (dup.product || '') + ' case for ' + dup.surgeon + ' on ' + dayName(dup.date) + ' (' + (dup.status || '') + ').');
    box.hidden = !msgs.length; box.className = 'full x-checks ' + level;
    box.replaceChildren.apply(box, msgs.map(function (t) { return el('div', '', t); }));
  }

  /* called by the tracker every time the editor is read (each autosave) */
  function augment(d) {
    var c = curCase(); if (!c) return;
    blockMsg = '';
    var prev = c.status || 'Scheduled', sel = $('#ce-status');
    if (d.status !== prev) {
      var gateDone = DONE.indexOf(d.status) >= 0 && DONE.indexOf(prev) < 0 && missing(d).length;
      var gatePO = ['PO received', 'Invoiced', 'Paid'].indexOf(d.status) >= 0 && !d.po;
      if (gateDone || gatePO) {
        blockMsg = 'Not marked ' + d.status + ' yet: ' + (gateDone ? 'fill in ' + missing(d).join(', ') : 'add the PO / Invoice #') + ' first.';
        d.status = prev; sel.value = prev;
      } else if (STAMP[d.status] && !c[STAMP[d.status]]) {
        d[STAMP[d.status]] = TODAY;
        if (d.status === 'Paid' && !c.invoiced_date) d.invoiced_date = TODAY;
        if ((d.status === 'Paid' || d.status === 'Invoiced') && !c.po_date) d.po_date = TODAY;
        if (!c.completed_date) d.completed_date = c.date && c.date <= TODAY ? c.date : TODAY;
      }
    }
    var p = contractPrice(d.product, d.facility);
    d.contract_price = p;
    d.off_contract = p != null && d.net_sales != null && Math.abs(Number(d.net_sales) - p * Number(d.units || 0)) > 0.5;
    drawChecks(d, c.id);
    drawPrefHint();
    priceHint();
  }

  /* ---------- preference card in the editor ---------- */
  function prefFor(rep, surgeon) { var n = norm(surgeon); return n ? X.prefs.find(function (p) { return norm(p.surgeon) === n && (!rep || p.rep === rep); }) : null; }
  function drawPrefHint() {
    var box = $('#ce-pref'); if (!box) return;
    var c = curCase(), p = c ? prefFor($('#ce-rep').value || c.rep, $('#ce-surgeon').value) : null;
    box.hidden = !p; box.replaceChildren(); if (!p) return;
    var t = el('span'); t.appendChild(el('b', '', 'Preference card · ' + p.surgeon + ': '));
    t.appendChild(document.createTextNode([(p.products || []).join(', '), p.sizes, p.facility, p.notes].filter(Boolean).join(' · ') || 'no details yet'));
    box.appendChild(t);
    box.appendChild(btn('Use card', 'small', function () { applyPref(p, true); }));
  }
  function applyPref(p, force) {
    var changed = false;
    var fill = function (sel, v) { var f = $(sel); if (v && (force || !f.value)) { f.value = v; changed = true; } };
    fill('#ce-product', (p.products || [])[0]); fill('#ce-facility', p.facility); fill('#ce-service', p.service_line);
    if (changed) { autoPrice(); T.editorChanged(0); T.render(); }
  }

  /* ---------- barcode / UDI ---------- */
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function yymmdd(v) { if (!/^\d{6}$/.test(v)) return ''; var y = 2000 + Number(v.slice(0, 2)), m = Number(v.slice(2, 4)), d = Number(v.slice(4, 6)); if (m < 1 || m > 12) return ''; if (!d) d = lastDay(y, m); return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function parseCode(raw) {
    var s = String(raw || '').trim().replace(/^\][A-Za-z]\d/, ''), out = { raw: s };
    if (!s) return out;
    if (s[0] === '+') { var segs = s.slice(1).split('/'); out.di = segs[0].slice(0, -1); var m = /\$\$?(\d{0,6})([A-Za-z0-9]+)/.exec(segs[1] || ''); if (m) out.lot = m[2]; return out; }
    var FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 }, VAR = ['10', '21', '22', '30', '240', '241', '250', '251'];
    var take = function (ai, v) { if (ai === '01') out.di = v; else if (ai === '17') out.exp = yymmdd(v); else if (ai === '10') out.lot = v; else if (ai === '21') out.serial = v; else if (ai === '11') out.mfg = yymmdd(v); };
    if (s.indexOf('(') >= 0) { var re = /\((\d{2,4})\)([^(]*)/g, mm; while ((mm = re.exec(s))) take(mm[1], mm[2].trim()); return out; }
    var str = s.replace(/[\u001dè]/g, '\u001d'), i = 0, guard = 0;
    if (/^\d{12,14}$/.test(str)) { out.di = str.padStart(14, '0'); return out; }
    while (i < str.length && guard++ < 20) {
      if (str[i] === '\u001d') { i++; continue; }
      var ai2 = str.substr(i, 2), ai3 = str.substr(i, 3);
      if (FIXED[ai2]) { take(ai2, str.substr(i + 2, FIXED[ai2])); i += 2 + FIXED[ai2]; continue; }
      var ai = VAR.indexOf(ai3) >= 0 ? ai3 : VAR.indexOf(ai2) >= 0 ? ai2 : null;
      if (!ai) break;
      var j = str.indexOf('\u001d', i + ai.length); if (j < 0) j = str.length;
      take(ai, str.slice(i + ai.length, j)); i = j;
    }
    return out;
  }
  function productByDI(di) {
    var hit = S.products.find(function (p) { return (p.udi_dis || []).indexOf(di) >= 0; });
    return hit ? ((hit.case_names && hit.case_names[0]) || hit.name) : null;
  }
  function productByName(brand, company) {
    var b = lc(brand), c = lc(company), best = null;
    S.products.forEach(function (p) {
      if (p.available === false) return;
      var names = [p.name].concat(p.case_names || []).map(lc), mf = lc(p.manufacturer);
      var nameHit = b && names.some(function (n) { var core = n.replace(/[®™]/g, '').split(/[ \/]/)[0]; return core.length > 3 && (b.indexOf(core) >= 0 || n.indexOf(b) >= 0); });
      if (nameHit) best = best || ((p.case_names && p.case_names[0]) || p.name);
      else if (!best && c && mf && (c.indexOf(mf.split(' ')[0]) >= 0)) best = (p.case_names && p.case_names[0]) || p.name;
    });
    return best;
  }
  function handleCode(raw) {
    var msg = $('#ce-scanmsg'), g = parseCode(raw);
    if (!g.raw) return;
    $('#ce-udi').value = g.raw;
    if (g.lot) $('#ce-lot').value = g.lot;
    if (g.exp) $('#ce-exp').value = g.exp;
    var found = [g.lot ? 'lot ' + g.lot : '', g.exp ? 'exp ' + dayName(g.exp) : ''].filter(Boolean);
    var finish = function (product, note, ok) {
      if (product) { $('#ce-product').value = product; autoPrice(); }
      msg.className = 'x-scanmsg ' + (ok ? 'ok' : product ? 'ok' : '');
      msg.textContent = [product ? 'Product: ' + product : '', found.join(', '), note].filter(Boolean).join(' · ');
      if (g.exp && g.exp < TODAY) { msg.className = 'x-scanmsg bad'; msg.textContent = '⚠ EXPIRED ' + dayName(g.exp) + ' · ' + msg.textContent; }
      T.editorChanged(0); T.render();
    };
    if (!g.di) return finish(null, 'Barcode saved; no device ID found in it.');
    var local = productByDI(g.di);
    if (local) return finish(local, '', true);
    msg.className = 'x-scanmsg'; msg.textContent = 'Looking up device ' + g.di + '…';
    api('/api/udi/' + encodeURIComponent(g.di)).then(function (j) {
      if (j.product_id) { var p = S.products.find(function (x) { return x.id === j.product_id; }); return finish(p ? ((p.case_names && p.case_names[0]) || p.name) : null, '', true); }
      if (!j.found) return finish(null, j.error || 'Device ' + g.di + ' not found in the FDA database. Pick the product.');
      var match = productByName(j.brand, j.company);
      finish(match, 'FDA: ' + [j.brand, j.company].filter(Boolean).join(' · ') + (match ? '' : ' — not in our catalog, pick the product'));
    }, function () { finish(null, 'Could not reach the device lookup. Pick the product.'); });
  }
  var scanStream = null, scanStop = null;
  function openScanner() {
    var m = $('#x-scan'); m.hidden = false; $('#x-scanmsg').textContent = 'Starting camera…';
    var v = $('#x-video');
    var done = function (text) { closeScanner(); handleCode(text); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#x-scanmsg').textContent = 'This browser cannot use the camera. Type or paste the barcode instead.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      scanStream = stream; v.srcObject = stream; v.play().catch(function () {});
      $('#x-scanmsg').textContent = 'Hold the product label barcode inside the frame.';
      if ('BarcodeDetector' in window) {
        var det = new window.BarcodeDetector({ formats: ['data_matrix', 'code_128', 'qr_code', 'ean_13', 'upc_a', 'code_39'] }), live = true;
        scanStop = function () { live = false; };
        var tick = function () { if (!live) return; det.detect(v).then(function (r) { if (r && r[0] && r[0].rawValue) done(r[0].rawValue); else setTimeout(tick, 250); }, function () { setTimeout(tick, 400); }); };
        tick();
      } else loadZXing().then(function (Z) {
        var reader = new Z.BrowserMultiFormatReader(), live = true; scanStop = function () { live = false; try { reader.reset(); } catch (e) {} };
        var loop = function () { if (!live) return; reader.decodeOnceFromVideoElement(v).then(function (r) { if (live) done(r.getText()); }, function () { setTimeout(loop, 300); }); };
        loop();
      }, function () { $('#x-scanmsg').textContent = 'The scanner could not load. Type or paste the barcode instead.'; });
    }, function () { $('#x-scanmsg').textContent = 'Camera permission was blocked. Allow the camera, or type the barcode.'; });
  }
  var zx = null;
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zx) return zx;
    zx = new Promise(function (ok, bad) { var sc = document.createElement('script'); sc.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'; sc.onload = function () { ok(window.ZXing); }; sc.onerror = bad; document.head.appendChild(sc); });
    return zx;
  }
  function closeScanner() {
    if (scanStop) scanStop(); scanStop = null;
    if (scanStream) scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null;
    $('#x-scan').hidden = true;
  }

  /* ---------- attachments ---------- */
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var fr = new FileReader(); fr.onerror = bad;
      fr.onload = function () { var im = new Image(); im.onerror = function () { bad({ error: 'That file is not an image.' }); };
        im.onload = function () { var r = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * r); c.height = Math.round(im.naturalHeight * r); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.82)); };
        im.src = fr.result; };
      fr.readAsDataURL(file);
    });
  }
  var attSig = '';
  function setAtt(c, list) { c.attachments = list; S.cases = S.cases.map(function (x) { return x.id === c.id ? Object.assign({}, x, { attachments: list }) : x; }); save('cases', c.id, 'update', { attachments: list, updated_at: new Date().toISOString() }); }
  function drawAtt() {
    var box = $('#ce-att'), c = curCase(); if (!box) return; box.replaceChildren(); if (!c) { attSig = ''; return; }
    attSig = c.id + ':' + (c.attachments || []).join(',');
    (c.attachments || []).forEach(function (id) {
      var w = el('div', 'x-thumb'), a = el('a'); a.href = '/img/' + encodeURIComponent(id); a.target = '_blank'; a.rel = 'noopener';
      var im = el('img'); im.src = a.href; im.alt = 'Attachment'; a.appendChild(im); w.appendChild(a);
      var x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove photo');
      x.addEventListener('click', function () { if (!confirm('Remove this photo from the case?')) return; var list = (c.attachments || []).filter(function (i) { return i !== id; }); setAtt(c, list); api('/api/upload/' + encodeURIComponent(id), null, 'DELETE').catch(function () {}); drawAtt(); });
      w.appendChild(x); box.appendChild(w);
    });
    function picker(label, camera) {
      var inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
      if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
      var b = btn(label, 'small', function () { inp.click(); });
      inp.addEventListener('change', function () {
        var files = Array.from(inp.files || []); if (!files.length) return;
        box.querySelectorAll('button.att-add').forEach(function (x) { x.disabled = true; }); b.textContent = 'Uploading…';
        var chain = Promise.resolve(), ids = [];
        files.forEach(function (f) { chain = chain.then(function () { return shrink(f); }).then(function (data) { return api('/api/upload', { data: data, rep: c.rep }); }).then(function (j) { ids.push(j.id); }); });
        chain.then(function () {}, function (e) { T.setStatus('err', (e && e.error) || (navigator.onLine ? 'Photo upload failed' : 'Photos need a connection: try again when online')); })
          .then(function () { if (ids.length) { var cc = curCase() || c; setAtt(cc, (cc.attachments || []).concat(ids)); } drawAtt(); });
      });
      b.classList.add('att-add'); box.appendChild(b); box.appendChild(inp);
    }
    // phones and tablets: open the camera straight away; everyone: pick from photos/files
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) picker('📷 Take photo', true);
    picker('📎 Add photo', false);
  }

  /* ---------- invoice: the rep attaches it (photo or PDF) with its details; it waits for the COO's approval ---------- */
  var invSig = '', INVP = { pending: ['warn', 'Waiting for COO approval'], approved: ['ok', 'Approved'], rejected: ['bad', 'Sent back'] };
  function applyCase(cs) { S.cases = S.cases.map(function (x) { return x.id === cs.id ? Object.assign({}, x, { invoice: cs.invoice, status: cs.status, net_sales: cs.net_sales }) : x; }); }
  function invFiles(list) { var w = el('div', 'x-thumbs'); (list || []).forEach(function (id) { var a = el('a', 'btn small', '📄 View invoice'); a.href = '/img/' + encodeURIComponent(id); a.target = '_blank'; a.rel = 'noopener'; w.appendChild(a); }); return w; }
  function invSummary(inv) {
    var d = el('div'); d.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr));gap:6px 12px;margin:6px 0';
    [['Invoice #', inv.number], ['Invoice date', inv.date], ['Amount', money(inv.amount)], ['PO #', inv.po || '—'], ['Bill to', inv.bill_to || '—'], ['Terms', inv.terms || '—']].forEach(function (f) { var x = el('div'); x.appendChild(el('div', 'x-lab', f[0])); x.appendChild(el('div', 'strong', f[1])); d.appendChild(x); });
    return d;
  }
  function invForm(c, box, inv) {
    var f = el('div', 'x-form'); f.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr));gap:8px 12px';
    var lab = function (t, node, full) { var l = el('label', full ? 'full' : '', t); if (full) l.style.gridColumn = '1/-1'; l.appendChild(node); f.appendChild(l); return node; };
    var num = lab('Invoice # *', el('input', 'field')), dt = lab('Invoice date *', el('input', 'field')), amt = lab('Amount $ *', el('input', 'field')), po = lab('PO #', el('input', 'field')), bt = lab('Bill to (hospital / facility)', el('input', 'field')), tm = lab('Terms', el('input', 'field'));
    dt.type = 'date'; amt.inputMode = 'decimal'; tm.placeholder = 'e.g. Net 30';
    num.value = (inv && inv.number) || c.invoice_no || c.po || ''; dt.value = (inv && inv.date) || T.TODAY; amt.value = inv ? inv.amount : (c.net_sales || ''); po.value = (inv && inv.po) || c.po || ''; bt.value = (inv && inv.bill_to) || c.facility || ''; tm.value = (inv && inv.terms) || '';
    var nt = lab('Notes for the COO', el('textarea', 'field'), true); nt.rows = 2; nt.value = (inv && inv.notes) || '';
    var files = ((inv && inv.files) || []).slice(), fl = el('div', 'x-thumbs'); fl.style.gridColumn = '1/-1';
    function drawFiles() {
      fl.replaceChildren();
      files.forEach(function (id) { var w = el('span', 'pill mute'); var a = el('a', '', '📄 invoice'); a.href = '/img/' + encodeURIComponent(id); a.target = '_blank'; w.appendChild(a); var x = el('button', 'btn small', '×'); x.type = 'button'; x.onclick = function () { files = files.filter(function (i) { return i !== id; }); drawFiles(); }; w.appendChild(x); fl.appendChild(w); });
      [['📷 Photo of invoice', 'image/*', true], ['📎 Add photo or PDF', 'image/*,application/pdf', false]].forEach(function (o) {
        if (o[2] && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return;
        var inp = el('input'); inp.type = 'file'; inp.accept = o[1]; inp.hidden = true; if (o[2]) inp.setAttribute('capture', 'environment');
        var b = btn(o[0], 'small', function () { inp.click(); });
        inp.onchange = function () { var file = inp.files[0]; if (!file) return; b.textContent = 'Uploading…'; b.disabled = true;
          var go = /pdf$/i.test(file.type) ? new Promise(function (ok, bad) { if (file.size > 3e6) return bad({ error: 'That PDF is over 3 MB. Take a photo of it instead.' }); var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = bad; r.readAsDataURL(file); }) : shrink(file);
          go.then(function (data) { return api('/api/upload', { data: data, rep: c.rep }); }).then(function (j) { files.push(j.id); drawFiles(); }, function (e) { b.disabled = false; b.textContent = o[0]; msg.className = 'msg err'; msg.hidden = false; msg.textContent = (e && e.error) || 'Upload failed.'; }); };
        fl.appendChild(b); fl.appendChild(inp);
      });
    }
    drawFiles(); f.appendChild(fl);
    var msg = el('div', 'msg'); msg.hidden = true; msg.style.gridColumn = '1/-1';
    var send = btn(T.isLead() ? 'Save invoice' : 'Send for approval', 'primary', function () {
      send.disabled = true; msg.hidden = true;
      api('/api/cases/' + encodeURIComponent(c.id) + '/invoice', { number: num.value, date: dt.value, amount: amt.value, po: po.value, bill_to: bt.value, terms: tm.value, notes: nt.value, files: files })
        .then(function (j) { applyCase(j.case); invSig = ''; drawInv(); T.render(); }, function (e) { send.disabled = false; msg.className = 'msg err'; msg.hidden = false; msg.textContent = (e && e.error) || 'Could not send. Check your connection.'; });
    });
    var row = el('div', 'tools'); row.style.gridColumn = '1/-1'; row.appendChild(send); if (inv) row.appendChild(btn('Cancel', 'small', function () { invSig = ''; drawInv(); }));
    f.appendChild(row); f.appendChild(msg); box.appendChild(f); num.focus();
  }
  function drawInv(force) {
    var box = $('#ce-inv'), c = curCase(); if (!box) return; if (!c) { box.replaceChildren(); invSig = ''; return; }
    var inv = c.invoice, sig = c.id + ':' + JSON.stringify(inv || null); if (!force && sig === invSig) return; invSig = sig; box.replaceChildren();
    var head = el('div', 'tools'); head.style.cssText = 'justify-content:space-between;flex-wrap:wrap'; head.appendChild(el('span', 'x-lab', 'Invoice'));
    if (inv) { var p = INVP[inv.status] || ['mute', inv.status]; head.appendChild(el('span', 'pill ' + p[0], p[1] + (inv.status !== 'pending' && inv.reviewed_by ? ' · ' + inv.reviewed_by : ''))); }
    box.appendChild(head);
    var locked = !!closedMonth(c.date), lead = T.isLead();
    // status: reps reach Invoiced / Paid only after approval
    var stSel = $('#ce-status'); if (stSel) [].forEach.call(stSel.options, function (o) { if (o.value === 'Invoiced' || o.value === 'Paid') o.disabled = !lead && !(inv && inv.status === 'approved') && stSel.value !== o.value; });
    if (!inv) { box.appendChild(el('p', 'note', lead ? 'No invoice yet.' : 'Add the invoice (photo or PDF) and its details. The case moves to Invoiced once the COO approves it.')); if (!locked) box.appendChild(btn('🧾 Add invoice', 'primary small', function () { box.replaceChildren(head); invForm(c, box, null); })); return; }
    box.appendChild(invSummary(inv)); box.appendChild(invFiles(inv.files));
    if (inv.notes) box.appendChild(el('p', 'note', 'Notes: ' + inv.notes));
    if (inv.status === 'rejected' && inv.reason) { var r = el('div', 'msg err', 'Sent back: ' + inv.reason); box.appendChild(r); }
    box.appendChild(el('p', 'note', 'Sent ' + new Date(inv.submitted_at).toLocaleString() + ' by ' + (inv.submitted_by || '') + (inv.reviewed_at ? ' · reviewed ' + new Date(inv.reviewed_at).toLocaleString() : '')));
    var acts = el('div', 'tools'); acts.style.flexWrap = 'wrap';
    if (lead && inv.status === 'pending' && !locked) {
      acts.appendChild(btn('✓ Approve', 'primary small', function (e) { e.target.disabled = true; api('/api/cases/' + encodeURIComponent(c.id) + '/invoice/review', { approve: true }).then(function (j) { applyCase(j.case); invSig = ''; drawInv(); T.render(); }, function (er) { e.target.disabled = false; alert((er && er.error) || 'Could not approve.'); }); }));
      acts.appendChild(btn('Send back', 'small', function () { var why = prompt('What needs fixing? The rep sees this.'); if (!why) return; api('/api/cases/' + encodeURIComponent(c.id) + '/invoice/review', { approve: false, reason: why }).then(function (j) { applyCase(j.case); invSig = ''; drawInv(); T.render(); }, function (er) { alert((er && er.error) || 'Could not send it back.'); }); }));
    }
    if (!locked && (inv.status !== 'approved' || lead)) acts.appendChild(btn(inv.status === 'rejected' ? 'Fix and resend' : 'Edit invoice', 'small', function () { box.replaceChildren(head); invForm(c, box, inv); }));
    box.appendChild(acts);
  }

  // COO: invoices waiting for approval · reps: their invoices that are waiting or were sent back
  var invqSig = '';
  function drawInvQueue() {
    var sec = $('#sec-invq'); if (!sec) return; var lead = T.isLead();
    var list = S.cases.filter(function (c) { return c.invoice && (c.invoice.status === 'pending' || (!lead && c.invoice.status === 'rejected')) && (lead || c.rep === S.myRep); })
      .sort(function (a, b) { return String(a.invoice.submitted_at).localeCompare(String(b.invoice.submitted_at)); });
    var sig = lead + JSON.stringify(list.map(function (c) { return [c.id, c.invoice.status, c.invoice.submitted_at]; })); if (sig === invqSig) return; invqSig = sig;
    sec.hidden = !list.length; var jp = document.querySelector('#jump a[href="#sec-invq"]'); if (jp) { jp.hidden = !list.length; jp.textContent = '🧾 ' + (lead ? 'Approve' : 'Invoices') + ' (' + list.length + ')'; }
    if (!list.length) return; sec.replaceChildren();
    var h = el('div', 'cardhead'); h.appendChild(el('h2', '', lead ? 'Invoices to approve · ' + list.length : 'My invoices · ' + list.length)); sec.appendChild(h);
    sec.appendChild(el('p', 'note', lead ? 'Reps added these invoices to their cases. Open one to check the photo and details, then approve it (the case becomes Invoiced at that amount) or send it back with a note.' : 'Waiting for the COO, or sent back for a fix. Open the case to see the note and resend.'));
    var g = el('div'); g.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:8px';
    list.forEach(function (c) {
      var inv = c.invoice, d = el('div'); d.style.cssText = 'border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px';
      var t = el('div', 'strong', (lead ? c.rep + ' · ' : '') + 'Invoice ' + inv.number); d.appendChild(t);
      d.appendChild(el('div', '', money(inv.amount) + ' · ' + inv.date));
      d.appendChild(el('div', 'note', [c.surgeon, c.facility, c.product].filter(Boolean).join(' · ') + ' · case ' + dayName(c.date)));
      if (inv.status === 'rejected') d.appendChild(el('div', 'pill bad', 'Sent back: ' + (inv.reason || '')));
      var row = el('div', 'tools'); row.appendChild(btn(lead ? 'Review' : 'Open case', 'small primary', function () { var lg = $('#sec-log'); if (lg && lg.classList.contains('folded')) { var fh = lg.querySelector('.fold-h'); if (fh) fh.click(); else lg.classList.remove('folded'); } T.openEditor(c.id); setTimeout(function () { var x = $('#ce-inv'); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200); }));
      (inv.files || []).slice(0, 1).forEach(function (id) { var a = el('a', 'btn small', '📄 View'); a.href = '/img/' + encodeURIComponent(id); a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a); });
      d.appendChild(row); g.appendChild(d);
    });
    sec.appendChild(g);
  }

  /* ---------- history ---------- */
  function fmtVal(f, v) { if (v == null || v === '') return '—'; if (f === 'net_sales' || f === 'contract_price') return money(v); if (f === 'attachments') return (v.length || 0) + ' photo' + (v.length === 1 ? '' : 's'); if (typeof v === 'boolean') return v ? 'yes' : 'no'; if (/date$|^expiry$|^date$/.test(f)) return dayName(v); var s = String(v); return s.length > 60 ? s.slice(0, 60) + '…' : s; }
  function showHistory() {
    var box = $('#ed-hist'), c = curCase(); if (!c) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.textContent = 'Loading history…';
    api('/api/audit/' + encodeURIComponent(c.id)).then(function (j) {
      box.replaceChildren(el('b', '', 'Change history'));
      if (!j.entries.length) { box.appendChild(el('p', 'note', 'No changes recorded yet. History starts from the day this feature went live.')); return; }
      var ul = el('ul');
      j.entries.slice().reverse().forEach(function (e) {
        var when = new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        var parts = Object.keys(e.changes || {}).filter(function (f) { return LABELS[f]; }).map(function (f) { return LABELS[f] + ': ' + fmtVal(f, e.changes[f][0]) + ' → ' + fmtVal(f, e.changes[f][1]); });
        ul.appendChild(el('li', '', when + ' · ' + e.by + ' ' + e.op + (parts.length ? ' — ' + parts.join('; ') : '')));
      });
      box.appendChild(ul);
    }, function () { box.textContent = 'History is not available right now.'; });
  }

  function openEditor(c) {
    blockMsg = '';
    $('#ed-hist').hidden = true; $('#ce-scanmsg').textContent = '';
    var lock = closedMonth(c.date), lb = $('#ce-lock');
    lb.hidden = !lock; lb.textContent = lock ? T.monthName(lock) + ' is closed for commissions. This case is read-only; ask the COO to reopen the month to change it.' : '';
    document.querySelectorAll('#editor .form input, #editor .form select, #editor .form textarea').forEach(function (f) { f.disabled = !!lock || (f.id === 'ce-rep' && !T.isLead()); });
    $('#ed-delete').disabled = !!lock;
    var sales = $('#ce-sales'), p = contractPrice(c.product, c.facility);
    sales.dataset.auto = p != null && c.net_sales != null && Math.abs(c.net_sales - p * (c.units || 0)) < 0.5 ? String(c.net_sales) : (c.net_sales == null ? '' : '__');
    drawAtt(); invSig = ''; drawInv(); priceHint(); drawPrefHint(); drawChecks(c, c.id);
    addMic($('#ce-notes'));
  }
  function closeEditor() { blockMsg = ''; closeScanner(); }

  /* ---------- extra alerts ---------- */
  function alerts(M, tstatus, repFilter) {
    var out = [], st = set(), mine = function (r) { return !repFilter || r.rep === repFilter; }, you = !!repFilter;
    var cases = S.cases.filter(function (c) { return c.date && mine(c); });
    var noPO = cases.filter(function (c) { return c.status === 'Completed' && daysBetween(c.date, TODAY) >= st.po_alert_days; });
    if (noPO.length) out.push({ level: 'warn', text: pl(noPO.length, 'completed case has', 'completed cases have') + ' no PO after ' + st.po_alert_days + '+ days (' + money(noPO.reduce(function (t, c) { return t + (c.net_sales || 0); }, 0)) + '). Chase the PO so it can be billed.' });
    var noInv = cases.filter(function (c) { return c.status === 'PO received' && daysBetween(c.po_date || c.date, TODAY) >= st.invoice_alert_days; });
    if (noInv.length) out.push({ level: 'warn', text: pl(noInv.length, 'case has', 'cases have') + ' a PO but no invoice after ' + st.invoice_alert_days + '+ days.' });
    var off = cases.filter(function (c) { return c.off_contract && c.date.slice(0, 7) === S.month; });
    if (off.length) out.push({ level: 'warn', text: pl(off.length, 'case is', 'cases are') + ' priced off contract this month. Check net sales against the price book.' });
    var phi = cases.filter(function (c) { return phiHit(c.notes) || phiHit(c.surgeon); });
    if (phi.length) out.push({ level: 'bad', text: pl(phi.length, 'case looks', 'cases look') + ' like ' + (phi.length === 1 ? 'it includes' : 'they include') + ' a patient identifier in the notes. Open ' + (phi.length === 1 ? 'it' : 'them') + ' and remove it.' });
    X.creds.filter(mine).forEach(function (c) {
      if (!c.expires) return; var d = daysBetween(TODAY, c.expires), who = you ? 'Your' : c.rep + "'s";
      if (d < 0) out.push({ level: 'bad', text: who + ' ' + (c.system || 'credential') + ' for ' + (c.facility || 'a facility') + ' expired ' + dayName(c.expires) + '. Renew it before the next case there.' });
      else if (d <= st.cred_warn_days) out.push({ level: 'warn', text: who + ' ' + (c.system || 'credential') + ' for ' + (c.facility || 'a facility') + ' expires in ' + pl(d, 'day', 'days') + ' (' + dayName(c.expires) + ').' });
    });
    tstatus.filter(mine).forEach(function (t) {
      var since = t.step_changed_at || (S.targets.find(function (x) { return x.id === t.id; }) || {}).step_changed_at;
      if (t.step >= 6 || t.cases > 0 || !since) return;
      var d = daysBetween(since, TODAY);
      if (d >= st.stuck_step_days) out.push({ level: 'info', text: t.surgeon + ' has been at ' + (t.step ? 'pathway step ' + t.step : 'Not started') + ' for ' + d + ' days' + (you ? '' : ' (' + t.rep + ')') + '. Plan the next step.' });
    });
    var badV = X.visits.filter(mine).filter(function (v) { return v.check && v.check.ok === false && !v.check.ack && String(v.date).slice(0, 7) === S.month; });
    if (badV.length) out.push({ level: you ? 'warn' : 'bad', text: pl(badV.length, 'target visit was', 'target visits were') + ' not verified at the facility this month: ' + badV.slice(0, 3).map(function (v) { return (you ? '' : v.rep + ' · ') + v.surgeon + ' (' + dayName(v.date) + ')'; }).join(', ') + (badV.length > 3 ? ' and more' : '') + '.' });
    var nov = X.visits.filter(mine).filter(function (v) { return v.check && v.check.ok === null && String(v.date).slice(0, 7) === S.month; });
    if (nov.length && !you) out.push({ level: 'info', text: pl(nov.length, 'check-in', 'check-ins') + " couldn't be verified because the facility has no address. Add it in Admin → Facilities." });
    var openNow = X.visits.filter(mine).filter(function (v) { return v.status === 'planned' && !v.check && v.time && window.VisitCal && window.VisitCal.state(v, X.settings) === 'open'; });
    if (openNow.length && you) out.push({ level: 'info', text: 'Check-in is open for ' + openNow.map(function (v) { return v.surgeon; }).join(', ') + '. Open it in the visit calendar and tap Check in.' });
    var due = openNextSteps().filter(mine).filter(function (v) { return v.next_date < TODAY; });
    if (due.length) out.push({ level: 'warn', text: pl(due.length, 'next step is', 'next steps are') + ' overdue: ' + due.slice(0, 3).map(function (v) { return v.surgeon + (v.next_step ? ' (' + v.next_step + ')' : ''); }).join(', ') + (due.length > 3 ? ' and more' : '') + '.' });
    return out;
  }
  function openNextSteps() {
    return X.visits.filter(function (v) { return v.next_date && !X.visits.some(function (w) { return w !== v && w.target_id && w.target_id === v.target_id && (w.date > v.date || (w.date === v.date && (w.created_at || '') > (v.created_at || ''))); }); })
      .sort(function (a, b) { return a.next_date < b.next_date ? -1 : 1; });
  }
  /* add step_changed_at to target status rows for alerts */
  var origTS = T.targetStatus;

  /* ---------- section: billing pipeline ---------- */
  function drawBilling(ctx) {
    var sec = $('#sec-billing'); sec.hidden = !ctx.loaded; if (!ctx.loaded) return;
    var st = set(), cases = S.cases.filter(function (c) { return c.date && inView(c); });
    var sum = function (l) { return l.reduce(function (t, c) { return t + (c.net_sales || 0); }, 0); };
    var stage = function (s) { return cases.filter(function (c) { return c.status === s; }); };
    var waitPO = stage('Completed'), waitInv = stage('PO received'), waitPay = stage('Invoiced');
    var paidM = cases.filter(function (c) { return c.status === 'Paid' && String(c.paid_date || '').slice(0, 7) === S.month; });
    var invM = cases.filter(function (c) { return c.invoiced_date && c.invoiced_date.slice(0, 7) === S.month; });
    var avg = function (l, f) { var v = l.filter(function (c) { return c[f]; }).map(function (c) { return Math.max(0, daysBetween(c.date, c[f])); }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10 : null; };
    var dInv = avg(invM, 'invoiced_date'), dPaid = avg(paidM, 'paid_date');
    sec.replaceChildren();
    var h = el('div', 'cardhead'); h.appendChild(el('h2', '', 'Billing pipeline · PO to paid')); sec.appendChild(h);
    sec.appendChild(el('p', 'note', 'Every completed case moves Completed → PO received → Invoiced → Paid. Open items include all months. Change a case\'s status in the case log; the date of each step is recorded automatically.'));
    var g = el('div', 'x-stages');
    var tile = function (lab, n, sub) { var d = el('div', 'x-stage'); d.appendChild(el('div', 'lab', lab)); d.appendChild(el('div', 'num', n)); d.appendChild(el('div', 'sub', sub)); g.appendChild(d); };
    tile('Awaiting PO', cnt(waitPO.length), money(sum(waitPO)));
    tile('Awaiting invoice', cnt(waitInv.length), money(sum(waitInv)));
    tile('Awaiting payment', cnt(waitPay.length), money(sum(waitPay)));
    tile('Paid · ' + T.mName(S.month), money(sum(paidM)), pl(paidM.length, 'case', 'cases'));
    tile('Days case → invoice', dInv == null ? '—' : String(dInv), invM.length ? 'avg of ' + pl(invM.length, 'case', 'cases') + ' invoiced in ' + T.mName(S.month) : 'none invoiced this month');
    tile('Days case → paid', dPaid == null ? '—' : String(dPaid), paidM.length ? 'avg, paid in ' + T.mName(S.month) : 'none paid this month');
    sec.appendChild(g);
    var open = waitPO.concat(waitInv, waitPay).map(function (c) { var since = c.status === 'Completed' ? c.date : c.status === 'PO received' ? (c.po_date || c.date) : (c.invoiced_date || c.date); return { c: c, age: daysBetween(c.date, TODAY), stepAge: daysBetween(since, TODAY) }; })
      .sort(function (a, b) { return b.age - a.age; });
    if (!open.length) { sec.appendChild(el('div', 'empty', 'Nothing open. Every completed case is paid.')); return; }
    sec.appendChild(el('div', 'x-sub', 'Open items, oldest first'));
    var wrap = el('div', 'scroll'), tb = el('table'), th = el('thead'), tr = el('tr');
    ['Case date', 'Rep', 'Surgeon', 'Product', 'Status', 'PO #', 'Net sales', 'Days open', ''].forEach(function (x, i) { var c = el('th', i === 6 || i === 7 ? 'r' : i === 1 ? 'col-rep' : '', x); tr.appendChild(c); });
    th.appendChild(tr); tb.appendChild(th); var body = el('tbody');
    open.slice(0, 25).forEach(function (o) {
      var c = o.c, row = el('tr', 'click'); row.tabIndex = 0;
      var late = (c.status === 'Completed' && o.stepAge >= st.po_alert_days) || (c.status === 'PO received' && o.stepAge >= st.invoice_alert_days) || (c.status === 'Invoiced' && o.stepAge >= 30);
      [dayName(c.date), c.rep, c.surgeon || '—', c.product || '—', c.status, c.po || '—', money(c.net_sales), String(o.age)].forEach(function (v, i) { row.appendChild(el('td', i === 6 || i === 7 ? 'r' : i === 1 ? 'col-rep' : '', v)); });
      var f = el('td'); if (late) f.appendChild(el('span', 'pill ' + (c.status === 'Completed' ? 'bad' : 'warn'), c.status === 'Completed' ? 'PO late' : c.status === 'PO received' ? 'Invoice late' : 'Unpaid 30+')); row.appendChild(f);
      var go = function () { T.openEditor(c.id); $('#sec-log').scrollIntoView({ behavior: 'smooth' }); };
      row.addEventListener('click', go); row.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      body.appendChild(row);
    });
    tb.appendChild(body); wrap.appendChild(tb); sec.appendChild(wrap);
    if (open.length > 25) sec.appendChild(el('p', 'note', '+ ' + (open.length - 25) + ' more open items.'));
  }

  /* ---------- section: upcoming + calendar ---------- */
  function drawUpcoming(ctx) {
    var sec = $('#sec-upcoming');
    if (!X.built.upcoming) {
      X.built.upcoming = true; sec.replaceChildren();
      var h = el('div', 'cardhead'); h.appendChild(el('h2', '', 'Upcoming · next 14 days'));
      h.appendChild(btn('📅 Add to my phone calendar', 'small', calLink)); sec.appendChild(h);
      sec.appendChild(el('p', 'note', 'Scheduled cases, target visits and pathway next steps. Add a time to a case in the case log and it shows on your phone calendar at that time.'));
      var list = el('div'); list.id = 'x-up-list'; sec.appendChild(list);
      var cal = el('div', 'x-cal'); cal.id = 'x-cal'; cal.hidden = true; sec.appendChild(cal);
    }
    list = $('#x-up-list'); list.replaceChildren();
    var end = addDays(TODAY, 13), items = [];
    S.cases.filter(function (c) { return inView(c) && c.date >= TODAY && c.date <= end && c.status !== 'Cancelled'; }).forEach(function (c) { items.push({ date: c.date, time: c.time || '', kind: 'case', c: c }); });
    X.visits.filter(inView).filter(function (v) { return v.status === 'planned' && v.date >= TODAY && v.date <= end; }).forEach(function (v) { items.push({ date: v.date, time: v.time || '', kind: 'visit', v: v }); });
    openNextSteps().filter(inView).filter(function (v) { return v.next_date <= end; }).forEach(function (v) { items.push({ date: v.next_date < TODAY ? TODAY : v.next_date, time: '', kind: 'step', v: v, late: v.next_date < TODAY }); });
    items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '99') < (b.time || '99') ? -1 : 1; });
    if (!items.length) { list.appendChild(el('div', 'empty', 'Nothing scheduled in the next two weeks. Log upcoming cases with status Scheduled to see them here.')); return; }
    var day = null, ul = null;
    items.forEach(function (it) {
      if (it.date !== day) { day = it.date; list.appendChild(el('div', 'x-day', it.date === TODAY ? 'Today · ' + dayName(it.date) : new Date(it.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }))); ul = el('ul', 'x-list'); list.appendChild(ul); }
      var li = el('li'), left = el('div');
      if (it.kind === 'case') {
        var c = it.c;
        left.appendChild(el('div', 'strong', (c.time ? fmtTime(c.time) + ' · ' : '') + (c.surgeon || 'Surgeon TBD') + (c.product ? ' · ' + c.product : '')));
        left.appendChild(el('div', 'meta', [c.facility, ctx.viewRep ? '' : c.rep, c.status].filter(Boolean).join(' · ')));
        li.appendChild(left); li.appendChild(btn('Open', 'small', function () { T.openEditor(c.id); $('#sec-log').scrollIntoView({ behavior: 'smooth' }); }));
      } else if (it.kind === 'visit') {
        var pv = it.v, pst = window.VisitCal ? window.VisitCal.state(pv, X.settings) : 'planned';
        left.appendChild(el('div', 'strong', (pv.time ? fmtTime(pv.time) + ' · ' : '') + 'Target visit · ' + pv.surgeon));
        left.appendChild(el('div', 'meta', [pv.facility, ctx.viewRep ? '' : pv.rep, pv.purpose].filter(Boolean).join(' · ')));
        li.appendChild(left);
        var pb = btn(pst === 'open' && !T.isLead() ? '📍 Check in' : 'Open', 'small' + (pst === 'open' && !T.isLead() ? ' primary' : ''), function () { if (vcal) vcal.open(pv); });
        li.appendChild(pb);
      } else {
        var v = it.v;
        left.appendChild(el('div', 'strong', 'Next step · ' + v.surgeon + (v.next_step ? ': ' + v.next_step : '')));
        left.appendChild(el('div', 'meta', [it.late ? 'Overdue since ' + dayName(v.next_date) : 'Pathway', ctx.viewRep ? '' : v.rep].filter(Boolean).join(' · ')));
        li.appendChild(left); if (it.late) li.appendChild(el('span', 'pill warn', 'Overdue'));
      }
      ul.appendChild(li);
    });
  }
  function fmtTime(t) { var p = t.split(':').map(Number); return ((p[0] + 11) % 12 + 1) + ':' + String(p[1]).padStart(2, '0') + (p[0] < 12 ? ' AM' : ' PM'); }
  function calLink() {
    var box = $('#x-cal'); box.hidden = false; box.textContent = 'Getting your calendar link…';
    api('/api/cal-link').then(function (j) {
      var web = j.url.replace(/^https?:/, 'webcal:');
      box.replaceChildren();
      box.appendChild(el('b', '', 'Your private calendar link'));
      box.appendChild(el('div', '', 'iPhone / Mac: tap Subscribe below, then Subscribe again. Google Calendar: Settings → Add calendar → From URL, and paste the link. Outlook: Add calendar → Subscribe from web.'));
      var row = el('div', 'tools'); var a = el('a', 'btn primary small', 'Subscribe'); a.href = web; row.appendChild(a);
      row.appendChild(btn('Copy link', 'small', function () { (navigator.clipboard ? navigator.clipboard.writeText(j.url) : Promise.reject()).then(function () { T.setStatus('saved', 'Calendar link copied'); }, function () { prompt('Copy this link:', j.url); }); }));
      box.appendChild(row); box.appendChild(el('code', '', j.url));
      box.appendChild(el('div', 'meta', 'Keep this link private: anyone with it can see your case calendar. Resetting your PIN turns it off.'));
    }, function () { box.textContent = 'Could not get the link. Check your connection.'; });
  }

  // put the tracker's cases and visits into Outlook: a subscribed calendar that refreshes on its own (read-only in Outlook)
  function outlookBox() {
    var box = $('#x-outlook'); if (!box) return; if (!box.hidden && box.dataset.ready) { box.hidden = true; return; }
    box.hidden = false; box.textContent = 'Getting your calendar link…';
    api('/api/cal-link').then(function (j) {
      var https = j.url, web = j.url.replace(/^https?:/, 'webcal:'), name = encodeURIComponent('360 Medical cases & visits');
      box.replaceChildren(); box.dataset.ready = '1';
      box.appendChild(el('b', '', 'Show your cases and visits in Outlook'));
      box.appendChild(el('div', '', 'Pick the Outlook you use. It adds a "360 Medical cases & visits" calendar next to your own; new and changed visits show up there on their own (Outlook refreshes it every few hours). Plan and change visits here in the tracker.'));
      var row = el('div', 'tools'); row.style.flexWrap = 'wrap';
      var a1 = el('a', 'btn primary small', 'Outlook (work · Microsoft 365)'); a1.href = 'https://outlook.office.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + name; a1.target = '_blank'; a1.rel = 'noopener';
      var a2 = el('a', 'btn small', 'Outlook.com / Hotmail'); a2.href = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + name; a2.target = '_blank'; a2.rel = 'noopener';
      var a3 = el('a', 'btn small', 'Outlook app on this computer / iPhone'); a3.href = web;
      row.appendChild(a1); row.appendChild(a2); row.appendChild(a3);
      row.appendChild(btn('Copy link', 'small', function () { (navigator.clipboard ? navigator.clipboard.writeText(https) : Promise.reject()).then(function () { T.setStatus('saved', 'Calendar link copied'); }, function () { prompt('Copy this link:', https); }); }));
      box.appendChild(row);
      box.appendChild(el('div', 'meta', 'Outlook app: if a button does nothing, open Outlook → Calendar → Add calendar → Subscribe from web, and paste the copied link. Keep the link private: anyone with it can see your calendar. Resetting your PIN turns it off.'));
    }, function () { box.textContent = 'Could not get the link. Check your connection.'; });
  }

  /* ---------- section: pathway visit log ---------- */
  function drawVisits(ctx) {
    var sec = $('#sec-visits'), targets = S.targets.filter(inView);
    if (!X.built.visits) {
      X.built.visits = true; sec.replaceChildren();
      sec.appendChild(el('h2', '', 'Pathway activity · visit log'));
      sec.appendChild(el('p', 'note', 'Log every touch with a target surgeon: visits, case observations, in-services. Set the next step and a date so nothing goes quiet. Moving the pathway step here updates the target table.'));
      var f = el('div', 'x-form'); f.id = 'x-vform';
      var lab = function (t, node, cls) { var l = el('label', cls || '', t); l.appendChild(node); f.appendChild(l); return node; };
      lab('Target surgeon', el('select', 'field')).id = 'xv-target';
      var d = lab('Date', el('input', 'field')); d.type = 'date'; d.id = 'xv-date'; d.value = TODAY;
      opt(lab('Type', el('select', 'field')), VISIT_TYPES).id = 'xv-type';
      lab('Pathway step after this', el('select', 'field')).id = 'xv-step';
      var n = lab('What happened', el('textarea', 'field'), 'full'); n.id = 'xv-notes'; n.placeholder = 'Who you met, what they said, objections, commitments. No patient identifiers.';
      var wt = winToggle(false); wt.box.id = 'xv-win'; wt.label.classList.add('full'); f.appendChild(wt.label);
      var ns = lab('Next step', el('input', 'field')); ns.id = 'xv-next'; ns.placeholder = 'e.g. Bring samples, schedule 360 Experience';
      var nd = lab('Next step date', el('input', 'field')); nd.type = 'date'; nd.id = 'xv-ndate';
      var b = btn('Log visit', 'primary', logVisit); b.id = 'xv-btn'; f.appendChild(b);
      sec.appendChild(f); addMic(n);
      var m = el('div', 'msg'); m.id = 'xv-msg'; m.hidden = true; sec.appendChild(m);
      var lw = el('div'); lw.id = 'xv-list'; sec.appendChild(lw);
      $('#xv-target').addEventListener('change', syncStep);
    }
    var tsel = $('#xv-target');
    if (tsel !== document.activeElement) {
      fillTargetSelect(tsel, targets, ctx, true);
      syncStep();
    }
    $('#xv-btn').disabled = !$('#xv-target').value;
    var list = $('#xv-list'); list.replaceChildren();
    var rows = X.visits.filter(inView).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at || '') < (b.created_at || '') ? 1 : -1; });
    if (!rows.length) { list.appendChild(el('div', 'empty', 'No visits logged yet.')); return; }
    list.appendChild(el('div', 'x-sub', 'Recent activity'));
    var ul = el('ul', 'x-list');
    rows.slice(0, 15).forEach(function (v) {
      var li = el('li'), l = el('div');
      l.appendChild(el('div', 'strong', (v.status === 'planned' ? 'Planned · ' : v.status === 'cancelled' ? 'Cancelled · ' : '') + dayName(v.date) + ' · ' + v.surgeon + ' · ' + (v.type || 'Visit') + (v.step_to != null && v.step_to !== v.step_from ? ' · moved to step ' + v.step_to : '')));
      if (v.notes) l.appendChild(el('div', '', v.notes));
      var meta = [ctx.viewRep ? '' : v.rep, v.next_step || v.next_date ? 'Next: ' + [v.next_step, v.next_date ? dayName(v.next_date) : ''].filter(Boolean).join(' by ') : ''].filter(Boolean).join(' · ');
      if (meta) l.appendChild(el('div', 'meta', meta));
      li.appendChild(l);
      var acts = el('div'); acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center';
      if (v.status !== 'planned' && v.status !== 'cancelled') {
        var wb = btn(v.win ? '★ Win' : '☆ Win', 'small' + (v.win ? ' primary' : '')); wb.title = v.win ? 'In your WCU Top wins · tap to remove' : 'Flag as a win for your WCU';
        wb.addEventListener('click', function () { v.win = !v.win; save('visits', v.id, 'update', { win: v.win, updated_at: new Date().toISOString() }); T.render(); });
        acts.appendChild(wb);
      }
      var rm = btn('Remove', 'small danger'); rm.addEventListener('click', function () { armed(rm, 'Confirm', function () { X.visits = X.visits.filter(function (x) { return x.id !== v.id; }); save('visits', v.id, 'delete'); T.render(); }); });
      acts.appendChild(rm); li.appendChild(acts); ul.appendChild(li);
    });
    list.appendChild(ul);
  }
  /* target-surgeon pickers list the rep's targets plus every surgeon in the shared directory;
     picking a directory surgeon makes them that rep's target automatically */
  function pickRep(ctx) { return T.isLead() ? (ctx && ctx.viewRep) || '' : S.myRep; }
  function fillTargetSelect(tsel, targets, ctx, withFacility) {
    var keep = tsel.value, rep = pickRep(ctx), mine = {};
    targets.forEach(function (t) { if (t.rep === rep) mine[dirKey(t.surgeon)] = 1; });
    var dir = rep ? (S.dirSurgeons || []).filter(function (d) { return d.name && !mine[dirKey(d.name)]; }).sort(function (a, b) { return dirKey(a.name) < dirKey(b.name) ? -1 : 1; }) : [];
    tsel.replaceChildren();
    if (!targets.length && !dir.length) { tsel.appendChild(new Option(rep || !T.isLead() ? 'Add a surgeon to the directory first' : 'Pick a rep in View to plan', '')); return; }
    var g1 = document.createElement('optgroup'); g1.label = T.isLead() && !ctx.viewRep ? 'Target surgeons' : 'My target surgeons';
    targets.forEach(function (t) { g1.appendChild(new Option(t.surgeon + (withFacility && t.facility ? ' · ' + t.facility : '') + (ctx.viewRep ? '' : ' (' + t.rep + ')'), t.id)); });
    if (targets.length) tsel.appendChild(g1);
    if (dir.length) { var g2 = document.createElement('optgroup'); g2.label = 'Surgeon directory'; dir.forEach(function (d) { g2.appendChild(new Option(d.name + (d.facility ? ' · ' + d.facility : ''), 'dir:' + d.id)); }); tsel.appendChild(g2); }
    if (Array.from(tsel.options).some(function (o) { return o.value === keep; })) tsel.value = keep;
  }
  function resolveTarget(val, ctx) {
    if (!val) return null;
    if (val.indexOf('dir:') !== 0) return S.targets.find(function (x) { return x.id === val; }) || null;
    var d = (S.dirSurgeons || []).find(function (x) { return 'dir:' + x.id === val; }), rep = pickRep(ctx || X.ctx || {});
    if (!d || !rep) return null;
    var ex = S.targets.find(function (t) { return t.rep === rep && dirKey(t.surgeon) === dirKey(d.name); }); if (ex) return ex;
    var id = S.db.collection('targets').doc().id, body = { rep: rep, surgeon: d.name, facility: d.facility || '', step: 0, step_changed_at: TODAY, updated_at: new Date().toISOString() };
    var t = Object.assign({ id: id }, body); S.targets = S.targets.concat([t]); save('targets', id, 'set', body); return t;
  }
  function selFacility(val) { if (!val) return ''; if (val.indexOf('dir:') === 0) { var d = (S.dirSurgeons || []).find(function (x) { return 'dir:' + x.id === val; }); return d ? d.facility || '' : ''; } var t = S.targets.find(function (x) { return x.id === val; }); return t ? t.facility || '' : ''; }
  function syncStep() {
    var t = S.targets.find(function (x) { return x.id === $('#xv-target').value; }), s = $('#xv-step');
    opt(s, T.STEPS.map(function (lab, i) { return [String(i), lab]; }), String(t ? t.step || 0 : 0));
  }
  function winToggle(checked) { // ⭐ Win: flagged visits fill the Top wins of the rep's WCU
    var l = el('label', 'chk x-win'), c = el('input'); c.type = 'checkbox'; c.checked = !!checked; l.appendChild(c); l.appendChild(document.createTextNode(' ⭐ Win — add to my WCU')); l.title = 'Flagged visits fill the Top wins section of your Weekly Clinical Update'; return { label: l, box: c };
  }
  function logVisit() {
    var t = resolveTarget($('#xv-target').value, X.ctx), msg = $('#xv-msg');
    if (!t) return;
    var date = $('#xv-date').value, notes = $('#xv-notes').value.trim();
    if (!date) { $('#xv-date').focus(); return; }
    if (phiHit(notes)) { msg.className = 'msg err'; msg.textContent = 'Those notes look like they include a patient identifier (DOB, MRN). Remove it before saving.'; msg.hidden = false; return; }
    var stepTo = Number($('#xv-step').value), id = S.db.collection('visits').doc().id;
    var body = { rep: t.rep, target_id: t.id, surgeon: t.surgeon, facility: t.facility || '', date: date, type: $('#xv-type').value, notes: notes, next_step: $('#xv-next').value.trim(), next_date: $('#xv-ndate').value || '', step_from: t.step || 0, step_to: stepTo, win: $('#xv-win').checked, created_at: new Date().toISOString() };
    X.visits = X.visits.concat([Object.assign({ id: id }, body)]);
    save('visits', id, 'set', body);
    if (stepTo !== (t.step || 0)) { t.step = stepTo; t.step_changed_at = TODAY; save('targets', t.id, 'update', { step: stepTo, step_changed_at: TODAY, updated_at: new Date().toISOString() }); }
    $('#xv-notes').value = ''; $('#xv-next').value = ''; $('#xv-ndate').value = ''; $('#xv-win').checked = false;
    msg.className = 'msg ok'; msg.textContent = 'Visit logged for ' + t.surgeon + '.'; msg.hidden = false; setTimeout(function () { msg.hidden = true; }, 3000);
    T.render();
  }


  /* ---------- shared directory: surgeons + facilities ---------- */
  var dirKey = function (v) { return lc(v).replace(/\bdr\.?\s*/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  function dirSurgeon(name) { var k = dirKey(name); return k ? (S.dirSurgeons || []).find(function (d) { return dirKey(d.name) === k; }) : null; }
  function drawDir(ctx) {
    var sec = $('#sec-dir');
    if (!X.built.dir) {
      X.built.dir = true; sec.replaceChildren();
      var h = el('div', 'cardhead'); h.appendChild(el('h2', '', 'Surgeons & facilities directory'));
      var q = el('input', 'field'); q.type = 'search'; q.id = 'xd-q'; q.placeholder = 'Search'; q.setAttribute('aria-label', 'Search directory'); q.style.maxWidth = '14rem'; q.addEventListener('input', function () { T.render(); }); h.appendChild(q);
      sec.appendChild(h);
      sec.appendChild(el('p', 'note', 'One shared list for the whole team. Everything here shows in the surgeon and facility dropdowns. Add a new surgeon or facility and the COO sees it in Admin. A facility address you add is checked by the COO before it counts for visit check-ins.'));
      var sp = el('div', 'x-split');
      var a = el('div'); a.appendChild(el('div', 'x-sub', 'Add a surgeon'));
      var fa = el('div', 'x-form'), labA = function (t, n) { var l = el('label', '', t); l.appendChild(n); fa.appendChild(l); return n; };
      var sn = labA('Name', el('input', 'field')); sn.id = 'xd-sname'; sn.placeholder = 'Dr. First Last';
      var ss = labA('Specialty', el('input', 'field')); ss.id = 'xd-sspec'; ss.placeholder = 'Colorectal, Ortho hand…';
      var sf = labA('Main facility', el('input', 'field')); sf.id = 'xd-sfac'; sf.setAttribute('list', 'dl-facilities');
      fa.appendChild(btn('Add surgeon', 'primary', addSurgeon)); a.appendChild(fa);
      var b = el('div'); b.appendChild(el('div', 'x-sub', 'Add a facility'));
      var fb = el('div', 'x-form'), labB = function (t, n, c) { var l = el('label', c || '', t); l.appendChild(n); fb.appendChild(l); return n; };
      var fn = labB('Facility name', el('input', 'field')); fn.id = 'xd-fname'; fn.placeholder = 'e.g. Rio Grande Regional';
      var fdw = el('label', 'full', 'Address'); fb.appendChild(fdw); X.dirAddr = window.AddrFields.mount(fdw, {});
      fb.appendChild(btn('Add facility', 'primary', addFacility)); b.appendChild(fb);
      sp.appendChild(a); sp.appendChild(b); sec.appendChild(sp);
      var m = el('div', 'msg'); m.id = 'xd-msg'; m.hidden = true; sec.appendChild(m);
      var lists = el('div', 'x-split'); lists.id = 'xd-lists'; sec.appendChild(lists);
    }
    var q2 = lc($('#xd-q').value), match = function (d) { return !q2 || [d.name, d.specialty, d.facility, d.address].join(' ').toLowerCase().indexOf(q2) >= 0; };
    var L = $('#xd-lists'); L.replaceChildren();
    var su = (S.dirSurgeons || []).filter(match).sort(function (x, y) { return dirKey(x.name) < dirKey(y.name) ? -1 : 1; });
    var fa2 = (S.dirFacilities || []).filter(match).sort(function (x, y) { return lc(x.name) < lc(y.name) ? -1 : 1; });
    var col = function (title, rows, fmt) { var d = el('div'); d.appendChild(el('div', 'x-sub', title + ' · ' + rows.length)); var ul = el('ul', 'x-list'); ul.style.maxHeight = '16rem'; ul.style.overflow = 'auto'; rows.forEach(function (r) { ul.appendChild(fmt(r)); }); if (!rows.length) ul.appendChild(el('li', 'note', 'None yet.')); d.appendChild(ul); L.appendChild(d); };
    col('Surgeons', su, function (r) { var li = el('li'), l = el('div'); l.appendChild(el('div', 'strong', r.name)); l.appendChild(el('div', 'meta', [r.specialty, r.facility, r.added_by && r.added_by !== 'COO' ? 'added by ' + r.added_by : ''].filter(Boolean).join(' · '))); li.appendChild(l); return li; });
    col('Facilities', fa2, function (r) { var li = el('li'), l = el('div'); l.appendChild(el('div', 'strong', r.name)); l.appendChild(el('div', 'meta', [r.address || 'No address yet', r.added_by && r.added_by !== 'COO' ? 'added by ' + r.added_by : ''].filter(Boolean).join(' · '))); li.appendChild(l); li.appendChild(el('span', 'pill ' + (r.approved === false ? 'warn' : r.lat != null ? 'ok' : 'mute'), r.approved === false ? 'Pending COO' : r.lat != null ? 'On map' : 'No address'));
      if (r.lat == null) {
        var ab = btn('📍 Add address', 'small', function () {
          if (li.querySelector('.fa-edit')) return;
          var row = el('div', 'fa-edit'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;width:100%;margin-top:6px';
          var inp = el('input', 'field'); inp.placeholder = 'Street, city, TX ZIP'; inp.style.flex = '1 1 14rem'; inp.setAttribute('aria-label', 'Address for ' + r.name);
          var sv = btn('Save', 'small primary', function () {
            var v = inp.value.trim(); if (!v) { inp.focus(); return; } sv.disabled = true; sv.textContent = 'Finding…';
            api('/api/directory/facility', { name: r.name, address: v }).then(function (j) {
              dirMsg('ok', 'Address saved for ' + r.name + (j.facility && j.facility.approved === false ? '. The COO will confirm it before it counts for check-ins.' : ' and placed on the map.')); row.remove();
            }, function (e) { sv.disabled = false; sv.textContent = 'Save'; dirMsg('err', (e && e.error) || 'Could not save the address.'); });
          });
          row.appendChild(inp); row.appendChild(sv); li.appendChild(row); inp.focus();
        });
        ab.classList.add('fa-add'); li.appendChild(ab); li.style.flexWrap = 'wrap';
      }
      return li; });
  }
  function dirMsg(kind, t) { var m = $('#xd-msg'); m.className = 'msg ' + kind; m.textContent = t; m.hidden = false; setTimeout(function () { m.hidden = true; }, 5000); }
  function addSurgeon() {
    var name = $('#xd-sname').value.trim(); if (!name) { $('#xd-sname').focus(); return; }
    api('/api/directory/surgeon', { name: name, specialty: $('#xd-sspec').value.trim(), facility: $('#xd-sfac').value.trim() }).then(function (j) {
      dirMsg(j.existed ? 'warn' : 'ok', j.existed ? j.surgeon.name + ' is already in the directory.' : j.surgeon.name + ' added. Everyone on the team can pick them now.');
      $('#xd-sname').value = ''; $('#xd-sspec').value = ''; $('#xd-sfac').value = '';
    }, function (e) { dirMsg('err', (e && e.error) || (navigator.onLine ? 'Could not add.' : 'Adding to the directory needs a connection.')); });
  }
  function addFacility() {
    var name = $('#xd-fname').value.trim(); if (!name) { $('#xd-fname').focus(); return; }
    var av = X.dirAddr.value();
    api('/api/directory/facility', { name: name, address: av.address, lat: av.lat, lng: av.lng }).then(function (j) {
      dirMsg(j.updated ? 'ok' : j.existed || j.not_found ? 'warn' : 'ok', j.updated ? 'Address saved for ' + j.facility.name + (j.facility.approved === false ? '. The COO will confirm it before it counts for check-ins.' : ' and placed on the map.') : j.existed ? j.facility.name + ' is already in the directory' + (j.facility.lat != null ? ' with an address.' : '. Tap Add address next to it below.') : j.not_found ? j.facility.name + ' added, but that address wasn\'t found on the map. Tap Add address to try again.' : j.facility.name + ' added' + (j.facility.approved === false ? '. The COO will confirm the address before it counts for check-ins.' : '.'));
      $('#xd-fname').value = ''; X.dirAddr.clear();
    }, function (e) { dirMsg('err', (e && e.error) || (navigator.onLine ? 'Could not add.' : 'Adding to the directory needs a connection.')); });
  }

  /* ---------- section: surgeon preference cards ---------- */
  var prefEdit = null;
  function drawPrefs(ctx) {
    var sec = $('#sec-pref');
    if (!X.built.pref) {
      X.built.pref = true; sec.replaceChildren();
      var h = el('div', 'cardhead'); h.appendChild(el('h2', '', 'Surgeon preference cards'));
      var b = btn('+ Add card', 'small primary', function () { editPref(null); }); b.id = 'xp-add'; h.appendChild(b); sec.appendChild(h);
      sec.appendChild(el('p', 'note', 'Each surgeon\'s usual products, sizes and setup. When you log a case for that surgeon, the card shows in the case editor and fills product and facility for you.'));
      var f = el('div', 'x-form'); f.id = 'xp-form'; f.hidden = true;
      var lab = function (t, node, cls) { var l = el('label', cls || '', t); l.appendChild(node); f.appendChild(l); return node; };
      var su = lab('Surgeon', el('input', 'field')); su.id = 'xp-surgeon'; su.setAttribute('list', 'dl-surgeons'); su.placeholder = 'Dr. Last name';
      var fa = lab('Facility', el('input', 'field')); fa.id = 'xp-facility'; fa.setAttribute('list', 'dl-facilities');
      opt(lab('Service line', el('select', 'field')), SERVICES.map(function (s) { return [s, s || 'Not set']; })).id = 'xp-service';
      lab('Rep', el('select', 'field')).id = 'xp-rep';
      var pr = lab('Usual products · comma separated', el('input', 'field'), 'full'); pr.id = 'xp-products'; pr.setAttribute('list', 'dl-products'); pr.placeholder = 'Clarix Flo, AmnioSurge ASG';
      var sz = lab('Sizes / quantities', el('input', 'field')); sz.id = 'xp-sizes'; sz.placeholder = 'e.g. 4x4 cm sheet + 1cc flow';
      var nt = lab('Setup notes · likes and dislikes', el('textarea', 'field'), 'full'); nt.id = 'xp-notes';
      var row = el('div', 'tools'); row.appendChild(btn('Save card', 'primary', savePref)); row.appendChild(btn('Cancel', '', function () { $('#xp-form').hidden = true; prefEdit = null; })); f.appendChild(row);
      sec.appendChild(f); addMic(nt);
      var lw = el('div'); lw.id = 'xp-list'; sec.appendChild(lw);
    }
    var rs = $('#xp-rep'); rs.parentNode.hidden = !ctx.lead;
    if (rs !== document.activeElement) { var k = rs.value; opt(rs, T.repNames()); rs.value = ctx.viewRep || k || T.repNames()[0] || ''; }
    var list = $('#xp-list'); list.replaceChildren();
    var rows = X.prefs.filter(inView).sort(function (a, b) { return norm(a.surgeon) < norm(b.surgeon) ? -1 : 1; });
    if (!rows.length) { list.appendChild(el('div', 'empty', 'No preference cards yet.')); return; }
    var ul = el('ul', 'x-list');
    rows.forEach(function (p) {
      var li = el('li'), l = el('div');
      l.appendChild(el('div', 'strong', p.surgeon + (p.facility ? ' · ' + p.facility : '') + (p.service_line ? ' · ' + p.service_line : '')));
      l.appendChild(el('div', '', [(p.products || []).join(', '), p.sizes].filter(Boolean).join(' · ') || 'No products listed'));
      if (p.notes) l.appendChild(el('div', 'meta', p.notes));
      if (!ctx.viewRep) l.appendChild(el('div', 'meta', p.rep));
      li.appendChild(l);
      var tb = el('span', 'tools'); tb.appendChild(btn('Edit', 'small', function () { editPref(p); }));
      var rm = btn('Remove', 'small danger'); rm.addEventListener('click', function () { armed(rm, 'Confirm', function () { X.prefs = X.prefs.filter(function (x) { return x.id !== p.id; }); save('prefcards', p.id, 'delete'); T.render(); }); });
      tb.appendChild(rm); li.appendChild(tb); ul.appendChild(li);
    });
    list.appendChild(ul);
  }
  function editPref(p) {
    prefEdit = p; $('#xp-form').hidden = false;
    $('#xp-surgeon').value = p ? p.surgeon : ''; $('#xp-facility').value = p ? p.facility || '' : ''; $('#xp-service').value = p ? p.service_line || '' : '';
    $('#xp-products').value = p ? (p.products || []).join(', ') : ''; $('#xp-sizes').value = p ? p.sizes || '' : ''; $('#xp-notes').value = p ? p.notes || '' : '';
    if (p) $('#xp-rep').value = p.rep;
    $('#xp-surgeon').focus();
  }
  function savePref() {
    var surgeon = $('#xp-surgeon').value.trim(); if (!surgeon) { $('#xp-surgeon').focus(); return; }
    var rep = T.isLead() ? $('#xp-rep').value : S.myRep; if (!rep) return;
    var body = { rep: rep, surgeon: surgeon, facility: $('#xp-facility').value.trim(), service_line: $('#xp-service').value, products: $('#xp-products').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean), sizes: $('#xp-sizes').value.trim(), notes: $('#xp-notes').value.trim(), updated_at: new Date().toISOString() };
    var id = prefEdit ? prefEdit.id : S.db.collection('prefcards').doc().id;
    X.prefs = X.prefs.filter(function (x) { return x.id !== id; }).concat([Object.assign({ id: id }, body)]);
    save('prefcards', id, 'set', body); $('#xp-form').hidden = true; prefEdit = null; T.render();
  }

  /* ---------- section: hospital credentials ---------- */
  function drawCreds(ctx) {
    var sec = $('#sec-cred');
    if (!X.built.cred) {
      X.built.cred = true; sec.replaceChildren();
      sec.appendChild(el('h2', '', 'Hospital vendor credentials'));
      sec.appendChild(el('p', 'note', 'Track each facility\'s vendor credential so nobody is turned away at the OR door. You get a warning ' + set().cred_warn_days + ' days before anything expires.'));
      var f = el('div', 'x-form');
      var lab = function (t, node) { var l = el('label', '', t); l.appendChild(node); f.appendChild(l); return node; };
      var fa = lab('Facility', el('input', 'field')); fa.id = 'xc-facility'; fa.setAttribute('list', 'dl-facilities');
      opt(lab('System', el('select', 'field')), SYSTEMS).id = 'xc-system';
      var ex = lab('Expires', el('input', 'field')); ex.type = 'date'; ex.id = 'xc-exp';
      lab('Rep', el('select', 'field')).id = 'xc-rep';
      var no = lab('Notes', el('input', 'field')); no.id = 'xc-notes'; no.placeholder = 'e.g. flu shot, badge #, TB test';
      f.appendChild(btn('Add credential', 'primary', addCred)); sec.appendChild(f);
      var lw = el('div'); lw.id = 'xc-list'; sec.appendChild(lw);
    }
    var rs = $('#xc-rep'); rs.parentNode.hidden = !ctx.lead;
    if (rs !== document.activeElement) { var k = rs.value; opt(rs, T.repNames()); rs.value = ctx.viewRep || k || T.repNames()[0] || ''; }
    var list = $('#xc-list'); list.replaceChildren();
    var rows = X.creds.filter(inView).sort(function (a, b) { return (a.expires || '9') < (b.expires || '9') ? -1 : 1; });
    if (!rows.length) { list.appendChild(el('div', 'empty', 'No credentials tracked yet.')); return; }
    var wrap = el('div', 'scroll'), tb = el('table'), hr = el('tr');
    ['Facility', 'System', 'Expires', 'Status', 'Notes', 'Rep', ''].forEach(function (x, i) { hr.appendChild(el('th', i === 5 ? 'col-rep' : '', x)); });
    var th = el('thead'); th.appendChild(hr); tb.appendChild(th); var body = el('tbody');
    rows.forEach(function (c) {
      var tr = el('tr'), d = c.expires ? daysBetween(TODAY, c.expires) : null;
      tr.appendChild(el('td', 'name', c.facility || '—')); tr.appendChild(el('td', '', c.system || '—'));
      var et = el('td'), ei = el('input', 'cell'); ei.type = 'date'; ei.value = c.expires || ''; ei.setAttribute('aria-label', 'Expiration for ' + (c.facility || 'credential'));
      ei.addEventListener('change', function () { c.expires = ei.value; save('credentials', c.id, 'update', { expires: ei.value, updated_at: new Date().toISOString() }); T.render(); });
      et.appendChild(ei); tr.appendChild(et);
      var stc = el('td'); stc.appendChild(el('span', 'pill ' + (d == null ? 'mute' : d < 0 ? 'bad' : d <= set().cred_warn_days ? 'warn' : 'ok'), d == null ? 'No date' : d < 0 ? 'Expired' : d === 0 ? 'Expires today' : d <= set().cred_warn_days ? pl(d, 'day', 'days') + ' left' : 'Current')); tr.appendChild(stc);
      tr.appendChild(el('td', '', c.notes || '')); tr.appendChild(el('td', 'col-rep', c.rep));
      var x = el('td'), rm = btn('Remove', 'small danger'); rm.addEventListener('click', function () { armed(rm, 'Confirm', function () { X.creds = X.creds.filter(function (y) { return y.id !== c.id; }); save('credentials', c.id, 'delete'); T.render(); }); });
      x.appendChild(rm); tr.appendChild(x); body.appendChild(tr);
    });
    tb.appendChild(body); wrap.appendChild(tb); list.appendChild(wrap);
  }
  function addCred() {
    var facility = $('#xc-facility').value.trim(); if (!facility) { $('#xc-facility').focus(); return; }
    var rep = T.isLead() ? $('#xc-rep').value : S.myRep; if (!rep) return;
    var id = S.db.collection('credentials').doc().id, body = { rep: rep, facility: facility, system: $('#xc-system').value, expires: $('#xc-exp').value || '', notes: $('#xc-notes').value.trim(), updated_at: new Date().toISOString() };
    X.creds = X.creds.concat([Object.assign({ id: id }, body)]);
    save('credentials', id, 'set', body);
    $('#xc-facility').value = ''; $('#xc-exp').value = ''; $('#xc-notes').value = ''; T.render();
  }

  /* ---------- section: notifications ---------- */
  function b64u(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function drawNotify() {
    var sec = $('#sec-notify'); if (X.built.notify) { if (Date.now() - prevAt > 30000) loadPreview(); return; } X.built.notify = true;
    sec.replaceChildren();
    sec.appendChild(el('h2', '', 'Weekly digest & notifications'));
    sec.appendChild(el('p', 'note', 'Every Monday morning you get a push notification with your week: pace to quota, needed per day, cases this week, POs to chase, next steps due and credentials expiring. The COO gets the team version.'));
    var prev = el('div', 'x-cal'); prev.id = 'xn-prev'; prev.textContent = 'Loading this week\'s digest…'; sec.appendChild(prev);
    var row = el('div', 'tools'); row.style.marginTop = '12px'; row.id = 'xn-row'; sec.appendChild(row);
    var msg = el('p', 'note'); msg.id = 'xn-msg'; sec.appendChild(msg);
    sec.appendChild(el('div', 'x-sub', 'Your sign-in'));
    var sg = el('p', 'note'); sg.id = 'xs-msg'; sec.appendChild(sg);
    var srow = el('div', 'tools'); srow.id = 'xs-row'; sec.appendChild(srow);
    drawSignIn();
    loadPreview(); refreshNotify();
  }
  function drawSignIn() {
    var msg = $('#xs-msg'), row = $('#xs-row'); row.replaceChildren();
    api('/api/me/passkeys').then(function (j) {
      var W = window.SimpleWebAuthnBrowser, can = W && W.browserSupportsWebAuthn() && j.available;
      if (!j.manager) { msg.textContent = T.isLead() ? 'You are signed in with the COO PIN. Set up your own email account in Admin → Sign-in accounts.' : 'You sign in with a PIN. Ask the COO for an email invite to switch to email + authenticator app and Face ID.'; return; }
      msg.textContent = 'You sign in with email, password and your authenticator code' + (j.passkeys.length ? ', or Face ID on: ' + j.passkeys.map(function (p) { return p.label; }).join(', ') + '.' : '. Turn on Face ID to sign in on this phone with just your face.');
      if (can) row.appendChild(btn(/iPhone|iPad|Android|Mac/.test(navigator.userAgent) ? '🙂 Turn on Face ID on this device' : '🔑 Turn on passkey on this device', 'primary', function () {
        var b = this; b.disabled = true;
        api('/api/passkey/register/options', {}).then(function (o) { return W.startRegistration(o.options).then(function (resp) { return api('/api/passkey/register/verify', { ticket: o.ticket, response: resp, label: /iPhone|iPad|Android/.test(navigator.userAgent) ? 'Phone' : 'Computer' }); }); })
          .then(function () { T.setStatus('saved', 'Face ID turned on'); drawSignIn(); }, function (e) { msg.textContent = (e && e.error) || (e && e.name === 'NotAllowedError' ? 'Cancelled.' : 'Could not turn on Face ID on this device.'); b.disabled = false; });
      }));
    }, function () { msg.textContent = 'Sign-in settings need a connection.'; });
  }
  var prevAt = 0;
  function loadPreview() {
    prevAt = Date.now(); var prev = $('#xn-prev');
    api('/api/digest/preview').then(function (d) { prev.replaceChildren(el('b', '', d.title + ' · preview'), el('div', '', d.body)); }, function () { prev.textContent = 'Digest preview is not available offline.'; });
  }
  function refreshNotify() {
    var row = $('#xn-row'), msg = $('#xn-msg'); row.replaceChildren();
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { msg.textContent = ios && !standalone ? 'On iPhone, first install the app (Share → Add to Home Screen), open it from the home screen, then turn on notifications here.' : 'This browser does not support notifications.'; return; }
    Promise.all([api('/api/push/key'), navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); })]).then(function (a) {
      var info = a[0], sub = a[1];
      if (!info.enabled) { msg.textContent = 'Notifications are not set up on the server yet.'; return; }
      if (sub) {
        msg.textContent = 'Notifications are on for this device.';
        row.appendChild(btn('Send me a test now', 'primary', function () { api('/api/push/test', {}).then(function (j) { msg.textContent = j.sent ? 'Sent. It should pop up in a few seconds.' : 'Nothing was sent; turn notifications off and on again.'; }, function () { msg.textContent = 'Could not send the test.'; }); }));
        row.appendChild(btn('Turn off on this device', '', function () { var ep = sub.endpoint; sub.unsubscribe().then(function () { return api('/api/push/unsubscribe', { endpoint: ep }); }).then(refreshNotify, refreshNotify); }));
      } else {
        msg.textContent = 'Notifications are off for this device.';
        row.appendChild(btn('Turn on notifications', 'primary', function () {
          Notification.requestPermission().then(function (p) {
            if (p !== 'granted') { msg.textContent = 'Notifications are blocked. Allow them for this site in your browser or phone settings.'; return; }
            return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(info.key) }); })
              .then(function (s) { return api('/api/push/subscribe', { sub: s.toJSON() }); }).then(refreshNotify);
          }).catch(function () { msg.textContent = 'Could not turn on notifications on this device.'; });
        }));
      }
    }, function () { msg.textContent = 'Notifications need a connection to set up.'; });
  }


  /* ---------- target visit calendar: plan, check in (geo), complete ---------- */
  var vcal = null;
  function drawVCal(ctx) {
    var sec = $('#sec-vcal'), targets = S.targets.filter(inView);
    if (!X.built.vcal) {
      X.built.vcal = true; sec.replaceChildren();
      var vhd = el('div', 'cardhead'); vhd.appendChild(el('h2', '', 'Target visit calendar'));
      var vtools = el('div', 'tools'); vtools.appendChild(btn('📆 Add to Outlook', 'small', outlookBox)); vtools.appendChild(btn('✕ Close', 'small', function () { sec.hidden = true; var pl = document.querySelector('#jump .jcal'); if (pl) { pl.classList.remove('calopen'); pl.classList.remove('on'); } window.scrollTo({ top: 0, behavior: 'smooth' }); }));
      vhd.appendChild(vtools); sec.appendChild(vhd);
      var ob = el('div', 'msg'); ob.id = 'x-outlook'; ob.hidden = true; sec.appendChild(ob);
      sec.appendChild(el('p', 'note', 'Tap a day to see its visits; open a visit and tap Check in when you arrive (your phone shares its location once to confirm you are there). Green = verified, red = not verified or missed.'));
      var f = el('div', 'x-form'); f.id = 'xvc-form';
      var lab = function (t, node, cls) { var l = el('label', cls || '', t); l.appendChild(node); f.appendChild(l); return node; };
      lab('Target surgeon', el('select', 'field')).id = 'xvc-target';
      var fa = lab('Facility', el('input', 'field')); fa.id = 'xvc-fac'; fa.setAttribute('list', 'dl-facilities'); fa.placeholder = 'Pick one or type a new facility'; fa.autocomplete = 'off';
      var fadWrap = el('label', 'full', 'New facility · address (so check-ins can be verified)'); fadWrap.id = 'xvc-faddr-wrap'; fadWrap.hidden = true; f.appendChild(fadWrap);
      X.vcAddr = window.AddrFields.mount(fadWrap, {});
      var facState = function () { var n = fa.value.trim(), known = n && facOf(n); fadWrap.hidden = !n || !!(known && known.lat != null); fadWrap.firstChild.textContent = known && known.lat == null ? known.name + ' has no address yet · add it so check-ins can be verified' : 'New facility · address (so check-ins can be verified)'; };
      fa.addEventListener('input', facState); fa.addEventListener('change', facState);
      var d = lab('Date', el('input', 'field')); d.type = 'date'; d.id = 'xvc-date'; d.value = TODAY;
      var t = lab('Time', el('input', 'field')); t.type = 'time'; t.id = 'xvc-time'; t.value = '09:00';
      opt(lab('Length', el('select', 'field')), [['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1½ hours'], ['120', '2 hours'], ['240', 'Half day (case)']], '60').id = 'xvc-dur';
      opt(lab('Type', el('select', 'field')), VISIT_TYPES).id = 'xvc-type';
      var pu = lab('Purpose', el('input', 'field'), 'full'); pu.id = 'xvc-purpose'; pu.placeholder = 'e.g. Observe a colorectal case, drop off samples';
      var b = btn('Plan visit', 'primary', planVisit); b.id = 'xvc-btn'; f.appendChild(b);
      // calendar first; the planning form sits under it and starts folded on phones
      var root = el('div'); sec.appendChild(root);
      var phone = window.innerWidth < 640;
      var tg = btn(phone ? '+ Plan a visit' : '− Plan a visit', phone ? 'primary' : '', function () { f.hidden = !f.hidden; tg.textContent = (f.hidden ? '+ ' : '− ') + 'Plan a visit'; tg.classList.toggle('primary', f.hidden); if (!f.hidden) { f.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
      tg.id = 'xvc-toggle'; tg.style.marginTop = '14px'; sec.appendChild(tg);
      f.hidden = phone; f.style.marginTop = '10px'; sec.appendChild(f);
      var m = el('div', 'msg'); m.id = 'xvc-msg'; m.hidden = true; sec.appendChild(m);
      vcal = window.VisitCal.mount(root, { repFilter: T.isLead(), showRep: T.isLead(), getData: function () { return { visits: X.visits.filter(inView), reps: T.repNames(), settings: X.settings }; }, actions: visitActions });
      $('#xvc-target').addEventListener('change', function () { var f = selFacility($('#xvc-target').value); if (f) $('#xvc-fac').value = f; facState(); });
    }
    var tsel = $('#xvc-target');
    if (tsel !== document.activeElement) {
      var before = tsel.value;
      fillTargetSelect(tsel, targets, ctx, false);
      if (tsel.value !== before && $('#xvc-fac') !== document.activeElement) $('#xvc-fac').value = selFacility(tsel.value);
    }
    $('#xvc-btn').disabled = !tsel.value;
    if (vcal) vcal.render();
  }
  function planVisit() {
    var t = resolveTarget($('#xvc-target').value, X.ctx), msg = $('#xvc-msg');
    if (!t) return;
    var date = $('#xvc-date').value, time = $('#xvc-time').value, fac = $('#xvc-fac').value.trim();
    if (!date || !time) { msg.className = 'msg err'; msg.textContent = 'Pick a date and time.'; msg.hidden = false; return; }
    if (!fac) { msg.className = 'msg err'; msg.textContent = 'Add the facility so the check-in can be verified.'; msg.hidden = false; $('#xvc-fac').focus(); return; }
    if (window.VisitCal.windowOf({ date: date, time: time, duration: $('#xvc-dur').value }, X.settings).close < Date.now()) { msg.className = 'msg err'; msg.textContent = 'That time has already passed. Use the visit log below for visits that already happened.'; msg.hidden = false; return; }
    var aw = $('#xvc-faddr-wrap'), av = aw && !aw.hidden && X.vcAddr ? X.vcAddr.value() : null;
    if (av && av.address) { // a facility typed in fresh (or one with no address): put it in the directory with its address first
      var b0 = $('#xvc-btn'); b0.disabled = true;
      api('/api/directory/facility', { name: fac, address: av.address, lat: av.lat, lng: av.lng }).then(function (j) { b0.disabled = false; if (j.not_found) { msg.className = 'msg err'; msg.textContent = 'Could not find that address on the map. Pick it from the suggestions, or check the street, city and ZIP.'; msg.hidden = false; return; } X.vcAddr.clear(); aw.hidden = true; planVisit(); }, function (e) { b0.disabled = false; msg.className = 'msg err'; msg.textContent = (e && e.error) || 'Could not save the facility.'; msg.hidden = false; });
      return;
    }
    var id = S.db.collection('visits').doc().id;
    var body = { rep: t.rep, target_id: t.id, surgeon: t.surgeon, facility: fac, date: date, time: time, duration: Number($('#xvc-dur').value), type: $('#xvc-type').value, purpose: $('#xvc-purpose').value.trim(), status: 'planned', created_at: new Date().toISOString() };
    X.visits = X.visits.concat([Object.assign({ id: id }, body)]);
    save('visits', id, 'set', body);
    $('#xvc-purpose').value = '';
    msg.className = 'msg ok'; msg.textContent = 'Planned: ' + t.surgeon + ' on ' + dayName(date) + ' at ' + fmtTime(time) + '. Check in from the calendar when you arrive.'; msg.hidden = false; setTimeout(function () { msg.hidden = true; }, 5000);
    T.render();
  }
  function visitActions(v, st, close) {
    var acts = [];
    if (!T.isLead() && v.status === 'planned' && !(v.check && (v.check.ok === true || v.check.missed))) {
      var w = window.VisitCal.windowOf(v, X.settings);
      if (Date.now() >= w.open && Date.now() <= w.close) acts.push({ label: '📍 Check in now', cls: 'primary', fn: function () { checkIn(v, close); } });
      if (Date.now() < w.start) acts.push({ label: 'Cancel visit', cls: 'danger', fn: function () { if (!confirm('Cancel this visit?')) return; v.status = 'cancelled'; save('visits', v.id, 'update', { status: 'cancelled', updated_at: new Date().toISOString() }); close(); T.render(); } });
    }
    if (!T.isLead() && v.status === 'planned' && v.check) acts.push({ label: 'Complete visit (notes)', cls: v.check.ok ? 'primary' : '', fn: function () { completeForm(v, close); } });
    if (T.isLead() && v.check && v.check.ok !== true && !v.check.ack) acts.push({ label: 'Mark reviewed', fn: function () { var note = prompt('Note for the record (optional):', '') ; if (note === null) return; api('/api/admin/visit-ack', { id: v.id, note: note }).then(function () { close(); T.setStatus('saved', 'Marked reviewed'); }, function () { T.setStatus('err', 'Could not save'); }); } });
    return acts;
  }
  function checkIn(v, close) {
    var box = document.querySelector('.vc-box'), status = box && box.querySelector('.vc-status');
    if (!navigator.geolocation) { alert('This device cannot share its location.'); return; }
    if (status) { status.className = 'vc-status st-planned'; status.textContent = 'Getting your location…'; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      api('/api/checkin', { id: v.id, lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }).then(function (j) {
        v.check = j.check;
        var st = window.VisitCal.state(v, X.settings);
        if (status) { status.className = 'vc-status st-' + st; status.textContent = window.VisitCal.LABEL[st] + ' — ' + j.check.reason; }
        X.visits = X.visits.map(function (x) { return x.id === v.id ? Object.assign({}, x, { check: j.check }) : x; });
        T.render();
      }, function (e) { if (status) { status.className = 'vc-status st-failed'; status.textContent = (e && e.error) || 'Check-in failed. Check your connection and try again.'; } });
    }, function (err) {
      if (status) { status.className = 'vc-status st-failed'; status.textContent = err.code === 1 ? 'Location is blocked. Allow location for this app in your phone settings, then try again.' : 'Could not get your location. Step outside or near a window and try again.'; }
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  function completeForm(v, close) {
    var box = document.querySelector('.vc-box'); if (!box) return;
    var f = el('div', 'x-form'); f.style.gridTemplateColumns = '1fr';
    var lab = function (t, node) { var l = el('label', '', t); l.appendChild(node); f.appendChild(l); return node; };
    var n = lab('What happened', el('textarea', 'field')); n.value = v.notes || '';
    var t = S.targets.find(function (x) { return x.id === v.target_id; });
    var sp = opt(lab('Pathway step after this', el('select', 'field')), T.STEPS.map(function (l, i) { return [String(i), l]; }), String(t ? t.step || 0 : 0));
    var ns = lab('Next step', el('input', 'field')); ns.value = v.next_step || '';
    var nd = lab('Next step date', el('input', 'field')); nd.type = 'date'; nd.value = v.next_date || '';
    var wt = winToggle(v.win); f.appendChild(wt.label);
    f.appendChild(btn('Save visit', 'primary', function () {
      if (phiHit(n.value)) { alert('Those notes look like they include a patient identifier. Remove it first.'); return; }
      var step = Number(sp.value), upd = { status: 'done', notes: n.value.trim(), next_step: ns.value.trim(), next_date: nd.value || '', step_from: t ? t.step || 0 : 0, step_to: step, win: wt.box.checked, updated_at: new Date().toISOString() };
      Object.assign(v, upd); save('visits', v.id, 'update', upd);
      if (t && step !== (t.step || 0)) { t.step = step; t.step_changed_at = TODAY; save('targets', t.id, 'update', { step: step, step_changed_at: TODAY, updated_at: new Date().toISOString() }); }
      close(); T.render();
    }));
    box.appendChild(f); addMic(n); n.focus();
  }

  /* ---------- commission statement ---------- */
  function qualifies(c, row) {
    var s = (c.status || '').toLowerCase();
    if (s === 'scheduled') return 'Not counted: still Scheduled';
    if (s === 'cancelled') return 'Not counted: Cancelled';
    if (row.counts === 'New only' && c.surgeon_type !== 'New') return 'Not counted: legacy surgeon (plan pays on new business)';
    if (row.counts === 'Legacy only' && c.surgeon_type !== 'Legacy') return 'Not counted: new surgeon (legacy-only plan)';
    if (row.product_filter && lc(c.product).indexOf(lc(row.product_filter)) < 0) return 'Not counted: not ' + row.product_filter;
    return '';
  }
  function openStatement(rep, month) {
    var M = T.compute(), reps = T.repNames();
    rep = rep || T.currentViewRep() || reps[0]; month = month || S.month;
    var box = $('#x-stmt'); box.hidden = false; document.body.style.overflow = 'hidden';
    var sheet = $('#x-sheet'); sheet.replaceChildren();
    var bar = el('div', 'bar'), left = el('div', 'tools');
    if (T.isLead()) { var rsel = opt(el('select', 'field'), reps, rep); rsel.style.width = 'auto'; rsel.addEventListener('change', function () { openStatement(rsel.value, month); }); left.appendChild(rsel); }
    var msel = opt(el('select', 'field'), M.months.map(function (m) { return [m, T.monthName(m)]; }), month); msel.style.width = 'auto'; msel.addEventListener('change', function () { openStatement(rep, msel.value); }); left.appendChild(msel);
    bar.appendChild(left);
    var right = el('div', 'tools'); right.appendChild(btn('Print / Save PDF', 'primary', function () { window.print(); })); right.appendChild(btn('Close', '', closeStatement)); bar.appendChild(right);
    sheet.appendChild(bar);
    var row = M.score.find(function (s) { return s.rep === rep && s.month === month; }), q = S.quotas.find(function (x) { return x.rep === rep && x.role !== 'Team'; }) || {};
    var paper = el('div', 'x-paper'), logo = el('img'); logo.src = '/logo.png'; logo.alt = '360 Medical'; logo.style.cssText = 'height:36px;background:#081F33;padding:6px 10px;border-radius:6px';
    paper.appendChild(logo);
    paper.appendChild(el('h1', '', 'Commission statement · ' + rep));
    var closed = closedMonth(month + '-01');
    paper.appendChild(el('div', '', T.monthName(month) + ' · ' + (closed ? 'Month closed' : 'Month open — figures can still change') + ' · prepared ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })));
    if (!row) { paper.appendChild(el('p', '', 'No plan on file for this rep.')); sheet.appendChild(paper); return; }
    var basis = row.product_filter ? row.product_filter + ' sales' : row.counts === 'New only' ? 'new-business sales' : row.counts === 'Legacy only' ? 'legacy sales' : 'all sales';
    paper.appendChild(el('p', '', 'Plan: ' + (row.comm_rate ? Math.round(row.comm_rate * 1000) / 10 + '% on ' + basis + (row.comm_floor_base ? ' above a ' + money(row.comm_floor_base) + ' monthly floor' + (row.carry ? ' (the floor rises by any shortfall carried from earlier in the quarter)' : '') : ' from the first dollar') : 'Salaried — no commission on this plan') + (row.pay_amount ? ' · ' + money(row.pay_amount) + (row.pay_kind === 'salary' ? ' base salary' : ' monthly draw') : '') + '.'));
    var cases = S.cases.filter(function (c) { return c.rep === rep && c.date && c.date.slice(0, 7) === month; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var tb = el('table'), hr = el('tr'); ['Date', 'Surgeon', 'Facility', 'Product', 'Type', 'Status', 'Net sales', 'Counts toward commission'].forEach(function (x, i) { hr.appendChild(el('th', i === 6 ? 'r' : '', x)); });
    var th = el('thead'); th.appendChild(hr); tb.appendChild(th); var body = el('tbody'), qual = 0;
    cases.forEach(function (c) {
      var why = qualifies(c, q), tr = el('tr', why ? 'no' : '');
      if (!why) qual += c.net_sales || 0;
      [dayName(c.date), c.surgeon || '—', c.facility || '—', c.product || '—', c.surgeon_type || '—', c.status || '—', money(c.net_sales), why || 'Yes'].forEach(function (v, i) { tr.appendChild(el('td', i === 6 ? 'r' : '', v)); });
      body.appendChild(tr);
    });
    if (!cases.length) { var tr0 = el('tr'), td0 = el('td', '', 'No cases logged this month.'); td0.colSpan = 8; tr0.appendChild(td0); body.appendChild(tr0); }
    tb.appendChild(body); var tw = el('div', 'scroll'); tw.style.maxHeight = 'none'; tw.appendChild(tb); paper.appendChild(tw);
    var calc = el('div', 'x-calc'), line = function (a, b, cls) { calc.appendChild(el('div', cls || '', a)); calc.appendChild(el('div', 'r ' + (cls || ''), b)); };
    line('Commissionable sales (' + basis + ')', money(row.actual));
    if (row.comm_rate) {
      if (row.comm_floor_base) { line('Monthly floor', money(row.comm_floor_base)); if (row.carried_in > 0) line('+ shortfall carried from ' + T.mName(row.prev_month), money(row.carried_in)); line('Sales above the floor', money(row.comm_above)); }
      line('× ' + Math.round(row.comm_rate * 1000) / 10 + '% commission', money(row.commission));
    }
    if (row.pay_amount) line(row.pay_kind === 'salary' ? 'Base salary' : 'Monthly draw', money(row.pay_amount));
    line('Estimated pay for ' + T.mName(month), money(row.est_pay), 'tot');
    if (row.comm_rate) line('Commission ' + T.qLabel(month) + ' to date', money(row.comm_qtd));
    paper.appendChild(calc);
    if (Math.abs(qual - row.actual) > 1) paper.appendChild(el('p', 'fine', 'Note: the case list totals ' + money(qual) + ' counted; the plan total above uses the same rules and may differ only by rounding.'));
    paper.appendChild(el('p', 'fine', 'Estimate from cases logged in the 360 Medical case tracker. Final commissions are calculated by 360 Medical from invoiced net sales under the written commission plan; where they differ, the written plan governs. Every change to a case is recorded in its history.'));
    var sg = el('div', 'x-sign'); sg.appendChild(el('div', '', 'Rep signature / date')); sg.appendChild(el('div', '', 'COO signature / date')); paper.appendChild(sg);
    sheet.appendChild(paper);
  }
  function closeStatement() { $('#x-stmt').hidden = true; document.body.style.overflow = ''; }

  /* ---------- wiring ---------- */
  function shell() {
    var m = el('div', 'x-modal'); m.id = 'x-scan'; m.hidden = true;
    var box = el('div', 'x-scanbox'); box.appendChild(el('b', '', 'Scan the product label'));
    var v = el('video'); v.id = 'x-video'; v.setAttribute('playsinline', ''); v.muted = true; box.appendChild(v);
    var p = el('div', 'note'); p.id = 'x-scanmsg'; box.appendChild(p);
    box.appendChild(btn('Cancel', '', closeScanner)); m.appendChild(box); document.body.appendChild(m);
    var st = el('div', 'x-stmt'); st.id = 'x-stmt'; st.hidden = true; var sh = el('div', 'x-sheet'); sh.id = 'x-sheet'; st.appendChild(sh); document.body.appendChild(st);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('#x-scan').hidden) closeScanner(); else if (!$('#x-stmt').hidden) closeStatement(); } });
    $('#ce-scan').addEventListener('click', openScanner);
    $('#ce-udi').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); handleCode(e.target.value); } });
    $('#ce-udi').addEventListener('change', function (e) { handleCode(e.target.value); });
    ['#ce-product', '#ce-facility', '#ce-units'].forEach(function (s) { $(s).addEventListener('input', autoPrice); $(s).addEventListener('change', autoPrice); });
    $('#ce-sales').addEventListener('input', priceHint);
    $('#ce-surgeon').addEventListener('change', function () { var c = curCase(); var p = c && prefFor($('#ce-rep').value || c.rep, $('#ce-surgeon').value); if (p && !$('#ce-product').value) applyPref(p, false); drawPrefHint(); });
    $('#ce-surgeon').addEventListener('input', drawPrefHint);
    $('#ta-surgeon').addEventListener('change', function () { var d = dirSurgeon($('#ta-surgeon').value); if (d && d.facility && !$('#ta-facility').value) $('#ta-facility').value = d.facility; });
    $('#ce-surgeon').addEventListener('change', function () { var d = dirSurgeon($('#ce-surgeon').value); if (d && d.facility && !$('#ce-facility').value) { $('#ce-facility').value = d.facility; autoPrice(); T.editorChanged(0); } });
    $('#ed-history').addEventListener('click', showHistory);
    $('#btn-statement').addEventListener('click', function () { openStatement(); });
    addMic($('#note-text'));
  }
  /* ---------- geofence: only around the facility, only during the visit window, only while the app is open ---------- */
  var GF = { watch: null, busy: false, lastTry: 0, outside: [] };
  function facOf(name) { var n = String(name || '').trim().toLowerCase(); if (!n) return null; return (S.dirFacilities || []).find(function (f) { return String(f.name || '').trim().toLowerCase() === n || (f.aliases || []).some(function (a) { return String(a).trim().toLowerCase() === n; }); }) || null; }
  function meters(a, b, c, d) { var R = 6371000, r = function (x) { return x * Math.PI / 180; }, dl = r(c - a), dg = r(d - b); var h = Math.pow(Math.sin(dl / 2), 2) + Math.cos(r(a)) * Math.cos(r(c)) * Math.pow(Math.sin(dg / 2), 2); return Math.round(2 * R * Math.asin(Math.sqrt(h))); }
  function geoJobs() {
    if (T.isLead() || !X.visits || document.hidden) return [];
    var now = Date.now(), out = [];
    X.visits.forEach(function (v) {
      if (v.rep !== S.myRep || v.status !== 'planned' || !v.time) return;
      var f = facOf(v.facility); if (!f || f.lat == null || f.lng == null || f.approved === false) return;
      var w = window.VisitCal.windowOf(v, X.settings), c = v.check, r = Number(f.radius_m) || Number((X.settings || {}).geo_radius_m) || 400;
      if (now >= w.open && now <= w.close && (!c || (c.ok === false && !c.missed))) out.push({ kind: 'arrive', v: v, f: f, r: r, w: w });
      else if (c && c.ok === true && !c.left_at && now < w.end) out.push({ kind: 'stay', v: v, f: f, r: r, w: w });
    });
    return out;
  }
  function geoBanner(jobs) {
    var b = $('#geo-banner');
    if (!b) { b = el('div', 'msg'); b.id = 'geo-banner'; b.setAttribute('role', 'status'); b.style.margin = '0 0 10px'; var j = $('#jump'); if (j && j.parentNode) j.parentNode.insertBefore(b, j.nextSibling); else return; }
    if (!jobs.length) { b.hidden = true; return; }
    var a = jobs.find(function (x) { return x.kind === 'arrive'; }), s = jobs.find(function (x) { return x.kind === 'stay'; });
    b.hidden = false;
    if (a) { b.className = 'msg'; b.textContent = '📍 Geofence on for ' + a.v.surgeon + ' at ' + a.f.name + '. Keep the app open when you arrive and it checks you in automatically (until ' + fmtTime(new Date(a.w.close).toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' })) + ').'; }
    else { b.className = 'msg ok'; b.textContent = '✅ Checked in at ' + s.f.name + '. Visit ends ' + fmtTime(new Date(s.w.end).toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' })) + '. Leaving the facility before then is flagged.'; }
  }
  function geoOnPos(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy || 0, now = Date.now();
    geoJobs().forEach(function (j) {
      var d = meters(lat, lng, j.f.lat, j.f.lng), slack = Math.min(acc, 150);
      if (j.kind === 'arrive' && acc <= 1500 && d - slack <= j.r && !GF.busy && now - GF.lastTry > 20000) {
        GF.busy = true; GF.lastTry = now;
        api('/api/checkin', { id: j.v.id, lat: lat, lng: lng, acc: acc, auto: true }).then(function (r) {
          X.visits = X.visits.map(function (x) { return x.id === j.v.id ? Object.assign({}, x, { check: r.check }) : x; });
          T.setStatus('saved', r.check.ok === true ? 'Checked in automatically at ' + j.f.name : 'Check-in: ' + r.check.reason); T.render();
          if (r.check.ok === true) geoPopup(j);
        }, function () {}).then(function () { GF.busy = false; });
      }
      if (j.kind === 'stay') {
        var out = acc <= 1500 && d - slack > j.r * 1.5;
        GF.outside = out ? GF.outside.concat([now]).filter(function (t) { return now - t < 10 * 60e3; }) : [];
        if (out && GF.outside.length >= 2 && now - GF.outside[0] >= 90e3 && !GF.busy) {
          GF.busy = true;
          api('/api/visit-left', { id: j.v.id, lat: lat, lng: lng, acc: acc }).then(function (r) {
            if (r.check) X.visits = X.visits.map(function (x) { return x.id === j.v.id ? Object.assign({}, x, { check: r.check }) : x; });
            GF.outside = []; T.render();
          }, function () {}).then(function () { GF.busy = false; });
        }
      }
    });
  }
  function geoPopup(j) {
    var endT = fmtTime(new Date(j.w.end).toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' }));
    try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) {}
    try { if (window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.showNotification('Checked in · ' + j.f.name, { body: j.v.surgeon + ' visit. Stay until ' + endT + '.', icon: '/icon-192.png', tag: 'geo-' + j.v.id }); }); } catch (e) {}
    var old = $('#geo-pop'); if (old) old.remove();
    var o = el('div'); o.id = 'geo-pop'; o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-label', 'Checked in');
    o.style.cssText = 'position:fixed;inset:0;z-index:85;background:rgba(3,18,31,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    var c = el('div'); c.style.cssText = 'background:#fff;color:#081F33;border-radius:16px;padding:24px 22px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:Inter,system-ui,sans-serif';
    var ic = el('div', '', '✓'); ic.style.cssText = 'width:56px;height:56px;border-radius:50%;background:#1FA971;color:#fff;font-size:30px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 12px';
    c.appendChild(ic);
    var h = el('div', '', "You're checked in"); h.style.cssText = 'font-weight:700;font-size:1.2rem;margin-bottom:6px'; c.appendChild(h);
    var b = el('div', '', j.v.surgeon + ' at ' + j.f.name + '. Visit ends ' + endT + ': leaving before then is flagged.'); b.style.cssText = 'font-size:.92rem;color:#5C6E7D;margin-bottom:16px'; c.appendChild(b);
    var okb = btn('OK', 'primary', function () { o.remove(); }); okb.style.minWidth = '120px'; okb.style.justifyContent = 'center'; c.appendChild(okb);
    o.appendChild(c); o.addEventListener('click', function (e) { if (e.target === o) o.remove(); }); document.body.appendChild(o); okb.focus();
  }
  function geoTick() {
    var jobs = geoJobs(); geoBanner(jobs);
    if (!jobs.length || !navigator.geolocation) { if (GF.watch != null) { navigator.geolocation.clearWatch(GF.watch); GF.watch = null; } return; }
    if (GF.watch == null) GF.watch = navigator.geolocation.watchPosition(geoOnPos, function () {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && GF.watch != null) { navigator.geolocation.clearWatch(GF.watch); GF.watch = null; } else if (!document.hidden) geoTick(); });
  setInterval(function () { if (S.db) geoTick(); }, 60e3);

  function render(M, ctx) {
    if (!S.db) return; X.ctx = ctx;
    var ec = curCase(); if (ec && attSig !== ec.id + ':' + (ec.attachments || []).join(',')) drawAtt();
    if (ec && !document.querySelector('#ce-inv .x-form')) drawInv();
    drawInvQueue(); drawBilling(ctx); drawUpcoming(ctx); drawVCal(ctx); drawVisits(ctx); drawDir(ctx); drawPrefs(ctx); drawCreds(ctx); drawNotify(); geoTick();
    var anyComm = S.quotas.some(function (q) { return q.role !== 'Team' && q.comm_rate; });
    $('#btn-statement').hidden = !ctx.loaded || !anyComm;
  }
  function start(db) {
    X.db = db;
    var rows = function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); };
    db.collection('visits').onSnapshot(function (s) { X.visits = rows(s); T.render(); });
    db.collection('prefcards').onSnapshot(function (s) { X.prefs = rows(s); T.render(); });
    db.collection('credentials').onSnapshot(function (s) { X.creds = rows(s); T.render(); });
    db.collection('surgeons').onSnapshot(function (s) { S.dirSurgeons = rows(s); T.render(); });
    db.collection('facilities').onSnapshot(function (s) { S.dirFacilities = rows(s); T.render(); });
    db.doc('config/pricebook').onSnapshot(function (s) { X.pricebook = (s.exists && s.data()) || { rows: [] }; if (!Array.isArray(X.pricebook.rows)) X.pricebook.rows = []; T.render(); });
    db.doc('config/settings').onSnapshot(function (s) { X.settings = (s.exists && s.data()) || {}; T.render(); });
    db.doc('config/closed').onSnapshot(function (s) { X.closed = (s.exists && s.data()) || { months: {} }; if (!X.closed.months) X.closed.months = {}; T.render(); });
  }
  /* targetStatus doesn't carry step_changed_at, so attach it */
  T.targetStatus = function (M) { return origTS(M).map(function (t) { var r = S.targets.find(function (x) { return x.id === t.id; }); return Object.assign(t, { step_changed_at: r && r.step_changed_at }); }); };

  shell();
  window.SCTX = { augment: augment, openEditor: openEditor, closeEditor: closeEditor, alerts: alerts, render: render, start: start, parseCode: parseCode, contractPrice: contractPrice };
})();
