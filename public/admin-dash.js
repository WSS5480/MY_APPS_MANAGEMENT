/* Admin dashboard (the landing page): sales week-to-date and month-to-date against target, margin on sales, and what each rep is doing.
   Also the product cost list that the margin uses (on the Products & prices page). */
(function () {
  'use strict';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $$ = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) : null; };
  var ago = function (iso) { if (!iso) return 'never'; var m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  var dayAgo = function (d) { if (!d) return 'none yet'; var n = Math.round((Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; };
  var call = function (u, body, m) { return fetch(u, { method: m || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); }); };
  var bar = function (v, t, mark) { var w = t ? Math.min(100, v / t * 100) : 0, m = t && mark != null ? Math.min(100, mark / t * 100) : null; return '<div style="position:relative;height:8px;border-radius:99px;background:var(--line,#e3e8ef);margin-top:6px"><div style="height:100%;width:' + w + '%;border-radius:99px;background:' + (mark != null && v < mark * 0.9 ? 'var(--bad,#c33)' : 'var(--accent,#1d6fd8)') + '"></div>' + (m != null ? '<div title="Where you should be today" style="position:absolute;top:-3px;left:' + m + '%;width:2px;height:14px;background:var(--fg,#111)"></div>' : '') + '</div>'; };

  var dash = document.getElementById('sec-dash');
  function approvalsHtml(a) {
    var inv = a.invoices || [], fac = a.facilities || [], sur = a.surgeons || [], n = inv.length + fac.length + sur.length;
    if (!n) return '<div class="msg ok" style="margin-bottom:10px">✓ Nothing waiting for your approval.</div>';
    var row = function (icon, title, list, line, href, btn) { return list.length ? '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:4px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><b>' + icon + ' ' + title + ' · ' + list.length + '</b><a class="btn small primary" href="' + href + '">' + btn + '</a></div>' + list.slice(0, 4).map(function (x) { return '<div class="note">' + line(x) + '</div>'; }).join('') + (list.length > 4 ? '<div class="note">+ ' + (list.length - 4) + ' more</div>' : '') + '</div>' : ''; };
    return '<div style="border:2px solid var(--warn,#d97706);background:var(--warn-bg,#fff7e6);border-radius:12px;padding:10px 12px;margin-bottom:12px"><div style="font-weight:700;margin-bottom:8px">⚠️ ' + n + ' approval' + (n === 1 ? '' : 's') + ' needed</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:8px">' +
      row('🧾', 'Invoices', inv, function (x) { return esc(x.rep) + ' · ' + esc(x.number) + ' · ' + $$(x.amount); }, '/#sec-invq', 'Review in tracker') +
      row('🏥', 'Facility addresses', fac, function (x) { return esc(x.name) + (x.by ? ' · added by ' + esc(x.by) : ''); }, '#pg-facilities', 'Review') +
      row('🩺', 'New surgeons', sur, function (x) { return esc(x.name) + (x.facility ? ' · ' + esc(x.facility) : '') + (x.by ? ' · ' + esc(x.by) : ''); }, '#pg-surgeons', 'Review') + '</div></div>';
  }
  var SORT = 'mtd';
  function drawDash(j) {
    var t = j.totals, gm = t.costed_sales ? (t.costed_sales - t.cost) / t.costed_sales : null;
    var tile = function (lab, big, sub, extra) { return '<div style="border:1px solid var(--line,#dde3ec);border-top:3px solid var(--accent,#1d6fd8);border-radius:12px;padding:14px 16px;min-width:0"><div class="lab" style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">' + lab + '</div><div style="font-size:1.8rem;font-weight:700;line-height:1.15">' + big + '</div><div class="note">' + sub + '</div>' + (extra || '') + '</div>'; };
    var mName = new Date(j.month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    var reps = j.reps.slice().sort(function (a, b) { return SORT === 'name' ? a.rep.localeCompare(b.rep) : SORT === 'pct' ? (pct(b.quota_actual, b.target) || -1) - (pct(a.quota_actual, a.target) || -1) : SORT === 'active' ? String(b.last_active || '').localeCompare(String(a.last_active || '')) : (b[SORT] || 0) - (a[SORT] || 0); });
    var wcuPill = { sent: '<span class="pill ok">WCU sent</span>', late: '<span class="pill warn">WCU late</span>', missing: '<span class="pill bad">WCU missing</span>', due: '<span class="pill mute">WCU due Thu</span>' };
    dash.innerHTML = '<div class="cardhead"><h2>Dashboard · ' + esc(mName) + '</h2><div class="tools"><span class="note">Business day ' + j.biz.elapsed + ' of ' + j.biz.total + '</span><button class="btn small" type="button" id="dsh-ref">⟳</button></div></div>' +
      approvalsHtml(j.approvals || {}) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:10px">' +
        tile('Sales · week to date', $$(t.wtd), t.wtd_target ? pct(t.wtd, t.wtd_target) + '% of ' + $$(t.wtd_target) + ' week target' : t.cases_wtd + ' cases', bar(t.wtd, t.wtd_target)) +
        tile('Sales · month to date', $$(t.mtd), t.target ? pct(t.mtd, t.target) + '% of ' + $$(t.target) + ' target · on pace for ' + $$(t.pace) : t.cases_mtd + ' cases', bar(t.mtd, t.target, t.pace)) +
        (function () { var pr = j.biz.elapsed ? Math.round(t.mtd / j.biz.elapsed * j.biz.total) : 0; return tile('Month-end projection', $$(pr), t.target ? (pr >= t.target ? 'Above target by ' + $$(pr - t.target) : 'Short of target by ' + $$(t.target - pr)) : 'At the current daily pace'); })() +
        tile('Margin on sales · MTD', gm == null ? '—' : Math.round(gm * 1000) / 10 + '%', gm == null ? 'Add product costs below the products list' : $$(t.costed_sales - t.cost) + ' on ' + $$(t.costed_sales) + ' costed sales' + (t.uncosted ? ' · ' + t.uncosted + ' case' + (t.uncosted === 1 ? '' : 's') + ' without a cost' : '')) +
        tile('Cases', t.cases_mtd, t.cases_wtd + ' this week') +
        tile('Visits this week', t.visits_wtd, 'completed field visits') +
      '</div>' +
      '<div class="tools" style="margin:16px 0 6px;justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">Sales reps</h3><select class="field" id="dsh-sort" style="width:auto"><option value="mtd">Sort: sales MTD</option><option value="wtd">Sort: sales WTD</option><option value="pct">Sort: % to target</option><option value="active">Sort: last active</option><option value="name">Sort: name</option></select></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:10px">' + reps.map(function (r) {
        var p = pct(r.quota_actual, r.target), behind = r.pace && r.quota_actual < r.pace * 0.9, m = r.costed_sales ? Math.round((r.costed_sales - r.cost) / r.costed_sales * 1000) / 10 : null;
        var stale = !r.last_active || Date.now() - Date.parse(r.last_active) > 3 * 864e5;
        return '<div style="border:1px solid var(--line,#dde3ec);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><b>' + esc(r.rep) + '</b>' + (p == null ? '<span class="pill mute">No target</span>' : '<span class="pill ' + (p >= 100 ? 'ok' : behind ? 'bad' : 'warn') + '">' + p + '% of target</span>') + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"><div><div class="note">WTD</div><b>' + $$(r.wtd) + '</b>' + (r.wtd_target ? '<div class="note">of ' + $$(r.wtd_target) + '</div>' : '') + '</div><div><div class="note">MTD</div><b>' + $$(r.mtd) + '</b>' + (r.target ? '<div class="note">of ' + $$(r.target) + '</div>' : '') + '</div><div><div class="note">Margin</div><b>' + (m == null ? '—' : m + '%') + '</b>' + (r.uncosted ? '<div class="note">' + r.uncosted + ' uncosted</div>' : '') + '</div></div>' +
          (r.target ? bar(r.quota_actual, r.target, r.pace) : '') +
          '<div class="note">' + r.cases_mtd + ' cases MTD (' + r.cases_wtd + ' this week) · ' + r.visits_wtd + ' visits this week' + (r.visits_planned ? ', ' + r.visits_planned + ' planned' : '') + ' · last case ' + esc(dayAgo(r.last_case)) + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="pill ' + (stale ? 'bad' : 'ok') + '">Active ' + esc(ago(r.last_active)) + '</span>' + (wcuPill[r.wcu] || '') + (r.projected && r.target ? '<span class="note">Projects ' + $$(r.projected) + '</span>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<details style="margin-top:14px"' + (j.feed.length ? ' open' : '') + '><summary><b>Recent activity</b></summary><div style="display:grid;gap:4px;margin-top:6px">' + (j.feed.length ? j.feed.map(function (f) { return '<div class="note"><b style="color:var(--fg)">' + esc(f.rep) + '</b> · ' + esc(f.what) + ' · ' + esc(ago(f.at)) + '</div>'; }).join('') : '<p class="note">Nothing yet.</p>') + '</div></details>' +
      '<p class="note" style="margin-top:10px">Sales = net sales on completed (and later) cases. Week target = the month target spread over business days. The black tick on a bar is where the month should be today; red = more than 10% behind. Margin uses the product costs on the Products &amp; prices page.</p>';
    document.getElementById('dsh-ref').onclick = loadDash;
    var ss = document.getElementById('dsh-sort'); ss.value = SORT; ss.onchange = function () { SORT = ss.value; drawDash(j); };
  }
  function loadDash() { if (!dash) return; call('/api/admin/dashboard').then(drawDash, function () { dash.innerHTML = '<p class="note">Could not load the dashboard.</p>'; }); }
  if (dash) { dash.innerHTML = '<p class="note">Loading dashboard…</p>'; loadDash(); setInterval(function () { if (!document.hidden && !dash.classList.contains('pg-off')) loadDash(); }, 120000); }

  /* product costs (for margin) */
  var cbox = document.getElementById('sec-costs');
  function loadCosts() {
    call('/api/admin/costs').then(function (j) {
      cbox.innerHTML = '<div class="cardhead"><h2>Product costs · for margin</h2><button class="btn primary small" type="button" id="pc-save" disabled>Save costs</button></div>' +
        '<p class="note">Your cost per unit for each product as reps log it. Margin on the Dashboard = net sales − units × this cost. Internal: reps never see it. Leave blank if you don\'t know it yet.</p>' +
        '<input class="field" id="pc-q" type="search" placeholder="Search products" style="max-width:20rem;margin-bottom:8px">' +
        '<div id="pc-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:6px 12px">' + j.rows.map(function (r, i) {
          return '<label data-pc="' + esc(r.product.toLowerCase()) + '" style="display:flex;align-items:center;gap:8px;justify-content:space-between;border-bottom:1px solid var(--line,#e3e8ef);padding:4px 0"><span style="min-width:0"><b style="font-weight:600">' + esc(r.product) + '</b><span class="note"> · ' + r.cases + ' case' + (r.cases === 1 ? '' : 's') + '</span></span><span style="white-space:nowrap">$<input class="field" data-i="' + i + '" inputmode="decimal" value="' + (r.cost == null ? '' : r.cost) + '" placeholder="—" style="width:6.5rem;display:inline-block"></span></label>';
        }).join('') + '</div><div class="msg" id="pc-msg" hidden></div>';
      var save = document.getElementById('pc-save'), dirty = {};
      cbox.querySelector('#pc-list').oninput = function (e) { var i = e.target.dataset.i; if (i == null) return; dirty[i] = 1; save.disabled = false; save.textContent = 'Save costs (' + Object.keys(dirty).length + ')'; };
      document.getElementById('pc-q').oninput = function (e) { var q = e.target.value.toLowerCase(); [].forEach.call(cbox.querySelectorAll('[data-pc]'), function (l) { l.hidden = q && l.dataset.pc.indexOf(q) < 0; }); };
      save.onclick = function () {
        save.disabled = true;
        var rows = Object.keys(dirty).map(function (i) { return { product: j.rows[i].product, cost: cbox.querySelector('[data-i="' + i + '"]').value.trim() }; });
        call('/api/admin/costs', { rows: rows }, 'PUT').then(function () { var m = document.getElementById('pc-msg'); m.className = 'msg ok'; m.hidden = false; m.textContent = 'Saved. The Dashboard margin uses these now.'; dirty = {}; save.textContent = 'Save costs'; loadDash(); }, function (e) { save.disabled = false; var m = document.getElementById('pc-msg'); m.className = 'msg err'; m.hidden = false; m.textContent = (e && e.error) || 'Could not save.'; });
      };
    }).catch(function () { cbox.innerHTML = '<p class="note">Could not load product costs.</p>'; });
  }
  if (cbox) loadCosts();
})();
