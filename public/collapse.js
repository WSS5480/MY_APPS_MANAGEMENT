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
  function apply(card) {
    var f = headOf(card); if (!f) { card.removeAttribute('data-fold'); return; }
    card.setAttribute('data-fold', '1'); f.top.classList.add('fold-head'); f.h.classList.add('fold-h');
    var saved = null; try { saved = localStorage.getItem(key(card, f.h)); } catch (e) {}
    card.classList.toggle('folded', saved === '1');
    f.h.setAttribute('aria-expanded', saved === '1' ? 'false' : 'true');
  }
  function scan() { document.querySelectorAll(SEL).forEach(apply); }
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
  // "fold all / open all" helper for the keyboard: Alt+Shift+C toggles every card on the page
  document.addEventListener('keydown', function (e) {
    if (!(e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c'))) return;
    var cards = [].slice.call(document.querySelectorAll(SEL + '[data-fold]')), anyOpen = cards.some(function (c) { return !c.classList.contains('folded'); });
    cards.forEach(function (c) { c.classList.toggle('folded', anyOpen); var h = c.querySelector('.fold-h'); if (h) { h.setAttribute('aria-expanded', anyOpen ? 'false' : 'true'); try { localStorage.setItem(key(c, h), anyOpen ? '1' : '0'); } catch (x) {} } });
  });
})();
