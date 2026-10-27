/* Target surgeon visit calendar (month grid + agenda), shared by the tracker and the admin page.
   Colors: green = checked in at the facility during the visit window; red = not at the facility,
   outside the window, or missed; amber = facility has no address so it can't be verified;
   blue = planned; grey = logged without a plan. */
(function () {
  'use strict';
  var CSS = '' +
    '.vc-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px}' +
    '.vc-nav{display:flex;gap:6px;align-items:center}.vc-title{font-weight:700;font-size:1rem;min-width:9.5rem;text-align:center}' +
    '.vc-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.75rem;color:var(--muted);margin:4px 0 10px}' +
    '.vc-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}' +
    '.vc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}' +
    '.vc-dow{font-size:.6875rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:6px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--bg)}' +
    '.vc-day{min-height:6.5rem;padding:4px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:3px;min-width:0;background:var(--panel)}' +
    '.vc-day.out{background:var(--bg);opacity:.55}.vc-day.today{box-shadow:inset 0 0 0 2px var(--accent)}' +
    '.vc-num{font-size:.75rem;font-weight:600;color:var(--muted)}' +
    '.vc-chip{display:block;width:100%;text-align:left;border:1px solid transparent;border-radius:5px;padding:2px 5px;font:inherit;font-size:.6875rem;line-height:1.3;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.vc-more{font-size:.6875rem;color:var(--muted);background:none;border:none;cursor:pointer;text-align:left;padding:0 4px}' +
    '.st-verified{background:#1FA971;color:#fff}.st-failed,.st-missed{background:#D9483B;color:#fff}.st-unverifiable{background:#E0A019;color:#2b1d00}.st-left{background:#E46A2E;color:#fff}' +
    '.st-planned{background:var(--hl);color:var(--fg);border-color:var(--accent)}.st-open{background:var(--accent);color:#fff}' +
    '.st-logged{background:var(--mute-bg);color:var(--fg)}.st-cancelled{background:transparent;color:var(--muted);text-decoration:line-through;border-color:var(--line)}' +
    '.vc-agenda{list-style:none;margin:0;padding:0}.vc-agenda .vc-dhead{font-size:.6875rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:12px 0 4px}' +
    '.vc-arow{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;margin-bottom:6px;cursor:pointer;border:1px solid var(--line);background:var(--panel)}' +
    '.vc-arow .vc-dot{flex:none;width:10px;height:10px;border-radius:50%}.vc-arow .vc-t{font-weight:600;font-size:.875rem}.vc-arow .vc-m{font-size:.75rem;color:var(--muted)}' +
    '.vc-arow .vc-s{margin-left:auto;font-size:.6875rem;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}' +
    '.vc-modal{position:fixed;inset:0;z-index:80;background:rgba(3,18,31,.6);display:flex;align-items:center;justify-content:center;padding:16px}.vc-modal[hidden]{display:none}' +
    '.vc-box{background:var(--panel);color:var(--fg);border-radius:14px;width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(3,18,31,.35)}' +
    '.vc-box h3{margin:0;font-size:1.125rem}.vc-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:.875rem}.vc-kv span:nth-child(odd){color:var(--muted)}' +
    '.vc-status{border-radius:8px;padding:10px 12px;font-weight:600;font-size:.875rem}' +
    '.vc-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}' +
    '.vc-box textarea,.vc-box input,.vc-box select{font:inherit}' +
    '@media (max-width:640px){.vc-day{min-height:3.6rem}.vc-chip{font-size:0;padding:0;height:7px;border-radius:4px}.vc-more{font-size:.625rem}}';
  var injected = false;
  function inject() { if (injected) return; injected = true; var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
  var el = function (t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function chiEpoch(date, time) {
    var p = String(date).split('-').map(Number), t = String(time || '08:00').split(':').map(Number);
    var guess = Date.UTC(p[0], p[1] - 1, p[2], t[0] || 0, t[1] || 0);
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
    var g = function (k) { return Number(parts.find(function (x) { return x.type === k; }).value); };
    return guess - (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess);
  }
  function windowOf(v, set) { set = set || {}; var s = chiEpoch(v.date, v.time), e = s + (Number(v.duration) || 60) * 60e3; return { start: s, end: e, open: s - (Number(set.checkin_early_min) || 30) * 60e3, close: e + (Number(set.checkin_late_min) || 30) * 60e3 }; }
  var LABEL = { left: 'Left early', verified: 'Verified at facility', failed: 'Not verified', missed: 'Missed check-in', unverifiable: "Can't verify (no address)", planned: 'Planned', open: 'Check-in open now', logged: 'Logged (no plan)', cancelled: 'Cancelled' };
  var COLOR = { left: '#E46A2E', verified: '#1FA971', failed: '#D9483B', missed: '#D9483B', unverifiable: '#E0A019', planned: '#079FE9', open: '#079FE9', logged: '#8FA6B8', cancelled: '#8FA6B8' };
  function state(v, set) {
    if (v.status === 'cancelled') return 'cancelled';
    var c = v.check;
    if (c) return c.ok === true ? (c.left_at ? 'left' : 'verified') : c.ok === null ? 'unverifiable' : c.missed ? 'missed' : 'failed';
    if (v.status !== 'planned') return 'logged';
    if (!v.time) return 'planned';
    var w = windowOf(v, set), now = Date.now();
    return now >= w.open && now <= w.close ? 'open' : 'planned';
  }
  function clock(t) { if (!t) return ''; var p = t.split(':').map(Number); return ((p[0] + 11) % 12 + 1) + ':' + pad(p[1]) + (p[0] < 12 ? 'a' : 'p'); }
  function dayLabel(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function initials(n) { return String(n || '').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }

  function mount(root, opts) {
    inject();
    var today = new Date(), view = opts.view || (window.innerWidth < 640 ? 'agenda' : 'month');
    var ym = today.getFullYear() + '-' + pad(today.getMonth() + 1), repSel = '';
    var modal = el('div', 'vc-modal'); modal.hidden = true; var box = el('div', 'vc-box'); modal.appendChild(box); document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') modal.hidden = true; });
    var head = el('div', 'vc-bar'), nav = el('div', 'vc-nav'), title = el('span', 'vc-title'), right = el('div', 'vc-nav');
    var mk = function (t, fn, cls) { var b = el('button', 'btn small ' + (cls || ''), t); b.type = 'button'; b.addEventListener('click', fn); return b; };
    var shift = function (n) { var p = ym.split('-').map(Number), d = new Date(p[0], p[1] - 1 + n, 1); ym = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); };
    nav.appendChild(mk('‹', function () { shift(-1); })); nav.appendChild(title); nav.appendChild(mk('›', function () { shift(1); }));
    nav.appendChild(mk('Today', function () { ym = today.getFullYear() + '-' + pad(today.getMonth() + 1); render(); }));
    var vm = mk('Month', function () { view = 'month'; render(); }), va = mk('Agenda', function () { view = 'agenda'; render(); });
    var rs = null;
    if (opts.repFilter) { rs = el('select', 'field'); rs.style.width = 'auto'; rs.setAttribute('aria-label', 'Rep'); rs.addEventListener('change', function () { repSel = rs.value; render(); }); right.appendChild(rs); }
    right.appendChild(vm); right.appendChild(va);
    head.appendChild(nav); head.appendChild(right); root.appendChild(head);
    var legend = el('div', 'vc-legend');
    ['verified', 'left', 'failed', 'unverifiable', 'planned', 'logged'].forEach(function (k) { var s = el('span'), i = el('i'); i.style.background = COLOR[k]; s.appendChild(i); s.appendChild(document.createTextNode(k === 'failed' ? 'Not verified / missed' : LABEL[k])); legend.appendChild(s); });
    root.appendChild(legend);
    var body = el('div'); root.appendChild(body);
    var summary = el('p', 'note'); root.appendChild(summary);

    function data() { var d = opts.getData() || {}; return { visits: d.visits || [], reps: d.reps || [], settings: d.settings || {} }; }
    function visible(d) { return d.visits.filter(function (v) { return v.date && (!repSel || v.rep === repSel); }); }
    function chipText(v) { return (v.time ? clock(v.time) + ' ' : '') + (opts.showRep && !repSel ? initials(v.rep) + ' · ' : '') + (v.surgeon || 'Visit'); }

    function render() {
      var d = data(), p = ym.split('-').map(Number);
      title.textContent = new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      vm.classList.toggle('primary', view === 'month'); va.classList.toggle('primary', view === 'agenda');
      if (rs && rs !== document.activeElement) { var k = rs.value; rs.replaceChildren.apply(rs, [new Option('All reps', '')].concat(d.reps.map(function (r) { return new Option(r, r); }))); rs.value = d.reps.indexOf(k) >= 0 ? k : ''; repSel = rs.value; }
      var all = visible(d), inMonth = all.filter(function (v) { return v.date.slice(0, 7) === ym; }).sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
      body.replaceChildren();
      if (view === 'month') {
        var g = el('div', 'vc-grid');
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (w) { g.appendChild(el('div', 'vc-dow', w)); });
        var first = new Date(p[0], p[1] - 1, 1), start = new Date(first); start.setDate(1 - first.getDay());
        var todayIso = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
        for (var i = 0; i < 42; i++) {
          var dt = new Date(start); dt.setDate(start.getDate() + i);
          var iso = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
          if (i >= 35 && dt.getMonth() !== p[1] - 1) break;
          var cell = el('div', 'vc-day' + (dt.getMonth() !== p[1] - 1 ? ' out' : '') + (iso === todayIso ? ' today' : ''));
          cell.appendChild(el('span', 'vc-num', String(dt.getDate())));
          var day = all.filter(function (v) { return v.date === iso; }).sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
          day.slice(0, 3).forEach(function (v) { var c = el('button', 'vc-chip st-' + state(v, d.settings), chipText(v)); c.type = 'button'; c.title = chipText(v) + ' · ' + LABEL[state(v, d.settings)]; c.addEventListener('click', function () { open(v); }); cell.appendChild(c); });
          if (day.length > 3) { var mo = el('button', 'vc-more', '+' + (day.length - 3) + ' more'); mo.type = 'button'; (function (isoDay) { mo.addEventListener('click', function () { view = 'agenda'; ym = isoDay.slice(0, 7); render(); }); })(iso); cell.appendChild(mo); }
          g.appendChild(cell);
        }
        body.appendChild(g);
      } else {
        var ul = el('div', 'vc-agenda'), last = null;
        if (!inMonth.length) ul.appendChild(el('div', 'empty', 'No target visits this month.'));
        inMonth.forEach(function (v) {
          if (v.date !== last) { last = v.date; ul.appendChild(el('div', 'vc-dhead', dayLabel(v.date))); }
          var st = state(v, d.settings), row = el('div', 'vc-arow'); row.tabIndex = 0;
          var dot = el('span', 'vc-dot'); dot.style.background = COLOR[st]; row.appendChild(dot);
          var t = el('div'); t.appendChild(el('div', 'vc-t', (v.time ? clock(v.time) + ' · ' : '') + (v.surgeon || 'Visit') + (v.facility ? ' @ ' + v.facility : '')));
          t.appendChild(el('div', 'vc-m', [opts.showRep ? v.rep : '', v.type, v.assigned_by === 'COO' ? 'assigned by COO' : '', v.purpose].filter(Boolean).join(' · '))); row.appendChild(t);
          row.appendChild(el('span', 'vc-s st-' + st, LABEL[st]));
          row.addEventListener('click', function () { open(v); }); row.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(v); });
          ul.appendChild(row);
        });
        body.appendChild(ul);
      }
      var planned = inMonth.filter(function (v) { return v.status === 'planned' || v.check; });
      var ver = planned.filter(function (v) { return v.check && v.check.ok === true; }).length, bad = planned.filter(function (v) { return v.check && v.check.ok === false; }).length;
      summary.textContent = inMonth.length + ' visit' + (inMonth.length === 1 ? '' : 's') + ' this month · ' + planned.length + ' planned · ' + ver + ' verified · ' + bad + ' not verified' + (planned.length ? ' · ' + Math.round(ver / Math.max(1, ver + bad) * 100) + '% verified of checked' : '');
    }
    function open(v) {
      var d = data(), st = state(v, d.settings), w = v.time ? windowOf(v, d.settings) : null;
      box.replaceChildren();
      box.appendChild(el('h3', '', (v.surgeon || 'Visit') + (v.facility ? ' · ' + v.facility : '')));
      var s = el('div', 'vc-status st-' + st, LABEL[st] + (v.check && v.check.reason ? ' — ' + v.check.reason : '')); box.appendChild(s);
      var kv = el('div', 'vc-kv'), add = function (k, val) { if (!val) return; kv.appendChild(el('span', '', k)); kv.appendChild(el('span', '', val)); };
      add('Rep', v.rep); add('Date', dayLabel(v.date)); add('Time', v.time ? clock(v.time) + ' · ' + (v.duration || 60) + ' min' : 'No time set');
      if (w && v.status === 'planned') add('Check-in window', new Date(w.open).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' – ' + new Date(w.close).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' (Central)');
      add('Type', v.type); add('Purpose', v.purpose); add('Scheduled by', v.assigned_by === 'COO' ? 'COO' : '');
      if (v.check && !v.check.missed) {
        add('Checked in', new Date(v.check.at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (v.check_attempts > 1 ? ' · attempt ' + v.check_attempts : ''));
        if (v.check.dist_m != null) add('Distance', (v.check.dist_m >= 1000 ? (v.check.dist_m / 1609.34).toFixed(1) + ' mi' : v.check.dist_m + ' m') + ' from the facility address · GPS ±' + v.check.acc + ' m');
      }
      if (v.check && v.check.ack) add('Reviewed', new Date(v.check.ack.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (v.check.ack.note ? ' · ' + v.check.ack.note : ''));
      add('Notes', v.notes); add('Next step', [v.next_step, v.next_date].filter(Boolean).join(' by '));
      box.appendChild(kv);
      var acts = el('div', 'vc-acts');
      (opts.actions ? opts.actions(v, st, close) : []).forEach(function (a) { acts.appendChild(mk(a.label, a.fn, a.cls)); });
      acts.appendChild(mk('Close', close));
      box.appendChild(acts);
      modal.hidden = false;
    }
    function close() { modal.hidden = true; }
    render();
    return { render: render, open: open, close: close, box: function () { return box; } };
  }
  window.VisitCal = { mount: mount, state: state, windowOf: windowOf, LABEL: LABEL, COLOR: COLOR };
})();
