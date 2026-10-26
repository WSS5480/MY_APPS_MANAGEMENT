/* 360° drag-to-rotate viewer. Finger on phones, mouse on computers, arrow keys too.
   Spin360.mount(container, { src, frames:[byteLengths], w, h, start, title }) -> { destroy } */
(function () {
  'use strict';
  var cache = {};
  function load(src, sizes) {
    if (cache[src]) return cache[src];
    cache[src] = fetch(src, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('load ' + r.status); return r.arrayBuffer();
    }).then(function (buf) {
      var urls = [], off = 0;
      sizes.forEach(function (n) { urls.push(URL.createObjectURL(new Blob([buf.slice(off, off + n)], { type: 'image/jpeg' }))); off += n; });
      return Promise.all(urls.map(function (u) { return new Promise(function (ok) { var i = new Image(); i.onload = i.onerror = function () { ok(u); }; i.src = u; }); }));
    });
    cache[src].catch(function () { delete cache[src]; });
    return cache[src];
  }
  function mount(box, o) {
    var n = (o.frames || []).length; if (!n) return { destroy: function () {} };
    // go forward through the frames, then back, so a long drag never jumps
    var seq = []; for (var i = 0; i < n; i++) seq.push(i); for (var j = n - 2; j > 0; j--) seq.push(j);
    var L = seq.length, pos = Math.max(0, o.start || 0), urls = null, dead = false;
    var wrap = document.createElement('div'); wrap.className = 'spin360'; wrap.tabIndex = 0;
    wrap.setAttribute('role', 'slider'); wrap.setAttribute('aria-label', (o.title || '360° view') + '. Drag or use arrow keys to rotate.');
    wrap.setAttribute('aria-valuemin', '0'); wrap.setAttribute('aria-valuemax', String(L - 1));
    wrap.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none;overflow:hidden';
    var img = document.createElement('img'); img.alt = o.title || '360° view'; img.draggable = false;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;pointer-events:none';
    if (o.poster) img.src = o.poster;
    var hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;left:50%;bottom:10px;transform:translateX(-50%);background:rgba(8,31,51,.82);color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;padding:8px 12px;border-radius:999px;pointer-events:none;white-space:nowrap;transition:opacity .4s';
    hint.textContent = 'Loading 360° view…';
    var badge = document.createElement('div'); badge.textContent = '360°';
    badge.style.cssText = 'position:absolute;top:10px;left:10px;background:#079FE9;color:#fff;font:700 11px/1 Inter,system-ui,sans-serif;padding:5px 8px;border-radius:6px;pointer-events:none';
    wrap.appendChild(img); wrap.appendChild(badge); wrap.appendChild(hint); box.appendChild(wrap);
    function draw() { if (!urls) return; var k = ((Math.round(pos) % L) + L) % L; img.src = urls[seq[k]]; wrap.setAttribute('aria-valuenow', String(k)); }
    // gentle auto-spin until the person touches it
    var auto = null, rafT = 0;
    function startAuto() { var last = 0; auto = function (t) { if (dead || !auto) return; if (last) { pos += (t - last) / 90; draw(); } last = t; rafT = requestAnimationFrame(auto); }; rafT = requestAnimationFrame(auto); }
    function stopAuto() { auto = null; cancelAnimationFrame(rafT); hint.style.opacity = '0'; }
    load(o.src, o.frames).then(function (u) {
      if (dead) return; urls = u; draw();
      hint.textContent = '⟷ Drag to rotate 360°';
      if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) startAuto();
      setTimeout(function () { hint.style.opacity = '0'; }, 3500);
    }, function () { hint.textContent = 'Could not load the 360° view'; });
    // drag: about 6px of movement per frame, scaled to the viewer width
    var down = false, sx = 0, sp = 0, pid = null;
    function step() { return Math.max(3, Math.min(10, wrap.clientWidth / 110)); }
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return; stopAuto(); down = true; pid = e.pointerId; sx = e.clientX; sp = pos; wrap.style.cursor = 'grabbing';
      try { wrap.setPointerCapture(pid); } catch (x) {}
    });
    wrap.addEventListener('pointermove', function (e) { if (!down || e.pointerId !== pid) return; pos = sp + (e.clientX - sx) / step(); draw(); });
    function up(e) { if (!down || (e && e.pointerId !== pid)) return; down = false; wrap.style.cursor = 'grab'; try { wrap.releasePointerCapture(pid); } catch (x) {} }
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up); wrap.addEventListener('lostpointercapture', function () { down = false; wrap.style.cursor = 'grab'; });
    // horizontal finger swipes rotate; vertical swipes still scroll the page (touch-action: pan-y)
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); stopAuto(); pos += e.key === 'ArrowRight' ? 1 : -1; draw(); }
    });
    wrap.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); stopAuto(); pos += e.deltaX / 12; draw(); } }, { passive: false });
    return { destroy: function () { dead = true; stopAuto(); wrap.remove(); } };
  }
  window.Spin360 = { mount: mount };
})();
