/* Executive sales summary, live, for the admin Dashboard (data: /api/admin/exec). Everything wraps; no sideways tables. */
(function () {
  'use strict';
  var css = document.createElement('style');
  css.textContent =
    '.ex{display:grid;gap:12px;margin-bottom:14px}' +
    '.ex-band{border-radius:16px;padding:18px 20px;background:linear-gradient(120deg,#07173a 0%,#0b2a5c 55%,#0b4d96 100%);color:#fff;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:12px 24px;box-shadow:0 12px 30px -16px rgba(7,23,58,.8)}' +
    '.ex-band h2{margin:0;font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-.01em}' +
    '.ex-band .sub{color:#c7d8f2;font-size:.9rem;margin-top:4px}.ex-band .conf{color:#8fc6ff;font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-top:6px}' +
    '.ex-band .big{border-left:2px solid rgba(143,198,255,.6);padding-left:16px}.ex-band .big b{font-size:1.45rem;font-weight:800;display:block}.ex-band .big span{color:#d8e4f6;font-size:.9rem}' +
    '.ex-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,9.5rem),1fr));gap:10px}' +
    '.ex-k{border:1px solid var(--line,#dde3ec);border-top:3px solid #0b4d96;border-radius:12px;padding:12px 14px;background:var(--panel,#fff);min-width:0}' +
    '.ex-k .l{font-size:.68rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5d6879)}.ex-k .v{font-size:1.6rem;font-weight:800;margin:4px 0 2px;font-variant-numeric:tabular-nums}.ex-k .s{font-size:.82rem;color:var(--muted,#5d6879)}' +
    '.ex-tag{display:inline-block;font-size:.7rem;font-weight:800;padding:2px 8px;border-radius:999px;margin-right:4px}.ex-tag.bad{background:#fde4e4;color:#b42318}.ex-tag.ok{background:#dff5e8;color:#15734a}' +
    '.ex-panel{border:1px solid var(--line,#dde3ec);border-radius:14px;padding:12px 14px;background:var(--hl,#f3f7fc)}' +
    '.ex-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:0 0 8px}.ex-h b{font-size:1.02rem}.ex-h span{font-size:.8rem;color:var(--muted,#5d6879)}' +
    '.ex-rank{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr));gap:10px 14px}' +
    '.ex-rk{display:grid;grid-template-columns:1.6rem 1fr;gap:2px 8px;align-items:center;min-width:0}.ex-rk .n{grid-row:span 3;width:1.5rem;height:1.5rem;border-radius:50%;background:#0f1b33;color:#fff;font-size:.75rem;font-weight:800;display:grid;place-items:center}.ex-rk:first-child .n{background:#0b4d96}' +
    '.ex-rk .nm{font-weight:700;font-size:.85rem;overflow-wrap:anywhere}.ex-rk .m{font-size:.74rem;color:var(--muted,#5d6879)}' +
    '.ex-bar{position:relative;height:7px;border-radius:99px;background:var(--line,#e3e8ef)}.ex-bar i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:#d64545;width:0;transition:width 1s cubic-bezier(.2,.8,.2,1)}.ex-bar i.ok{background:#1f9d63}.ex-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#0f1b33;border-radius:2px}' +
    '.ex-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:10px}' +
    '.ex-c{border:1px solid var(--line,#dde3ec);border-radius:14px;padding:12px 14px;background:var(--panel,#fff);display:flex;flex-direction:column;gap:6px;min-width:0}' +
    '.ex-c.team{background:var(--hl,#eef4fb);border-color:#b9cde6}' +
    '.ex-c .top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.ex-c .who{display:flex;gap:8px;align-items:flex-start;min-width:0}.ex-c .who b{font-size:1.02rem;display:block}.ex-c .who small{color:var(--muted,#5d6879);font-size:.76rem}' +
    '.ex-c .num{width:1.5rem;height:1.5rem;flex:none;border-radius:50%;background:#0f1b33;color:#fff;font-size:.75rem;font-weight:800;display:grid;place-items:center;margin-top:2px}' +
    '.ex-c .hero{font-size:1.45rem;font-weight:800;font-variant-numeric:tabular-nums}.ex-c .hero small{font-size:.8rem;font-weight:500;color:var(--muted,#5d6879)}' +
    '.ex-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 10px}.ex-g div{min-width:0}.ex-g .l{font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5d6879)}.ex-g .v{font-weight:700;font-variant-numeric:tabular-nums}' +
    '.ex-c .foot{font-size:.78rem;color:var(--muted,#5d6879);border-top:1px solid var(--line,#e3e8ef);padding-top:6px;margin-top:auto}' +
    '.ex-low{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:10px}' +
    '.ex-mix{display:grid;grid-template-columns:minmax(0,1fr) 5rem auto;gap:6px 10px;align-items:center;font-size:.85rem}.ex-mix b{overflow-wrap:anywhere}.ex-mix .bar{height:7px;border-radius:99px;background:#0b8fd8}' +
    '.ex-att{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:.85rem}.ex-att li{display:grid;grid-template-columns:.6rem 1fr;gap:8px}.ex-att li:before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:#e2a10f;margin-top:.4rem}.ex-att li.info:before{background:#1f8fe0}' +
    '.ex-comp{display:grid;gap:6px;font-size:.85rem}.ex-comp div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 10px;border-bottom:1px solid var(--line,#e3e8ef);padding-bottom:5px}.ex-comp div.t{font-weight:800;border:0}.ex-comp span{color:var(--muted,#5d6879)}' +
    '@media (max-width:520px){.ex-g{grid-template-columns:repeat(2,minmax(0,1fr))}.ex-band h2{font-size:1.25rem}}';
  document.head.appendChild(css);
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $$ = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function bar(v, t, tick, ok) { var w = t ? Math.min(100, v / t * 100) : 0; return '<div class="ex-bar"><i class="' + (ok ? 'ok' : '') + '" data-w="' + w + '"></i>' + (tick != null ? '<u style="left:calc(' + Math.min(100, tick) + '% - 1px)"></u>' : '') + '</div>'; }
  function val(r, n) { return r.metric === 'Cases' ? n + ' case' + (n === 1 ? '' : 's') : $$(n); }

  window.ExecHTML = function (x) {
    var c = x.company, mName = MON[Number(x.month.slice(5, 7)) - 1], tick = x.biz.total ? x.biz.elapsed / x.biz.total * 100 : null;
    var asOf = new Date(x.today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    var k = function (l, v, s) { return '<div class="ex-k"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
    var status = function (behind) { return '<span class="ex-tag ' + (behind ? 'bad' : 'ok') + '">' + (behind ? 'Behind' : 'On track') + '</span>'; };
    var h = '<div class="ex">' +
      '<div class="ex-band"><div><h2>Executive Sales Summary</h2><div class="sub">' + esc(mName) + ' ' + x.month.slice(0, 4) + ' · as of ' + esc(asOf) + ' · business day ' + x.biz.elapsed + ' of ' + x.biz.total + '</div><div class="conf">Confidential · leadership only · includes compensation estimates</div></div>' +
      '<div class="big"><b>' + $$(c.mtd) + (c.target ? ' of ' + $$(c.target) : '') + '</b><span>' + (c.pct != null ? Math.round(c.pct) + '% of the company quota for ' + esc(mName) + ' with ' + Math.round(tick || 0) + '% of the month gone; ' : '') + $$(c.run_rate) + ' run-rate projection. ' + c.new_surgeons_q + ' new surgeon' + (c.new_surgeons_q === 1 ? '' : 's') + ' won this quarter.</span></div></div>' +
      '<div class="ex-kpis">' +
        k('Net sales · ' + esc(mName), $$(c.mtd), c.target ? Math.round(c.pct) + '% of ' + $$(c.target) + ' company quota' : 'No company quota set') +
        k('Run-rate projection', $$(c.run_rate), (c.target ? status(c.behind) : '') + (c.to_go ? $$(c.to_go) + ' to go' : c.target ? 'Quota reached' : 'At today\'s daily pace')) +
        k('Quarter to date · ' + esc(x.quarter), $$(c.qtd), c.q_target ? 'of ' + $$(c.q_target) + ' quarter quota (' + Math.round(c.qtd / c.q_target * 100) + '%)' : '') +
        k('New surgeons won · ' + esc(x.quarter.split(' ')[0]), c.new_surgeons_q, c.targets ? c.targets_won + ' of ' + c.targets + ' target surgeons converted' : 'Surgeons with a first case this quarter') +
        k('Cases completed', c.cases, c.surgeons + ' surgeon' + (c.surgeons === 1 ? '' : 's') + ' · ' + c.new_share + '% of sales from new surgeons') +
        k('New-surgeon cases completed', c.new_cases, c.cases ? Math.round(c.new_cases / c.cases * 100) + '% of ' + c.cases + ' cases this month' : 'None this month') +
      '</div>';
    // ranking strip
    h += '<div class="ex-panel"><div class="ex-h"><b>Rep ranking · ' + esc(mName) + '</b><span>Ranked by % to target (quota attainment); ties broken by net sales.</span></div><div class="ex-rank">' +
      x.reps.map(function (r) { return '<div class="ex-rk"><span class="n">' + r.rank + '</span><span class="nm">' + esc(r.rep) + '</span>' + bar(r.actual, r.target, tick, r.pct >= 100) + '<span class="m"><b>' + (r.pct == null ? '—' : Math.round(r.pct) + '%') + '</b> · ' + (r.metric === 'Cases' ? r.actual + ' cases' : $$(r.sales)) + ' · ' + r.new_surgeons_q + ' new</span></div>'; }).join('') + '</div></div>';
    // rep performance cards
    h += '<div class="ex-h" style="margin-top:4px"><b style="font-size:1.15rem">Rep performance · ' + esc(mName) + ' ' + x.month.slice(0, 4) + '</b><span>cards in rank order</span></div><div class="ex-cards">' +
      x.reps.map(function (r) {
        var g = function (l, v) { return '<div><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; };
        return '<div class="ex-c"><div class="top"><div class="who"><span class="num">' + r.rank + '</span><div><b>' + esc(r.rep) + '</b><small>' + esc([r.role, r.territory && r.territory !== r.rep ? r.territory : ''].filter(Boolean).join(' · ')) + (r.counts !== 'All' ? ' · ' + esc(r.counts) : '') + '</small></div></div>' + (r.target ? status(r.behind) : '<span class="ex-tag" style="background:#eef1f5;color:#5d6879">No quota</span>') + '</div>' +
          '<div class="hero">' + val(r, r.actual) + ' <small>' + (r.target ? 'of ' + val(r, r.target) + ' · ' + Math.round(r.pct) + '%' : '') + '</small></div>' + (r.target ? bar(r.actual, r.target, tick, r.pct >= 100) : '') +
          '<div class="ex-g">' + g('Run-rate projection', val(r, r.run_rate)) + g('Needed / day', r.needed_day == null ? '—' : val(r, r.needed_day)) + g('Cases', r.cases) +
            g('New-surgeon cases', r.new_cases) + g('New surgeons · ' + esc(x.quarter.split(' ')[0]), r.new_surgeons_q) + g('QTD', val(r, r.qtd)) + g('Targets won', r.targets ? r.targets_won + ' of ' + r.targets : '—') + (r.metric === 'Cases' ? g('Net sales', $$(r.sales)) : '') + '</div>' +
          '<div class="foot">' + (r.top_surgeon ? 'Top surgeon ' + esc(r.top_surgeon.name) + ' (' + r.top_surgeon.n + ' case' + (r.top_surgeon.n === 1 ? '' : 's') + ')' + (r.top_product ? ' · top product ' + esc(r.top_product.name) : '') + '.' : 'No cases logged this month.') + '</div></div>';
      }).join('') +
      (c.target ? '<div class="ex-c team"><div class="top"><div class="who"><div><b>Team total' + (x.teams.length ? ' · ' + esc(x.teams.map(function (t) { return t.territory || t.name; }).join(' + ')) : '') + '</b><small>All ' + x.reps.length + ' reps</small></div></div>' + status(c.behind) + '</div>' +
        '<div class="hero">' + $$(c.mtd) + ' <small>of ' + $$(c.target) + ' · ' + Math.round(c.pct) + '%</small></div>' + bar(c.mtd, c.target, tick, c.pct >= 100) +
        '<div class="ex-g"><div><div class="l">Run-rate projection</div><div class="v">' + $$(c.run_rate) + '</div></div><div><div class="l">Needed / day</div><div class="v">' + $$(c.needed_day) + '</div></div><div><div class="l">Cases</div><div class="v">' + c.cases + '</div></div>' +
        '<div><div class="l">New-surgeon cases</div><div class="v">' + c.new_cases + '</div></div><div><div class="l">New surgeons · ' + esc(x.quarter.split(' ')[0]) + '</div><div class="v">' + c.new_surgeons_q + '</div></div><div><div class="l">QTD</div><div class="v">' + $$(c.qtd) + '</div></div><div><div class="l">Targets won</div><div class="v">' + c.targets_won + ' of ' + c.targets + '</div></div></div>' +
        (x.teams.length ? '<div class="foot">' + x.teams.map(function (t) { return esc(t.territory || t.name) + ' ' + $$(t.actual) + (t.target ? ' of ' + $$(t.target) + ' (' + Math.round(t.pct) + '%)' : ''); }).join(' · ') + '</div>' : '') + '</div>' : '') +
      '</div>';
    // bottom: product mix (from approved invoices), what needs attention, compensation
    var mx = x.mix, mmax = mx.reduce(function (m, r) { return Math.max(m, r.amount); }, 0);
    var comp = x.reps.filter(function (r) { return r.comm.est_pay != null || r.comm.commission; }), ct = comp.reduce(function (t, r) { return { c: t.c + (r.comm.commission || 0), g: t.g + (r.comm.guaranteed || 0), e: t.e + (r.comm.est_pay || 0) }; }, { c: 0, g: 0, e: 0 });
    h += '<div class="ex-low">' +
      '<div class="ex-c"><div class="ex-h"><b>Product mix · ' + esc(mName) + '</b><span>From approved invoices · amount · invoices</span></div>' +
        (mx.length ? '<div class="ex-mix">' + mx.map(function (r) { return '<b>' + esc(r.product) + '</b><div class="bar" style="width:' + Math.max(4, r.amount / mmax * 100) + '%"></div><span>' + $$(r.amount) + ' · ' + r.n + '</span>'; }).join('') + '</div>' : '<p class="note" style="margin:0">No approved invoices on this month\'s cases yet. Reps add them on each case (Case log → Invoice); they show here once you approve them.</p>') +
        (x.mix_missing ? '<p class="note" style="margin:6px 0 0">' + x.mix_missing + ' completed case' + (x.mix_missing === 1 ? '' : 's') + ' this month without an approved invoice.</p>' : '') + '</div>' +
      '<div class="ex-c"><div class="ex-h"><b>What needs attention</b><span>From the tracker\'s pace alerts</span></div>' + (x.attention.length ? '<ul class="ex-att">' + x.attention.map(function (a) { return '<li class="' + (a.tone === 'info' ? 'info' : '') + '">' + esc(a.text) + '</li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">✓ Nothing flagged.</p>') + '</div>' +
      '<div class="ex-c"><div class="ex-h"><b>Compensation exposure · estimates</b><span>Month to date; commission only above each rep\'s floor.</span></div><div class="ex-comp">' +
        comp.map(function (r) { return '<div><b>' + esc(r.rep) + '</b><span>Commission ' + $$(r.comm.commission) + ' · guaranteed ' + (r.comm.guaranteed ? $$(r.comm.guaranteed) : '—') + '</span><b>' + (r.comm.est_pay == null ? '—' : $$(r.comm.est_pay)) + '</b></div>'; }).join('') +
        '<div class="t"><span style="color:inherit">Total</span><span>Commission ' + $$(ct.c) + ' · guaranteed ' + $$(ct.g) + '</span><span style="color:inherit">' + $$(ct.e) + '</span></div></div></div>' +
      '</div>' +
      '<p class="note" style="margin:0"><b>How to read this.</b> Target = monthly quota plus any shortfall carried from earlier in the quarter; the black tick is where the month is today. Run-rate projection = month-end at today\'s daily pace. Completed and invoiced cases count; scheduled and cancelled do not. Business days are Monday to Friday. Commission estimates follow each plan and are not payroll figures.</p></div>';
    return h;
  };
  window.ExecAnimate = function (root) { requestAnimationFrame(function () { requestAnimationFrame(function () { [].forEach.call(root.querySelectorAll('.ex-bar i'), function (i) { i.style.width = i.dataset.w + '%'; }); }); }); };
})();
