/* Import historical cases (COO): pick an Excel or CSV file (or paste rows copied from Excel), match its columns to the tracker's
   fields, check the dry run, then import. Every import is a batch that can be undone. */
(function () {
  'use strict';
  var box = document.getElementById('sec-import'); if (!box) return;
  var $ = function (s) { return box.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var call = function (url, body, method) {
    return fetch(url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
  };
  var money = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  // tracker field → header words that usually mean it
  var FIELDS = [
    ['date', 'Case date *', ['date', 'case date', 'surgery date', 'dos', 'date of service', 'procedure date', 'day']],
    ['rep', 'Rep *', ['rep', 'sales rep', 'representative', 'rep name', 'territory manager', 'tm', 'salesperson']],
    ['surgeon', 'Surgeon', ['surgeon', 'doctor', 'physician', 'dr', 'surgeon name']],
    ['facility', 'Facility', ['facility', 'hospital', 'account', 'site', 'location', 'customer', 'asc']],
    ['product', 'Product', ['product', 'system', 'implant', 'item', 'description', 'product name']],
    ['units', 'Units', ['units', 'qty', 'quantity', 'count']],
    ['net_sales', 'Net sales $', ['net sales', 'sales', 'amount', 'revenue', 'total', 'price', 'net', 'invoice amount', 'extended']],
    ['status', 'Status', ['status', 'stage']],
    ['surgeon_type', 'New / Legacy', ['surgeon type', 'type', 'new/legacy', 'new or legacy', 'new', 'legacy']],
    ['service_line', 'Service line', ['service line', 'line', 'specialty', 'category']],
    ['po', 'PO #', ['po', 'po #', 'po number', 'purchase order']],
    ['lot', 'Lot #', ['lot', 'lot #', 'lot number']],
    ['notes', 'Notes', ['notes', 'note', 'comments', 'comment']]
  ];
  var HEAD = [], DATA = [], MAP = {}, FILE = '', ROSTER = [];

  box.innerHTML = '<div class="cardhead"><h2>Import historical cases</h2><a class="btn small" id="im-tpl" href="#">Download template</a></div>' +
    '<p class="note">Load past cases from Excel (.xlsx/.xls) or CSV, or paste rows copied from a spreadsheet (include the header row). Check how the columns line up, look at the dry run, then import. Duplicates (same date, rep, surgeon, product and amount) are skipped, closed months are filled in too, and every import can be undone.</p>' +
    '<div class="tools" style="flex-wrap:wrap;gap:8px"><label class="btn" style="cursor:pointer">Choose file<input type="file" id="im-file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden></label><span class="note" id="im-name"></span></div>' +
    '<details style="margin-top:8px"><summary class="note">…or paste rows from Excel</summary><textarea class="field" id="im-paste" rows="5" placeholder="Copy the cells in Excel (with the header row) and paste here"></textarea><button class="btn small" type="button" id="im-usepaste" style="margin-top:6px">Use pasted rows</button></details>' +
    '<div id="im-map" style="margin-top:12px"></div><div id="im-res"></div><div id="im-hist" style="margin-top:14px"></div>';

  function norm(h) { return String(h || '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' '); }
  function guess() {
    MAP = {}; var used = {};
    FIELDS.forEach(function (f) {
      var hit = -1;
      HEAD.forEach(function (h, i) { if (hit < 0 && !used[i] && f[2].indexOf(norm(h)) >= 0) hit = i; });
      if (hit < 0) HEAD.forEach(function (h, i) { if (hit < 0 && !used[i] && f[2].some(function (w) { return w.length > 2 && norm(h).indexOf(w) >= 0; })) hit = i; });
      if (hit >= 0) { MAP[f[0]] = hit; used[hit] = 1; }
    });
  }
  function parseText(t) { // tab- or comma-separated with quotes
    var sep = (t.split('\n')[0].match(/\t/g) || []).length ? '\t' : ',', rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
      if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(function (x) { return String(x).trim(); })) rows.push(row); row = []; } else cur += c;
    }
    row.push(cur); if (row.some(function (x) { return String(x).trim(); })) rows.push(row);
    return rows;
  }
  function take(rows, name) {
    if (!rows.length) { $('#im-map').innerHTML = '<div class="msg err">That file has no rows.</div>'; return; }
    HEAD = rows[0].map(function (h) { return String(h == null ? '' : h).trim(); }); DATA = rows.slice(1).filter(function (r) { return r.some(function (x) { return String(x == null ? '' : x).trim(); }); });
    FILE = name || 'pasted rows'; $('#im-name').textContent = FILE + ' · ' + DATA.length + ' rows';
    guess(); drawMap(); dry();
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = function () { ok(window.XLSX); }; s.onerror = function () { no(new Error('Could not load the Excel reader. Save the sheet as CSV and try again.')); }; document.head.appendChild(s); });
  }
  $('#im-file').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return; $('#im-name').textContent = 'Reading ' + f.name + '…';
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      Promise.all([loadXlsx(), f.arrayBuffer()]).then(function (a) {
        var wb = a[0].read(a[1], { type: 'array', cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]];
        var rows = a[0].utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
        take(rows, f.name + (wb.SheetNames.length > 1 ? ' (sheet "' + wb.SheetNames[0] + '")' : ''));
      }).catch(function (er) { $('#im-name').textContent = er.message || 'Could not read that file.'; });
    } else f.text().then(function (t) { take(parseText(t), f.name); });
    e.target.value = '';
  };
  $('#im-usepaste').onclick = function () { take(parseText($('#im-paste').value || ''), 'pasted rows'); };
  $('#im-tpl').onclick = function (e) {
    e.preventDefault();
    var csv = 'Date,Rep,Surgeon,Facility,Product,Units,Net sales,Status,New/Legacy,Service line,PO #,Lot #,Notes\n2025-03-14,Brandon Schafer,Dr. Smith,Doctors Hospital at Renaissance,Example plate,2,12000,Paid,New,Trauma,PO-1234,,\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'case-import-template.csv'; a.click();
  };
  function drawMap() {
    var opts = function (cur) { return '<option value="">— not in file —</option>' + HEAD.map(function (h, i) { return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + esc(h || ('Column ' + (i + 1))) + '</option>'; }).join(''); };
    $('#im-map').innerHTML = '<h3 style="margin:0 0 6px">Match the columns</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:8px 12px">' +
      FIELDS.map(function (f) { return '<label class="f" style="margin:0;min-width:0"><b>' + esc(f[1]) + '</b><select class="field" data-map="' + f[0] + '">' + opts(MAP[f[0]]) + '</select></label>'; }).join('') + '</div>' +
      '<p class="note" style="margin-top:6px">Missing status = Completed. Missing New/Legacy = New. Missing units = 1. Rep names are matched to the tracker\'s reps (full name or first + last); anything else stays as written.</p>';
    [].forEach.call(box.querySelectorAll('[data-map]'), function (s) { s.onchange = function () { MAP[s.dataset.map] = s.value === '' ? undefined : Number(s.value); dry(); }; });
  }
  function rowsOut() { return DATA.map(function (r) { var o = {}; FIELDS.forEach(function (f) { if (MAP[f[0]] !== undefined) o[f[0]] = r[MAP[f[0]]]; }); return o; }); }
  function report(j) {
    var months = Object.keys(j.months).sort(), unk = Object.keys(j.unknownReps);
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0"><span class="pill ok">' + j.ok + ' to import</span><span class="pill ' + (j.dup ? 'warn' : 'mute') + '">' + j.dup + ' duplicates skipped</span><span class="pill ' + (j.bad ? 'bad' : 'mute') + '">' + j.bad + ' with problems</span><span class="pill mute">' + money(j.sales) + ' net sales</span>' + (months.length ? '<span class="pill mute">' + months[0] + ' → ' + months[months.length - 1] + '</span>' : '') + '</div>' +
      (unk.length ? '<div class="msg warn">Not one of the tracker\'s current reps: ' + unk.map(function (u) { return '<b>' + esc(u) + '</b> (' + j.unknownReps[u] + ')'; }).join(', ') + '. Those cases import under that name. Fix the name in the file to put them under a current rep.</div>' : '') +
      (j.errors.length ? '<details' + (j.ok ? '' : ' open') + '><summary class="note">Rows with problems (' + j.bad + ')</summary><ul style="margin:4px 0 0 18px">' + j.errors.map(function (e) { return '<li>Row ' + e.line + ': ' + esc(e.why) + '</li>'; }).join('') + '</ul></details>' : '') +
      (j.sample.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:6px;margin-top:8px">' + j.sample.map(function (c) { return '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:6px 10px;font-size:.85rem"><b>' + esc(c.date) + ' · ' + esc(c.rep) + '</b><div>' + esc([c.surgeon, c.facility].filter(Boolean).join(' · ')) + '</div><div class="note">' + esc([c.product, c.units > 1 ? '×' + c.units : '', c.net_sales != null ? money(c.net_sales) : '', c.status, c.surgeon_type].filter(Boolean).join(' · ')) + '</div></div>'; }).join('') + '</div>' : '');
  }
  function dry() {
    var res = $('#im-res');
    if (MAP.date === undefined || MAP.rep === undefined) { res.innerHTML = '<div class="msg warn">Pick which columns hold the case date and the rep.</div>'; return; }
    res.innerHTML = '<p class="note">Checking…</p>';
    call('/api/admin/import-cases', { rows: rowsOut(), dry: true }).then(function (j) {
      res.innerHTML = '<h3 style="margin:12px 0 0">Dry run</h3>' + report(j) + (j.ok ? '<div class="tools" style="margin-top:10px"><button class="btn primary" type="button" id="im-go">Import ' + j.ok + ' case' + (j.ok === 1 ? '' : 's') + '</button></div>' : '');
      var go = $('#im-go'); if (go) go.onclick = function () {
        go.disabled = true; go.textContent = 'Importing…';
        call('/api/admin/import-cases', { rows: rowsOut(), dry: false, file: FILE }).then(function (k) {
          res.innerHTML = '<div class="msg ok">Imported ' + k.ok + ' case' + (k.ok === 1 ? '' : 's') + ' (' + money(k.sales) + '). They show in the tracker now. Undo below if something looks wrong.</div>'; DATA = []; $('#im-map').innerHTML = ''; $('#im-name').textContent = ''; hist();
        }, function (e) { go.disabled = false; go.textContent = 'Import'; res.insertAdjacentHTML('beforeend', '<div class="msg err">' + esc((e && e.error) || 'Import failed.') + '</div>'); });
      };
    }, function (e) { res.innerHTML = '<div class="msg err">' + esc((e && e.error) || 'Could not check the file.') + '</div>'; });
  }
  function hist() {
    call('/api/admin/import-cases').then(function (j) {
      ROSTER = j.roster || [];
      var h = $('#im-hist'); if (!j.batches.length) { h.innerHTML = ''; return; }
      h.innerHTML = '<h3 style="margin:0 0 6px">Past imports</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:8px">' + j.batches.map(function (b) {
        return '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:8px 10px' + (b.undone ? ';opacity:.6' : '') + '"><b>' + esc(b.file || 'Import') + '</b><div class="note">' + esc(new Date(b.at).toLocaleString()) + ' · ' + esc(b.by || '') + '</div><div>' + b.cases + ' cases · ' + money(b.sales) + (b.first ? ' · ' + esc(b.first) + ' → ' + esc(b.last) : '') + '</div>' +
          (b.undone ? '<div class="note">Undone · ' + (b.removed || 0) + ' removed</div>' : '<button class="btn small danger" type="button" data-undo="' + esc(b.id) + '" style="margin-top:4px">Undo this import</button>') + '</div>';
      }).join('') + '</div>';
      [].forEach.call(h.querySelectorAll('[data-undo]'), function (b) { b.onclick = function () { if (!confirm('Remove every case from this import? Cases logged by hand are not touched.')) return; b.disabled = true; call('/api/admin/import-cases/' + encodeURIComponent(b.dataset.undo), null, 'DELETE').then(hist, function () { b.disabled = false; }); }; });
    }).catch(function () {});
  }
  hist();
})();
