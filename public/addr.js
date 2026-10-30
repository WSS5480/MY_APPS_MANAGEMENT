/* Address fields with lookup: street (with suggestions as you type), city, state, ZIP in separate boxes.
   window.AddrFields.mount(container, opts) → { value(), set(parts), clear(), els }
   value() = { street, city, state, zip, address: "street, city, ST zip", lat, lng } — lat/lng only when a suggestion was picked. */
(function () {
  var STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }
  function mount(root, opts) {
    opts = opts || {};
    var wrap = el('div', 'addr' + (opts.className ? ' ' + opts.className : '')), picked = null, timer = null, last = '';
    var street = el('input', 'field addr-street'); street.placeholder = opts.placeholder || 'Street address · start typing to look it up'; street.autocomplete = 'off'; street.setAttribute('aria-label', 'Street address');
    var city = el('input', 'field addr-city'); city.placeholder = 'City'; city.autocomplete = 'address-level2'; city.setAttribute('aria-label', 'City');
    var state = el('select', 'field addr-state'); state.setAttribute('aria-label', 'State'); state.appendChild(new Option('State', '')); STATES.forEach(function (s) { state.appendChild(new Option(s, s)); }); state.value = opts.state || 'TX';
    var zip = el('input', 'field addr-zip'); zip.placeholder = 'ZIP'; zip.inputMode = 'numeric'; zip.autocomplete = 'postal-code'; zip.maxLength = 10; zip.setAttribute('aria-label', 'ZIP');
    var sug = el('div', 'addr-sug'); sug.hidden = true;
    var sw = el('div', 'addr-streetwrap'); sw.appendChild(street); sw.appendChild(sug);
    var row = el('div', 'addr-row'); row.appendChild(city); row.appendChild(state); row.appendChild(zip);
    wrap.appendChild(sw); wrap.appendChild(row); root.appendChild(wrap);
    function hide() { sug.hidden = true; sug.replaceChildren(); }
    function show(items) {
      sug.replaceChildren();
      if (!items.length) return hide();
      items.forEach(function (it) {
        var b = el('button', 'addr-item'); b.type = 'button';
        b.appendChild(el('div', 'addr-l1', it.street || it.name || '')); b.appendChild(el('div', 'addr-l2', [it.city, it.state, it.zip].filter(Boolean).join(', ')));
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { set(it); picked = { lat: it.lat, lng: it.lng }; hide(); city.focus(); if (opts.onPick) opts.onPick(value()); });
        sug.appendChild(b);
      });
      sug.hidden = false;
    }
    function lookup() {
      var q = street.value.trim(); if (q === last) return; last = q; picked = null;
      if (q.length < 4) return hide();
      var extra = [city.value.trim(), state.value].filter(Boolean).join(' ');
      fetch('/api/address-suggest?q=' + encodeURIComponent(q + (extra ? ' ' + extra : '')), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (j) { if (street.value.trim() !== q) return; show(j.items || []); }).catch(function () { hide(); });
    }
    street.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(lookup, 280); });
    street.addEventListener('focus', function () { if (sug.children.length) sug.hidden = false; });
    street.addEventListener('blur', function () { setTimeout(hide, 150); });
    street.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); if (e.key === 'ArrowDown' && sug.children.length) { e.preventDefault(); sug.firstChild.focus(); } });
    sug.addEventListener('keydown', function (e) { var a = document.activeElement; if (e.key === 'ArrowDown' && a.nextSibling) { e.preventDefault(); a.nextSibling.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); (a.previousSibling || street).focus(); } if (e.key === 'Escape') { hide(); street.focus(); } });
    [city, state, zip].forEach(function (i) { i.addEventListener('input', function () { picked = null; }); });
    function set(p) { p = p || {}; street.value = p.street || ''; city.value = p.city || ''; state.value = p.state || ''; zip.value = p.zip || ''; last = street.value.trim(); picked = p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null; }
    function value() {
      var s = street.value.trim(), c = city.value.trim(), st = state.value, z = zip.value.trim();
      var address = s ? s + (c ? ', ' + c : '') + (st ? ', ' + st : '') + (z ? ' ' + z : '') : '';
      return { street: s, city: c, state: st, zip: z, address: address, lat: picked ? picked.lat : null, lng: picked ? picked.lng : null };
    }
    function clear() { set({ state: opts.state || 'TX' }); hide(); }
    return { value: value, set: set, clear: clear, els: { street: street, city: city, state: state, zip: zip }, root: wrap };
  }
  // "1102 W Trenton Rd, Edinburg, TX 78539" → parts (for editing a saved address)
  function parse(addr) {
    var m = /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*(?:,?\s*(?:USA|United States))?$/i.exec(String(addr || '').trim());
    return m ? { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] || '' } : { street: String(addr || '').trim(), city: '', state: '', zip: '' };
  }
  window.AddrFields = { mount: mount, parse: parse };
})();
