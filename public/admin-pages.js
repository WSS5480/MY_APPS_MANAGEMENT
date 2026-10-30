/* Admin as pages, like the tracker: pills on top, and the menu on the left grouped Rep / Manager / Admin. Each item shows only its own cards;
   tapping the lit pill again goes back to the first page. Not used in embed mode (the store shows single cards from here). */
(function () {
  'use strict';
  if (document.body.classList.contains('embed') || /[?&]embed=1/.test(location.search)) return;
  var PAGES = [
    { k: 'wcu', l: '📝 WCU', g: 'Rep', ids: ['sec-wcu'] },
    { k: 'visits', l: 'Visits', g: 'Rep', ids: ['visits'] },
    { k: 'logins', l: '🔐 Login activity', g: 'Rep', ids: ['sec-logins', 'sec-activity'] },
    { k: 'reps', l: 'Reps & plans', g: 'Manager', ids: ['reps-pointer', 'reps-card'] },
    { k: 'surgeons', l: 'Surgeons', g: 'Manager', ids: ['surgeons'] },
    { k: 'facilities', l: 'Facilities', g: 'Manager', ids: ['facilities'] },
    { k: 'products', l: 'Products & prices', g: 'Manager', ids: ['products', 'pricebook'] },
    { k: 'import', l: '⬆ Import history', g: 'Manager', ids: ['sec-import'] },
    { k: 'managers', l: 'Managers & sign-in', g: 'Admin', ids: ['managers', 'mysign', 'sec-signin-links', 'pin-card'] },
    { k: 'settings', l: 'Settings', g: 'Admin', ids: ['sec-alerts', 'geo-card', 'sec-close', 'sec-digest'] },
    { k: 'mail', l: 'Approval emails', g: 'Admin', ids: ['mail-card'] },
    { k: 'backup', l: 'Backup', g: 'Admin', ids: ['sec-backup'] }
  ];
  var NAME_IDS = { 'Alert settings': 'sec-alerts', 'Close a month': 'sec-close', 'Weekly digest': 'sec-digest', 'Sign-in links': 'sec-signin-links', 'Activity': 'sec-activity', 'Backup and restore': 'sec-backup' };
  var OLD = { '#sec-wcu': 'wcu', '#sec-logins': 'logins', '#sec-import': 'import', '#managers': 'managers', '#visits': 'visits', '#surgeons': 'surgeons', '#facilities': 'facilities', '#mail-card': 'mail', '#reps-card': 'reps', '#products': 'products', '#pricebook': 'products', '#geo-card': 'settings' };
  var css = document.createElement('style');
  css.textContent = '.jump{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:6px;padding:8px 2px;margin:0 0 10px;background:var(--bg)}' +
    '.jump a{flex:none;padding:8px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--fg);font-size:.8125rem;font-weight:600;text-decoration:none;white-space:nowrap}' +
    '.jump a.on{background:var(--accent);border-color:var(--accent);color:#fff}' +
    '@media (max-width:760px){.jump{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.jump::-webkit-scrollbar{display:none}}' +
    '.pg-off{display:none!important}.navgrp{display:flex;flex-direction:column;gap:4px;width:100%}.navgrp-h{font:700 .68rem/1.3 var(--font,inherit);letter-spacing:.09em;text-transform:uppercase;opacity:.65;margin:.6rem 0 .1rem}' +
    'body:not(.side-layout) .navgrp{flex-direction:row;flex-wrap:wrap;align-items:center}body:not(.side-layout) .navgrp-h{margin:0 .2rem 0 0}' +
    '@media (max-width:760px){.navgrp{display:none!important}}'; // phones: the pills do the job
  document.head.appendChild(css);
  function start() {
    var wrap = document.querySelector('.wrap'), head = wrap && wrap.querySelector('header.head'); if (!head) return;
    // name the cards that have no id yet
    [].forEach.call(document.querySelectorAll('section.card'), function (s) { if (s.id) return; var h = s.querySelector('h2'); var n = h && NAME_IDS[h.textContent.trim()]; if (n) s.id = n; });
    var byId = {}; PAGES.forEach(function (p) { p.ids.forEach(function (id) { byId[id] = p.k; }); });
    // pills on top
    var nav = document.createElement('nav'); nav.className = 'jump'; nav.id = 'jump'; nav.setAttribute('aria-label', 'Admin pages');
    PAGES.forEach(function (p) { var a = document.createElement('a'); a.href = '#pg-' + p.k; a.textContent = p.l; a.dataset.pg = p.k; nav.appendChild(a); });
    var after = document.getElementById('hubpane') || head; after.parentNode.insertBefore(nav, after.nextSibling);
    // menu on the left, grouped by who it's for; the old one-off jump buttons give way to it
    var tools = head.querySelector('.tools');
    if (tools) {
      [].slice.call(tools.querySelectorAll('a.btn')).forEach(function (a) { var h = a.getAttribute('href') || ''; if (OLD[h] || h === '/products') a.remove(); });
      var box = document.createElement('div'); box.className = 'navgrp'; box.id = 'navgrp';
      ['Rep', 'Manager', 'Admin'].forEach(function (g) {
        var hd = document.createElement('div'); hd.className = 'navgrp-h'; hd.textContent = g; box.appendChild(hd);
        PAGES.filter(function (p) { return p.g === g; }).forEach(function (p) { var a = document.createElement('a'); a.className = 'btn'; a.href = '#pg-' + p.k; a.dataset.pg = p.k; a.textContent = p.l; box.appendChild(a); });
      });
      var openT = tools.querySelector('a[href="/"]'); tools.insertBefore(box, openT ? openT.nextSibling : tools.firstChild);
    }
    var cur = null;
    function show(k, keepScroll) {
      var page = PAGES.find(function (p) { return p.k === k; }) || PAGES[0]; cur = page.k;
      if (/^#hub-/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); if (window.hubRoute) window.hubRoute(); }
      Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) el.classList.toggle('pg-off', byId[id] !== page.k); });
      // a row (.grid) whose cards are all on other pages disappears too
      [].forEach.call(wrap.querySelectorAll(':scope > .grid'), function (g) { var cards = g.querySelectorAll(':scope > section.card'); g.classList.toggle('pg-off', cards.length > 0 && [].every.call(cards, function (c) { return c.classList.contains('pg-off'); })); });
      page.ids.forEach(function (id) { var el = document.getElementById(id); if (el && el.classList.contains('folded')) { var h = el.querySelector('.fold-h'); if (h) h.click(); else el.classList.remove('folded'); } });
      [].forEach.call(document.querySelectorAll('[data-pg]'), function (a) { a.classList.toggle('on', a.dataset.pg === page.k); });
      if (location.hash !== '#pg-' + page.k) history.replaceState(null, '', location.pathname + location.search + '#pg-' + page.k);
      if (!keepScroll) { var y = Math.max(0, Math.round(nav.getBoundingClientRect().top + window.scrollY - 4)); if (window.scrollY > y) window.scrollTo(0, y); }
      try { localStorage.setItem('adminPage', page.k); } catch (e) {}
    }
    window.AdminPage = { show: show, byId: byId };
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]'); if (!a) return; var h = a.getAttribute('href'), k = null;
      if (/^#pg-/.test(h)) k = h.slice(4); else if (OLD[h]) k = OLD[h]; else if (h.length > 1 && byId[h.slice(1)]) k = byId[h.slice(1)];
      if (!k) { if (/^#hub-/.test(h)) [].forEach.call(document.querySelectorAll('[data-pg]'), function (x) { x.classList.remove('on'); }); return; }
      e.preventDefault(); e.stopPropagation();
      if (a.closest('#jump') && k === cur && k !== PAGES[0].k) { show(PAGES[0].k); return; } // the lit pill tapped again: back to the first page
      show(k);
    }, true);
    var start = (/^#pg-(\w+)/.exec(location.hash) || [])[1] || OLD[location.hash] || (location.hash.length > 1 && byId[location.hash.slice(1)]) || null;
    if (/^#hub-/.test(location.hash)) start = null;
    var saved = null; try { saved = localStorage.getItem('adminPage'); } catch (e) {}
    if (start) show(start, true); else if (/^#hub-/.test(location.hash)) { Object.keys(byId).forEach(function () {}); cur = null; } else show(saved || PAGES[0].k, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
