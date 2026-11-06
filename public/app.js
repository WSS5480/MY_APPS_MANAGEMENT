/* MNA de México — Sistema de Operación de Procesos (front-end, no build step) */
(function () {
  'use strict';
  const S = { lang: localStorage.getItem('mna_lang') || 'es', meta: null, me: null, unread: 0, opts: {}, sideOpen: false, openGroups: JSON.parse(localStorage.getItem('mna_groups') || '[]') };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = a => (Array.isArray(a) ? (a[S.lang === 'en' ? 1 : 0] != null ? a[S.lang === 'en' ? 1 : 0] : a[0]) : (a == null ? '' : a));

  // ── UI dictionary (Guatemalan Spanish: formal "usted") ──
  const UI = {
    es: {
      brand: 'MNA de México', app: 'Sistema de Operación de Procesos', switchTo: 'English', dashboard: 'Tablero', inbox: 'Mis pendientes', diag: 'Diagnóstico y Hoja de ruta', reports: 'Reportes', menu: 'Menú', home: 'Inicio',
      search: 'Buscar…', all: 'Todos', new: 'Nuevo', save: 'Guardar', saving: 'Guardando…', cancel: 'Cancelar', del: 'Eliminar', back: 'Regresar', export: 'Exportar CSV', import: 'Importar CSV', template: 'Plantilla CSV', run: 'Consultar', yes: 'Sí', no: 'No', none: '—', ok: 'Aceptar', confirm: 'Confirmar', close: 'Cerrar',
      saved: 'Cambios guardados.', created: 'Registro creado.', deleted: 'Registro eliminado.', confirmDel: '¿Eliminar este registro? Esta acción no se puede deshacer.', comment: 'Comentario', commentReq: 'Escriba un comentario para continuar.',
      status: 'Estatus', history: 'Historial', related: 'Documentos relacionados', lines: 'Partidas', addLine: 'Agregar partida', total: 'Total', noRows: 'No hay registros para mostrar.', loading: 'Cargando…', records: 'registros',
      enterPin: 'Ingrese su PIN', pinSub: 'Use el PIN de 4 a 6 dígitos que le asignó el administrador.', enter: 'Entrar', clear: 'Borrar', demoUsers: 'Usuarios de demostración', logout: 'Cerrar sesión', resetDemo: 'Restablecer datos de demostración', resetAsk: 'Esto borra todos los datos y vuelve a cargar la demostración. ¿Continuar?', resetDone: 'Datos de demostración restablecidos.',
      heroTitle: 'Toda la operación de Ventas y Contabilidad, en un solo sistema.', heroSub: 'Pedidos, crédito, entregas, facturación, compras, cierre, activos y costos con dueños, políticas y autorizaciones claras.',
      hero1: 'Canal único de pedidos con disponibilidad y fecha factible', hero2: 'Notas de crédito, precios y crédito con autorización digital', hero3: 'Portal de proveedores con conciliación a 3 vías', hero4: 'Cierre en D+5 con calendario de precierre y conciliaciones firmadas', hero5: 'Costo estándar, rentabilidad y activos fijos fuera de Excel',
      vsBaseline: 'vs. línea base', baseline: 'Línea base', toQuantify: 'Línea base por cuantificar', gapByArea: 'Índice de brecha por área', cnTrend: 'Notas de crédito por mes', pipeline: 'Pedidos en proceso', roadmap: 'Hoja de ruta — 16 semanas', week: 'S', pending: 'Pendientes', notifications: 'Avisos', markRead: 'Marcar como leídos', nothingPending: 'No tiene pendientes. ¡Buen trabajo!',
      valueChains: 'Mapa de procesos de extremo a extremo', legendDone: 'Se hace', legendOpt: 'Oportunidad para optimizar', legendNo: 'No se hace', legendNA: 'No abordado', viewAll: 'Ver todos', subprocesses: 'Subprocesos',
      bankTitle: 'Conciliación bancaria automática', bankRun: 'Ejecutar conciliación automática', bankDesc: 'Compara cada movimiento del estado de cuenta contra cobros y pagos registrados: primero por importe y referencia, luego por importe exacto con ±3 días.', bankRes: 'Movimientos revisados: {a}. Coincidencias sugeridas: {b}.', allAccounts: 'Todas las cuentas', confirmAll: 'Confirmar todas las sugeridas', importStatement: 'Importar estado de cuenta',
      importTitle: 'Importar desde CSV', importHelp: 'La primera fila debe tener los nombres de columna (puede descargar la plantilla). Si alguna fila tiene error, no se importa nada y se le indica qué corregir.', importOk: '{n} registro(s) importado(s).', chooseFile: 'Seleccione el archivo CSV',
      upload: 'Subir archivo', takePhoto: 'Tomar foto / subir', viewFile: 'Ver archivo', uploading: 'Subiendo…', gpsNote: 'Se registrará su ubicación GPS al confirmar.', locked: 'Documento cerrado: ya no se puede modificar en este estatus.', audit: 'Bitácora de auditoría', role: 'Rol', user: 'Usuario', when: 'Fecha', action: 'Acción', module: 'Módulo',
      act_create: 'Creó el registro', act_update: 'Modificó', act_status: 'Cambió estatus', act_action: 'Ejecutó', act_login: 'Inició sesión', act_import: 'Importó', act_delete: 'Eliminó', act_automatch: 'Conciliación automática',
      portalTitle: 'Portal de proveedores', portalSub: 'Suba sus facturas (XML y PDF) contra una entrada de mercancía registrada. Consulte el estatus de validación y pago.', uploadInvoice: 'Subir factura', myPOs: 'Mis órdenes de compra', myReceipts: 'Entradas registradas', myInvoices: 'Mis facturas', myPayments: 'Mis pagos',
      driverTitle: 'Mis entregas', driverSub: 'Abra cada entrega, tome la foto de la remisión firmada y confirme.', session: 'Sesión', version: 'Versión', help: 'Ayuda', open: 'Abrir', more: 'Más', filters: 'Filtros', apply: 'Aplicar', period: 'Periodo', downloadXml: 'Descargar XML', preview: 'Vista previa', go: 'Ir',
    },
    en: {
      brand: 'MNA de México', app: 'Process Operations System', switchTo: 'Español', dashboard: 'Dashboard', inbox: 'My tasks', diag: 'Diagnostic & Roadmap', reports: 'Reports', menu: 'Menu', home: 'Home',
      search: 'Search…', all: 'All', new: 'New', save: 'Save', saving: 'Saving…', cancel: 'Cancel', del: 'Delete', back: 'Back', export: 'Export CSV', import: 'Import CSV', template: 'CSV template', run: 'Run', yes: 'Yes', no: 'No', none: '—', ok: 'OK', confirm: 'Confirm', close: 'Close',
      saved: 'Changes saved.', created: 'Record created.', deleted: 'Record deleted.', confirmDel: 'Delete this record? This cannot be undone.', comment: 'Comment', commentReq: 'Please enter a comment to continue.',
      status: 'Status', history: 'History', related: 'Related documents', lines: 'Lines', addLine: 'Add line', total: 'Total', noRows: 'No records to show.', loading: 'Loading…', records: 'records',
      enterPin: 'Enter your PIN', pinSub: 'Use the 4–6 digit PIN assigned by your administrator.', enter: 'Sign in', clear: 'Clear', demoUsers: 'Demo users', logout: 'Sign out', resetDemo: 'Reset demo data', resetAsk: 'This erases all data and reloads the demo. Continue?', resetDone: 'Demo data reset.',
      heroTitle: 'All of Sales and Accounting, in one system.', heroSub: 'Orders, credit, deliveries, billing, purchasing, close, fixed assets and costing — with clear owners, policies and approvals.',
      hero1: 'Single order channel with availability and feasible date', hero2: 'Credit notes, pricing and credit with digital approval', hero3: 'Supplier portal with 3-way match', hero4: 'Close by D+5 with pre-close calendar and signed reconciliations', hero5: 'Standard cost, profitability and fixed assets out of Excel',
      vsBaseline: 'vs. baseline', baseline: 'Baseline', toQuantify: 'Baseline to be quantified', gapByArea: 'Gap index by area', cnTrend: 'Credit notes per month', pipeline: 'Orders in process', roadmap: 'Roadmap — 16 weeks', week: 'W', pending: 'Pending', notifications: 'Notifications', markRead: 'Mark as read', nothingPending: 'Nothing pending. Great job!',
      valueChains: 'End-to-end process map', legendDone: 'Done in system', legendOpt: 'Needs optimization', legendNo: 'Not done', legendNA: 'Not covered', viewAll: 'View all', subprocesses: 'Subprocesses',
      bankTitle: 'Automatic bank reconciliation', bankRun: 'Run automatic matching', bankDesc: 'Compares every bank line to recorded receipts and payments: first by amount and reference, then exact amount within ±3 days.', bankRes: 'Lines checked: {a}. Suggested matches: {b}.', allAccounts: 'All accounts', confirmAll: 'Confirm all suggested', importStatement: 'Import bank statement',
      importTitle: 'Import from CSV', importHelp: 'The first row must contain column names (download the template). If any row has an error nothing is imported and you are told what to fix.', importOk: '{n} record(s) imported.', chooseFile: 'Choose the CSV file',
      upload: 'Upload file', takePhoto: 'Take photo / upload', viewFile: 'View file', uploading: 'Uploading…', gpsNote: 'Your GPS location will be recorded on confirmation.', locked: 'Document closed: it can no longer be edited in this status.', audit: 'Audit log', role: 'Role', user: 'User', when: 'Date', action: 'Action', module: 'Module',
      act_create: 'Created the record', act_update: 'Edited', act_status: 'Changed status', act_action: 'Ran', act_login: 'Signed in', act_import: 'Imported', act_delete: 'Deleted', act_automatch: 'Automatic matching',
      portalTitle: 'Supplier portal', portalSub: 'Upload your invoices (XML and PDF) against a recorded goods receipt. Track validation and payment status.', uploadInvoice: 'Upload invoice', myPOs: 'My purchase orders', myReceipts: 'Recorded receipts', myInvoices: 'My invoices', myPayments: 'My payments',
      driverTitle: 'My deliveries', driverSub: 'Open each delivery, take a photo of the signed delivery note and confirm.', session: 'Session', version: 'Version', help: 'Help', open: 'Open', more: 'More', filters: 'Filters', apply: 'Apply', period: 'Period', downloadXml: 'Download XML', preview: 'Preview', go: 'Go',
    },
  };
  const t = (k, vars) => { let s = (UI[S.lang] && UI[S.lang][k]) || UI.es[k] || k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
  const loc = () => (S.lang === 'en' ? 'en-US' : 'es-GT');

  // ── formatting ──
  const F = {
    money: v => (v == null || v === '' ? '—' : new Intl.NumberFormat(loc(), { style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).format(+v)),
    num: v => (v == null || v === '' ? '—' : new Intl.NumberFormat(loc(), { maximumFractionDigits: 2 }).format(+v)),
    pct: v => (v == null || v === '' ? '—' : new Intl.NumberFormat(loc(), { maximumFractionDigits: 1 }).format(+v) + '%'),
    date: v => { if (!v) return '—'; const d = new Date(String(v).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString(loc(), { day: '2-digit', month: 'short', year: 'numeric' }); },
    datetime: v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? v : d.toLocaleString(loc(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
  };
  const NUMT = ['num', 'money', 'pct', 'int'];

  // ── icons ──
  const IC = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>', map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>', tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8"/>', truck: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>', receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M1 2h3l3 13h12l2-9H6"/>', bank: '<path d="M3 10h18L12 4 3 10zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>', building: '<path d="M4 21V3h10v18M14 8h6v13M8 7h2M8 11h2M8 15h2M17 12h1M17 16h1M2 21h20"/>',
    chart: '<path d="M3 3v18h18M7 15l4-4 3 3 6-6"/>', shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>', bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>', menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', chev: '<path d="m9 18 6-6-6-6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', up: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>', check: '<path d="m5 12 5 5L20 7"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    back: '<path d="m15 18-6-6 6-6"/>', file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>', bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>', camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    logo: '<path d="M5 19V6l7 7 7-7v13" stroke="#34C38F" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

  // ── API ──
  async function api(path, opts = {}) {
    const o = Object.assign({ credentials: 'same-origin', headers: {} }, opts);
    if (o.body && typeof o.body !== 'string' && !(o.body instanceof Blob) && !(o.body instanceof ArrayBuffer)) { o.body = JSON.stringify(o.body); o.headers['content-type'] = 'application/json'; }
    let r;
    try { r = await fetch(path, o); } catch (e) { throw new Error(S.lang === 'en' ? 'No connection to the server. Check your internet and try again.' : 'Sin conexión con el servidor. Revise su internet e intente de nuevo.'); }
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { j = txt; }
    if (r.status === 401 && !path.includes('/login')) { S.me = null; S.meta = null; render(); throw Object.assign(new Error(L(j && j.msg) || 'Auth'), { silent: true }); }
    if (!r.ok) { const e = new Error(L(j && j.msg) || ('Error ' + r.status)); e.extra = j && j.extra; throw e; }
    return j;
  }
  function toast(msg, type = '') { const el = $('#toast'); el.textContent = msg; el.className = 'toast show ' + type; clearTimeout(toast._t); toast._t = setTimeout(() => (el.className = 'toast'), type === 'err' ? 6000 : 3200); }
  const fail = e => { if (!e.silent) toast(e.message + (e.extra && e.extra.errors ? '\n' + e.extra.errors.slice(0, 6).map(x => (S.lang === 'en' ? 'Row ' : 'Fila ') + x.row + ': ' + L(x.msg)).join('\n') : ''), 'err'); };
  function modal({ title, body, okText, cancelText, danger, onOpen }) {
    return new Promise(res => {
      const m = $('#modal');
      m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><div class="mh">${esc(title)}</div><div class="mb">${body || ''}</div><div class="mf"><button class="btn" data-x>${esc(cancelText || t('cancel'))}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-ok>${esc(okText || t('confirm'))}</button></div></div>`;
      m.hidden = false;
      const close = v => { m.hidden = true; m.innerHTML = ''; res(v); };
      $('[data-x]', m).onclick = () => close(null);
      $('[data-ok]', m).onclick = () => close(m.querySelector('.mb') ? collect(m) : true);
      m.onclick = e => { if (e.target === m) close(null); };
      if (onOpen) onOpen(m);
      const f = $('textarea,input', m); if (f) setTimeout(() => f.focus(), 30);
    });
    function collect(m) { const o = { ok: true }; $$('[name]', m).forEach(i => (o[i.name] = i.type === 'file' ? i.files[0] : i.value)); return o; }
  }

  // ── language bar ──
  function renderLangbar() {
    document.documentElement.lang = S.lang === 'en' ? 'en' : 'es';
    $('#langbar').innerHTML = `<span class="brandmini">${esc(t('brand'))} · ${esc(t('app'))}</span><button class="langbtn" id="langbtn" aria-label="${esc(t('switchTo'))}">${ic('globe')}${esc(t('switchTo'))}</button>`;
    $('#langbtn').onclick = () => { S.lang = S.lang === 'es' ? 'en' : 'es'; localStorage.setItem('mna_lang', S.lang); renderLangbar(); render(); };
  }

  // ── helpers over metadata ──
  const ENT = k => S.meta && S.meta.entities[k];
  function statusOf(ent, s) { const e = ENT(ent); const st = e && e.statuses && e.statuses.find(x => x.k === s); return st || { k: s, l: [s, s], c: 'gray' }; }
  const chip = (ent, s) => { if (!s) return ''; const st = statusOf(ent, s); return `<span class="chip ${st.c}">${esc(L(st.l))}</span>`; };
  function optLabel(f, v) { const o = (f.opts || []).find(x => x[0] === v); return o ? (S.lang === 'en' ? o[2] : o[1]) : v; }
  function disp(f, v, refs, raw) {
    if (v === null || v === undefined || v === '') return raw ? '' : '<span class="muted">—</span>';
    switch (f.t) {
      case 'money': return F.money(v); case 'num': return F.num(v); case 'int': return F.num(v); case 'pct': return F.pct(v);
      case 'date': return F.date(v); case 'datetime': return F.datetime(v); case 'bool': return v ? t('yes') : t('no');
      case 'select': return esc(optLabel(f, v)); case 'ref': return esc(((refs || {})[f.ref] || {})[v] || '#' + v);
      case 'file': return raw ? '#' + v : `<a href="/api/files/${v}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ic('file', 'i14')} ${esc(t('viewFile'))}</a>`;
      case 'longtext': return raw ? esc(v) : esc(String(v).length > 90 ? String(v).slice(0, 90) + '…' : v);
      default: return esc(v);
    }
  }
  async function opts(ent, status) { const key = ent + (status || ''); if (!S.opts[key]) S.opts[key] = await api('/api/opts/' + ent + (status ? '?status=' + status : '')); return S.opts[key]; }
  const qs = () => { const h = location.hash.split('?')[1] || ''; return Object.fromEntries(new URLSearchParams(h)); };
  const go = h => { if (location.hash === h) render(); else location.hash = h; };

  // ── navigation ──
  const PRIMARY = { VTA: '#/e/orders', ATC: '#/e/orders', GV: '#/e/orders', CHOF: '#/e/deliveries', PROV: '#/e/supplier_invoices', ALM: '#/e/goods_receipts', PROD: '#/e/production_orders', LOG: '#/e/loads', FACT: '#/r/billing_queue', COB: '#/e/receipts', CONT: '#/e/close_tasks', CXP: '#/e/supplier_invoices', COMP: '#/e/requisitions', COST: '#/r/profitability', DIR: '#/diag', ADMIN: '#/diag' };
  function navHtml() {
    const m = S.meta; const cur = location.hash || '#/';
    const a = (h, label, icon, cls = '') => `<a class="single ${cls} ${cur === h || (h !== '#/' && cur.startsWith(h)) ? 'active' : ''}" href="${h}">${ic(icon)}<span>${esc(label)}</span></a>`;
    let h = '';
    if (S.me.role === 'PROV') return a('#/', t('portalTitle'), 'grid') + a('#/inbox', t('inbox'), 'inbox') + '<div class="sep"></div>' + ['supplier_invoices', 'purchase_orders', 'goods_receipts', 'supplier_payments'].filter(ENT).map(k => a('#/e/' + k, L(ENT(k).l), k === 'supplier_invoices' ? 'receipt' : k === 'supplier_payments' ? 'bank' : 'box')).join('');
    h += a('#/', t('dashboard'), 'grid') + a('#/inbox', t('inbox'), 'inbox');
    h += '<div class="sep"></div>';
    for (const [g, es, en, icon] of m.groups) {
      if (g === 'tablero') continue;
      const ents = Object.values(m.entities).filter(e => e.g === g);
      const reps = m.reports.filter(r => r.g === g);
      if (!ents.length && !reps.length) continue;
      if (S.me.role === 'CHOF' && g !== 'logistica') continue;
      const open = S.openGroups.includes(g) || (g === 'diagnostico' && cur.startsWith('#/diag')) || ents.some(e => cur.startsWith('#/e/' + e.k)) || reps.some(r => cur.startsWith('#/r/' + r.k));
      h += `<div class="grp ${open ? 'open' : ''}" data-g="${g}"><div class="ghead">${ic(icon)}<span>${esc(S.lang === 'en' ? en : es)}</span>${ic('chev', 'chev')}</div><div class="items">`;
      if (g === 'diagnostico') h += `<a href="#/diag" class="${cur.startsWith('#/diag') ? 'active' : ''}">${esc(S.lang === 'en' ? 'Overview & process map' : 'Resumen y mapa de procesos')}</a>`;
      for (const e of ents) { const hr = '#/e/' + e.k; h += `<a href="${hr}" class="${cur.split('?')[0] === hr || cur.startsWith(hr + '/') ? 'active' : ''}">${esc(L(e.l))}</a>`; }
      if (g === 'finanzas' && ['ADMIN', 'CONT', 'CXP'].includes(S.me.role)) h += `<a href="#/bankmatch" class="${cur.startsWith('#/bankmatch') ? 'active' : ''}">${esc(t('bankTitle'))}</a>`;
      if (reps.length) { h += `<div class="sub">${esc(t('reports'))}</div>`; for (const r of reps) { const hr = '#/r/' + r.k; h += `<a href="${hr}" class="${cur.startsWith(hr) ? 'active' : ''}">${esc(L(r.l))}</a>`; } }
      if (g === 'admin' && ['ADMIN', 'DIR'].includes(S.me.role)) h += `<a href="#/audit" class="${cur.startsWith('#/audit') ? 'active' : ''}">${esc(t('audit'))}</a>`;
      h += '</div></div>';
    }
    return h;
  }
  function shell(content) {
    const u = S.me; const ini = u.name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
    const cur = location.hash || '#/';
    const prim = PRIMARY[u.role] || '#/diag';
    const primLabel = prim.startsWith('#/e/') && ENT(prim.slice(4)) ? L(ENT(prim.slice(4)).l) : prim.startsWith('#/r/') ? t('reports') : t('diag');
    $('#app').innerHTML = `<div class="shell">
      <header class="hdr">
        <button class="iconbtn menu-btn" id="menuBtn" aria-label="${esc(t('menu'))}">${ic('menu')}</button>
        <a class="logo" href="#/" style="color:#fff"><span class="mark"><svg viewBox="0 0 24 24">${IC.logo}</svg></span><span>MNA de México<small>${esc(t('app'))}</small></span></a>
        <div class="grow"></div>
        <a class="iconbtn" href="#/inbox" aria-label="${esc(t('notifications'))}">${ic('bell')}${S.unread ? `<span class="badge">${S.unread > 99 ? '99+' : S.unread}</span>` : ''}</a>
        <div class="userchip" id="userBtn"><span class="avatar">${esc(ini || 'U')}</span><span class="who"><b>${esc(u.name)}</b><span>${esc(L(S.meta.roles[u.role]))}</span></span></div>
      </header>
      <div class="overlay ${S.sideOpen ? 'open' : ''}" id="ovl"></div>
      <nav class="side ${S.sideOpen ? 'open' : ''}" id="side">${navHtml()}</nav>
      <main class="main" id="main">${content}</main>
      <nav class="bottomnav">
        <a href="#/" class="${cur === '#/' || cur === '' ? 'active' : ''}">${ic('grid')}<span>${esc(t('home'))}</span></a>
        <a href="#/inbox" class="${cur.startsWith('#/inbox') ? 'active' : ''}">${ic('inbox')}<span>${esc(t('pending'))}</span>${S.unread ? `<span class="badge">${S.unread > 99 ? '99+' : S.unread}</span>` : ''}</a>
        <a href="${prim}" class="${cur.startsWith(prim) ? 'active' : ''}">${ic(prim.includes('deliver') ? 'truck' : prim.includes('/r/') ? 'report' : prim.includes('diag') ? 'map' : 'receipt')}<span>${esc(primLabel.length > 14 ? primLabel.slice(0, 13) + '…' : primLabel)}</span></a>
        <a href="javascript:void 0" id="bnMenu">${ic('menu')}<span>${esc(t('menu'))}</span></a>
      </nav></div>`;
    const toggle = v => { S.sideOpen = v; $('#side').classList.toggle('open', v); $('#ovl').classList.toggle('open', v); };
    $('#menuBtn').onclick = () => toggle(!S.sideOpen);
    $('#bnMenu').onclick = () => toggle(!S.sideOpen);
    $('#ovl').onclick = () => toggle(false);
    $$('.side a').forEach(a => a.addEventListener('click', () => toggle(false)));
    $$('.side .ghead').forEach(hd => hd.onclick = () => { const g = hd.parentElement; g.classList.toggle('open'); const k = g.dataset.g; S.openGroups = g.classList.contains('open') ? [...new Set([...S.openGroups, k])] : S.openGroups.filter(x => x !== k); localStorage.setItem('mna_groups', JSON.stringify(S.openGroups)); });
    $('#userBtn').onclick = userMenu;
  }
  async function userMenu() {
    const u = S.me;
    const body = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px"><span class="avatar" style="width:44px;height:44px">${esc(u.name[0])}</span><div><b>${esc(u.name)}</b><div class="muted">${esc(L(S.meta.roles[u.role]))}${u.position ? ' · ' + esc(u.position) : ''}</div></div></div>
      ${u.role === 'ADMIN' ? `<button class="btn danger" id="resetBtn" style="width:100%;margin-bottom:8px">${esc(t('resetDemo'))}</button>` : ''}
      <div class="muted" style="font-size:12px">${esc(t('version'))} ${esc(S.version || '')}</div>`;
    const p = modal({ title: t('session'), body, okText: t('logout'), cancelText: t('close'), danger: true, onOpen: m => { const rb = $('#resetBtn', m); if (rb) rb.onclick = async () => { $('#modal').hidden = true; if (!await modal({ title: t('resetDemo'), body: `<p>${esc(t('resetAsk'))}</p>`, danger: true, okText: t('confirm') })) return; try { await api('/api/admin/reset-demo', { method: 'POST' }); S.opts = {}; toast(t('resetDone'), 'ok'); go('#/'); } catch (e) { fail(e); } }; } });
    if (await p) { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; S.meta = null; render(); }
  }

  // ── LOGIN ──
  async function viewLogin() {
    let pin = '';
    let demo = [];
    try { demo = await api('/api/demo-users'); } catch (_) {}
    $('#app').innerHTML = `<div class="login">
      <section class="hero"><div><div class="logo"><span class="mark" style="width:40px;height:40px"><svg viewBox="0 0 24 24" style="width:26px;height:26px">${IC.logo}</svg></span><span style="font-size:18px">MNA de México<small>${esc(t('app'))}</small></span></div>
        <h1>${esc(t('heroTitle'))}</h1><p>${esc(t('heroSub'))}</p>
        <ul>${['hero1', 'hero2', 'hero3', 'hero4', 'hero5'].map(k => `<li>${ic('check')}<span>${esc(t(k))}</span></li>`).join('')}</ul></div>
        <div class="foot">© ${new Date().getFullYear()} MNA de México · Ventas y Contabilidad · SAP Business One</div></section>
      <section class="panel"><div class="pinbox">
        <h2>${esc(t('enterPin'))}</h2><div class="sub">${esc(t('pinSub'))}</div>
        <div class="dots" id="dots">${'<i></i>'.repeat(6)}</div>
        <input id="pinInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" aria-label="PIN">
        <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button data-c class="act">${esc(t('clear'))}</button><button data-n="0">0</button><button data-go class="act" style="background:var(--accent);border-color:var(--accent)">${esc(t('enter'))}</button></div>
        <div class="pinerr" id="pinErr"></div>
        ${demo.length ? `<details class="demo"><summary>${esc(t('demoUsers'))}</summary>${demo.filter(d => d.pin).map(d => `<div class="du" data-pin="${esc(d.pin)}"><span><b>${esc(d.name)}</b><br><span class="muted">${esc(L(d.role_l) || d.role)} · ${esc(d.position || '')}</span></span><code>${esc(d.pin)}</code></div>`).join('')}</details>` : ''}
      </div></section></div>`;
    const draw = () => $$('#dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const submit = async () => {
      if (pin.length < 4) return;
      try { await api('/api/login', { method: 'POST', body: { pin } }); pin = ''; await boot(); }
      catch (e) { $('#pinErr').textContent = e.message; pin = ''; draw(); }
    };
    $$('.pad [data-n]').forEach(b => b.onclick = () => { if (pin.length < 6) { pin += b.dataset.n; draw(); $('#pinErr').textContent = ''; } });
    $('.pad [data-c]').onclick = () => { pin = ''; draw(); };
    $('.pad [data-go]').onclick = submit;
    $$('.du').forEach(d => d.onclick = () => { pin = d.dataset.pin; draw(); submit(); });
    document.onkeydown = e => { if (S.me) return; if (/^\d$/.test(e.key) && pin.length < 6) { pin += e.key; draw(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); draw(); } else if (e.key === 'Enter') submit(); };
  }

  // ── DASHBOARD ──
  function kpiTile(k) {
    let delta = '';
    if (k.base != null && k.v != null && k.base !== '') {
      const d = +k.v - +k.base; const better = k.lowerBetter ? d < 0 : d > 0;
      const val = k.t === 'pct' ? F.num(Math.abs(d)) + ' pts' : k.t === 'money' ? F.money(Math.abs(d)) : F.num(Math.abs(d));
      delta = `<span class="delta ${d === 0 ? 'neutral' : better ? 'good' : 'bad'}">${d < 0 ? '▼' : d > 0 ? '▲' : '='} ${val} ${esc(t('vsBaseline'))}</span>`;
    } else if (k.k && ['cn', 'dfr', 'hours'].includes(k.k)) delta = `<span class="delta neutral">${esc(t('toQuantify'))}</span>`;
    const v = k.t === 'money' ? F.money(k.v) : k.t === 'pct' ? F.pct(k.v) : k.t === 'day' ? (k.v == null ? '—' : 'D+' + k.v) : k.t === 'text' ? esc(k.v) : F.num(k.v);
    return `<${k.href ? `a href="${k.href}"` : 'div'} class="kpi ${k.tone ? 'tone-' + k.tone : ''}"><div class="l">${esc(L(k.l))}</div><div class="v">${v}</div>${k.sub ? `<div class="s">${esc(L(k.sub))}</div>` : ''}${delta}</${k.href ? 'a' : 'div'}>`;
  }
  function hbars(items, tt, series) {
    const max = Math.max(1, ...items.map(i => Math.max(+i.v || 0, +i.v2 || 0)));
    const f = v => (tt === 'money' ? F.money(v) : tt === 'pct' ? F.pct(v) : F.num(v));
    return (series ? `<div class="legend"><span><i style="background:#A9B6C4"></i>${esc(L(series[0]))}</span><span><i style="background:var(--accent)"></i>${esc(L(series[1]))}</span></div>` : '') +
      `<div class="hbars">${items.map(i => `<div class="hbar"><div class="lab"><b>${esc(L(i.label))}</b><span>${i.v2 != null ? f(i.v) + ' → <b style="color:var(--ink)">' + f(i.v2) + '</b>' : f(i.v)}</span></div>${i.v2 != null ? `<div class="track"><div class="fill base" style="width:${Math.max(0, (+i.v || 0) / max * 100)}%"></div></div><div class="track b2"><div class="fill" style="width:${Math.max(0, (+i.v2 || 0) / max * 100)}%"></div></div>` : `<div class="track"><div class="fill" style="width:${Math.max(0, (+i.v || 0) / max * 100)}%"></div></div>`}</div>`).join('')}</div>`;
  }
  function vbars(items, tt) {
    const max = Math.max(1, ...items.map(i => +i.v || 0));
    const f = v => (tt === 'money' ? (Math.abs(v) >= 1e6 ? '$' + F.num(v / 1e6) + 'M' : Math.abs(v) >= 1e3 ? '$' + F.num(Math.round(v / 1e3)) + 'k' : F.money(v)) : tt === 'pct' ? F.pct(v) : F.num(v));
    return `<div class="vbars">${items.map(i => `<div class="vbar"><div class="col" style="height:${Math.max(2, (+i.v || 0) / max * 100)}%"><span>${f(i.v)}</span></div><div class="x">${esc(L(i.label))}</div></div>`).join('')}</div>`;
  }
  function gantt(inits) {
    const wk = Array.from({ length: 16 }, (_, i) => `<div>${t('week')}${i + 1}</div>`).join('');
    const ST = { pendiente: ['Pendiente', 'Pending'], en_curso: ['En curso', 'In progress'], en_riesgo: ['En riesgo', 'At risk'], terminada: ['Terminada', 'Completed'] };
    return `<div class="gantt"><div class="weeks"><div></div>${wk}</div>${inits.map(i => `<div class="row"><div class="nm">${esc(i.code)} · ${esc(i.name)}<small>${esc(i.owner || '')}</small></div><div style="grid-column:${(+i.week_from || 1) + 1} / ${(+i.week_to || 1) + 2}"><div class="bar ${esc(i.status)}" title="${esc(L(ST[i.status] || [i.status, i.status]))}"><div class="p" style="width:${+i.pct || 0}%"></div><span style="position:relative">${F.pct(i.pct || 0)} · ${esc(L(ST[i.status] || [i.status, i.status]))}</span></div></div></div>`).join('')}</div>`;
  }
  async function viewDashboard() {
    if (S.me.role === 'PROV') return viewPortal();
    if (S.me.role === 'CHOF') return viewDriver();
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const [d, ib] = await Promise.all([api('/api/dashboard'), api('/api/inbox')]);
    const PS = ['cotizacion', 'borrador', 'por_aprobar', 'retenido', 'confirmado', 'en_produccion', 'listo', 'programado', 'en_ruta', 'entregado'];
    const hello = S.lang === 'en' ? 'Hello' : 'Buen día';
    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs">${esc(t('brand'))}</div><h1>${hello}, ${esc(S.me.name.split(' ')[0] === 'Dr.' ? S.me.name : S.me.name.split(' ')[0])}</h1><div class="desc">${esc(new Date().toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
      <div class="acts"><a class="btn" href="#/diag">${ic('map')}${esc(t('diag'))}</a>${ENT('orders') && ENT('orders').canWrite ? `<a class="btn pri" href="#/e/orders/new">${ic('plus')}${esc(L(ENT('orders').one))}</a>` : ''}</div></div>
      <div class="kpis">${d.kpis.map(kpiTile).join('')}</div>
      <div class="grid g2">
        <div class="card"><div class="ch"><h3>${esc(t('inbox'))}</h3><a class="btn sm ghost" href="#/inbox">${esc(t('viewAll'))}</a></div><div class="inbox">${ib.items.length ? ib.items.slice(0, 8).map(i => `<a href="${i.href}"><span class="n">${i.n}</span><span class="lbl">${esc(L(i.l))}</span>${ic('chev', 'i14')}</a>`).join('') : `<div class="empty">${ic('check')}<div>${esc(t('nothingPending'))}</div></div>`}</div></div>
        <div class="card"><div class="ch"><h3>${esc(t('gapByArea'))}</h3><a class="btn sm ghost" href="#/r/gap">${esc(t('viewAll'))}</a></div><div class="cb">${hbars(d.gap.slice().sort((a, b) => b.v2 - a.v2), 'pct', [['Diagnóstico sep-2026', 'Baseline Sep-2026'], ['Hoy', 'Today']])}</div></div>
        <div class="card"><div class="ch"><h3>${esc(t('cnTrend'))}</h3><a class="btn sm ghost" href="#/r/credit_notes">${esc(t('viewAll'))}</a></div><div class="cb">${vbars(d.cn6, 'num')}</div></div>
        <div class="card"><div class="ch"><h3>${esc(t('pipeline'))}</h3><a class="btn sm ghost" href="#/e/orders">${esc(t('viewAll'))}</a></div><div class="cb"><div class="hbars">${hbars(PS.map(s => ({ label: statusOf('orders', s).l, v: (d.pipeline.find(p => p.status === s) || {}).c || 0 })).filter(x => x.v), 'num')}</div></div></div>
        <div class="card span2"><div class="ch"><h3>${esc(t('roadmap'))}</h3><a class="btn sm ghost" href="#/e/initiatives">${esc(t('viewAll'))}</a></div><div class="cb">${gantt(d.initiatives)}</div></div>
      </div>`;
  }

  async function viewInbox() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const ib = await api('/api/inbox');
    $('#main').innerHTML = `<div class="ph"><div class="t"><h1>${esc(t('inbox'))}</h1></div><div class="acts"><button class="btn" id="mr">${ic('check')}${esc(t('markRead'))}</button></div></div>
      <div class="grid g2"><div class="card"><div class="ch"><h3>${esc(t('pending'))}</h3></div><div class="inbox">${ib.items.length ? ib.items.map(i => `<a href="${i.href}"><span class="n">${i.n}</span><span class="lbl">${esc(L(i.l))}</span>${ic('chev', 'i14')}</a>`).join('') : `<div class="empty">${ic('check')}<div>${esc(t('nothingPending'))}</div></div>`}</div></div>
      <div class="card"><div class="ch"><h3>${esc(t('notifications'))}</h3></div><div class="notes">${ib.notes.length ? ib.notes.map(n => `<div class="it ${n.read ? '' : 'unread'}">${n.link ? `<a href="${esc(n.link)}">` : ''}<b>${esc(n.title)}</b>${n.link ? '</a>' : ''}<div>${esc(n.body || '')}</div><small>${F.datetime(n.ts)}</small></div>`).join('') : `<div class="empty">${esc(t('noRows'))}</div>`}</div></div></div>`;
    $('#mr').onclick = async () => { await api('/api/notifications/read', { method: 'POST' }); S.unread = 0; viewInbox(); };
  }

  // ── DIAGNOSTIC ──
  async function viewDiag() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const [rep, sp, ini] = await Promise.all([api('/api/report/gap'), api('/api/e/subprocesses'), api('/api/e/initiatives')]);
    const CH = [['o2c', 'Order to Cash'], ['p2p', 'Procure to Pay'], ['p2prod', 'Plan to Produce'], ['r2r', 'Record to Report']];
    const own = (ini.refs.users || {});
    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs">Baseline Consulting · ${S.lang === 'en' ? 'Sales & Accounting vs SAP B1 best practices' : 'Ventas y Contabilidad vs. mejores prácticas SAP B1'}</div><h1>${esc(t('diag'))}</h1><div class="desc">${S.lang === 'en' ? 'Each of the 55 assessed subprocesses is mapped to the module that solves it. As owners move them to "Done", the gap index recalculates live.' : 'Cada uno de los 55 subprocesos evaluados está ligado al módulo que lo resuelve. Conforme los dueños los pasan a "Se hace", el índice de brecha se recalcula en vivo.'}</div></div>
      <div class="acts"><a class="btn" href="#/e/subprocesses">${esc(t('subprocesses'))}</a><a class="btn" href="#/r/gap">${ic('report')}${esc(t('gapByArea'))}</a></div></div>
      <div class="kpis">${rep.kpis.map(kpiTile).join('')}</div>
      <div class="grid g2">
        <div class="card"><div class="ch"><h3>${esc(t('gapByArea'))}</h3></div><div class="cb">${hbars(rep.charts[0].items, 'pct', rep.charts[0].series)}<div class="note">${esc(L(rep.note))}</div></div></div>
        <div class="card"><div class="ch"><h3>${esc(t('roadmap'))}</h3></div><div class="cb">${gantt(ini.rows.map(i => Object.assign({}, i, { owner: own[i.owner_id] })))}</div></div>
        <div class="card span2"><div class="ch"><h3>${esc(t('valueChains'))}</h3><div class="legend" style="margin:0"><span><i style="background:#B5E2CB"></i>${esc(t('legendDone'))}</span><span><i style="background:#F2DDB0"></i>${esc(t('legendOpt'))}</span><span><i style="background:#F3C7C7"></i>${esc(t('legendNo'))}</span><span><i style="background:#E3E8EE"></i>${esc(t('legendNA'))}</span></div></div><div class="cb">
          ${CH.map(([k, n]) => `<div class="chain"><h4>${esc(n)} <span class="chip plain">${sp.rows.filter(r => r.chain === k).length}</span></h4><div class="flow">${sp.rows.filter(r => r.chain === k).map(r => `<a class="node ${esc(r.current)}" href="#/e/subprocesses/${r.id}" title="${esc(r.finding || '')}"><b>${esc(r.ref)}</b>${esc(r.name)}</a>`).join('')}</div></div>`).join('')}
        </div></div>
      </div>`;
  }

  // ── PORTAL & DRIVER homes ──
  async function viewPortal() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const [ib, inv, gr] = await Promise.all([api('/api/inbox'), api('/api/e/supplier_invoices'), api('/api/e/goods_receipts')]);
    const open = gr.rows.filter(r => r.status === 'registrada');
    $('#main').innerHTML = `<div class="ph"><div class="t"><h1>${esc(t('portalTitle'))}</h1><div class="desc">${esc(t('portalSub'))}</div></div><div class="acts"><a class="btn pri" href="#/e/supplier_invoices/new">${ic('up')}${esc(t('uploadInvoice'))}</a></div></div>
      <div class="kpis">${kpiTile({ l: [t('myReceipts'), t('myReceipts')], v: open.length, t: 'num', href: '#/e/goods_receipts' })}${kpiTile({ l: [t('myInvoices'), t('myInvoices')], v: inv.rows.length, t: 'num', href: '#/e/supplier_invoices' })}${kpiTile({ l: [S.lang === 'en' ? 'Paid' : 'Pagadas', 'Paid'], v: inv.rows.filter(r => r.status === 'pagada').length, t: 'num', tone: 'good', href: '#/e/supplier_invoices?status=pagada' })}${kpiTile({ l: [S.lang === 'en' ? 'Exceptions' : 'Con excepción', 'Exceptions'], v: inv.rows.filter(r => r.status === 'excepcion').length, t: 'num', tone: 'bad', href: '#/e/supplier_invoices?status=excepcion' })}</div>
      <div class="grid g2"><div class="card"><div class="ch"><h3>${esc(t('myReceipts'))}</h3></div><div class="inbox">${open.length ? open.map(r => `<a href="#/e/supplier_invoices/new?gr_id=${r.id}"><span class="n">${ic('up', 'i14')}</span><span class="lbl">${esc(r.folio)} · ${F.date(r.date)} · ${F.money(r.amount)}</span><span class="chip blue">${esc(t('uploadInvoice'))}</span></a>`).join('') : `<div class="empty">${esc(t('noRows'))}</div>`}</div></div>
      <div class="card"><div class="ch"><h3>${esc(t('pending'))}</h3></div><div class="inbox">${ib.items.length ? ib.items.map(i => `<a href="${i.href}"><span class="n">${i.n}</span><span class="lbl">${esc(L(i.l))}</span></a>`).join('') : `<div class="empty">${esc(t('nothingPending'))}</div>`}</div></div></div>`;
  }
  async function viewDriver() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const d = await api('/api/e/deliveries?status=pendiente');
    $('#main').innerHTML = `<div class="ph"><div class="t"><h1>${esc(t('driverTitle'))}</h1><div class="desc">${esc(t('driverSub'))}</div></div></div>
      ${d.rows.length ? d.rows.map(r => `<a class="rcard" href="#/e/deliveries/${r.id}"><div class="top"><div class="ttl">${esc((d.refs.customers || {})[r.customer_id] || '')}</div>${chip('deliveries', r.status)}</div><div class="kv"><span class="k">${S.lang === 'en' ? 'Order' : 'Pedido'}</span><span class="v">${esc((d.refs.orders || {})[r.order_id] || '')}</span><span class="k">${S.lang === 'en' ? 'Load' : 'Carga'}</span><span class="v">${esc((d.refs.loads || {})[r.load_id] || '')}</span></div></a>`).join('') : `<div class="card"><div class="empty">${ic('check')}<div>${esc(t('nothingPending'))}</div></div></div>`}`;
  }

  // ── LIST ──
  async function viewList(ent) {
    const e = ENT(ent); if (!e) return notFound();
    const q = qs();
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const serverQ = Object.entries(q).filter(([k]) => k.startsWith('f_')).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const data = await api(`/api/e/${ent}?${serverQ}`);
    let status = q.status || '', term = q.q || '', ff = {};
    const cols = e.fields.filter(f => f.list).slice(0, 8);
    const filt = e.fields.filter(f => f.filter && (f.t === 'select' || f.t === 'ref' || f.t === 'text'));
    const fopts = {};
    for (const f of filt) fopts[f.k] = f.t === 'select' ? f.opts.map(o => [o[0], S.lang === 'en' ? o[2] : o[1]]) : f.t === 'ref' ? [...new Set(data.rows.map(r => r[f.k]).filter(Boolean))].map(id => [String(id), ((data.refs[f.ref] || {})[id]) || '#' + id]) : [...new Set(data.rows.map(r => r[f.k]).filter(Boolean))].sort().map(v => [v, v]);
    const titleField = e.fields.find(f => f.k === e.title) || cols[0];
    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs">${esc(L((S.meta.groups.find(g => g[0] === e.g) || []).slice(1, 3)))}</div><h1>${esc(L(e.l))}</h1></div>
      <div class="acts">${e.canWrite ? `<button class="btn" id="impBtn">${ic('up')}${esc(t('import'))}</button>` : ''}<a class="btn" href="/api/e/${ent}?format=csv&lang=${S.lang}&${serverQ}">${ic('down')}${esc(t('export'))}</a>${e.canWrite ? `<a class="btn pri" href="#/e/${ent}/new${serverQ ? '?' + serverQ : ''}">${ic('plus')}${esc(t('new'))}</a>` : ''}</div></div>
      ${e.statuses ? `<div class="tabs" id="tabs"></div>` : ''}
      <div class="toolbar"><div class="search">${ic('search')}<input id="q" placeholder="${esc(t('search'))}" value="${esc(term)}"></div>${filt.map(f => `<select data-f="${f.k}"><option value="">${esc(L(f.l))}: ${esc(t('all'))}</option>${fopts[f.k].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`).join('')}<span class="muted" id="cnt"></span></div>
      <div id="listBody"></div>`;
    const draw = () => {
      const low = term.toLowerCase();
      const rows = data.rows.filter(r => (!status || r.status === status) && Object.entries(ff).every(([k, v]) => !v || String(r[k]) === v) && (!low || cols.concat([titleField]).some(f => String(f.t === 'ref' ? ((data.refs[f.ref] || {})[r[f.k]] || '') : f.t === 'select' ? optLabel(f, r[f.k]) : r[f.k] == null ? '' : r[f.k]).toLowerCase().includes(low)) || String(r.id) === low));
      if (e.statuses) {
        const cnt = s => data.rows.filter(r => r.status === s).length;
        $('#tabs').innerHTML = `<span class="tab ${!status ? 'on' : ''}" data-s="">${esc(t('all'))} <span class="n">${data.rows.length}</span></span>` + e.statuses.filter(s => cnt(s.k)).map(s => `<span class="tab ${status === s.k ? 'on' : ''}" data-s="${s.k}">${esc(L(s.l))} <span class="n">${cnt(s.k)}</span></span>`).join('');
        $$('#tabs .tab').forEach(tb => tb.onclick = () => { status = tb.dataset.s; draw(); });
      }
      $('#cnt').textContent = rows.length + ' ' + t('records');
      if (!rows.length) { $('#listBody').innerHTML = `<div class="card"><div class="empty">${ic('file')}<div>${esc(t('noRows'))}</div></div></div>`; return; }
      const thc = f => (NUMT.includes(f.t) ? 'num' : f.t === 'bool' ? 'ctr' : '');
      const tbl = `<div class="tbl-wrap list"><table class="tbl"><thead><tr>${cols.map(f => `<th class="${thc(f)}">${esc(L(f.l))}</th>`).join('')}${e.statuses ? `<th>${esc(t('status'))}</th>` : ''}</tr></thead><tbody>${rows.map(r => `<tr class="click" data-id="${r.id}">${cols.map((f, i) => `<td class="${thc(f)} ${i === 0 ? 'strong' : ''}">${disp(f, r[f.k], data.refs)}</td>`).join('')}${e.statuses ? `<td>${chip(ent, r.status)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
      const sub = cols.filter(f => f !== titleField).slice(0, 5);
      const cards = `<div class="cards">${rows.map(r => `<a class="rcard" href="#/e/${ent}/${r.id}"><div class="top"><div class="ttl">${disp(titleField, r[titleField.k], data.refs)}</div>${e.statuses ? chip(ent, r.status) : ''}</div><div class="kv">${sub.map(f => `<span class="k">${esc(L(f.l))}</span><span class="v ${NUMT.includes(f.t) ? 'num' : ''}">${disp(f, r[f.k], data.refs)}</span>`).join('')}</div></a>`).join('')}</div>`;
      $('#listBody').innerHTML = tbl + cards;
      $$('#listBody tr.click').forEach(tr => tr.onclick = () => go(`#/e/${ent}/${tr.dataset.id}`));
    };
    $('#q').oninput = ev => { term = ev.target.value; draw(); };
    $$('[data-f]').forEach(s => s.onchange = () => { ff[s.dataset.f] = s.value; draw(); });
    const ib = $('#impBtn'); if (ib) ib.onclick = () => importDialog(ent);
    draw();
  }
  async function importDialog(ent) {
    const e = ENT(ent);
    const cols = e.fields.filter(f => !f.ro && f.t !== 'file' && f.t !== 'pin');
    const tpl = '﻿' + cols.map(f => '"' + L(f.l) + '"').join(',') + '\r\n';
    const href = URL.createObjectURL(new Blob([tpl], { type: 'text/csv' }));
    const r = await modal({ title: t('importTitle') + ' — ' + L(e.l), okText: t('import'), body: `<p class="muted" style="margin-top:0">${esc(t('importHelp'))}</p><p><a href="${href}" download="${ent}-plantilla.csv">${ic('down', 'i14')} ${esc(t('template'))}</a></p><div class="fld"><label>${esc(t('chooseFile'))}</label><input type="file" name="file" accept=".csv,text/csv"></div>` });
    if (!r || !r.file) return;
    try { const text = await r.file.text(); const out = await api(`/api/e/${ent}/import`, { method: 'POST', body: text, headers: { 'content-type': 'text/csv' } }); toast(t('importOk', { n: out.imported }), 'ok'); S.opts = {}; render(); } catch (e2) { fail(e2); }
  }

  // ── DETAIL / FORM ──
  async function viewDetail(ent, id) {
    const e = ENT(ent); if (!e) return notFound();
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const isNew = id === 'new';
    let d;
    if (isNew) {
      const row = {}; for (const f of e.fields) if (f.def !== undefined) row[f.k] = f.def;
      const q = qs(); for (const [k, v] of Object.entries(q)) { const kk = k.replace(/^f_/, ''); if (e.fields.some(f => f.k === kk)) row[kk] = /^\d+$/.test(v) ? +v : v; }
      if (e.fields.some(f => f.k === 'date') && !row.date) row.date = new Date().toLocaleDateString('en-CA');
      row.lines = []; row.status = e.initial; d = { row, refs: {}, history: [], locked: false };
    } else d = await api(`/api/e/${ent}/${id}`);
    const row = d.row;
    const editable = e.canWrite && !d.locked;
    const refFields = [...e.fields.filter(f => f.t === 'ref'), ...(e.lines || []).filter(f => f.t === 'ref')];
    const optMap = {};
    if (editable) await Promise.all([...new Set(refFields.map(f => f.ref))].map(async r => { if (S.meta.entities[r]) optMap[r] = await opts(r, ent === 'loads' && r === 'orders' ? 'listo,confirmado,programado' : ent === 'supplier_invoices' && r === 'goods_receipts' ? 'registrada' : ''); }));
    const lines = (row.lines || []).map(l => Object.assign({}, l));
    const title = isNew ? (S.lang === 'en' ? 'New ' : 'Nuevo: ') + L(e.one) : (row[e.title] ? (e.fields.find(f => f.k === e.title).t === 'ref' ? disp(e.fields.find(f => f.k === e.title), row[e.title], d.refs) : esc(row[e.title])) : L(e.one) + ' #' + row.id);
    const flows = isNew ? [] : (e.flow || []).filter(f => f.from.includes(row.status));
    const actions = isNew ? [] : (e.actions || []).filter(a => !a.when || a.when.includes(row.status));
    const statusSteps = e.statuses ? e.statuses.filter(s => !['cancelado', 'rechazada', 'rechazado', 'cancelada', 'excepcion', 'retenido', 'por_aprobar', 'parcial', 'bloqueado', 'inactivo', 'obsoleta', 'en_riesgo', 'vencido', 'agotado', 'cotizacion'].includes(s.k) || s.k === row.status) : [];
    const curIdx = statusSteps.findIndex(s => s.k === row.status);

    const fieldHtml = f => {
      const v = row[f.k];
      const full = f.t === 'longtext' || f.k === 'alerts' || f.k === 'match_note' || f.k === 'decision' || f.k === 'policy_check';
      const label = `<label for="f_${f.k}">${esc(L(f.l))}${f.req && editable && !f.ro ? '<span class="req">*</span>' : ''}</label>`;
      const help = f.help ? `<div class="help">${esc(L(f.help))}</div>` : '';
      if (!editable || f.ro) {
        if (f.t === 'file') return `<div class="fld ${full ? 'full' : ''}">${label}<div class="filebox">${v ? fileView(v) : '<span class="muted">—</span>'}</div></div>`;
        const alert = (f.k === 'alerts' || f.k === 'match_note') && v;
        return `<div class="fld ${full ? 'full' : ''}">${label}<div class="ro ${NUMT.includes(f.t) ? 'num' : ''} ${alert ? 'alert' : ''}">${f.t === 'longtext' || f.k === 'alerts' ? esc(v || '—') : disp(f, v, d.refs)}</div>${help}</div>`;
      }
      let input;
      const val = v == null ? '' : v;
      switch (f.t) {
        case 'longtext': input = `<textarea id="f_${f.k}" name="${f.k}">${esc(val)}</textarea>`; break;
        case 'select': input = `<select id="f_${f.k}" name="${f.k}"><option value=""></option>${f.opts.map(o => `<option value="${esc(o[0])}" ${String(val) === o[0] ? 'selected' : ''}>${esc(S.lang === 'en' ? o[2] : o[1])}</option>`).join('')}</select>`; break;
        case 'ref': { const op = optMap[f.ref] || []; const has = op.some(o => o.id === v); input = `<select id="f_${f.k}" name="${f.k}"><option value=""></option>${!has && v ? `<option value="${v}" selected>${esc(((d.refs || {})[f.ref] || {})[v] || '#' + v)}</option>` : ''}${op.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`; break; }
        case 'bool': input = `<label class="chk"><input type="checkbox" id="f_${f.k}" name="${f.k}" ${v ? 'checked' : ''}> ${esc(t('yes'))}</label>`; break;
        case 'date': input = `<input type="date" id="f_${f.k}" name="${f.k}" value="${esc(String(val).slice(0, 10))}">`; break;
        case 'datetime': input = `<input type="datetime-local" id="f_${f.k}" name="${f.k}" value="${val ? new Date(new Date(val).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}">`; break;
        case 'num': case 'money': case 'pct': case 'int': input = `<input type="number" step="${f.t === 'int' ? '1' : 'any'}" inputmode="decimal" class="num" id="f_${f.k}" name="${f.k}" value="${esc(val)}">`; break;
        case 'pin': input = `<input type="password" inputmode="numeric" maxlength="6" id="f_${f.k}" name="pin" autocomplete="new-password">`; break;
        case 'file': input = `<div class="filebox" data-file="${f.k}"><input type="hidden" name="${f.k}" value="${esc(val)}"><span class="fv">${v ? fileView(v) : ''}</span><label class="btn sm">${ic(f.k === 'photo' ? 'camera' : 'up')}${esc(f.k === 'photo' ? t('takePhoto') : t('upload'))}<input type="file" hidden ${f.k === 'photo' ? 'accept="image/*" capture="environment"' : f.accept ? `accept="${f.accept}"` : 'accept=".pdf,.xml,image/*"'}></label></div>`; break;
        default: input = `<input type="text" id="f_${f.k}" name="${f.k}" value="${esc(val)}">`;
      }
      return `<div class="fld ${full ? 'full' : ''}">${label}${input}${help}</div>`;
    };
    const main = e.fields.filter(f => !(isNew && f.ro && (row[f.k] == null || row[f.k] === '')));

    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs"><a href="#/e/${ent}">${esc(L(e.l))}</a></div><h1>${title}</h1>
        ${e.statuses && !isNew ? `<div class="statusline" style="margin-top:8px">${chip(ent, row.status)}${row.updated_at ? `<span class="muted" style="font-size:12px">${F.datetime(row.updated_at)}</span>` : ''}</div>${statusSteps.length > 2 ? `<div class="steps">${statusSteps.map((s, i) => `<span class="step ${i < curIdx ? 'done' : i === curIdx ? 'cur' : ''}">${esc(L(s.l))}</span>`).join('')}</div>` : ''}` : ''}</div>
        <div class="acts"><a class="btn" href="#/e/${ent}">${ic('back')}${esc(t('back'))}</a>${!isNew && e.canDelete ? `<button class="btn danger" id="delBtn">${esc(t('del'))}</button>` : ''}${editable ? `<button class="btn pri" id="saveBtn">${ic('check')}${esc(t('save'))}</button>` : ''}</div></div>
      <div class="dgrid"><div>
        <div class="card"><div class="cb">
          ${d.locked && e.canWrite ? `<div class="note" style="margin:0 0 14px">${esc(t('locked'))}</div>` : ''}
          ${ent === 'deliveries' && flows.length ? `<div class="note" style="margin:0 0 14px">${ic('camera', 'i14')} ${esc(t('gpsNote'))}</div>` : ''}
          <form class="form" id="frm" onsubmit="return false">${main.map(fieldHtml).join('')}</form>
          ${e.lines ? `<div class="mt"><div class="secttl">${esc(t('lines'))}</div><div class="lines" id="lines"></div></div>` : ''}
        </div>
        ${flows.length || actions.length ? `<div class="flowbar">${actions.map(a => `<button class="btn" data-act="${a.k}">${ic('bolt')}${esc(L(a.l))}</button>`).join('')}${flows.map(f => `<button class="btn flow ${/rechaz|cancel|excep|bloque|deshacer|riesgo|obsolet|desactiv/i.test(f.to + L(f.l)) ? 'neg' : ''}" data-to="${f.to}" data-c="${f.comment ? 1 : ''}">${esc(L(f.l))}</button>`).join('')}</div>` : ''}
        </div>
        ${d.extra && d.extra.table ? `<div class="card mt"><div class="cb">${reportTable(d.extra.table)}</div></div>` : ''}
      </div>
      <div>${d.extra && d.extra.links ? `<div class="card mb16"><div class="ch"><h3>${esc(t('related'))}</h3></div><div class="cb links">${d.extra.links.map(l => `<a href="${esc(l.href)}" ${l.href.startsWith('/api') ? 'target="_blank"' : ''}>${ic('link', 'i14')}${esc(L(l.l))}</a>`).join('')}</div></div>` : ''}
        ${!isNew ? `<div class="card"><div class="ch"><h3>${esc(t('history'))}</h3></div><div class="cb"><ul class="timeline">${d.history.length ? d.history.map(h => `<li><div class="a">${esc(t('act_' + h.action))}${h.detail && h.detail.to ? ': ' + esc(L(statusOf(ent, h.detail.from).l)) + ' → ' + esc(L(statusOf(ent, h.detail.to).l)) : ''}${h.detail && h.detail.action ? ' — ' + esc(L(h.detail.action)) : ''}</div>${h.detail && h.detail.comment ? `<div>“${esc(h.detail.comment)}”</div>` : ''}${h.action === 'update' && h.detail ? `<div class="muted">${esc(Object.keys(h.detail).map(k => { const f = e.fields.find(x => x.k === k); return f ? L(f.l) : k === 'lines' ? t('lines') : k; }).join(', '))}</div>` : ''}<div class="w">${esc(h.user_name || '')} · ${F.datetime(h.ts)}</div></li>`).join('') : `<li class="muted">—</li>`}</ul></div></div>` : ''}
      </div></div>`;

    // lines editor
    const drawLines = () => {
      if (!e.lines) return;
      const lf = e.lines;
      const cell = (l, f, i) => {
        if (!editable || f.ro) return f.t === 'ref' ? disp(f, l[f.k], d.refs) : NUMT.includes(f.t) ? disp(f, l[f.k]) : esc(l[f.k] == null ? '' : l[f.k]);
        if (f.t === 'ref') { const op = optMap[f.ref] || []; const has = op.some(o => o.id === l[f.k]); return `<select data-li="${i}" data-lk="${f.k}"><option value=""></option>${!has && l[f.k] ? `<option value="${l[f.k]}" selected>${esc(((d.refs || {})[f.ref] || {})[l[f.k]] || '#' + l[f.k])}</option>` : ''}${op.map(o => `<option value="${o.id}" ${o.id === l[f.k] ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`; }
        return `<input data-li="${i}" data-lk="${f.k}" ${NUMT.includes(f.t) ? 'type="number" step="any" inputmode="decimal" class="num"' : 'type="text"'} value="${esc(l[f.k] == null ? '' : l[f.k])}">`;
      };
      const totF = lf.find(f => f.k === 'total' || f.k === 'amount');
      const tot = totF ? lines.reduce((s, l) => s + (+l[totF.k] || 0), 0) : null;
      $('#lines').innerHTML = `<table><thead><tr><th>#</th>${lf.map(f => `<th class="${NUMT.includes(f.t) ? 'num' : ''}">${esc(L(f.l))}</th>`).join('')}${editable ? '<th></th>' : ''}</tr></thead><tbody>${lines.map((l, i) => `<tr><td class="muted">${i + 1}</td>${lf.map(f => `<td class="${NUMT.includes(f.t) && (!editable || f.ro) ? 'num' : ''}">${cell(l, f, i)}</td>`).join('')}${editable ? `<td><button class="xbtn" data-rm="${i}" aria-label="x">${ic('x')}</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${lf.length + 2}" class="muted">—</td></tr>`}</tbody></table>
        ${lines.map((l, i) => `<div class="lcard"><div class="lr"><label>#${i + 1}</label><div style="text-align:right">${editable ? `<button class="xbtn" data-rm="${i}">${ic('x')}</button>` : ''}</div></div>${lf.map(f => `<div class="lr"><label>${esc(L(f.l))}</label>${!editable || f.ro ? `<div class="ro">${cell(l, f, i)}</div>` : cell(l, f, i)}</div>`).join('')}</div>`).join('')}
        ${tot != null ? `<div class="tot"><span class="muted">${esc(t('total'))}</span><span class="pill-num">${F.money(tot)}</span></div>` : ''}
        ${editable ? `<button class="btn sm" id="addLine" style="margin-top:8px">${ic('plus')}${esc(t('addLine'))}</button>` : ''}`;
      $$('#lines [data-li]').forEach(inp => inp.onchange = () => { const f = lf.find(x => x.k === inp.dataset.lk); const vv = inp.value; lines[+inp.dataset.li][f.k] = vv === '' ? null : (f.t === 'ref' || NUMT.includes(f.t) ? +vv : vv); if (f.t === 'ref') { $$(`#lines [data-li="${inp.dataset.li}"][data-lk="${f.k}"]`).forEach(o => (o.value = vv)); } dirty = true; });
      $$('#lines [data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); dirty = true; drawLines(); });
      const al = $('#addLine'); if (al) al.onclick = () => { lines.push({}); dirty = true; drawLines(); };
    };
    let dirty = false;
    drawLines();
    $$('#frm input, #frm select, #frm textarea').forEach(i => i.addEventListener('change', () => (dirty = true)));
    // file uploads
    $$('#frm [data-file]').forEach(box => {
      const fi = $('input[type=file]', box);
      fi.onchange = async () => {
        const file = fi.files[0]; if (!file) return;
        $('.fv', box).textContent = t('uploading');
        try {
          const blob = file.type.startsWith('image/') && file.size > 1.5e6 ? await shrink(file) : file;
          const r = await api('/api/files', { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) } });
          $('input[type=hidden]', box).value = r.id; $('.fv', box).innerHTML = fileView(r.id, file.name, blob.type); dirty = true;
        } catch (er) { $('.fv', box).textContent = ''; fail(er); }
      };
    });
    const collect = () => {
      const o = {};
      $$('#frm [name]').forEach(i => { if (i.type === 'file') return; o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      if (e.lines) o.lines = lines;
      return o;
    };
    const save = async (quiet) => {
      const b = $('#saveBtn'); if (b) { b.disabled = true; b.innerHTML = esc(t('saving')); }
      try {
        const r = isNew ? await api(`/api/e/${ent}`, { method: 'POST', body: collect() }) : await api(`/api/e/${ent}/${id}`, { method: 'PUT', body: collect() });
        S.opts = {}; dirty = false;
        if (!quiet) toast(isNew ? t('created') : t('saved'), 'ok');
        if (isNew) go(`#/e/${ent}/${r.row.id}`); else if (!quiet) viewDetail(ent, id);
        return r.row;
      } catch (er) { fail(er); if (b) { b.disabled = false; b.innerHTML = ic('check') + esc(t('save')); } throw er; }
    };
    const sb = $('#saveBtn'); if (sb) sb.onclick = () => save().catch(() => {});
    const db = $('#delBtn'); if (db) db.onclick = async () => { if (!await modal({ title: t('del'), body: `<p>${esc(t('confirmDel'))}</p>`, danger: true, okText: t('del') })) return; try { await api(`/api/e/${ent}/${id}`, { method: 'DELETE' }); toast(t('deleted'), 'ok'); go(`#/e/${ent}`); } catch (er) { fail(er); } };
    $$('.flowbar [data-to]').forEach(b => b.onclick = async () => {
      let comment = '';
      if (b.dataset.c) { const r = await modal({ title: b.textContent, body: `<div class="fld"><label>${esc(t('comment'))} *</label><textarea name="comment"></textarea></div>` }); if (!r) return; comment = (r.comment || '').trim(); if (!comment) return toast(t('commentReq'), 'err'); }
      try {
        if (dirty && editable) await save(true);
        const body = { to: b.dataset.to, comment };
        if (ent === 'deliveries') { const vals = collect(); body.photo = vals.photo ? +vals.photo : null; body.received_by = vals.received_by; body.gps = await gps(); }
        b.disabled = true;
        await api(`/api/e/${ent}/${id}/flow`, { method: 'POST', body });
        S.opts = {}; toast(L(['Listo: ', 'Done: ']) + b.textContent, 'ok'); refreshMe(); viewDetail(ent, id);
      } catch (er) { b.disabled = false; fail(er); }
    });
    $$('.flowbar [data-act]').forEach(b => b.onclick = async () => {
      try { if (dirty && editable) await save(true); b.disabled = true; const r = await api(`/api/e/${ent}/${id}/act/${b.dataset.act}`, { method: 'POST', body: {} }); S.opts = {}; toast(L(r.msg) || 'OK', 'ok'); if (r.go) go(r.go); else viewDetail(ent, id); }
      catch (er) { b.disabled = false; fail(er); }
    });
    // lazy file names
    $$('[data-fid]').forEach(async a => { try { const inf = await api('/api/files/' + a.dataset.fid + '/info'); if (inf) { a.querySelector('span').textContent = inf.name; if (/^image\//.test(inf.mime)) { const img = document.createElement('img'); img.src = '/api/files/' + inf.id; img.alt = inf.name; a.parentNode.insertBefore(img, a); } } } catch (_) {} });
  }
  const fileView = (id, name) => `<a href="/api/files/${id}" target="_blank" rel="noopener" data-fid="${name ? '' : id}">${ic('file', 'i14')} <span>${esc(name || t('viewFile'))}</span></a>`;
  async function shrink(file) {
    try {
      const img = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.82));
    } catch (_) { return file; }
  }
  const gps = () => new Promise(res => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(p => res(p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5)), () => res(null), { timeout: 6000, maximumAge: 60000 }); });

  // ── REPORT ──
  function cellFmt(c, v) {
    const tt = c.t || '';
    if (tt === 'money') return F.money(v); if (tt === 'num') return F.num(v); if (tt === 'pct') return F.pct(v); if (tt === 'date') return F.date(v); if (tt === 'datetime') return F.datetime(v);
    if (tt.startsWith('status:')) return chip(tt.split(':')[1], v);
    return esc(v == null || v === '' ? '—' : v);
  }
  function reportTable(tb) {
    if (!tb || !tb.rows.length) return `<div class="empty">${esc(t('noRows'))}</div>`;
    const cls = c => (['money', 'num', 'pct'].includes(c.t) ? 'num' : '');
    const lbl = (c, r) => (c.k === 'area' && r.area_en && S.lang === 'en' ? r.area_en : r[c.k]);
    const link = (c, r, h) => (c.t === 'link' && r.link ? `<a href="${esc(r.link)}">${esc(r[c.k])}</a>` : h);
    const tbl = `<div class="tbl-wrap list"><table class="tbl"><thead><tr>${tb.cols.map(c => `<th class="${cls(c)}">${esc(L(c.l))}</th>`).join('')}</tr></thead><tbody>${tb.rows.map(r => `<tr>${tb.cols.map((c, i) => `<td class="${cls(c)} ${i === 0 ? 'strong' : ''}">${link(c, r, cellFmt(c, lbl(c, r)))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const [c0, ...rest] = tb.cols;
    const cards = `<div class="cards">${tb.rows.map(r => `<div class="rcard"><div class="top"><div class="ttl">${link(c0, r, cellFmt(c0, lbl(c0, r)))}</div></div><div class="kv">${rest.map(c => `<span class="k">${esc(L(c.l))}</span><span class="v ${cls(c)}">${cellFmt(c, r[c.k])}</span>`).join('')}</div></div>`).join('')}</div>`;
    return tbl + cards;
  }
  async function viewReport(k) {
    const rp = S.meta.reports.find(r => r.k === k); if (!rp) return notFound();
    const q = qs();
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const fhtml = await Promise.all((rp.filters || []).map(async f => {
      const v = q[f.k] || '';
      if (f.t === 'select') return `<select data-rf="${f.k}"><option value="">${esc(L(f.l))}</option>${f.opts.map(o => `<option value="${esc(o[0])}" ${v === o[0] ? 'selected' : ''}>${esc(S.lang === 'en' ? o[2] : o[1])}</option>`).join('')}</select>`;
      if (f.t === 'ref') { const op = await opts(f.ref); return `<select data-rf="${f.k}"><option value="">${esc(L(f.l))}: ${esc(t('all'))}</option>${op.map(o => `<option value="${o.id}" ${String(o.id) === v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`; }
      if (f.t === 'period') return `<input type="month" data-rf="${f.k}" value="${esc(v || new Date().toLocaleDateString('en-CA').slice(0, 7))}" style="height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px">`;
      return `<div class="search">${ic('search')}<input data-rf="${f.k}" placeholder="${esc(L(f.l))}" value="${esc(v)}"></div>`;
    }));
    const params = new URLSearchParams(q).toString();
    let r;
    try { r = await api(`/api/report/${k}?${params}`); } catch (e) { fail(e); r = { kpis: [] }; }
    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs">${esc(t('reports'))} · ${esc(L((S.meta.groups.find(g => g[0] === rp.g) || []).slice(1, 3)))}</div><h1>${esc(L(rp.l))}</h1>${rp.d ? `<div class="desc">${esc(L(rp.d))}</div>` : ''}</div>
      <div class="acts">${r.table ? `<a class="btn" href="/api/report/${k}?${params}&format=csv&lang=${S.lang}">${ic('down')}${esc(t('export'))}</a>` : ''}${(r.links || []).map(l => `<a class="btn ${l.href.startsWith('/api') ? 'pri' : ''}" href="${esc(l.href)}">${ic(l.href.startsWith('/api') ? 'down' : 'link')}${esc(L(l.l))}</a>`).join('')}</div></div>
      ${fhtml.length ? `<div class="toolbar">${fhtml.join('')}<button class="btn blue" id="runR">${esc(t('run'))}</button></div>` : ''}
      ${r.kpis && r.kpis.length ? `<div class="kpis">${r.kpis.map(kpiTile).join('')}</div>` : ''}
      ${r.charts && r.charts.length ? `<div class="grid ${r.charts.length > 1 ? 'g2' : ''} mb16">${r.charts.map(c => `<div class="card"><div class="ch"><h3>${esc(L(c.l))}</h3></div><div class="cb">${c.type === 'hbar' ? hbars(c.items, c.t, c.series) : vbars(c.items, c.t)}</div></div>`).join('')}</div>` : ''}
      ${r.table ? `<div class="rtable">${reportTable(r.table)}</div>` : ''}
      ${r.note ? `<div class="note">${esc(L(r.note))}</div>` : ''}
      ${r.xml ? `<details class="card mt"><summary style="padding:14px 16px;cursor:pointer;font-weight:600">${esc(t('preview'))} XML</summary><pre style="margin:0;padding:14px 16px;overflow:auto;font-size:11.5px;background:#0E1A27;color:#CFE3F5;border-radius:0 0 10px 10px;max-height:380px">${esc(r.xml)}</pre></details>` : ''}`;
    const rb = $('#runR'); if (rb) rb.onclick = () => { const p = {}; $$('[data-rf]').forEach(i => { if (i.value) p[i.dataset.rf] = i.value; }); go(`#/r/${k}?${new URLSearchParams(p)}`); };
  }

  // ── BANK MATCH ──
  async function viewBankMatch() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const [acc, lines] = await Promise.all([opts('bank_accounts'), api('/api/e/bank_lines')]);
    const sug = lines.rows.filter(r => r.status === 'sugerido');
    const pen = lines.rows.filter(r => r.status === 'pendiente' || r.status === 'excepcion');
    const lf = ENT('bank_lines').fields;
    const fld = k => lf.find(f => f.k === k);
    const list = rows => rows.length ? `<div class="tbl-wrap list"><table class="tbl"><thead><tr><th>${esc(L(fld('date').l))}</th><th>${esc(L(fld('description').l))}</th><th class="num">${esc(L(fld('amount').l))}</th><th>${esc(L(fld('match_type').l))}</th><th>${esc(t('status'))}</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-id="${r.id}"><td>${F.date(r.date)}</td><td class="strong">${esc(r.description || '')}<div class="muted">${esc((lines.refs.bank_accounts || {})[r.bank_account_id] || '')}</div></td><td class="num">${F.money(r.amount)}</td><td>${esc(r.match_type || '—')}<div class="muted">${esc(r.match_rule || '')}</div></td><td>${chip('bank_lines', r.status)}</td></tr>`).join('')}</tbody></table></div><div class="cards">${rows.map(r => `<a class="rcard" href="#/e/bank_lines/${r.id}"><div class="top"><div class="ttl">${esc(r.description || '')}</div>${chip('bank_lines', r.status)}</div><div class="kv"><span class="k">${esc(L(fld('date').l))}</span><span class="v">${F.date(r.date)}</span><span class="k">${esc(L(fld('amount').l))}</span><span class="v num">${F.money(r.amount)}</span><span class="k">${esc(L(fld('match_type').l))}</span><span class="v">${esc(r.match_type || '—')}</span></div></a>`).join('')}</div>` : `<div class="card"><div class="empty">${esc(t('noRows'))}</div></div>`;
    $('#main').innerHTML = `<div class="ph"><div class="t"><div class="crumbs">${esc(L(['Finanzas y Cierre', 'Finance & Close']))}</div><h1>${esc(t('bankTitle'))}</h1><div class="desc">${esc(t('bankDesc'))}</div></div>
      <div class="acts"><button class="btn" id="impB">${ic('up')}${esc(t('importStatement'))}</button><a class="btn" href="#/r/bank_summary">${ic('report')}${esc(t('reports'))}</a></div></div>
      <div class="toolbar"><select id="acc"><option value="">${esc(t('allAccounts'))}</option>${acc.map(a => `<option value="${a.id}">${esc(a.t)}</option>`).join('')}</select><button class="btn pri" id="runM">${ic('bolt')}${esc(t('bankRun'))}</button>${sug.length ? `<button class="btn" id="confAll">${ic('check')}${esc(t('confirmAll'))} (${sug.length})</button>` : ''}</div>
      <div class="kpis">${kpiTile({ l: ['Sugeridos por confirmar', 'Suggested to confirm'], v: sug.length, t: 'num' })}${kpiTile({ l: ['Sin conciliar / excepción', 'Unmatched / exception'], v: pen.length, t: 'num', tone: pen.length ? 'bad' : 'good' })}${kpiTile({ l: ['Conciliados', 'Matched'], v: lines.rows.filter(r => r.status === 'conciliado').length, t: 'num', tone: 'good' })}</div>
      <div class="secttl">${esc(L(statusOf('bank_lines', 'sugerido').l))}</div>${list(sug)}
      <div class="secttl mt">${esc(L(statusOf('bank_lines', 'pendiente').l))}</div>${list(pen)}`;
    $$('#main tr.click').forEach(tr => tr.onclick = () => go('#/e/bank_lines/' + tr.dataset.id));
    $('#runM').onclick = async () => { try { const r = await api('/api/bankmatch', { method: 'POST', body: { account: $('#acc').value } }); toast(t('bankRes', { a: r.checked, b: r.matched }), 'ok'); viewBankMatch(); } catch (e) { fail(e); } };
    const ca = $('#confAll'); if (ca) ca.onclick = async () => { ca.disabled = true; let n = 0; for (const r of sug) { try { await api(`/api/e/bank_lines/${r.id}/flow`, { method: 'POST', body: { to: 'conciliado' } }); n++; } catch (e) { fail(e); break; } } toast(`${n} ✓`, 'ok'); viewBankMatch(); };
    $('#impB').onclick = () => importDialog('bank_lines');
  }

  async function viewAudit() {
    shell(`<div class="boot"><div class="spinner"></div></div>`);
    const rows = await api('/api/audit');
    $('#main').innerHTML = `<div class="ph"><div class="t"><h1>${esc(t('audit'))}</h1></div></div>` + reportTable({ cols: [{ k: 'ts', l: [t('when'), t('when')], t: 'datetime' }, { k: 'user_name', l: [t('user'), t('user')] }, { k: 'role', l: [t('role'), t('role')] }, { k: 'mod', l: [t('module'), t('module')] }, { k: 'act', l: [t('action'), t('action')] }], rows: rows.map(r => Object.assign(r, { mod: (ENT(r.entity) ? L(ENT(r.entity).one) : r.entity || '') + (r.record_id ? ' #' + r.record_id : ''), act: t('act_' + r.action) + (r.detail && r.detail.to ? ' → ' + L(statusOf(r.entity, r.detail.to).l) : '') })) });
  }
  function notFound() { shell(`<div class="card"><div class="empty">${ic('x')}<div>${S.lang === 'en' ? 'Page not found or no access.' : 'Página no encontrada o sin acceso.'}</div><p><a class="btn" href="#/">${esc(t('home'))}</a></p></div></div>`); }

  // ── router ──
  async function render() {
    renderLangbar();
    if (!S.me) return viewLogin();
    document.onkeydown = null;
    const h = (location.hash || '#/').split('?')[0];
    const p = h.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    try {
      if (!p[0]) return await viewDashboard();
      if (p[0] === 'inbox') return await viewInbox();
      if (p[0] === 'diag') return await viewDiag();
      if (p[0] === 'bankmatch') return await viewBankMatch();
      if (p[0] === 'audit') return await viewAudit();
      if (p[0] === 'e' && p[1] && p[2]) return await viewDetail(p[1], p[2]);
      if (p[0] === 'e' && p[1]) return await viewList(p[1]);
      if (p[0] === 'r' && p[1]) return await viewReport(p[1]);
      notFound();
    } catch (e) { fail(e); if (!e.silent && $('#main')) $('#main').innerHTML = `<div class="card"><div class="empty">${ic('x')}<div>${esc(e.message)}</div><p><a class="btn" href="#/">${esc(t('home'))}</a></p></div></div>`; }
  }
  async function refreshMe() { try { const m = await api('/api/me'); S.unread = m.unread; S.version = m.version; } catch (_) {} }
  async function boot() {
    try {
      const me = await fetch('/api/me', { credentials: 'same-origin' });
      if (me.status === 200) { const m = await me.json(); S.me = m.user; S.unread = m.unread; S.version = m.version; S.meta = await api('/api/meta'); S.metaRoles = S.meta.roles; }
      else S.me = null;
    } catch (_) { S.me = null; }
    render();
  }
  window.addEventListener('hashchange', () => { if (S.me) refreshMe().then(render); else render(); });
  boot();
})();
