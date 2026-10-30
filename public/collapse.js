/* Every card / panel folds: click its heading to collapse or expand. The choice is remembered per page and heading on this device. */
(function () {
  var SEL = 'section.card, .panel, .info';
  function key(card, h) { return 'fold:' + location.pathname + ':' + (card.id || '') + ':' + h.textContent.trim().replace(/\s+/g, ' ').slice(0, 60); }
  function headOf(card) {
    var h = card.querySelector('h2, h3'); if (!h) return null;
    var top = h; while (top.parentElement && top.parentElement !== card) top = top.parentElement;
    if (top.parentElement !== card || top !== card.firstElementChild) return null; // heading must sit at the top of the card
    return { h: h, top: top };
  }
  // a panel that appears on its own among cards already on the page (Edit order, Add customer, a PIN…) opens;
  // when a whole page renders (every card is new) its panels start collapsed
  function apply(card, pageRender) {
    var f = headOf(card); if (!f || card.hasAttribute('data-nofold')) { card.removeAttribute('data-fold'); return; }
    card.setAttribute('data-fold', '1'); f.top.classList.add('fold-head'); f.h.classList.add('fold-h');
    if (card.dataset.foldInit) return; card.dataset.foldInit = '1';
    var saved = null; try { saved = localStorage.getItem(key(card, f.h)); } catch (e) {}
    var openDefault = false; try { openDefault = localStorage.getItem('foldDefault') === 'open'; } catch (e) {}
    var folded = saved === null ? (pageRender && !openDefault && !card.hasAttribute('data-fold-open')) : saved === '1';
    card.classList.toggle('folded', folded);
    f.h.setAttribute('aria-expanded', folded ? 'false' : 'true');
  }
  // which cards are "page" cards (start collapsed) vs. a panel you asked for by clicking (opens):
  // a single new card right after a click somewhere in the page content is an action panel; everything else is a page render
  var lastAction = 0;
  document.addEventListener('click', function (e) { lastAction = e.target.closest('aside, header.head, nav, [data-nav], [data-invtab], .seg, .rnav, .jump, .navtoggle, .fold-h, .login, .mtop') ? 0 : Date.now(); }, true);
  function scan() {
    var all = [].slice.call(document.querySelectorAll(SEL)), fresh = all.filter(function (c) { return !c.dataset.foldInit; });
    var action = fresh.length === 1 && Date.now() - lastAction < 2500;
    all.forEach(function (c) { apply(c, !action); });
  }
  document.addEventListener('click', function (e) {
    var h = e.target.closest('.fold-h'); if (!h) return;
    if (e.target.closest('button, a, input, select, label')) return;
    var card = h.closest(SEL); if (!card) return;
    var folded = card.classList.toggle('folded');
    h.setAttribute('aria-expanded', folded ? 'false' : 'true');
    try { localStorage.setItem(key(card, h), folded ? '1' : '0'); } catch (x) {}
  });
  // jumping to a card (the pills at the top, a #hash link, a deep link) opens it instead of landing on a folded header
  function unfold(card) {
    if (!card || !card.classList.contains('folded')) return;
    card.classList.remove('folded'); var h = card.querySelector('.fold-h'); if (h) { h.setAttribute('aria-expanded', 'true'); try { localStorage.setItem(key(card, h), '0'); } catch (x) {} }
  }
  function openTarget(hash) {
    if (!hash || hash.length < 2) return; var id = hash.slice(1), target; try { target = document.getElementById(id); } catch (e) { return; }
    if (!target) return;
    var card = target.closest(SEL + '[data-fold]') || (target.matches(SEL) ? target : null); unfold(card);
    [].slice.call(target.querySelectorAll(SEL + '[data-fold]')).slice(0, 1).forEach(unfold); // a group whose first card is folded
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]'); if (!a || a.closest('.fold-h')) return;
    var hash = a.getAttribute('href'); if (hash === '#' || /^#(hub-|refresh)/.test(hash)) return;
    openTarget(hash); setTimeout(function () { openTarget(hash); }, 80); // after any render the click triggers
  });
  // the pill bar works like tabs: the pill you pick lights up and its card opens; picking another closes the last one and opens the next
  function fold(card) {
    if (!card || card.classList.contains('folded') || !card.hasAttribute('data-fold')) return;
    card.classList.add('folded'); var h = card.querySelector('.fold-h'); if (h) { h.setAttribute('aria-expanded', 'false'); try { localStorage.setItem(key(card, h), '1'); } catch (x) {} }
  }
  var pillLast = null;
  document.addEventListener('click', function (e) {
    var a = e.target.closest('.jump a[href^="#"]'); if (!a) return;
    var hash = a.getAttribute('href'); if (hash === '#' || /^#(hub-|refresh)/.test(hash)) return;
    var bar = a.closest('.jump'); [].forEach.call(bar.querySelectorAll('a.on'), function (x) { if (x !== a) x.classList.remove('on'); }); a.classList.add('on');
    if (pillLast && pillLast !== hash) { var prev = document.getElementById(pillLast.slice(1)); if (prev) { var pc = prev.closest(SEL + '[data-fold]') || (prev.matches(SEL) ? prev : null); fold(pc); [].slice.call(prev.querySelectorAll(SEL + '[data-fold]')).forEach(fold); } }
    pillLast = hash;
  });
  window.addEventListener('hashchange', function () { openTarget(location.hash); });
  if (location.hash) setTimeout(function () { openTarget(location.hash); }, 400);
  var t = null;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(scan, 60); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  // the left menu folds too: a « / » button at its top; collapsed by default, remembered on this device
  function sideEl() { return document.querySelector('aside.side') || (document.body.classList.contains('side-layout') ? document.querySelector('header.head') : null); }
  function setNav(collapsed) { document.body.classList.toggle('nav-collapsed', collapsed); var b = document.querySelector('.navtoggle'); if (b) { b.textContent = collapsed ? '»' : '«'; b.title = collapsed ? 'Show the menu' : 'Hide the menu'; b.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); } try { localStorage.setItem('navCollapsed', collapsed ? '1' : '0'); } catch (e) {} }
  function navInit() {
    var side = sideEl(); if (!side || side.querySelector('.navtoggle')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'navtoggle'; b.setAttribute('aria-label', 'Menu');
    b.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-collapsed')); });
    side.insertBefore(b, side.firstChild);
    var saved = null; try { saved = localStorage.getItem('navCollapsed'); } catch (e) {}
    setNav(saved === null ? true : saved === '1');
  }
  new MutationObserver(navInit).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', navInit); else navInit();
  // wide tables: a second sideways scrollbar at the TOP of the table (the real one sits at the bottom, often off screen)
  // phones: a table too wide for the screen turns each row into a card — every value labelled with its column name, fields wrap, no sideways scroll
  var FLIP_W = 760;
  (function () { var st = document.createElement('style'); st.textContent =
    'table.flip,table.flip>tbody,table.flip>thead,table.flip>tfoot{display:block;width:100%;min-width:0!important}' +
    'table.flip tr{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,7.5rem),1fr));gap:6px 12px;padding:10px 12px;margin:0 0 8px;border:1px solid var(--line,#dde3ec);border-radius:12px;background:var(--panel,var(--card,#fff))}' +
    'table.flip tr.fliphead{display:none}' +
    'table.flip td,table.flip tbody th{display:block;border:0!important;padding:0!important;text-align:left!important;white-space:normal!important;min-width:0!important;width:auto!important;max-width:100%;overflow-wrap:anywhere;background:none}' +
    'table.flip td[data-label]:not([data-label=""])::before,table.flip tbody th[data-label]:not([data-label=""])::before{content:attr(data-label);display:block;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:2px}' +
    'table.flip td:first-child,table.flip td.flipwide{grid-column:1/-1}table.flip td:empty{display:none}' +
    'table.flip input:not([type=checkbox]):not([type=radio]),table.flip select,table.flip textarea{width:100%!important;min-width:0!important}';
    (document.head || document.documentElement).appendChild(st); })();
  function headCells(t) {
    var hr = t.tHead && t.tHead.rows[0] ? t.tHead.rows[0] : null;
    if (!hr) { var r0 = t.rows[0]; if (r0 && r0.cells.length && [].every.call(r0.cells, function (c) { return c.tagName === 'TH'; })) hr = r0; }
    if (!hr) return null;
    var out = []; [].forEach.call(hr.cells, function (c) { var n = c.colSpan || 1, txt = (c.textContent || '').replace(/\s+/g, ' ').trim(); for (var i = 0; i < n; i++) out.push(txt); });
    return { row: hr, labels: out };
  }
  function flipTables() {
    var narrow = window.innerWidth <= FLIP_W;
    [].slice.call(document.querySelectorAll('table')).forEach(function (t) {
      if (t.hasAttribute('data-noflip') || t.closest('[data-noflip]')) return;
      if (!narrow) { if (t.classList.contains('flip')) t.classList.remove('flip'); return; }
      if (!t.offsetParent && !t.classList.contains('flip')) return;
      var h = headCells(t); if (!h) return;
      if (!t.classList.contains('flip')) { var box = t.parentElement; if (!box || t.scrollWidth <= box.clientWidth + 4) return; t.classList.add('flip'); }
      h.row.classList.add('fliphead');
      [].forEach.call(t.rows, function (r) {
        if (r === h.row) return; var col = 0;
        [].forEach.call(r.cells, function (c) { if (!c.hasAttribute('data-label')) c.setAttribute('data-label', (c.colSpan || 1) > 1 ? '' : (h.labels[col] || '')); col += c.colSpan || 1; });
      });
    });
  }
  var TW = '.tblwrap, .scroll';
  function topbars() {
    flipTables();
    [].slice.call(document.querySelectorAll(TW)).forEach(function (w) {
      var wide = w.scrollWidth > w.clientWidth + 2, bar = w.previousElementSibling && w.previousElementSibling.classList.contains('hbar') ? w.previousElementSibling : null;
      if (!wide) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'hbar'; bar.setAttribute('aria-hidden', 'true'); bar.style.cssText = 'overflow-x:auto;overflow-y:hidden;height:14px;margin:0 0 2px';
        var inner = document.createElement('div'); inner.style.height = '1px'; bar.appendChild(inner);
        w.parentNode.insertBefore(bar, w);
        var lock = false;
        bar.addEventListener('scroll', function () { if (lock) return; lock = true; w.scrollLeft = bar.scrollLeft; lock = false; });
        w.addEventListener('scroll', function () { if (lock) return; lock = true; bar.scrollLeft = w.scrollLeft; lock = false; });
      }
      bar.firstChild.style.width = w.scrollWidth + 'px'; bar.style.width = w.clientWidth + 'px';
    });
  }
  var tb = null;
  new MutationObserver(function () { clearTimeout(tb); tb = setTimeout(topbars, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', function () { clearTimeout(tb); tb = setTimeout(topbars, 120); });
  document.addEventListener('click', function () { clearTimeout(tb); tb = setTimeout(topbars, 160); }, true); // opening a folded card or a tab shows tables that were hidden
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', topbars); else setTimeout(topbars, 300);
  // "fold all / open all" helper for the keyboard: Alt+Shift+C toggles every card on the page
  document.addEventListener('keydown', function (e) {
    if (!(e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c'))) return;
    var cards = [].slice.call(document.querySelectorAll(SEL + '[data-fold]')), anyOpen = cards.some(function (c) { return !c.classList.contains('folded'); });
    cards.forEach(function (c) { c.classList.toggle('folded', anyOpen); var h = c.querySelector('.fold-h'); if (h) { h.setAttribute('aria-expanded', anyOpen ? 'false' : 'true'); try { localStorage.setItem(key(c, h), anyOpen ? '1' : '0'); } catch (x) {} } });
  });
})();
