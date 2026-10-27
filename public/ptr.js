/* Pull down to refresh, for the installed app (iPhone/Android home-screen apps don't have it).
   In a normal browser tab the browser's own pull-to-refresh is left alone. */
(function () {
  'use strict';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!standalone || !('ontouchstart' in window)) return;
  var TRIGGER = 72, MAX = 110, y0 = null, x0 = 0, pull = 0, busy = false, ind = null, arrow = null;
  function make() {
    ind = document.createElement('div'); ind.setAttribute('aria-hidden', 'true');
    ind.style.cssText = 'position:fixed;left:50%;top:0;z-index:100;width:40px;height:40px;margin-left:-20px;border-radius:50%;background:#fff;box-shadow:0 4px 14px rgba(3,18,31,.25);display:flex;align-items:center;justify-content:center;transform:translateY(-50px);opacity:0;pointer-events:none';
    arrow = document.createElement('div'); arrow.textContent = '↓';
    arrow.style.cssText = 'font:700 20px/1 Inter,system-ui,sans-serif;color:#079FE9;transition:transform .15s';
    ind.appendChild(arrow); document.body.appendChild(ind);
    var st = document.createElement('style'); st.textContent = '@keyframes ptrspin{to{transform:rotate(360deg)}}'; document.head.appendChild(st);
  }
  function scrolledInside(el) {
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
      if (el.matches && el.matches('dialog[open], .spin360, input, textarea, select, [role="dialog"], [role="alertdialog"], #install-sheet')) return true;
    }
    return false;
  }
  function draw() {
    if (!ind) make();
    var p = Math.min(pull, MAX);
    ind.style.transition = 'none'; ind.style.opacity = String(Math.min(1, p / 40));
    ind.style.transform = 'translateY(' + (p * 0.8 - 10) + 'px)';
    arrow.style.transform = p >= TRIGGER ? 'rotate(180deg)' : 'rotate(0deg)';
  }
  function reset() {
    if (!ind) return;
    ind.style.transition = 'transform .2s, opacity .2s'; ind.style.transform = 'translateY(-50px)'; ind.style.opacity = '0';
  }
  document.addEventListener('touchstart', function (e) {
    if (busy || e.touches.length !== 1 || (window.scrollY || document.documentElement.scrollTop) > 0 || scrolledInside(e.target)) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (y0 === null) return;
    var dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
    if (dy <= 0 || dx > dy) { if (pull) { pull = 0; reset(); } if (dy < 0 || dx > 12) y0 = null; return; }
    pull = dy * 0.55; draw();
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', function () {
    if (y0 === null) return; y0 = null;
    if (pull >= TRIGGER) {
      busy = true; arrow.textContent = '⟳'; arrow.style.transform = 'none'; arrow.style.animation = 'ptrspin .7s linear infinite';
      ind.style.transition = 'transform .15s'; ind.style.transform = 'translateY(24px)';
      setTimeout(function () { location.reload(); }, 250);
    } else reset();
    pull = 0;
  }, { passive: true });
})();
