/* Login activity (admin): who signs in, how often, from what, and when they were last using the app. */
(function () {
  'use strict';
  var box = document.getElementById('sec-logins'); if (!box) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ago = function (iso) { if (!iso) return 'never'; var m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  var when = function (iso) { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  var D = null, show = 'Rep', sort = 'seen', open = {};
  box.innerHTML = '<div class="cardhead"><h2>Login activity</h2><button class="btn small" type="button" id="lg-ref">⟳</button></div><div id="lg-body"><p class="note">Loading…</p></div>';
  function draw() {
    var list = D.people.filter(function (p) { return !show || p.role === show; });
    var key = { seen: function (p) { return -(Date.parse(p.last_seen || p.last_login || 0) || 0); }, d30: function (p) { return -p.d30; }, name: function (p) { return p.who.toLowerCase(); } }[sort];
    list.sort(function (a, b) { var x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
    var quiet = list.filter(function (p) { return !p.last_seen || Date.now() - Date.parse(p.last_seen) > 7 * 864e5; }).length;
    var html = '<div class="tools" style="flex-wrap:wrap;gap:8px;margin:4px 0 8px"><select class="field" id="lg-show" style="width:auto"><option value="Rep">Reps</option><option value="Manager">Managers</option><option value="Admin">Admins</option><option value="">Everyone</option></select>' +
      '<select class="field" id="lg-sort" style="width:auto"><option value="seen">Sort: last active</option><option value="d30">Sort: sign-ins (30 days)</option><option value="name">Sort: name</option></select></div>' +
      '<p class="note">' + list.length + ' people · ' + (quiet ? '<b>' + quiet + ' not active in the last 7 days</b>' : 'everyone active this week') + (D.since ? ' · records since ' + esc(when(D.since)) : '') + '. Tap someone to see their recent sign-ins.</p>' +
      '<div style="display:grid;gap:8px">' + list.map(function (p) {
        var stale = !p.last_seen || Date.now() - Date.parse(p.last_seen) > 7 * 864e5, o = open[p.key];
        return '<div style="border:1px solid var(--line,#dde3ec);border-radius:12px;padding:8px 12px"><div data-lk="' + esc(p.key) + '" style="display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;cursor:pointer">' +
          '<span style="flex:1 1 12rem"><span style="display:inline-block;width:1rem">' + (o ? '▾' : '▸') + '</span><b>' + esc(p.who) + '</b> <span class="note">' + esc(p.role) + '</span></span>' +
          '<span class="pill ' + (stale ? 'bad' : 'ok') + '">Active ' + esc(ago(p.last_seen || p.last_login)) + '</span><span class="note">Last sign-in ' + esc(p.last_login ? ago(p.last_login) : 'never') + '</span><span class="note">' + p.d7 + ' this week · ' + p.d30 + ' in 30 days</span></div>' +
          (o ? '<div style="margin-top:8px"><p class="note">Last 30 days: ' + p.phone + ' on a phone, ' + p.computer + ' on a computer.</p>' + (p.events.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:4px 12px">' + p.events.map(function (e) { return '<div class="note">' + esc(when(e.at)) + ' · ' + (e.dev === 'phone' ? '📱 phone' : '💻 computer') + ' · ' + esc(e.how) + '</div>'; }).join('') + '</div>' : '<p class="note">No sign-ins recorded yet.</p>') + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    var b = document.getElementById('lg-body'); b.innerHTML = html;
    document.getElementById('lg-show').value = show; document.getElementById('lg-sort').value = sort;
    document.getElementById('lg-show').onchange = function (e) { show = e.target.value; draw(); };
    document.getElementById('lg-sort').onchange = function (e) { sort = e.target.value; draw(); };
    [].forEach.call(b.querySelectorAll('[data-lk]'), function (r) { r.onclick = function () { open[r.dataset.lk] = !open[r.dataset.lk]; draw(); }; });
  }
  function load() { fetch('/api/admin/logins', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { D = j; draw(); }).catch(function () { document.getElementById('lg-body').innerHTML = '<p class="note">Could not load login activity.</p>'; }); }
  document.getElementById('lg-ref').onclick = load; load();
})();
