/* 360 University card on a rep's portal dashboard: how many courses are left (courses and tests live in the store's rep app). */
(function () {
  'use strict';
  if (/[?&]embed=1/.test(location.search)) return;
  function start() {
    var tiles = document.getElementById('tiles'); if (!tiles) return;
    fetch('/api/uni/mine', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ok || !j.n) return;
      var left = j.n - j.passed, box = document.createElement('section');
      box.className = 'card'; box.id = 'sec-uni'; box.setAttribute('data-nofold', '');
      box.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;border-left:4px solid ' + (j.locked ? '#9b1c1c' : left ? '#0b4d96' : '#15734a');
      box.innerHTML = '<div style="min-width:0"><div style="font-weight:800;font-size:1.05rem">🎓 360 University</div><div class="note" style="margin:2px 0 0">' +
        (left ? left + ' of ' + j.n + ' course' + (j.n === 1 ? '' : 's') + ' to finish' + (j.locked ? ' · ' + j.locked + ' locked (your admin can unlock it)' : '') : 'All ' + j.n + ' courses passed ✓') + '</div></div>' +
        '<a class="btn primary" href="/go/store?next=' + encodeURIComponent('/rep#university') + '">' + (left ? 'Open my courses' : 'Review courses') + '</a>';
      tiles.parentNode.insertBefore(box, tiles.nextSibling);
      box.classList.toggle('pg-off', tiles.classList.contains('pg-off'));
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
