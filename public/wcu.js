/* Weekly Clinical Update: reps build it from their week's activity, review it and submit it to the COO in the app
   (due Thursday 5:00 PM Central). The COO sees every rep's update for the week: on time, late or missing. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var el = function (t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var api = function (url, body, method) {
    return fetch(url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
  };
  var chiToday = function () { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); };
  var addDays = function (iso, n) { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); };
  var mondayOf = function (iso) { var w = new Date(iso + 'T12:00:00Z').getUTCDay(); return addDays(iso, w === 0 ? -6 : 1 - w); };
  var wkName = function (wk) { return new Date(wk + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
  var when = function (iso) { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  var FLASH = '', ME = null, WEEK = mondayOf(chiToday()), R = null, saveT = null;

  function statusPill(st) {
    if (st.sent) return st.late ? '<span class="pill bad">Submitted late · ' + esc(when(st.sent_at)) + '</span>' : '<span class="pill ok">Submitted · ' + esc(when(st.sent_at)) + '</span>';
    return st.late ? '<span class="pill bad">LATE · was due Thu 5:00 PM</span>' : '<span class="pill warn">Due Thu 5:00 PM</span>';
  }
  /* ---------- banner: due on Thursday, late after 5 PM until submitted ---------- */
  function banner(html, tone) {
    var b = $('#wcu-banner'), stack = $('#main .stack'), head = $('.wrap > header.head');
    if (!html) { if (b) b.remove(); return; }
    if (!b) { b = el('div'); b.id = 'wcu-banner'; if (stack) stack.insertBefore(b, stack.firstChild); else if (head) head.after(b); else return; }
    b.className = 'msg ' + tone; b.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-weight:600';
    b.innerHTML = html;
    var go = b.querySelector('[data-wcugo]'); if (go) go.onclick = function () { openSection(); };
  }
  function repBanner(st) {
    if (st.sent) return banner(null);
    var due = new Date(st.due), now = new Date(), isThu = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(now) === 'Thu';
    if (now > due) return banner('<span>⚠️ LATE: your WCU was due Thursday at 5:00 PM.</span><button class="btn small primary" type="button" data-wcugo>Review &amp; submit now</button>', 'err');
    if (isThu) return banner('<span>📝 WCU is due today by 5:00 PM.</span><button class="btn small primary" type="button" data-wcugo>Review &amp; submit</button>', 'warn');
    banner(null);
  }
  function cooBanner(list) {
    var due = new Date(list.due), now = new Date(), isThu = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(now) === 'Thu';
    var missing = list.reps.filter(function (r) { return !r.sent; }).map(function (r) { return r.rep; });
    if (!missing.length) return banner(null);
    if (now > due) return banner('<span>⚠️ WCUs late: ' + esc(missing.join(', ')) + '.</span><button class="btn small" type="button" data-wcugo>Open WCUs</button>', 'err');
    if (isThu) return banner('<span>📝 WCUs are due today by 5:00 PM · waiting on ' + esc(missing.join(', ')) + '.</span><button class="btn small" type="button" data-wcugo>Open WCUs</button>', 'warn');
    banner(null);
  }
  function openSection() { var s = $('#sec-wcu'); if (!s) return; s.hidden = false; s.classList.remove('folded'); var h = s.querySelector('.fold-h'); if (h) h.setAttribute('aria-expanded', 'true'); s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  /* ---------- rep: review and submit ---------- */
  function weekOptions() { var out = [], m = mondayOf(chiToday()); for (var i = 0; i < 6; i++) { var w = addDays(m, -7 * i); out.push('<option value="' + w + '"' + (w === WEEK ? ' selected' : '') + '>Week of ' + wkName(w) + (i === 0 ? ' (this week)' : '') + '</option>'); } return out.join(''); }
  function lines(a) { return (a || []).join('\n'); }
  function readForm() {
    var sec = $('#sec-wcu'), g = function (s) { var n = sec.querySelector(s); return n ? n.value : ''; };
    return {
      week: WEEK, win_ids: (R && R.win_ids) || [], wins: g('#wcu-wins').split('\n'), projected: g('#wcu-proj'), notes: g('#wcu-notes'),
      pod: [].slice.call(sec.querySelectorAll('#wcu-pod .wcu-podc')).map(function (tr) { var v = function (k) { return tr.querySelector('[data-p="' + k + '"]').value; }; return { surgeon: v('surgeon'), hospital: v('hospital'), specialty: v('specialty'), products: v('products'), next: v('next') }; }),
      plan: DAYS.map(function (d) { return { day: d, items: g('[data-plan="' + d + '"]').split('\n') }; })
    };
  }
  var PODF = [['surgeon', 'Surgeon name'], ['hospital', 'Hospital'], ['specialty', 'Specialty'], ['products', 'Product(s)'], ['next', 'Next step']];
  function podRow(p) { // one surgeon per card; fields wrap so every name is readable on a phone
    p = p || {}; var card = el('div', 'wcu-podc');
    card.style.cssText = 'border:1px solid var(--line,#dde3ec);border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr));gap:8px 12px;align-items:start;position:relative';
    PODF.forEach(function (f) { var l = el('label', 'f'); l.style.cssText = 'margin:0;min-width:0' + (f[0] === 'next' ? ';grid-column:1/-1' : ''); l.appendChild(el('b', '', f[1])); var i = el(f[0] === 'next' ? 'textarea' : 'input', 'field'); i.dataset.p = f[0]; i.value = p[f[0]] || ''; if (f[0] === 'next') i.rows = 2; i.style.width = '100%'; l.appendChild(i); card.appendChild(l); });
    var b = el('button', 'btn small', '✕ Remove'); b.type = 'button'; b.style.justifySelf = 'start'; b.onclick = function () { card.remove(); queueSave(); }; card.appendChild(b);
    return card;
  }
  function queueSave() { clearTimeout(saveT); var m = $('#wcu-saved'); if (m) m.textContent = 'Saving…'; saveT = setTimeout(function () { api('/api/wcu', readForm(), 'PUT').then(function (j) { R = j.report; var m2 = $('#wcu-saved'); if (m2) m2.textContent = 'Draft saved'; }, function (e) { var m2 = $('#wcu-saved'); if (m2) m2.textContent = (e && e.error) || 'Could not save'; }); }, 700); }
  function drawRep(j) {
    R = j.report; var st = j.state, sec = $('#sec-wcu'); repBanner(WEEK === mondayOf(chiToday()) ? st : { sent: true });
    sec.innerHTML = '<div class="cardhead"><h2>WCU <small class="note">Weekly Clinical Update</small></h2><div class="tools"><select class="field" id="wcu-week" style="width:auto">' + weekOptions() + '</select>' + statusPill(st) + '</div></div>' +
      '<p class="note">Built from your week in the tracker: cases from your case log, wins from the visits you flag <b>⭐ Win</b> in the Visit log, targets from your pathway, next week from your planned visits and scheduled cases. Review it, edit anything, then submit. Due every <b>Thursday by 5:00 PM</b>; the COO sees it here in the app.</p>' +
      '<div class="tools" style="margin:6px 0 12px"><button class="btn small" type="button" id="wcu-rebuild">↻ Rebuild from my activity</button><a class="btn small" id="wcu-print" target="_blank" rel="noopener" href="/api/wcu/view?week=' + WEEK + '">Print / PDF</a><span class="note" id="wcu-saved">' + (j.saved ? 'Draft saved' : 'Not saved yet') + '</span></div>' +
      '<label class="f"><b>Top wins for the week</b> <span class="note">· one per line · flag a visit ⭐ Win to add it here</span><textarea class="field" id="wcu-wins" rows="6">' + esc(lines(R.wins)) + '</textarea></label>' +
      '<h3 style="margin:16px 0 6px">Cases this week: ' + R.cases_count + ' <span class="note">· from your case log</span></h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));gap:8px">' + (R.days || []).map(function (d) { return '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:8px 10px;min-width:0"><b>' + esc(d.day) + ' ' + esc(d.date.slice(5).replace('-', '/')) + '</b>' + (d.cases.length ? d.cases.map(function (c) { return '<div style="margin-top:4px">' + esc(c) + '</div>'; }).join('') : '<div class="note">—</div>') + '</div>'; }).join('') + '</div>' +
      '<label class="f" style="max-width:14rem;width:100%;margin-top:12px"><b>Projected cases next week</b><input class="field" id="wcu-proj" type="number" min="0" value="' + esc(R.projected) + '"></label>' +
      '<h3 style="margin:16px 0 6px">Pod surgeon targets</h3><div id="wcu-pod" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));gap:10px"></div><button class="btn small" type="button" id="wcu-addpod" style="margin-top:6px">+ Add surgeon</button>' +
      '<h3 style="margin:16px 0 6px">Next week plan <span class="note">· one item per line</span></h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:10px">' +
        DAYS.map(function (d) { var p = (R.plan || []).find(function (x) { return x.day === d; }) || { items: [] }; return '<label class="f"><b>' + d + '</b><textarea class="field" rows="4" data-plan="' + d + '">' + esc(lines(p.items)) + '</textarea></label>'; }).join('') + '</div>' +
      '<label class="f" style="margin-top:12px"><b>Comments / additional notes</b><textarea class="field" id="wcu-notes" rows="3">' + esc(R.notes || '') + '</textarea></label>' +
      '<div class="tools" style="margin-top:14px"><button class="btn primary" type="button" id="wcu-send">' + (st.sent ? 'Submit an update to the COO' : 'Submit to the COO') + '</button><span class="note">Submitting shares it with the COO in the app.</span></div><div class="msg" id="wcu-msg" hidden></div><div id="wcu-arch" style="margin-top:16px"></div>';
    if (FLASH) { var fm = $('#wcu-msg'); fm.className = 'msg ok'; fm.hidden = false; fm.textContent = FLASH; FLASH = ''; }
    repArchive();
    var tb = sec.querySelector('#wcu-pod'); (R.pod || []).forEach(function (p) { tb.appendChild(podRow(p)); });
    sec.oninput = function (e) { if (e.target.closest('#wcu-week')) return; queueSave(); };
    $('#wcu-week').onchange = function (e) { WEEK = e.target.value; loadRep(); };
    $('#wcu-addpod').onclick = function () { tb.appendChild(podRow({})); };
    $('#wcu-rebuild').onclick = function () {
      if (!confirm('Rebuild wins, targets and next week\'s plan from your activity? Your edits to those parts are replaced (comments stay).')) return;
      var f = j.fresh, notes = $('#wcu-notes').value; drawRep({ report: Object.assign({}, f, { notes: notes }), state: st, saved: j.saved, fresh: f }); queueSave();
    };
    $('#wcu-send').onclick = function () {
      var b = $('#wcu-send'), m = $('#wcu-msg'); b.disabled = true; clearTimeout(saveT);
      api('/api/wcu/send', readForm()).then(function (r) { FLASH = 'Submitted to the COO' + (r.state.late ? ' (after the Thursday 5:00 PM deadline).' : ' — on time. Thank you.'); loadRep(); },
        function (e) { b.disabled = false; m.className = 'msg err'; m.hidden = false; m.textContent = (e && e.error) || 'Could not submit. Check your connection.'; });
    };
  }
  function loadRep() { return api('/api/wcu?week=' + WEEK).then(drawRep, function () {}); }

  /* ---------- archive (rep: own weeks; COO: every rep, on-time and late history) ---------- */
  function wkChip(w, rep) {
    var cls = w.sent ? (w.late ? 'bad' : 'ok') : (w.late ? 'bad' : 'warn'), t = w.sent ? (w.late ? 'Late' : 'On time') : (w.late ? 'Missing' : 'Open');
    return '<button type="button" class="pill ' + cls + '" style="border:0;cursor:pointer" data-wk="' + w.week + '"' + (rep ? ' data-r="' + esc(rep) + '"' : '') + ' title="' + (w.sent_at ? 'Submitted ' + esc(when(w.sent_at)) : t) + '">' + esc(wkName(w.week).replace(/, \d{4}$/, '')) + ' · ' + t + '</button>';
  }
  function stats(r) { return '<span class="pill ok">' + r.on_time + ' on time</span> <span class="pill ' + (r.late ? 'bad' : 'mute') + '">' + r.late + ' late</span> <span class="pill ' + (r.missing ? 'bad' : 'mute') + '">' + r.missing + ' missing</span>' + (r.rate == null ? '' : ' <b>' + r.rate + '% on time</b>'); }
  function repArchive() {
    var box = $('#wcu-arch'); if (!box) return;
    api('/api/wcu/history').then(function (h) {
      var r = h.reps[0]; if (!r) return;
      box.innerHTML = '<details' + (r.weeks.length > 1 ? '' : ' open') + '><summary><b>My past WCUs</b> · ' + stats(r) + '</summary><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + r.weeks.map(function (w) { return wkChip(w); }).join('') + '</div><p class="note">Tap a week to open it.</p></details>';
      box.onclick = function (e) { var c = e.target.closest('[data-wk]'); if (!c) return; WEEK = c.dataset.wk; loadRep().then(function () { openSection(); }); };
    }, function () {});
  }

  /* ---------- COO: pick a rep, read their update; history underneath ---------- */
  var LIST = null, PICK = '';
  function drawCoo(list) {
    LIST = list; var sec = $('#sec-wcu'); if (WEEK === mondayOf(chiToday())) cooBanner(list);
    var sentN = list.reps.filter(function (r) { return r.sent; }).length;
    if (!list.reps.some(function (r) { return r.rep === PICK; })) PICK = (list.reps.find(function (r) { return r.sent; }) || list.reps[0] || {}).rep || '';
    var badge = function (r) { return r.sent ? (r.late ? '⚠ late' : '✓ on time') : (r.late ? '✗ missing' : (r.draft ? '… draft' : '○ not started')); };
    sec.innerHTML = '<div class="cardhead"><h2>WCU <small class="note">Weekly Clinical Updates</small></h2><div class="tools"><select class="field" id="wcu-week" style="width:auto">' + weekOptions() + '</select><span class="pill ' + (sentN === list.reps.length ? 'ok' : 'warn') + '">' + sentN + ' of ' + list.reps.length + ' submitted</span></div></div>' +
      '<div class="tools" style="flex-wrap:wrap;gap:8px;margin:4px 0 10px"><label class="f" style="margin:0;min-width:16rem"><b>Rep</b><select class="field" id="wcu-rep">' + list.reps.map(function (r) { return '<option value="' + esc(r.rep) + '"' + (r.rep === PICK ? ' selected' : '') + '>' + esc(r.rep) + ' — ' + badge(r) + '</option>'; }).join('') + '</select></label><span id="wcu-repstat"></span></div>' +
      '<div id="wcu-one"></div><div id="wcu-hist" style="margin-top:16px"></div>';
    $('#wcu-week').onchange = function (e) { WEEK = e.target.value; loadCoo(); };
    $('#wcu-rep').onchange = function (e) { PICK = e.target.value; drawOne(); };
    drawOne(); cooHistory();
  }
  function drawOne() {
    var r = LIST.reps.find(function (x) { return x.rep === PICK; }), box = $('#wcu-one'), st = $('#wcu-repstat'); if (!r) { box.innerHTML = '<p class="note">No reps yet.</p>'; return; }
    st.innerHTML = r.sent ? (r.late ? '<span class="pill bad">Late · ' : '<span class="pill ok">On time · ') + esc(when(r.sent_at)) + (r.report && r.report.resent ? ' · updated' : '') + '</span> <a class="btn small" target="_blank" rel="noopener" href="/api/wcu/view?rep=' + encodeURIComponent(r.rep) + '&week=' + LIST.week + '">Print</a>' : (r.late ? '<span class="pill bad">Missing · was due Thu 5:00 PM</span>' : '<span class="pill warn">Due Thu 5:00 PM</span>');
    box.innerHTML = r.report ? cooView(r.report) : '<p class="note">' + esc(r.rep) + ' hasn\'t submitted the update for the week of ' + esc(wkName(LIST.week)) + (r.draft ? ' (a draft is started).' : '.') + '</p>';
  }
  function cooView(r) {
    var li = function (a) { return a && a.length ? '<ul style="margin:4px 0 0 18px;padding:0">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="note">—</p>'; };
    var box = function (t, body) { return '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:10px 12px;min-width:0"><b>' + t + '</b>' + body + '</div>'; };
    var grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:10px;margin-top:10px';
    return '<div style="' + grid + '">' + box('Top wins', li(r.wins)) +
      box('Cases this week: ' + r.cases_count + ' · projected next week: ' + esc(r.projected), (r.days || []).filter(function (d) { return d.cases.length; }).map(function (d) { return '<div style="margin-top:4px"><b>' + esc(d.day.slice(0, 3)) + ':</b> ' + esc(d.cases.join('; ')) + '</div>'; }).join('') || '<p class="note">No cases logged.</p>') +
      (r.notes ? box('Comments', '<p style="white-space:pre-line;margin:4px 0 0">' + esc(r.notes) + '</p>') : '') + '</div>' +
      '<h3 style="margin:14px 0 4px">Pod surgeon targets</h3><div style="' + grid + '">' + ((r.pod || []).map(function (p) { return box(esc(p.surgeon || '—'), '<div class="note">' + esc([p.hospital, p.specialty].filter(Boolean).join(' · ')) + '</div>' + (p.products ? '<div><b>Products:</b> ' + esc(p.products) + '</div>' : '') + (p.next ? '<div><b>Next:</b> ' + esc(p.next) + '</div>' : '')); }).join('') || '<p class="note">None listed.</p>') + '</div>' +
      '<h3 style="margin:14px 0 4px">Next week plan</h3><div style="' + grid.replace('17rem', '12rem') + '">' + ((r.plan || []).filter(function (d) { return d.items.length; }).map(function (d) { return box(esc(d.day), li(d.items)); }).join('') || '<p class="note">No plan listed.</p>') + '</div>';
  }
  function cooHistory() {
    api('/api/wcu/history').then(function (h) {
      var box = $('#wcu-hist'); if (!box) return;
      box.innerHTML = '<details><summary><b>Submission history</b> · on-time and late by rep</summary><div class="tools" style="margin:8px 0"><label class="f" style="margin:0;min-width:16rem"><select class="field" id="wcu-hrep"><option value="">All reps · summary</option>' + h.reps.map(function (r) { return '<option value="' + esc(r.rep) + '">' + esc(r.rep) + (r.rate == null ? '' : ' — ' + r.rate + '% on time') + '</option>'; }).join('') + '</select></label></div><div id="wcu-hbody"></div></details>';
      var body = $('#wcu-hbody');
      var show = function (rep) {
        if (!rep) { body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:8px">' + h.reps.map(function (r) { return '<div style="border:1px solid var(--line,#dde3ec);border-radius:10px;padding:8px 10px"><b>' + esc(r.rep) + '</b><div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center">' + stats(r) + '</div></div>'; }).join('') + '</div>'; return; }
        var r = h.reps.find(function (x) { return x.rep === rep; });
        body.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">' + stats(r) + '</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + r.weeks.map(function (w) { return wkChip(w, r.rep); }).join('') + '</div><p class="note">Tap a week to open that WCU.</p>';
      };
      $('#wcu-hrep').onchange = function (e) { show(e.target.value); }; show('');
      body.onclick = function (e) { var c = e.target.closest('[data-wk]'); if (!c) return; WEEK = c.dataset.wk; PICK = c.dataset.r; loadCoo().then(function () { openSection(); }); };
    }, function () {});
  }
  function loadCoo() { return api('/api/wcu/list?week=' + WEEK).then(drawCoo, function () {}); }

  function start() {
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (!me || !$('#sec-wcu')) return; ME = me;
      if (me.role === 'rep') loadRep(); else if (me.role === 'owner') loadCoo(); else $('#sec-wcu').hidden = true;
      setInterval(function () { if (WEEK !== mondayOf(chiToday())) return; (ME.role === 'rep' ? api('/api/wcu?week=' + WEEK).then(function (j) { repBanner(j.state); }) : api('/api/wcu/list?week=' + WEEK).then(cooBanner)).catch(function () {}); }, 5 * 60 * 1000);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
