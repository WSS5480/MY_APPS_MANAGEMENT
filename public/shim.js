/* Server-backed stand-in for the window.claude runtime the tracker was written against.
   Gives it a small document database (collections + docs with live snapshots via polling),
   the signed-in user, and file downloads. */
(function () {
  'use strict';
  var cache = {};            // path -> data
  var version = -1;
  var me = null;
  var listeners = [];        // {kind:'col'|'doc', path, cb, err, last}
  var pending = 0;
  var failing = false;
  var offline = false;
  var LS = { get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };
  var qKey = function () { return 'sct_q_' + (me ? me.uid : 'x'); };
  var cKey = function () { return 'sct_cache_' + (me ? me.uid : 'x'); };
  var queue = function () { return LS.get(qKey()) || []; };
  var isNet = function (e) { return e instanceof TypeError || (e && e.code === 'network'); };
  var bar = null;
  function banner() {
    if (!bar) { bar = document.createElement('div'); bar.className = 'x-offline'; bar.setAttribute('role', 'status'); bar.hidden = true; (document.body || document.documentElement).appendChild(bar); }
    var n = queue().length;
    if (offline) { bar.hidden = false; bar.textContent = 'Offline' + (n ? ' · ' + n + ' change' + (n === 1 ? '' : 's') + ' saved on this device' : ' · showing your last saved data'); }
    else if (n) { bar.hidden = false; bar.textContent = 'Syncing ' + n + ' change' + (n === 1 ? '' : 's') + '…'; }
    else bar.hidden = true;
  }
  function applyOp(o) {
    if (o.op === 'delete') delete cache[o.path];
    else if (o.op === 'update') cache[o.path] = Object.assign({}, cache[o.path] || {}, clone(o.data));
    else cache[o.path] = clone(o.data);
  }
  var flushing = false;
  function flush() {
    if (flushing || !queue().length) return Promise.resolve();
    flushing = true;
    var step = function () {
      var q = queue(); if (!q.length) { flushing = false; version = -1; banner(); return sync(); }
      return fetch('/api/doc', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q[0]) }).then(function (r) {
        if (r.status === 401) { flushing = false; toLogin(); return; }
        var rest = queue().slice(1); LS.set(qKey(), rest); offline = false; banner(); return step();
      }, function () { flushing = false; offline = true; banner(); });
    };
    return step();
  }

  function toLogin() { location.href = '/login?next=' + encodeURIComponent(location.pathname); }
  function api(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {})).then(function (r) {
      if (r.status === 401) { toLogin(); throw { code: 'unauthenticated' }; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw { code: j.code || 'error', message: j.error || r.statusText };
        return j;
      });
    });
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function colOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
  function idOf(path) { return path.slice(path.lastIndexOf('/') + 1); }
  function newId() { var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = ''; var b = new Uint8Array(20); crypto.getRandomValues(b); for (var i = 0; i < 20; i++) s += a[b[i] % 62]; return s; }

  function snapFor(l) {
    if (l.kind === 'doc') { var d = cache[l.path]; return { exists: d != null, id: idOf(l.path), data: function () { return clone(d); }, metadata: { hasPendingWrites: pending > 0 } }; }
    var docs = Object.keys(cache).filter(function (p) { return colOf(p) === l.path; }).sort().map(function (p) { var d = cache[p]; return { id: idOf(p), data: function () { return clone(d); } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: { hasPendingWrites: pending > 0 } };
  }
  function sigFor(l) {
    if (l.kind === 'doc') return JSON.stringify(cache[l.path] == null ? null : cache[l.path]);
    return JSON.stringify(Object.keys(cache).filter(function (p) { return colOf(p) === l.path; }).sort().map(function (p) { return [p, cache[p]]; }));
  }
  function notify(force) {
    listeners.forEach(function (l) {
      if (!l.ready) return;
      var s = sigFor(l);
      if (force || s !== l.last) { l.last = s; try { l.cb(snapFor(l)); } catch (e) { console.error(e); } }
    });
  }
  var loadedOnce = false;
  function sync() {
    return api('/api/sync?v=' + version).then(function (j) {
      failing = false; if (offline) { offline = false; banner(); }
      if (!j.unchanged) {
        if (pending === 0) { cache = j.docs || {}; version = j.v; queue().forEach(applyOp); LS.set(cKey(), { v: j.v, docs: j.docs }); }
      }
      if (queue().length) flush();
      if (!loadedOnce) { loadedOnce = true; listeners.forEach(function (l) { l.ready = true; l.last = null; }); }
      notify();
    }, function (e) {
      if (e && e.code === 'unauthenticated') return;
      if (isNet(e)) { offline = true; banner(); if (!loadedOnce) { loadedOnce = true; listeners.forEach(function (l) { l.ready = true; l.last = null; }); notify(); } return; }
      if (!failing) { failing = true; listeners.forEach(function (l) { if (l.err && !loadedOnce) l.err(e); }); }
    });
  }
  function listen(kind, path, cb, err) {
    var l = { kind: kind, path: path, cb: cb, err: err, last: null, ready: loadedOnce };
    listeners.push(l);
    if (loadedOnce) { l.last = sigFor(l); setTimeout(function () { cb(snapFor(l)); }, 0); }
    return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
  }
  function write(op, path, data) {
    var prev = cache[path];
    if (op === 'delete') delete cache[path];
    else if (op === 'update') { if (prev == null) return Promise.reject({ code: 'not_found' }); cache[path] = Object.assign({}, prev, clone(data)); }
    else cache[path] = clone(data);
    pending++; notify();
    return api('/api/doc', { method: 'POST', body: JSON.stringify({ op: op, path: path, data: data }) }).then(function (j) {
      pending--; if (j && j.data !== undefined && op !== 'delete') cache[path] = j.data; if (pending === 0) version = -1; return sync();
    }, function (e) {
      pending--;
      if (isNet(e)) { var q = queue(); q.push({ op: op, path: path, data: data }); LS.set(qKey(), q); offline = true; banner(); var c = LS.get(cKey()) || { v: -1, docs: {} }; c.docs = Object.assign({}, cache); LS.set(cKey(), c); return; }
      if (prev == null) delete cache[path]; else cache[path] = prev; notify(); throw e;
    });
  }
  function docRef(path) {
    return {
      id: idOf(path), path: path,
      set: function (d) { return write('set', path, d); },
      update: function (d) { return write('update', path, d); },
      delete: function () { return write('delete', path); },
      onSnapshot: function (cb, err) { return listen('doc', path, cb, err); }
    };
  }
  var db = {
    collection: function (name) {
      return {
        doc: function (id) { return docRef(name + '/' + (id || newId())); },
        onSnapshot: function (cb, err) { return listen('col', name, cb, err); }
      };
    },
    doc: function (path) { return docRef(path); }
  };
  var user = {
    isOwner: function () { return Promise.resolve(!!(me && me.role === 'owner')); },
    canEdit: function () { return Promise.resolve(true); },
    id: function () { return Promise.resolve(me ? me.uid : null); },
    can: function () { return Promise.resolve(true); }
  };
  var downloads = {
    save: function (o) {
      var blob = new Blob([o.data], { type: /\.csv$/i.test(o.filename) ? 'text/csv' : 'application/octet-stream' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'download';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return Promise.resolve();
    }
  };
  var ready = api('/api/me').then(function (j) { me = j; LS.set('sct_me', j); }, function (e) {
    var saved = LS.get('sct_me');
    if (!isNet(e) || !saved) throw e;
    me = saved; offline = true;
  }).then(function () {
    var c = LS.get(cKey()); if (c && c.docs) { cache = c.docs; queue().forEach(applyOp); }
    if (offline) { loadedOnce = true; setTimeout(function () { banner(); notify(true); }, 0); }
    window.addEventListener('online', function () { flush(); sync(); });
    window.addEventListener('offline', function () { offline = true; banner(); });
    sync();
    setInterval(function () { if (!document.hidden && pending === 0) sync(); }, 4000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  });
  window.claudeShim = {
    logout: function () {
      if (queue().length && !confirm(queue().length + ' change(s) on this device have not synced yet. Log out anyway and lose them?')) return;
      LS.del(qKey()); LS.del(cKey()); LS.del('sct_me');
      if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { if (/^sct360-(pages|img)/.test(k)) caches.delete(k); }); });
      api('/api/logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
    },
    pending: function () { return queue().length; }
  };
  window.claude = {
    use: function (name) {
      return ready.then(function () { return name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : null; });
    }
  };
})();
