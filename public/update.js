/* When a new version of the app goes live, load it: right away if the screen was away or nothing is being
   edited, otherwise show a one-tap Update bar. Fixes installed iPhone apps that keep the old page. */
(function () {
  'use strict';
  var mine = null, bar = null, last = 0;
  function busy() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value) return true;
    return !!document.querySelector('dialog[open], #editor:not([hidden]) .form, .vc-box, [role="alertdialog"]');
  }
  function show() {
    if (bar) return;
    bar = document.createElement('div'); bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:90;background:#081F33;color:#fff;border-radius:999px;padding:8px 8px 8px 16px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(3,18,31,.35);font:600 .9rem Inter,system-ui,sans-serif;max-width:calc(100% - 24px)';
    var t = document.createElement('span'); t.textContent = 'New version of the app is ready';
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Update';
    b.style.cssText = 'font:inherit;border:0;border-radius:999px;background:#079FE9;color:#fff;padding:8px 14px;cursor:pointer';
    b.addEventListener('click', function () { location.reload(); });
    bar.appendChild(t); bar.appendChild(b); document.body.appendChild(bar);
  }
  function check(fromReturn) {
    var now = Date.now(); if (now - last < 15000) return; last = now;
    fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.build) return;
      if (mine === null) { mine = j.build; return; }
      if (j.build === mine) return;
      if (fromReturn || !busy()) location.reload(); else show();
    }).catch(function () {});
  }
  check(false);
  setInterval(function () { if (!document.hidden) check(false); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { last = 0; check(!busy()); } });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { last = 0; check(true); } });
})();
