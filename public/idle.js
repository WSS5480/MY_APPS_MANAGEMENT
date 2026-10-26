/* Computers: sign out after 10 minutes without activity (phones stay signed in).
   Activity in any open tab counts. The server enforces the same limit. */
(function () {
  'use strict';
  var KEY = 'sct_last_activity', lastPing = 0, limit = 0, warnBox = null;
  function now() { return Date.now(); }
  function last() { try { return Number(localStorage.getItem(KEY)) || now(); } catch (e) { return now(); } }
  function mark() {
    var t = now(); try { localStorage.setItem(KEY, String(t)); } catch (e) {}
    if (warnBox) { warnBox.remove(); warnBox = null; }
    if (t - lastPing > 60e3) { lastPing = t; fetch('/api/activity', { method: 'POST', credentials: 'same-origin' }).catch(function () {}); }
  }
  function signOut() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () { location.href = '/login?idle=1'; });
  }
  function warn(secs) {
    if (!warnBox) {
      warnBox = document.createElement('div');
      warnBox.setAttribute('role', 'alertdialog');
      warnBox.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(3,18,31,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif';
      var b = document.createElement('div'); b.style.cssText = 'background:#fff;color:#081F33;border-radius:14px;padding:22px;max-width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)';
      b.innerHTML = '<div style="font-weight:700;font-size:1.1rem;margin-bottom:6px">Still there?</div><div id="idle-msg" style="font-size:.9rem;color:#5C6E7D;margin-bottom:14px"></div>';
      var go = document.createElement('button'); go.type = 'button'; go.textContent = 'Stay signed in';
      go.style.cssText = 'font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;border:none;background:#079FE9;color:#fff;cursor:pointer';
      go.addEventListener('click', function () { lastPing = 0; mark(); });
      b.appendChild(go); warnBox.appendChild(b); document.body.appendChild(warnBox); go.focus();
    }
    var m = warnBox.querySelector('#idle-msg'); if (m) m.textContent = 'For security, this computer signs out in ' + secs + ' second' + (secs === 1 ? '' : 's') + ' because nothing has happened for a while.';
  }
  function tick() {
    if (!limit) return;
    var idle = now() - last(), left = Math.ceil((limit - idle) / 1000);
    if (idle >= limit) signOut();
    else if (left <= 60) warn(left);
    else if (warnBox) { warnBox.remove(); warnBox = null; }
  }
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    if (!me || !me.idle_min) return;
    limit = me.idle_min * 60e3; mark();
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (ev) { window.addEventListener(ev, mark, { passive: true, capture: true }); });
    var mm = 0; window.addEventListener('mousemove', function () { var t = now(); if (t - mm > 5000) { mm = t; mark(); } }, { passive: true });
    window.addEventListener('storage', function (e) { if (e.key === KEY && warnBox) { warnBox.remove(); warnBox = null; } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    setInterval(tick, 1000);
  }).catch(function () {});
})();
