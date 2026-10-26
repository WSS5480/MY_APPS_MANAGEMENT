/* Hover zoom for product and case photos (mouse/trackpad only; phones keep tap-to-open). */
(function () {
  'use strict';
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var SEL = '.pthumb, #pe-photos .ph img, .x-thumb img, .pc .ph img, .gal .thumbs img, img[data-zoom]';
  var box = null, img = null, cur = null;
  function make() {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:95;pointer-events:none;background:#fff;border:1px solid #D5E2EB;border-radius:12px;padding:6px;box-shadow:0 18px 50px rgba(3,18,31,.35);display:none;transition:opacity .12s ease;opacity:0';
    img = document.createElement('img'); img.alt = '';
    img.style.cssText = 'display:block;max-width:min(460px,60vw);max-height:min(460px,70vh);border-radius:8px;object-fit:contain';
    box.appendChild(img); document.body.appendChild(box);
  }
  function place(x, y) {
    var w = box.offsetWidth, h = box.offsetHeight, vw = innerWidth, vh = innerHeight;
    var left = x + 18; if (left + w > vw - 8) left = x - w - 18; if (left < 8) left = 8;
    var top = y - h / 2; top = Math.max(8, Math.min(vh - h - 8, top));
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest(SEL);
    if (!t || t.tagName !== 'IMG' || !t.src) return;
    if (!box) make();
    cur = t; img.src = t.currentSrc || t.src; box.style.display = 'block';
    requestAnimationFrame(function () { box.style.opacity = '1'; place(e.clientX, e.clientY); });
    img.onload = function () { if (cur === t) place(e.clientX, e.clientY); };
  });
  document.addEventListener('mousemove', function (e) { if (cur && box) place(e.clientX, e.clientY); });
  document.addEventListener('mouseout', function (e) {
    if (!cur) return; var to = e.relatedTarget;
    if (to && (to === cur || cur.contains(to))) return;
    if (e.target === cur || (e.target.contains && e.target.contains(cur))) { cur = null; if (box) { box.style.opacity = '0'; box.style.display = 'none'; } }
  });
  window.addEventListener('scroll', function () { if (cur && box) { cur = null; box.style.display = 'none'; } }, { passive: true });
})();
