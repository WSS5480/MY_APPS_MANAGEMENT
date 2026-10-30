/* Leaderboard: reps ranked by % to their own quota this month, with month-to-date sales.
   Tracker: its own card on the Dashboard page, right under the tiles. Admin: on top of the Dashboard. Refreshes every 2 minutes. */
(function () {
  'use strict';
  if (/[?&]embed=1/.test(location.search)) return;
  var css = document.createElement('style');
  css.textContent =
    '#sec-leader{padding:0;overflow:hidden;border:0;background:linear-gradient(135deg,#07173a 0%,#0b4d96 62%,#1a6fc4 100%);color:#fff;box-shadow:0 10px 30px -12px rgba(11,77,150,.55)}' +
    '#sec-leader .lb-h{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:6px 14px;padding:16px 18px 10px}' +
    '#sec-leader .lb-t{font:800 1.15rem/1.2 inherit;letter-spacing:.01em;margin:0;color:#fff}' +
    '#sec-leader .lb-s{font-size:.78rem;color:#c7d8f2;letter-spacing:.04em;text-transform:uppercase;font-weight:700}' +
    '#sec-leader .lb-list{display:grid;gap:8px;padding:4px 12px 14px}' +
    '#sec-leader .lb-r{position:relative;display:grid;grid-template-columns:2.4rem minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(2px)}' +
    '#sec-leader .lb-r.me{background:rgba(255,255,255,.16);border-color:rgba(143,198,255,.8);box-shadow:0 0 0 1px rgba(143,198,255,.35) inset}' +
    '#sec-leader .lb-r.r1{background:linear-gradient(90deg,rgba(255,206,84,.22),rgba(255,255,255,.07) 60%);border-color:rgba(255,206,84,.55)}' +
    '#sec-leader .lb-k{width:2.2rem;height:2.2rem;border-radius:50%;display:grid;place-items:center;font:800 .95rem/1 inherit;background:rgba(255,255,255,.12);color:#fff;grid-row:span 2}' +
    '#sec-leader .r1 .lb-k{background:linear-gradient(145deg,#ffe08a,#e7a913);color:#4a3200;box-shadow:0 0 14px rgba(255,206,84,.6)}' +
    '#sec-leader .r2 .lb-k{background:linear-gradient(145deg,#f1f4f8,#a9b4c2);color:#26303d}' +
    '#sec-leader .r3 .lb-k{background:linear-gradient(145deg,#f0c39a,#b06a33);color:#3b1e06}' +
    '#sec-leader .lb-n{font-weight:700;font-size:.98rem;min-width:0;overflow-wrap:anywhere;display:flex;flex-wrap:wrap;align-items:center;gap:6px}' +
    '#sec-leader .lb-you{font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:#8fc6ff;color:#07173a}' +
    '#sec-leader .lb-p{font:800 1.35rem/1 inherit;text-align:right;grid-row:span 2;font-variant-numeric:tabular-nums}' +
    '#sec-leader .lb-p small{display:block;font-size:.66rem;font-weight:700;letter-spacing:.06em;color:#c7d8f2;text-transform:uppercase;margin-top:3px}' +
    '#sec-leader .lb-p.hit{color:#7ef0b0}' +
    '#sec-leader .lb-b{grid-column:2;position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.14);overflow:visible}' +
    '#sec-leader .lb-f{position:absolute;inset:0 auto 0 0;width:0;border-radius:999px;background:linear-gradient(90deg,#8fc6ff,#ffffff);transition:width 1.1s cubic-bezier(.2,.8,.2,1)}' +
    '#sec-leader .r1 .lb-f{background:linear-gradient(90deg,#ffd166,#fff3c4)}' +
    '#sec-leader .lb-f.hit{background:linear-gradient(90deg,#34d399,#bbf7d0)}' +
    '#sec-leader .lb-pace{position:absolute;top:-4px;bottom:-4px;width:2px;border-radius:2px;background:#ffd166;opacity:.9}' +
    '#sec-leader .lb-m{grid-column:2;font-size:.8rem;color:#d8e4f6;display:flex;flex-wrap:wrap;gap:2px 12px;font-variant-numeric:tabular-nums}' +
    '#sec-leader .lb-m b{color:#fff}' +
    '#sec-leader .lb-key{padding:0 18px 14px;font-size:.74rem;color:#c7d8f2;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}' +
    '#sec-leader .lb-key i{display:inline-block;width:2px;height:12px;background:#ffd166;margin-right:5px;vertical-align:-2px}' +
    '#sec-leader .lb-empty{padding:4px 18px 18px;color:#d8e4f6}' +
    '@media (max-width:520px){#sec-leader .lb-r{grid-template-columns:2rem minmax(0,1fr) auto;padding:9px 10px;gap:4px 9px}#sec-leader .lb-k{width:1.9rem;height:1.9rem;font-size:.85rem}#sec-leader .lb-p{font-size:1.1rem}}';
  document.head.appendChild(css);

  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  var box = null;

  function place() {
    if (box) return box;
    box = document.createElement('section'); box.className = 'card'; box.id = 'sec-leader'; box.setAttribute('data-nofold', '');
    var tiles = document.getElementById('tiles'), dash = document.getElementById('sec-dash');
    if (tiles && tiles.parentNode) { tiles.parentNode.insertBefore(box, tiles.nextSibling); box.classList.toggle('pg-off', tiles.classList.contains('pg-off')); } // tracker: under the Dashboard tiles (its page)
    else if (dash && dash.parentNode) { dash.parentNode.insertBefore(box, dash); if (window.AdminPage && window.AdminPage.byId) { window.AdminPage.byId['sec-leader'] = 'dash'; box.classList.toggle('pg-off', dash.classList.contains('pg-off')); } }
    else { box = null; }
    return box;
  }

  function draw(j) {
    var b = place(); if (!b) return;
    var m = MON[Number(j.month.slice(5, 7)) - 1] || '';
    var rows = j.reps.map(function (r) {
      var pct = r.pct, hit = pct != null && pct >= 100, w = pct == null ? 0 : Math.min(100, pct);
      var detail = r.metric === 'Cases'
        ? '<span><b>' + r.actual + '</b> of ' + (r.target || '—') + ' cases</span><span>' + money(r.sales) + ' sales</span>'
        : '<span><b>' + money(r.sales) + '</b>' + (r.target ? ' of ' + money(r.target) : ' · no quota set') + '</span>' + (r.target && !hit ? '<span>' + money(r.target - r.actual) + ' to go</span>' : '') + (r.cases ? '<span>' + r.cases + ' case' + (r.cases === 1 ? '' : 's') + '</span>' : '');
      var medal = r.rank <= 3 && pct != null ? ' r' + r.rank : '';
      return '<div class="lb-r' + medal + (j.me && r.rep === j.me ? ' me' : '') + '">' +
        '<div class="lb-k">' + (r.rank === 1 && pct ? '👑' : r.rank) + '</div>' +
        '<div class="lb-n">' + esc(r.rep) + (j.me && r.rep === j.me ? '<span class="lb-you">You</span>' : '') + (hit ? '<span class="lb-you" style="background:#7ef0b0">Quota hit</span>' : '') + '</div>' +
        '<div class="lb-p' + (hit ? ' hit' : '') + '">' + (pct == null ? '—' : Math.round(pct) + '%') + '<small>to quota</small></div>' +
        '<div class="lb-b"><div class="lb-f' + (hit ? ' hit' : '') + '" data-w="' + w + '"></div>' + (j.pace ? '<div class="lb-pace" style="left:calc(' + Math.min(100, j.pace) + '% - 1px)" title="Where you should be today"></div>' : '') + '</div>' +
        '<div class="lb-m">' + detail + '</div></div>';
    }).join('');
    b.innerHTML = '<div class="lb-h"><h2 class="lb-t">🏆 Leaderboard · ' + esc(m) + '</h2><span class="lb-s">Ranked by % to quota · day ' + j.biz.elapsed + ' of ' + j.biz.total + '</span></div>' +
      (rows ? '<div class="lb-list">' + rows + '</div><div class="lb-key"><span><i></i>Pace: where everyone should be today (' + Math.round(j.pace) + '% of the month)</span></div>' : '<p class="lb-empty">No quotas set yet. Add them under Team logins → each rep\'s plan.</p>');
    requestAnimationFrame(function () { requestAnimationFrame(function () { [].forEach.call(b.querySelectorAll('.lb-f'), function (f) { f.style.width = f.dataset.w + '%'; }); }); });
  }

  function load() { return fetch('/api/leaderboard', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) draw(j); }).catch(function () {}); }
  function start() {
    if (!document.getElementById('tiles') && !document.getElementById('sec-dash')) return;
    load(); setInterval(function () { if (!document.hidden) load(); }, 2 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
