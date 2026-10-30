/* Admin → Sales reps (case tracker): every rep with this month's results, plan, commission and activity.
   Each rep is a folding card (wraps on phones, no sideways table). Plans and access are edited in Team logins when the store hub is linked. */
(function () {
  'use strict';
  var box = document.getElementById('sec-replist'); if (!box) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $$ = function (n) { return n == null ? '—' : '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  var css = document.createElement('style');
  css.textContent =
    '#sec-replist .rl-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 10px}#sec-replist .rl-tools select{width:auto}' +
    '#sec-replist .rl-sum{font-size:.85rem;color:var(--muted,#5d6879);margin:0 0 10px}' +
    '#sec-replist .rl-list{display:grid;gap:8px}' +
    '#sec-replist details{border:1px solid var(--line,#dde3ec);border-radius:12px;background:var(--panel,#fff)}' +
    '#sec-replist details[open]{border-color:#9fb6d3}' +
    '#sec-replist summary{list-style:none;cursor:pointer;padding:10px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center}#sec-replist summary::-webkit-details-marker{display:none}' +
    '#sec-replist .rl-n{font-weight:700;font-size:1rem;display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0;overflow-wrap:anywhere}#sec-replist .rl-n:before{content:"▸";color:var(--muted,#5d6879);font-size:.8rem}#sec-replist details[open] .rl-n:before{content:"▾"}' +
    '#sec-replist .rl-sub{grid-column:1;font-size:.8rem;color:var(--muted,#5d6879)}' +
    '#sec-replist .rl-pct{grid-row:span 2;text-align:right;font-weight:800;font-size:1.15rem;font-variant-numeric:tabular-nums}#sec-replist .rl-pct small{display:block;font-size:.72rem;font-weight:600;color:var(--muted,#5d6879)}' +
    '#sec-replist .rl-bar{grid-column:1/-1;position:relative;height:6px;border-radius:99px;background:var(--line,#e3e8ef)}#sec-replist .rl-bar i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:#0b4d96}#sec-replist .rl-bar i.ok{background:#1f9d63}#sec-replist .rl-bar i.bad{background:#d64545}' +
    '#sec-replist .rl-body{padding:0 12px 12px;display:grid;gap:10px}' +
    '#sec-replist .rl-grp{border-top:1px solid var(--line,#e3e8ef);padding-top:8px}#sec-replist .rl-grp h4{margin:0 0 6px;font-size:.7rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5d6879)}' +
    '#sec-replist .rl-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8.5rem),1fr));gap:6px 12px}#sec-replist .rl-g div{min-width:0}#sec-replist .rl-g .l{font-size:.72rem;color:var(--muted,#5d6879)}#sec-replist .rl-g .v{font-weight:700;overflow-wrap:anywhere}' +
    '#sec-replist .rl-acts{display:flex;flex-wrap:wrap;gap:8px}#sec-replist details.t summary{cursor:default}#sec-replist details.t .rl-n:before{content:none}';
  document.head.appendChild(css);
  var FILTER = 'active', SORT = 'rank', OPEN = {};
  try { FILTER = localStorage.getItem('rlFilter') || 'active'; SORT = localStorage.getItem('rlSort') || 'rank'; } catch (e) {}
  var DATA = null;
  function call(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }); }
  function load() {
    return Promise.all([call('/api/admin/state'), call('/api/admin/exec').catch(function () { return { reps: [], teams: [] }; })]).then(function (r) { DATA = { st: r[0], ex: r[1] }; draw(); },
      function () { box.innerHTML = '<div class="cardhead"><h2>Sales reps</h2></div><p class="note">Could not load the reps. Refresh to try again.</p>'; });
  }
  function teamLogins() { var a = document.querySelector('.both-apps[data-hub="staff"]'); if (a && !a.hidden) { a.click(); return; } var r = document.getElementById('reps-card'); if (r) { r.hidden = false; r.scrollIntoView({ behavior: 'smooth' }); } }
  function draw() {
    var st = DATA.st, ex = DATA.ex, byEx = {}; (ex.reps || []).forEach(function (r) { byEx[r.rep] = r; });
    var mName = ex.month ? new Date(ex.month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }) : 'This month';
    var all = st.rows.filter(function (r) { return r.role !== 'Team'; }).map(function (r) { return { row: r, x: byEx[r.rep] || null, c: (st.counts || {})[r.rep] || {} }; });
    var list = all.filter(function (o) { return FILTER === 'all' || (FILTER === 'active' ? o.row.active !== false : o.row.active === false); });
    list.sort(function (a, b) {
      if (SORT === 'name') return a.row.rep.localeCompare(b.row.rep);
      if (SORT === 'sales') return ((b.x || {}).sales || 0) - ((a.x || {}).sales || 0);
      if (SORT === 'cases') return ((b.x || {}).cases || 0) - ((a.x || {}).cases || 0);
      if (SORT === 'comm') return (((b.x || {}).comm || {}).commission || 0) - (((a.x || {}).comm || {}).commission || 0);
      return ((a.x || {}).rank || 999) - ((b.x || {}).rank || 999) || a.row.rep.localeCompare(b.row.rep);
    });
    var act = all.filter(function (o) { return o.row.active !== false; }), tot = act.reduce(function (t, o) { var x = o.x || {}; t.s += x.sales || 0; t.c += x.cases || 0; t.m += (x.comm || {}).commission || 0; return t; }, { s: 0, c: 0, m: 0 });
    var val = function (x, n) { return x.metric === 'Cases' ? (n == null ? '—' : n + ' case' + (n === 1 ? '' : 's')) : $$(n); };
    var g = function (l, v) { return '<div><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; };
    var card = function (o) {
      var r = o.row, x = o.x, c = o.c, off = r.active === false, pct = x && x.pct != null ? x.pct : null;
      var plan = (r.metric === 'Cases' ? (r.quota ? r.quota + ' cases' : 'No quota') : (r.quota ? $$(r.quota) : 'No quota')) + ' a month';
      var rate = Number(r.comm_rate) || 0, ratePct = rate ? (rate < 1 ? Math.round(rate * 1000) / 10 : rate) + '%' : '—';
      var pay = r.pay_kind === 'salary' ? 'Base salary' : r.pay_kind === 'draw' || r.draw ? 'Draw' : '', payAmt = Number(r.pay_amount) || Number(r.draw) || 0;
      return '<details data-rep="' + esc(r.rep) + '"' + (OPEN[r.rep] ? ' open' : '') + '><summary>' +
        '<div class="rl-n">' + (x ? '<span class="pill mute">#' + x.rank + '</span>' : '') + esc(r.rep) + (off ? '<span class="pill bad">Access off</span>' : '') + (x && x.target ? '<span class="pill ' + (pct >= 100 ? 'ok' : x.behind ? 'bad' : 'warn') + '">' + (pct >= 100 ? 'Quota hit' : x.behind ? 'Behind' : 'On track') + '</span>' : '') + '</div>' +
        '<div class="rl-pct">' + (pct == null ? '—' : Math.round(pct) + '%') + '<small>' + (x ? val(x, x.actual) + (x.target ? ' of ' + val(x, x.target) : '') : 'no results') + '</small></div>' +
        '<div class="rl-sub">' + esc([r.role, r.territory && r.territory !== r.rep ? r.territory : ''].filter(Boolean).join(' · ')) + ' · ' + (x ? x.cases + ' case' + (x.cases === 1 ? '' : 's') + ' · ' + $$(x.sales) + ' sales in ' + esc(mName) : (c.cases || 0) + ' cases logged') + '</div>' +
        (x && x.target ? '<div class="rl-bar"><i class="' + (pct >= 100 ? 'ok' : x.behind ? 'bad' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></div>' : '') +
        '</summary><div class="rl-body">' +
        (x ? '<div class="rl-grp"><h4>' + esc(mName) + '</h4><div class="rl-g">' + g('Counts toward quota', val(x, x.actual)) + g('Target', x.target ? val(x, x.target) : '—') + g('Run-rate projection', val(x, x.run_rate)) + g('Needed / day', x.needed_day == null ? '—' : val(x, x.needed_day)) +
          g('Net sales', $$(x.sales)) + g('Cases completed', x.cases) + g('New-surgeon cases', x.new_cases) + g('New surgeons · ' + esc((ex.quarter || '').split(' ')[0]), x.new_surgeons_q) + g('Quarter to date', val(x, x.qtd)) + g('Targets won', x.targets ? x.targets_won + ' of ' + x.targets : '—') +
          g('Top surgeon', x.top_surgeon ? esc(x.top_surgeon.name) + ' (' + x.top_surgeon.n + ')' : '—') + g('Top product', x.top_product ? esc(x.top_product.name) : '—') + '</div></div>' : '') +
        '<div class="rl-grp"><h4>Plan</h4><div class="rl-g">' + g('Quota', plan) + g('Measured on', r.metric === 'Cases' ? 'Cases' : 'Sales') + g('Counts', esc(r.counts || 'All')) + g('Product', esc(r.product_filter || 'All products')) + g('Carry shortfall', r.carry ? 'Yes, within the quarter' : 'No') + g('Territory', esc(r.territory || '—')) + '</div></div>' +
        '<div class="rl-grp"><h4>Pay &amp; commission</h4><div class="rl-g">' + g('Commission rate', ratePct) + g('Commission floor', r.comm_floor ? $$(r.comm_floor) : '—') + g(pay || 'Guaranteed pay', payAmt ? $$(payAmt) + ' / month' : '—') +
          g('Commission · ' + esc(mName), x ? $$((x.comm || {}).commission) : '—') + g('Est. pay · ' + esc(mName), x && x.comm && x.comm.est_pay != null ? $$(x.comm.est_pay) : '—') + '</div></div>' +
        '<div class="rl-grp"><h4>Activity · all time</h4><div class="rl-g">' + g('Cases logged', c.cases || 0) + g('Last case', c.last ? new Date(c.last + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—') + g('Visits', c.visits || 0) + g('Target surgeons', c.targets || 0) + g('Pref cards', c.prefcards || 0) + g('Credentials', c.credentials || 0) + '</div></div>' +
        '<div class="rl-grp"><h4>Access</h4><div class="rl-g">' + g('Tracker access', off ? 'Off' : 'On') + g('PIN', r.pin ? 'Set' : 'Not set') + g('Signs in through', r.hub ? 'Team logins (one login, both apps)' : 'Tracker PIN') + '</div></div>' +
        '<div class="rl-acts"><button class="btn small primary" type="button" data-tl>Edit plan &amp; access in Team logins</button></div>' +
        '</div></details>';
    };
    var teams = (ex.teams || []);
    box.innerHTML = '<div class="cardhead"><h2>Sales reps</h2><div class="tools"><button class="btn primary small" type="button" data-tl>+ Add or edit reps in Team logins</button></div></div>' +
      '<p class="note">Every case-tracker rep with ' + esc(mName) + '\'s results, plan, commission and activity. Tap a rep to open the details. Reps, PINs, access and plans are changed in Team logins: one roster for the store and the tracker.</p>' +
      '<div class="rl-tools"><select class="field" id="rl-f"><option value="active">Active reps</option><option value="off">Access off</option><option value="all">All reps</option></select>' +
      '<select class="field" id="rl-s"><option value="rank">Sort: rank (% to quota)</option><option value="sales">Sort: net sales</option><option value="cases">Sort: cases</option><option value="comm">Sort: commission</option><option value="name">Sort: name A–Z</option></select>' +
      '<button class="btn small" type="button" id="rl-x">' + (list.length && list.every(function (o) { return OPEN[o.row.rep]; }) ? 'Collapse all' : 'Expand all') + '</button><button class="btn small" type="button" id="rl-r">⟳</button></div>' +
      '<p class="rl-sum">' + act.length + ' active rep' + (act.length === 1 ? '' : 's') + ' · ' + tot.c + ' cases · ' + $$(tot.s) + ' net sales · ' + $$(tot.m) + ' commission in ' + esc(mName) + '</p>' +
      '<div class="rl-list">' + (list.length ? list.map(card).join('') : '<p class="note">No reps here.</p>') + '</div>' +
      (teams.length ? '<h3 style="margin:16px 0 6px">Team quotas</h3><div class="rl-list">' + teams.map(function (t) { var p = t.pct; return '<details class="t"><summary onclick="event.preventDefault()"><div class="rl-n">' + esc(t.name) + '</div><div class="rl-pct">' + (p == null ? '—' : Math.round(p) + '%') + '<small>' + $$(t.actual) + (t.target ? ' of ' + $$(t.target) : '') + '</small></div><div class="rl-sub">Territory ' + esc(t.territory || '—') + '</div>' + (t.target ? '<div class="rl-bar"><i class="' + (p >= 100 ? 'ok' : '') + '" style="width:' + Math.min(100, p || 0) + '%"></i></div>' : '') + '</summary></details>'; }).join('') + '</div>' : '');
    var f = box.querySelector('#rl-f'), s = box.querySelector('#rl-s');
    f.value = FILTER; s.value = SORT;
    f.onchange = function () { FILTER = f.value; try { localStorage.setItem('rlFilter', FILTER); } catch (e) {} draw(); };
    s.onchange = function () { SORT = s.value; try { localStorage.setItem('rlSort', SORT); } catch (e) {} draw(); };
    box.querySelector('#rl-x').onclick = function () { var open = !list.every(function (o) { return OPEN[o.row.rep]; }); list.forEach(function (o) { OPEN[o.row.rep] = open; }); draw(); };
    box.querySelector('#rl-r').onclick = load;
    [].forEach.call(box.querySelectorAll('details[data-rep]'), function (d) { d.addEventListener('toggle', function () { OPEN[d.dataset.rep] = d.open; }); });
    [].forEach.call(box.querySelectorAll('[data-tl]'), function (b) { b.onclick = function (e) { e.preventDefault(); teamLogins(); }; });
  }
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    if (!me || me.role !== 'owner') { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = '<p class="note">Loading reps…</p>'; load();
    setInterval(function () { if (!document.hidden && !box.classList.contains('pg-off')) load(); }, 120000);
  });
})();
