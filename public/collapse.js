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
    var folded = saved === null ? (pageRender && !openDefault) : saved === '1';
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
  // "fold all / open all" helper for the keyboard: Alt+Shift+C toggles every card on the page
  document.addEventListener('keydown', function (e) {
    if (!(e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c'))) return;
    var cards = [].slice.call(document.querySelectorAll(SEL + '[data-fold]')), anyOpen = cards.some(function (c) { return !c.classList.contains('folded'); });
    cards.forEach(function (c) { c.classList.toggle('folded', anyOpen); var h = c.querySelector('.fold-h'); if (h) { h.setAttribute('aria-expanded', anyOpen ? 'false' : 'true'); try { localStorage.setItem(key(c, h), anyOpen ? '1' : '0'); } catch (x) {} } });
  });
})();
