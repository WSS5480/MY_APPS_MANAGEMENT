/* Ask to install the app when the tracker is opened in a browser instead of the installed app.
   Android / Windows / Chrome / Edge: one-tap Install (only offered when the app is not installed yet).
   iPhone / iPad: Safari can't install for you, so show the Share → Add to Home Screen steps. */
(function () {
  'use strict';
  var APP = window.SCT_APP || {}; // the admin page sets its own name, icon and storage keys; the tracker uses the defaults
  var NAME = APP.name || '360 Cases', ICON = APP.icon || '/icon-192.png', BLURB = APP.blurb || 'Opens full screen, stays signed in, works offline and sends visit reminders.';
  var KEY = APP.key || 'sct_app_installed', SKIP = APP.skip || 'sct_install_later';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function get(s, k) { try { return s.getItem(k); } catch (e) { return null; } }
  function set(s, k, v) { try { s.setItem(k, v); } catch (e) {} }
  if (standalone) { set(localStorage, KEY, '1'); return; }
  if (get(localStorage, KEY) || get(sessionStorage, SKIP)) return;
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var iosSafari = ios && !/CriOS|FxiOS|EdgiOS|GSA\//.test(ua);
  var deferred = null, sheet = null;

  function close(rememberInstalled) {
    if (sheet) { sheet.remove(); sheet = null; }
    if (rememberInstalled) set(localStorage, KEY, '1'); else set(sessionStorage, SKIP, '1');
  }
  function button(text, primary, fn) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.style.cssText = 'font:inherit;font-weight:600;font-size:.9rem;padding:11px 16px;border-radius:10px;cursor:pointer;border:1px solid ' + (primary ? '#0f1b33;background:#0f1b33;color:#fff' : '#c9d1dc;background:#fff;color:#121c2f');
    b.addEventListener('click', fn); return b;
  }
  function show(kind) {
    if (sheet || document.querySelector('[role="alertdialog"]')) return;
    sheet = document.createElement('div'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Install the ' + NAME + ' app'); sheet.id = 'install-sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(15,27,51,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px;font-family:Poppins,system-ui,sans-serif';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;color:#081F33;border-radius:16px;padding:20px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);margin-bottom:env(safe-area-inset-bottom)';
    var head = document.createElement('div'); head.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:10px';
    var icon = document.createElement('img'); icon.src = ICON; icon.alt = ''; icon.style.cssText = 'width:52px;height:52px;border-radius:12px;flex:none';
    var t = document.createElement('div'); t.innerHTML = '<div style="font-weight:700;font-size:1.1rem">Get the ' + NAME + ' app</div><div style="font-size:.85rem;color:#5C6E7D">' + BLURB + '</div>';
    head.appendChild(icon); head.appendChild(t); card.appendChild(head);
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px';
    if (kind === 'ios') {
      var steps = document.createElement('ol'); steps.style.cssText = 'margin:6px 0 0;padding-left:1.2rem;font-size:.92rem;line-height:1.6';
      steps.innerHTML = '<li>Tap the <b>Share</b> button <span aria-hidden="true" style="display:inline-block;border:1.5px solid #0b4d96;border-radius:4px;padding:0 4px;color:#0b4d96;font-weight:700">↑</span> at the bottom of Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>, then open <b>' + NAME + '</b> from your home screen.</li>';
      card.appendChild(steps);
      if (!iosSafari) { var n = document.createElement('p'); n.style.cssText = 'font-size:.8rem;color:#B45309;margin:8px 0 0'; n.textContent = 'Open this page in Safari first. Other iPhone browsers can\'t add apps to the home screen.'; card.appendChild(n); }
      row.appendChild(button('Got it', true, function () { close(false); }));
    } else {
      row.appendChild(button('Install app', true, function () {
        if (!deferred) return close(false);
        deferred.prompt(); deferred.userChoice.then(function (c) { deferred = null; close(c.outcome === 'accepted'); });
      }));
      row.appendChild(button('Not now', false, function () { close(false); }));
    }
    row.appendChild(button('It\'s already installed', false, function () { close(true); }));
    card.appendChild(row); sheet.appendChild(card);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(false); });
    document.body.appendChild(sheet);
  }

  // Chrome/Edge only fire this when the app can be installed and isn't installed yet
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; setTimeout(function () { show('prompt'); }, 800); });
  window.addEventListener('appinstalled', function () { set(localStorage, KEY, '1'); if (sheet) { sheet.remove(); sheet = null; } });
  if (ios) setTimeout(function () { show('ios'); }, 1200);
})();
