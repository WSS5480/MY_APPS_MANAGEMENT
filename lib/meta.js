'use strict';
// Metadata-driven definition of every module. Server builds tables, routes,
// validation and permissions from this; the browser builds lists and forms.

const ROLES = {
  ADMIN: ['Administrador del sistema', 'System administrator'],
  DIR: ['Dirección General', 'Executive management'],
  GV: ['Gerencia de Ventas', 'Sales management'],
  VTA: ['Asesor de Ventas', 'Sales advisor'],
  ATC: ['Atención a Clientes', 'Customer service'],
  FACT: ['Facturación', 'Billing'],
  COB: ['Crédito y Cobranza', 'Credit & collections'],
  CONT: ['Contabilidad', 'Accounting'],
  COST: ['Costos', 'Cost accounting'],
  CXP: ['Cuentas por Pagar / Tesorería', 'Payables / Treasury'],
  COMP: ['Compras y Abastecimiento', 'Purchasing & supply'],
  ALM: ['Almacén / Bodega', 'Warehouse'],
  PROD: ['Producción', 'Production'],
  LOG: ['Logística', 'Logistics'],
  CHOF: ['Chofer', 'Driver'],
  PROV: ['Proveedor (portal)', 'Supplier (portal)'],
};
const INTERNAL = Object.keys(ROLES).filter(r => r !== 'PROV');

const GROUPS = [
  ['tablero', 'Tablero', 'Dashboard', 'grid'],
  ['diagnostico', 'Diagnóstico y Hoja de ruta', 'Diagnostic & Roadmap', 'map'],
  ['ventas', 'Ventas', 'Sales', 'tag'],
  ['operacion', 'Almacén y Producción', 'Warehouse & Production', 'box'],
  ['logistica', 'Logística', 'Logistics', 'truck'],
  ['cobranza', 'Facturación y Cobranza', 'Billing & Collections', 'receipt'],
  ['compras', 'Compras y Proveedores', 'Purchasing & Suppliers', 'cart'],
  ['finanzas', 'Finanzas y Cierre', 'Finance & Close', 'bank'],
  ['activos', 'Activos Fijos', 'Fixed Assets', 'building'],
  ['costos', 'Costos y Rentabilidad', 'Costing & Profitability', 'chart'],
  ['gobernanza', 'Gobernanza', 'Governance', 'shield'],
  ['admin', 'Administración', 'Administration', 'gear'],
];

const F = (k, t, es, en, o = {}) => Object.assign({ k, t, l: [es, en] }, o);
const S = (k, es, en, c = 'gray') => ({ k, l: [es, en], c });
const T = (from, to, es, en, roles, o = {}) => Object.assign({ from: [].concat(from), to, l: [es, en], roles }, o);
const O = (...a) => a; // option tuple [key, es, en]

const COMPANY = F('company', 'select', 'Sociedad', 'Company', { opts: [O('MNA', 'MNA de México', 'MNA de México'), O('CAG', 'Compra Agro', 'Compra Agro'), O('PET', 'PET', 'PET'), O('AQUA', 'Aqua Laboratorios', 'Aqua Laboratorios'), O('TRA', 'Transportes', 'Transport'), O('SVC', 'Servicios', 'Services')], def: 'MNA' });
const CHANNEL = F('channel', 'select', 'Canal', 'Channel', { opts: [O('pecuario', 'Pecuario', 'Livestock'), O('pet', 'PET / Mascotas', 'PET'), O('ca', 'Centroamérica', 'Central America')], list: true });
const AREAS = [O('costos', 'Costos', 'Costing'), O('activos', 'Activos fijos', 'Fixed assets'), O('gobernanza', 'Gobernanza', 'Governance'), O('almacenes', 'Almacenes', 'Warehouses'), O('produccion', 'Producción', 'Production'), O('finanzas', 'Finanzas', 'Finance'), O('compras', 'Compras', 'Purchasing'), O('ventas', 'Ventas', 'Sales'), O('logistica', 'Logística', 'Logistics')];
const DIAG_STATUS = [O('se_hace', 'Se hace', 'Done in system'), O('optimizar', 'Oportunidad para optimizar', 'Needs optimization'), O('no_se_hace', 'No se hace', 'Not done'), O('no_abordado', 'No abordado', 'Not covered')];
const ROLE_OPTS = Object.entries(ROLES).map(([k, v]) => [k, v[0], v[1]]);

const E = {};

// ───────────────────────── DIAGNÓSTICO ─────────────────────────
E.subprocesses = {
  g: 'diagnostico', l: ['Subprocesos evaluados', 'Assessed subprocesses'], one: ['Subproceso', 'Subprocess'],
  read: INTERNAL, write: ['ADMIN', 'DIR', 'CONT', 'GV'], title: 'name', sort: 'ref',
  fields: [
    F('ref', 'text', 'Ref.', 'Ref.', { list: true, req: true }),
    F('area', 'select', 'Área', 'Area', { opts: AREAS, list: true, filter: true, req: true }),
    F('chain', 'select', 'Cadena de valor', 'Value chain', { opts: [O('o2c', 'Order to Cash', 'Order to Cash'), O('p2p', 'Procure to Pay', 'Procure to Pay'), O('p2prod', 'Plan to Produce', 'Plan to Produce'), O('r2r', 'Record to Report', 'Record to Report')], filter: true }),
    F('name', 'text', 'Subproceso', 'Subprocess', { list: true, req: true }),
    F('baseline', 'select', 'Estatus diagnóstico (sep-2026)', 'Baseline status (Sep-2026)', { opts: DIAG_STATUS, ro: true }),
    F('current', 'select', 'Estatus actual', 'Current status', { opts: DIAG_STATUS, list: true, filter: true, req: true }),
    F('finding', 'longtext', 'Hallazgo', 'Finding'),
    F('solution', 'longtext', 'Solución en este sistema', 'Solution in this system'),
    F('module', 'text', 'Módulo que lo resuelve', 'Module that solves it'),
    F('owner_id', 'ref', 'Dueño del proceso', 'Process owner', { ref: 'users', list: true }),
    F('initiative_id', 'ref', 'Iniciativa', 'Initiative', { ref: 'initiatives' }),
    F('target_week', 'int', 'Semana meta', 'Target week'),
    F('evidence', 'file', 'Evidencia', 'Evidence'),
  ],
};
E.initiatives = {
  g: 'diagnostico', l: ['Hoja de ruta (16 semanas)', 'Roadmap (16 weeks)'], one: ['Iniciativa', 'Initiative'],
  read: INTERNAL, write: ['ADMIN', 'DIR'], title: 'name', sort: 'code',
  statuses: [S('pendiente', 'Pendiente', 'Pending'), S('en_curso', 'En curso', 'In progress', 'blue'), S('en_riesgo', 'En riesgo', 'At risk', 'amber'), S('terminada', 'Terminada', 'Completed', 'green')],
  flow: [T(['pendiente', 'en_riesgo'], 'en_curso', 'Iniciar', 'Start', ['ADMIN', 'DIR']), T(['en_curso'], 'en_riesgo', 'Marcar en riesgo', 'Flag at risk', ['ADMIN', 'DIR']), T(['en_curso', 'en_riesgo'], 'terminada', 'Terminar', 'Complete', ['ADMIN', 'DIR'])],
  fields: [
    F('code', 'text', 'No.', 'No.', { list: true, req: true }),
    F('name', 'text', 'Iniciativa', 'Initiative', { list: true, req: true }),
    F('phase', 'select', 'Fase', 'Phase', { opts: [O('inicio', 'Punto de partida', 'Starting point'), O('definir', 'Definir cómo operar', 'Define how to operate'), O('habilitar', 'Habilitar y sostener', 'Enable & sustain')], list: true }),
    F('week_from', 'int', 'Semana inicio', 'Start week', { list: true }),
    F('week_to', 'int', 'Semana fin', 'End week', { list: true }),
    F('owner_id', 'ref', 'Responsable', 'Owner', { ref: 'users', list: true }),
    F('pct', 'pct', '% avance', '% complete', { list: true }),
    F('objective', 'longtext', 'Objetivo', 'Objective'),
    F('addresses', 'longtext', 'Hallazgos que atiende', 'Findings addressed'),
  ],
};
E.baseline_kpis = {
  g: 'diagnostico', l: ['Línea base de indicadores', 'KPI baseline'], one: ['Indicador', 'KPI'],
  read: INTERNAL, write: ['ADMIN', 'DIR', 'CONT'], title: 'name', sort: 'id',
  fields: [
    F('name', 'text', 'Indicador', 'KPI', { list: true, req: true }),
    F('unit', 'text', 'Unidad', 'Unit', { list: true }),
    F('baseline', 'num', 'Línea base', 'Baseline', { list: true }),
    F('target', 'num', 'Meta', 'Target', { list: true }),
    F('source', 'text', 'Fuente del valor actual', 'Current value source'),
  ],
};

// ───────────────────────── VENTAS ─────────────────────────
E.product_families = {
  g: 'ventas', l: ['Familias de producto', 'Product families'], one: ['Familia', 'Family'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'COMP'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Nombre', 'Name', { list: true, req: true }),
    F('parent_id', 'ref', 'Familia padre', 'Parent family', { ref: 'product_families', list: true }),
    CHANNEL,
  ],
};
E.products = {
  g: 'ventas', l: ['Catálogo de productos', 'Product catalog'], one: ['Producto', 'Product'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'COMP'], title: 'name', sort: 'code',
  fields: [
    F('code', 'text', 'Código', 'Code', { list: true, req: true, unique: true }),
    F('name', 'text', 'Descripción', 'Description', { list: true, req: true }),
    F('family_id', 'ref', 'Familia / subfamilia', 'Family / subfamily', { ref: 'product_families', list: true, filter: true }),
    CHANNEL,
    F('line_type', 'select', 'Tipo de línea', 'Line type', { opts: [O('linea', 'Línea', 'Standard'), O('especial', 'Especial', 'Special'), O('ca', 'Centroamérica', 'Central America')] }),
    F('mode', 'select', 'Fabricación', 'Make mode', { opts: [O('mts', 'Contra almacén (MTS)', 'Make to stock'), O('mto', 'Contra pedido (MTO)', 'Make to order')], def: 'mts' }),
    F('uom', 'text', 'Unidad', 'Unit', { def: 'Saco 40 kg' }),
    F('kg_unit', 'num', 'Kg por unidad', 'Kg per unit', { def: 40 }),
    F('barcode', 'text', 'Código de barras', 'Barcode'),
    F('list_price', 'money', 'Precio de lista', 'List price', { list: true, req: true }),
    F('std_cost', 'money', 'Costo estándar', 'Standard cost', { roles: ['ADMIN', 'DIR', 'COST', 'CONT'] }),
    F('discontinue', 'bool', 'Propuesto para descontinuar', 'Proposed to discontinue'),
  ],
};
E.segment_rules = {
  g: 'ventas', l: ['Reglas de segmentación', 'Segmentation rules'], one: ['Segmento', 'Segment'],
  read: INTERNAL, write: ['ADMIN', 'DIR', 'GV'], title: 'segment', sort: 'segment',
  fields: [
    F('segment', 'text', 'Segmento', 'Segment', { list: true, req: true }),
    F('min_volume', 'money', 'Compra mínima 12 meses', 'Min. 12-month purchases', { list: true }),
    F('min_months', 'int', 'Meses mínimos activo', 'Min. months active', { list: true }),
    F('max_dpd', 'int', 'Días de atraso máximos', 'Max. days past due', { list: true }),
    F('max_disc_vta', 'pct', 'Descuento que autoriza el asesor', 'Discount advisor can grant', { list: true }),
    F('max_disc_gv', 'pct', 'Descuento que autoriza Gerencia', 'Discount sales mgmt can grant', { list: true }),
    F('credit_days', 'int', 'Días de crédito estándar', 'Standard credit days'),
    F('max_line', 'money', 'Línea de crédito máxima', 'Max. credit line'),
  ],
};
E.customers = {
  g: 'ventas', l: ['Clientes', 'Customers'], one: ['Cliente', 'Customer'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'VTA', 'ATC', 'COB'], title: 'name', sort: 'name',
  statuses: [S('activo', 'Activo', 'Active', 'green'), S('bloqueado', 'Bloqueado por crédito', 'Credit hold', 'red'), S('inactivo', 'Inactivo', 'Inactive')],
  flow: [T(['activo'], 'bloqueado', 'Bloquear', 'Put on hold', ['COB', 'DIR', 'ADMIN']), T(['bloqueado', 'inactivo'], 'activo', 'Activar', 'Activate', ['COB', 'DIR', 'ADMIN']), T(['activo'], 'inactivo', 'Desactivar', 'Deactivate', ['COB', 'DIR', 'ADMIN'])],
  fields: [
    F('code', 'text', 'Código SAP', 'SAP code', { list: true, req: true, unique: true }),
    F('name', 'text', 'Razón social', 'Legal name', { list: true, req: true }),
    F('rfc', 'text', 'RFC', 'Tax ID (RFC)', { req: true }),
    CHANNEL,
    F('segment', 'text', 'Segmento', 'Segment', { list: true, ro: true, help: ['Se calcula automáticamente con las reglas de segmentación', 'Calculated automatically from segmentation rules'] }),
    F('segment_override', 'text', 'Segmento manual (Dirección)', 'Manual segment (management)'),
    F('zone', 'text', 'Zona', 'Zone', { list: true, filter: true }),
    F('route_id', 'ref', 'Ruta de entrega', 'Delivery route', { ref: 'routes' }),
    F('advisor_id', 'ref', 'Asesor', 'Advisor', { ref: 'users', list: true }),
    F('warehouse_id', 'ref', 'Bodega que surte', 'Supplying warehouse', { ref: 'warehouses' }),
    F('credit_limit', 'money', 'Línea de crédito', 'Credit line', { list: true }),
    F('credit_days', 'int', 'Días de crédito', 'Credit days'),
    F('balance', 'money', 'Saldo por cobrar', 'Open balance', { ro: true, list: true }),
    F('months_active', 'int', 'Meses como cliente', 'Months as customer'),
    F('email', 'text', 'Correo', 'Email'),
    F('phone', 'text', 'Teléfono / WhatsApp', 'Phone / WhatsApp'),
    F('address', 'longtext', 'Dirección de entrega', 'Delivery address'),
  ],
};
const ORDER_LINES = [
  F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', req: true }),
  F('qty', 'num', 'Cantidad', 'Qty', { req: true }),
  F('price', 'money', 'Precio', 'Price'),
  F('disc', 'pct', 'Desc. %', 'Disc. %'),
  F('total', 'money', 'Importe', 'Amount', { ro: true }),
  F('note', 'text', 'Nota', 'Note', { ro: true }),
];
E.orders = {
  g: 'ventas', l: ['Pedidos y cotizaciones', 'Orders & quotes'], one: ['Pedido', 'Order'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'VTA', 'ATC'], title: 'folio', sort: 'id desc', lines: ORDER_LINES,
  statuses: [
    S('cotizacion', 'Cotización', 'Quote', 'gray'), S('borrador', 'Borrador', 'Draft'), S('por_aprobar', 'Por aprobar precio', 'Price approval', 'amber'),
    S('retenido', 'Retenido por crédito', 'Credit hold', 'red'), S('confirmado', 'Confirmado', 'Confirmed', 'blue'), S('en_produccion', 'En producción', 'In production', 'purple'),
    S('listo', 'Listo para embarque', 'Ready to ship', 'teal'), S('programado', 'Programado en carga', 'Scheduled', 'teal'), S('en_ruta', 'En ruta', 'In transit', 'blue'),
    S('entregado', 'Entregado — por facturar', 'Delivered — to invoice', 'amber'), S('facturado', 'Facturado', 'Invoiced', 'green'), S('cancelado', 'Cancelado', 'Cancelled', 'red'),
  ],
  flow: [
    T(['cotizacion', 'borrador'], 'confirmado', 'Confirmar pedido', 'Confirm order', ['ADMIN', 'GV', 'VTA', 'ATC'], { guard: 'orderConfirm' }),
    T(['por_aprobar'], 'confirmado', 'Autorizar precio', 'Approve price', ['ADMIN', 'GV', 'DIR'], { guard: 'priceApprove' }),
    T(['retenido'], 'confirmado', 'Liberar crédito', 'Release credit', ['ADMIN', 'COB', 'DIR'], { guard: 'creditRelease' }),
    T(['confirmado', 'en_produccion'], 'listo', 'Marcar listo para embarque', 'Mark ready to ship', ['ADMIN', 'ALM', 'PROD', 'LOG']),
    T(['entregado'], 'facturado', 'Facturar', 'Invoice', ['ADMIN', 'FACT'], { guard: 'invoiceOrder' }),
    T(['cotizacion', 'borrador', 'por_aprobar', 'retenido', 'confirmado'], 'cancelado', 'Cancelar', 'Cancel', ['ADMIN', 'GV', 'VTA', 'ATC'], { comment: true }),
  ],
  initial: 'borrador',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }),
    COMPANY,
    F('doc_type', 'select', 'Tipo', 'Type', { opts: [O('pedido', 'Pedido', 'Order'), O('cotizacion', 'Cotización', 'Quote')], def: 'pedido' }),
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true, req: true }),
    F('source', 'select', 'Canal de entrada', 'Intake channel', { opts: [O('whatsapp', 'WhatsApp', 'WhatsApp'), O('correo', 'Correo', 'Email'), O('telefono', 'Teléfono', 'Phone'), O('oc', 'Orden de compra del cliente', 'Customer PO'), O('asesor', 'Asesor en campo', 'Field advisor'), O('contrato', 'Contrato abierto', 'Blanket order')], req: true, def: 'asesor' }),
    F('contract_id', 'ref', 'Contrato abierto', 'Blanket order', { ref: 'contracts' }),
    F('warehouse_id', 'ref', 'Bodega que surte', 'Supplying warehouse', { ref: 'warehouses', req: true }),
    F('promised_date', 'date', 'Fecha compromiso de entrega', 'Promised delivery date', { list: true, req: true }),
    F('earliest_date', 'date', 'Fecha factible más temprana', 'Earliest feasible date', { ro: true }),
    F('subtotal', 'money', 'Subtotal', 'Subtotal', { ro: true }),
    F('freight', 'money', 'Flete cobrado', 'Freight charged', { ro: true }),
    F('freight_actual', 'money', 'Flete real asignado', 'Actual freight allocated', { ro: true }),
    F('total', 'money', 'Total', 'Total', { ro: true, list: true }),
    F('kg', 'num', 'Kg totales', 'Total kg', { ro: true }),
    F('approval_level', 'select', 'Autorización requerida', 'Approval required', { ro: true, opts: [O('', 'Ninguna', 'None'), O('GV', 'Gerencia de Ventas', 'Sales management'), O('DIR', 'Dirección', 'Management')] }),
    F('alerts', 'longtext', 'Alertas del sistema', 'System alerts', { ro: true }),
    F('sap_folio', 'text', 'Folio SAP', 'SAP doc no.'),
    F('notes', 'longtext', 'Observaciones', 'Notes'),
  ],
  actions: [{ k: 'toOrder', l: ['Convertir en pedido', 'Convert to order'], roles: ['ADMIN', 'GV', 'VTA', 'ATC'], when: ['cotizacion'] }],
};
E.contracts = {
  g: 'ventas', l: ['Contratos / pedidos abiertos', 'Blanket orders'], one: ['Contrato', 'Blanket order'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'VTA'], title: 'folio', sort: 'id desc',
  lines: [F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', req: true }), F('qty', 'num', 'Cantidad contratada', 'Contracted qty', { req: true }), F('price', 'money', 'Precio pactado', 'Agreed price', { req: true }), F('released', 'num', 'Liberado', 'Released', { ro: true })],
  statuses: [S('vigente', 'Vigente', 'Active', 'green'), S('agotado', 'Agotado', 'Fully released', 'gray'), S('vencido', 'Vencido', 'Expired', 'red')],
  flow: [T(['vigente'], 'vencido', 'Cerrar', 'Close', ['ADMIN', 'GV'])], initial: 'vigente',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }),
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true, req: true }),
    F('valid_from', 'date', 'Vigente desde', 'Valid from', { req: true }),
    F('valid_to', 'date', 'Vigente hasta', 'Valid to', { list: true, req: true }),
    F('pct_used', 'pct', '% liberado', '% released', { ro: true, list: true }),
  ],
};
E.promotions = {
  g: 'ventas', l: ['Promociones', 'Promotions'], one: ['Promoción', 'Promotion'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'DIR'], title: 'name', sort: 'id desc',
  statuses: [S('borrador', 'Borrador', 'Draft'), S('activa', 'Activa', 'Active', 'green'), S('terminada', 'Terminada', 'Ended', 'gray')],
  flow: [T(['borrador'], 'activa', 'Activar', 'Activate', ['ADMIN', 'GV', 'DIR']), T(['activa'], 'terminada', 'Terminar', 'End', ['ADMIN', 'GV', 'DIR'])], initial: 'borrador',
  fields: [
    F('name', 'text', 'Nombre', 'Name', { list: true, req: true }),
    F('type', 'select', 'Mecánica', 'Mechanic', { opts: [O('nxm', 'Producto gratis (N+M)', 'Free goods (N+M)'), O('pct', 'Descuento %', '% off')], list: true, req: true }),
    F('buy', 'int', 'Compra N', 'Buy N', { def: 1 }),
    F('get', 'int', 'Recibe M gratis', 'Get M free', { def: 1 }),
    F('pct', 'pct', 'Descuento %', 'Discount %'),
    F('channel', 'select', 'Canal', 'Channel', { opts: [O('', 'Todos', 'All'), O('pecuario', 'Pecuario', 'Livestock'), O('pet', 'PET', 'PET'), O('ca', 'Centroamérica', 'Central America')] }),
    F('family_id', 'ref', 'Familia', 'Family', { ref: 'product_families' }),
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products' }),
    F('starts', 'date', 'Inicio', 'Start', { list: true, req: true }),
    F('ends', 'date', 'Fin', 'End', { list: true, req: true }),
    F('cost', 'money', 'Costo acumulado de la promoción', 'Accumulated promo cost', { ro: true, list: true }),
  ],
};
E.credit_notes = {
  g: 'ventas', l: ['Notas de crédito', 'Credit notes'], one: ['Nota de crédito', 'Credit note'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'VTA', 'ATC', 'FACT', 'COB'], title: 'folio', sort: 'id desc',
  statuses: [S('solicitada', 'Solicitada', 'Requested', 'amber'), S('aprobada', 'Aprobada', 'Approved', 'blue'), S('rechazada', 'Rechazada', 'Rejected', 'red'), S('aplicada', 'Aplicada (timbrada)', 'Applied (stamped)', 'green')],
  flow: [
    T(['solicitada'], 'aprobada', 'Aprobar', 'Approve', ['ADMIN', 'GV', 'DIR'], { guard: 'cnApprove', sod: true }),
    T(['solicitada'], 'rechazada', 'Rechazar', 'Reject', ['ADMIN', 'GV', 'DIR'], { comment: true }),
    T(['aprobada'], 'aplicada', 'Aplicar y timbrar', 'Apply & stamp', ['ADMIN', 'FACT', 'CONT'], { guard: 'cnApply' }),
  ], initial: 'solicitada',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }), COMPANY,
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true, req: true }),
    F('invoice_id', 'ref', 'Factura origen', 'Source invoice', { ref: 'invoices' }),
    F('reason', 'select', 'Motivo', 'Reason', { list: true, filter: true, req: true, opts: [O('entrega', 'Incidencia de entrega', 'Delivery incident'), O('flete', 'Ajuste de flete', 'Freight adjustment'), O('promocion', 'Promoción', 'Promotion'), O('devolucion', 'Devolución', 'Return'), O('precio', 'Diferencia de precio', 'Price difference'), O('calidad', 'Calidad', 'Quality'), O('otro', 'Otro', 'Other')] }),
    F('amount', 'money', 'Importe', 'Amount', { list: true, req: true }),
    F('approver_level', 'select', 'Nivel que autoriza', 'Approval level', { ro: true, opts: [O('GV', 'Gerencia de Ventas', 'Sales management'), O('DIR', 'Dirección', 'Management')] }),
    F('description', 'longtext', 'Descripción', 'Description', { req: true }),
    F('evidence', 'file', 'Evidencia', 'Evidence'),
    F('uuid', 'text', 'UUID CFDI de egreso', 'CFDI credit UUID', { ro: true }),
  ],
};
E.forecasts = {
  g: 'ventas', l: ['Pronóstico de demanda', 'Demand forecast'], one: ['Pronóstico', 'Forecast'],
  read: INTERNAL, write: ['ADMIN', 'GV', 'VTA', 'PROD'], title: 'period', sort: 'period desc',
  fields: [
    F('period', 'text', 'Periodo (AAAA-MM)', 'Period (YYYY-MM)', { list: true, req: true }),
    F('advisor_id', 'ref', 'Asesor', 'Advisor', { ref: 'users', list: true }),
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', list: true, req: true }),
    F('qty', 'num', 'Cantidad pronosticada', 'Forecast qty', { list: true, req: true }),
    F('actual', 'num', 'Real colocado', 'Actual sold', { ro: true, list: true }),
    F('accuracy', 'pct', 'Precisión', 'Accuracy', { ro: true, list: true }),
  ],
};

// ───────────────────────── ALMACÉN Y PRODUCCIÓN ─────────────────────────
E.warehouses = {
  g: 'operacion', l: ['Bodegas', 'Warehouses'], one: ['Bodega', 'Warehouse'],
  read: INTERNAL, write: ['ADMIN', 'COMP', 'ALM'], title: 'name', sort: 'name',
  fields: [
    F('code', 'text', 'Código', 'Code', { list: true, req: true }),
    F('name', 'text', 'Nombre', 'Name', { list: true, req: true }),
    F('state', 'text', 'Estado', 'State', { list: true }), COMPANY,
    F('coordinator_id', 'ref', 'Responsable', 'Person in charge', { ref: 'users', list: true }),
    F('lag_target', 'num', 'Meta de captura (horas)', 'Capture target (hours)', { def: 24 }),
  ],
};
E.stock = {
  g: 'operacion', l: ['Inventario por bodega', 'Stock by warehouse'], one: ['Existencia', 'Stock line'],
  read: INTERNAL, write: ['ADMIN', 'ALM', 'COMP'], title: 'lot', sort: 'id',
  fields: [
    F('warehouse_id', 'ref', 'Bodega', 'Warehouse', { ref: 'warehouses', list: true, filter: true, req: true }),
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', list: true, req: true }),
    F('qty', 'num', 'Existencia', 'On hand', { list: true, req: true }),
    F('lot', 'text', 'Lote', 'Lot', { list: true }),
    F('expires', 'date', 'Caducidad', 'Expiry'),
  ],
};
E.wh_movements = {
  g: 'operacion', l: ['Movimientos de bodega', 'Warehouse movements'], one: ['Movimiento', 'Movement'],
  read: INTERNAL, write: ['ADMIN', 'ALM'], title: 'reference', sort: 'id desc',
  fields: [
    F('warehouse_id', 'ref', 'Bodega', 'Warehouse', { ref: 'warehouses', list: true, filter: true, req: true }),
    F('type', 'select', 'Tipo', 'Type', { list: true, opts: [O('entrada', 'Entrada', 'Receipt'), O('salida', 'Salida / remisión', 'Issue / delivery note'), O('traslado', 'Traslado', 'Transfer'), O('ajuste', 'Ajuste', 'Adjustment')], req: true }),
    F('reference', 'text', 'Referencia', 'Reference', { list: true, req: true }),
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products' }),
    F('qty', 'num', 'Cantidad', 'Qty'),
    F('lot', 'text', 'Lote', 'Lot'),
    F('physical_at', 'datetime', 'Movimiento físico', 'Physical movement', { req: true }),
    F('captured_at', 'datetime', 'Capturado en SAP', 'Captured in SAP'),
    F('lag_hours', 'num', 'Retraso de captura (h)', 'Capture lag (h)', { ro: true, list: true }),
  ],
};
E.production_lines = {
  g: 'operacion', l: ['Líneas de producción', 'Production lines'], one: ['Línea', 'Line'],
  read: INTERNAL, write: ['ADMIN', 'PROD'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Línea', 'Line', { list: true, req: true }),
    F('plant', 'text', 'Planta', 'Plant', { list: true }),
    F('kg_day', 'num', 'Capacidad kg/día', 'Capacity kg/day', { list: true, req: true }),
    F('lead_days', 'int', 'Días de producción', 'Production days', { def: 4 }),
  ],
};
E.production_orders = {
  g: 'operacion', l: ['Órdenes de fabricación', 'Production orders'], one: ['Orden de fabricación', 'Production order'],
  read: INTERNAL, write: ['ADMIN', 'PROD', 'GV'], title: 'folio', sort: 'id desc',
  statuses: [S('solicitada', 'Solicitada', 'Requested', 'amber'), S('programada', 'Programada', 'Scheduled', 'blue'), S('en_proceso', 'En proceso (WIP)', 'In process (WIP)', 'purple'), S('terminada', 'Terminada', 'Finished', 'teal'), S('liquidada', 'Liquidada', 'Settled', 'green')],
  flow: [
    T(['solicitada'], 'programada', 'Programar', 'Schedule', ['ADMIN', 'PROD'], { guard: 'poSchedule' }),
    T(['programada'], 'en_proceso', 'Iniciar producción', 'Start production', ['ADMIN', 'PROD']),
    T(['en_proceso'], 'terminada', 'Terminar y entregar a almacén', 'Finish & deliver to stock', ['ADMIN', 'PROD'], { guard: 'poFinish' }),
    T(['terminada'], 'liquidada', 'Liquidar costo', 'Settle cost', ['ADMIN', 'COST', 'CONT'], { guard: 'poSettle' }),
  ], initial: 'solicitada',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }),
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', list: true, req: true }),
    F('order_id', 'ref', 'Pedido de venta (MTO)', 'Sales order (MTO)', { ref: 'orders' }),
    F('line_id', 'ref', 'Línea', 'Line', { ref: 'production_lines', list: true }),
    F('warehouse_id', 'ref', 'Bodega destino', 'Destination warehouse', { ref: 'warehouses' }),
    F('qty', 'num', 'Cantidad (unidades)', 'Qty (units)', { req: true }),
    F('kg', 'num', 'Kg', 'Kg', { ro: true, list: true }),
    F('need_by', 'date', 'Requerida para', 'Needed by', { list: true }),
    F('sched_date', 'date', 'Fecha programada', 'Scheduled date'),
    F('qty_done', 'num', 'Cantidad producida', 'Qty produced'),
    F('lot', 'text', 'Lote asignado', 'Lot', { ro: true }),
    F('material_actual', 'money', 'Material real consumido', 'Actual material', { roles: ['ADMIN', 'DIR', 'COST', 'CONT', 'PROD'] }),
    F('labor_hours', 'num', 'Horas máquina/mano de obra', 'Machine/labor hours'),
    F('std_total', 'money', 'Costo estándar total', 'Total standard cost', { ro: true, roles: ['ADMIN', 'DIR', 'COST', 'CONT'] }),
    F('actual_total', 'money', 'Costo real total', 'Total actual cost', { ro: true, roles: ['ADMIN', 'DIR', 'COST', 'CONT'] }),
    F('variance', 'money', 'Variación (real − estándar)', 'Variance (actual − std)', { ro: true, roles: ['ADMIN', 'DIR', 'COST', 'CONT'] }),
    F('sap_folio', 'text', 'Folio OF en SAP', 'SAP order no.'),
  ],
};

// ───────────────────────── LOGÍSTICA ─────────────────────────
E.routes = {
  g: 'logistica', l: ['Rutas y tarifas de flete', 'Routes & freight rates'], one: ['Ruta', 'Route'],
  read: INTERNAL, write: ['ADMIN', 'LOG'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Ruta', 'Route', { list: true, req: true }),
    F('km', 'num', 'Km ida y vuelta', 'Round-trip km', { list: true }),
    F('rate_kg', 'money', 'Flete cobrado por kg', 'Freight charged per kg', { list: true, req: true }),
    F('ship_days', 'int', 'Días de tránsito', 'Transit days', { def: 1 }),
  ],
};
E.trucks = {
  g: 'logistica', l: ['Unidades de transporte', 'Trucks'], one: ['Unidad', 'Truck'],
  read: INTERNAL, write: ['ADMIN', 'LOG'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Unidad / placas', 'Unit / plates', { list: true, req: true }),
    F('type', 'select', 'Tipo', 'Type', { list: true, opts: [O('propia', 'Flota propia', 'Own fleet'), O('externa', 'Transportista externo', 'External carrier')], req: true }),
    F('carrier', 'text', 'Transportista', 'Carrier', { list: true }),
    F('cap_kg', 'num', 'Capacidad kg', 'Capacity kg', { list: true, req: true }),
    F('cost_km', 'money', 'Costo por km (propia)', 'Cost per km (own)'),
    F('driver_id', 'ref', 'Chofer asignado', 'Assigned driver', { ref: 'users' }),
  ],
};
E.loads = {
  g: 'logistica', l: ['Programación de cargas', 'Load planning'], one: ['Carga', 'Load'],
  read: INTERNAL, write: ['ADMIN', 'LOG'], title: 'folio', sort: 'id desc',
  lines: [F('order_id', 'ref', 'Pedido', 'Order', { ref: 'orders', req: true }), F('kg', 'num', 'Kg', 'Kg', { ro: true }), F('customer', 'text', 'Cliente', 'Customer', { ro: true })],
  statuses: [S('planeada', 'Planeada', 'Planned', 'gray'), S('en_ruta', 'En ruta', 'In transit', 'blue'), S('cerrada', 'Cerrada', 'Closed', 'green')],
  flow: [T(['planeada'], 'en_ruta', 'Despachar', 'Dispatch', ['ADMIN', 'LOG'], { guard: 'loadDispatch' }), T(['en_ruta'], 'cerrada', 'Cerrar carga y costear', 'Close & cost load', ['ADMIN', 'LOG'], { guard: 'loadClose' })],
  initial: 'planeada',
  actions: [{ k: 'suggest', l: ['Sugerir pedidos de la ruta', 'Suggest orders on route'], roles: ['ADMIN', 'LOG'], when: ['planeada'] }],
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }),
    F('date', 'date', 'Fecha de salida', 'Departure date', { list: true, req: true }),
    F('route_id', 'ref', 'Ruta', 'Route', { ref: 'routes', list: true, req: true }),
    F('truck_id', 'ref', 'Unidad', 'Truck', { ref: 'trucks', list: true, req: true }),
    F('kg', 'num', 'Kg cargados', 'Kg loaded', { ro: true }),
    F('fill', 'pct', '% ocupación', '% fill', { ro: true, list: true }),
    F('carrier_cost', 'money', 'Costo transportista externo', 'External carrier cost'),
    F('tolls', 'money', 'Casetas y viáticos', 'Tolls & per diem'),
    F('actual_cost', 'money', 'Costo real del viaje', 'Actual trip cost', { ro: true }),
  ],
};
E.deliveries = {
  g: 'logistica', l: ['Confirmación de entregas', 'Delivery confirmation'], one: ['Entrega', 'Delivery'],
  read: INTERNAL, write: ['ADMIN', 'LOG', 'CHOF'], title: 'id', sort: 'id desc',
  statuses: [S('pendiente', 'Pendiente', 'Pending', 'amber'), S('entregado', 'Entregado', 'Delivered', 'green'), S('parcial', 'Entrega parcial', 'Partial', 'purple'), S('rechazado', 'Rechazado', 'Rejected', 'red')],
  flow: [
    T(['pendiente'], 'entregado', 'Confirmar entrega', 'Confirm delivery', ['ADMIN', 'LOG', 'CHOF'], { guard: 'deliver' }),
    T(['pendiente'], 'parcial', 'Entrega parcial', 'Partial delivery', ['ADMIN', 'LOG', 'CHOF'], { guard: 'deliver', comment: true }),
    T(['pendiente'], 'rechazado', 'Rechazado por cliente', 'Rejected by customer', ['ADMIN', 'LOG', 'CHOF'], { guard: 'deliver', comment: true }),
  ], initial: 'pendiente',
  fields: [
    F('load_id', 'ref', 'Carga', 'Load', { ref: 'loads', list: true }),
    F('order_id', 'ref', 'Pedido', 'Order', { ref: 'orders', list: true, req: true }),
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true }),
    F('driver_id', 'ref', 'Chofer', 'Driver', { ref: 'users' }),
    F('photo', 'file', 'Foto de remisión firmada', 'Signed delivery note photo'),
    F('received_by', 'text', 'Recibió', 'Received by'),
    F('gps', 'text', 'Ubicación GPS', 'GPS location', { ro: true }),
    F('delivered_at', 'datetime', 'Fecha y hora de entrega', 'Delivered at', { ro: true, list: true }),
  ],
};
E.double_freight = {
  g: 'logistica', l: ['Dobles fletes', 'Double freight'], one: ['Doble flete', 'Double freight'],
  read: INTERNAL, write: ['ADMIN', 'LOG', 'GV'], title: 'id', sort: 'id desc',
  fields: [
    F('order_id', 'ref', 'Pedido', 'Order', { ref: 'orders', list: true, req: true }),
    F('date', 'date', 'Fecha', 'Date', { list: true, req: true }),
    F('cost', 'money', 'Costo adicional', 'Extra cost', { list: true, req: true }),
    F('cause', 'select', 'Causa', 'Cause', { list: true, filter: true, req: true, opts: [O('produccion', 'Producción tardía', 'Late production'), O('bodega', 'Bodega / surtido', 'Warehouse / picking'), O('venta', 'Venta prometió sin disponibilidad', 'Sales promised without stock'), O('cliente', 'Cliente', 'Customer'), O('transporte', 'Transporte', 'Transport')] }),
    F('responsible_id', 'ref', 'Responsable', 'Responsible', { ref: 'users', list: true, req: true }),
    F('note', 'longtext', 'Explicación', 'Explanation', { req: true }),
  ],
};

// ───────────────────────── FACTURACIÓN Y COBRANZA ─────────────────────────
E.invoices = {
  g: 'cobranza', l: ['Facturas (CxC)', 'Invoices (A/R)'], one: ['Factura', 'Invoice'],
  read: INTERNAL, write: ['ADMIN', 'FACT', 'CONT'], title: 'folio', sort: 'id desc', lines: ORDER_LINES,
  statuses: [S('abierta', 'Abierta', 'Open', 'blue'), S('pagada', 'Pagada', 'Paid', 'green'), S('cancelada', 'Cancelada', 'Cancelled', 'red')],
  flow: [T(['abierta'], 'cancelada', 'Cancelar CFDI', 'Cancel CFDI', ['ADMIN', 'FACT', 'CONT'], { comment: true })], initial: 'abierta',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }), COMPANY,
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true, req: true }),
    F('order_id', 'ref', 'Pedido', 'Order', { ref: 'orders' }),
    F('date', 'date', 'Fecha', 'Date', { list: true, req: true }),
    F('due', 'date', 'Vencimiento', 'Due date', { list: true }),
    F('method', 'select', 'Método de pago', 'Payment method', { opts: [O('PPD', 'PPD — parcialidades o diferido', 'PPD — deferred'), O('PUE', 'PUE — una exhibición', 'PUE — single payment')], def: 'PPD' }),
    F('subtotal', 'money', 'Subtotal', 'Subtotal', { ro: true }),
    F('freight', 'money', 'Flete', 'Freight'),
    F('total', 'money', 'Total', 'Total', { list: true, ro: true }),
    F('balance', 'money', 'Saldo', 'Balance', { list: true, ro: true }),
    F('uuid', 'text', 'UUID CFDI', 'CFDI UUID', { ro: true }),
  ],
};
E.receipts = {
  g: 'cobranza', l: ['Cobros y aplicación de pagos', 'Receipts & cash application'], one: ['Cobro', 'Receipt'],
  read: INTERNAL, write: ['ADMIN', 'COB', 'CONT'], title: 'reference', sort: 'id desc',
  lines: [F('invoice_id', 'ref', 'Factura', 'Invoice', { ref: 'invoices', req: true }), F('amount', 'money', 'Importe aplicado', 'Amount applied', { req: true })],
  statuses: [S('por_aplicar', 'Por aplicar', 'Unapplied', 'amber'), S('aplicado', 'Aplicado', 'Applied', 'green')],
  flow: [T(['por_aplicar'], 'aplicado', 'Aplicar pago', 'Apply payment', ['ADMIN', 'COB', 'CONT'], { guard: 'applyReceipt' })], initial: 'por_aplicar',
  actions: [{ k: 'suggestApply', l: ['Sugerir aplicación automática', 'Suggest automatic application'], roles: ['ADMIN', 'COB', 'CONT'], when: ['por_aplicar'] }],
  fields: [
    F('customer_id', 'ref', 'Cliente', 'Customer', { ref: 'customers', list: true, req: true }),
    F('date', 'date', 'Fecha de depósito', 'Deposit date', { list: true, req: true }),
    F('amount', 'money', 'Importe', 'Amount', { list: true, req: true }),
    F('reference', 'text', 'Referencia bancaria', 'Bank reference', { list: true }),
    F('bank_account_id', 'ref', 'Cuenta bancaria', 'Bank account', { ref: 'bank_accounts' }),
    F('warehouse_id', 'ref', 'Bodega que reporta', 'Reporting warehouse', { ref: 'warehouses' }),
    F('rep_uuid', 'text', 'UUID complemento de pago (REP)', 'Payment complement UUID', { ro: true }),
  ],
};
E.credit_policies = {
  g: 'cobranza', l: ['Política de crédito', 'Credit policy'], one: ['Regla de crédito', 'Credit rule'],
  read: INTERNAL, write: ['ADMIN', 'DIR'], title: 'factor', sort: 'id',
  fields: [
    F('factor', 'select', 'Factor de evaluación', 'Scoring factor', { list: true, req: true, opts: [O('years', 'Antigüedad del negocio', 'Years in business'), O('history', 'Historial de pago', 'Payment history'), O('volume', 'Volumen mensual estimado', 'Estimated monthly volume'), O('guarantee', 'Cobertura de garantía', 'Guarantee coverage'), O('references', 'Referencias comerciales', 'Trade references'), O('bureau', 'Buró de crédito', 'Credit bureau')] }),
    F('weight', 'num', 'Peso (puntos)', 'Weight (points)', { list: true, req: true }),
    F('description', 'longtext', 'Cómo se califica (0 a 1)', 'How it is scored (0 to 1)', { list: true }),
  ],
};
E.credit_requests = {
  g: 'cobranza', l: ['Solicitudes de crédito', 'Credit applications'], one: ['Solicitud de crédito', 'Credit application'],
  read: INTERNAL, write: ['ADMIN', 'COB', 'VTA', 'GV'], title: 'applicant', sort: 'id desc',
  statuses: [S('borrador', 'Borrador', 'Draft'), S('revision_direccion', 'Revisión de Dirección', 'Management review', 'amber'), S('aprobada', 'Aprobada', 'Approved', 'green'), S('rechazada', 'Rechazada', 'Rejected', 'red')],
  flow: [
    T(['borrador'], 'evaluar', 'Evaluar (score automático)', 'Evaluate (auto score)', ['ADMIN', 'COB'], { guard: 'creditEvaluate' }),
    T(['revision_direccion'], 'aprobada', 'Aprobar', 'Approve', ['ADMIN', 'DIR'], { guard: 'creditGrant' }),
    T(['revision_direccion'], 'rechazada', 'Rechazar', 'Reject', ['ADMIN', 'DIR'], { comment: true }),
  ], initial: 'borrador',
  fields: [
    F('applicant', 'text', 'Solicitante (razón social)', 'Applicant (legal name)', { list: true, req: true }),
    F('customer_id', 'ref', 'Cliente (si ya existe)', 'Customer (if existing)', { ref: 'customers' }),
    F('rfc', 'text', 'RFC', 'Tax ID (RFC)', { req: true }),
    F('segment', 'text', 'Segmento', 'Segment'),
    F('line_req', 'money', 'Línea solicitada', 'Requested line', { list: true, req: true }),
    F('days_req', 'int', 'Días solicitados', 'Requested days', { req: true }),
    F('years', 'num', 'Años en operación', 'Years in business'),
    F('monthly_volume', 'money', 'Compra mensual estimada', 'Estimated monthly purchases'),
    F('guarantee', 'money', 'Pagaré / garantía', 'Promissory note / guarantee'),
    F('references_ok', 'int', 'Referencias positivas (0-3)', 'Positive references (0-3)'),
    F('bureau', 'select', 'Buró', 'Bureau', { opts: [O('bueno', 'Bueno', 'Good'), O('regular', 'Regular', 'Fair'), O('malo', 'Malo', 'Poor'), O('sin', 'Sin historial', 'No history')], def: 'sin' }),
    F('doc_rfc', 'file', 'RFC / Cédula fiscal', 'Tax ID document'),
    F('doc_csf', 'file', 'Constancia de situación fiscal', 'Tax status certificate'),
    F('doc_pagare', 'file', 'Pagaré firmado', 'Signed promissory note'),
    F('doc_id', 'file', 'Identificación', 'ID'),
    F('score', 'pct', 'Score', 'Score', { ro: true, list: true }),
    F('decision', 'text', 'Resultado de la evaluación', 'Evaluation result', { ro: true }),
  ],
};

// ───────────────────────── COMPRAS ─────────────────────────
E.suppliers = {
  g: 'compras', l: ['Proveedores', 'Suppliers'], one: ['Proveedor', 'Supplier'],
  read: INTERNAL, write: ['ADMIN', 'COMP'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Razón social', 'Legal name', { list: true, req: true }),
    F('rfc', 'text', 'RFC', 'Tax ID (RFC)', { list: true, req: true, unique: true }),
    F('kind', 'select', 'Tipo de compra', 'Purchase type', { list: true, opts: [O('mp', 'Materia prima', 'Raw material'), O('general', 'Compras generales', 'General purchases'), O('servicio', 'Servicios', 'Services'), O('flete', 'Fletes', 'Freight')] }),
    F('third_type', 'select', 'Tipo de tercero (DIOT)', 'Third-party type (DIOT)', { opts: [O('04', '04 — Proveedor nacional', '04 — Domestic'), O('05', '05 — Proveedor extranjero', '05 — Foreign'), O('15', '15 — Proveedor global', '15 — Global')], def: '04' }),
    F('pay_days', 'int', 'Días de pago', 'Payment terms (days)', { def: 30 }),
    F('email', 'text', 'Correo', 'Email'),
    F('clabe', 'text', 'Banco / CLABE', 'Bank / CLABE'),
  ],
};
E.requisitions = {
  g: 'compras', l: ['Solicitudes de compra', 'Purchase requisitions'], one: ['Solicitud de compra', 'Requisition'],
  read: INTERNAL, write: INTERNAL, title: 'folio', sort: 'id desc',
  lines: [F('description', 'text', 'Descripción', 'Description', { req: true }), F('qty', 'num', 'Cantidad', 'Qty', { req: true }), F('price', 'money', 'Precio estimado', 'Est. price', { req: true }), F('total', 'money', 'Importe', 'Amount', { ro: true })],
  statuses: [S('solicitada', 'Solicitada', 'Requested', 'amber'), S('aprobada', 'Aprobada', 'Approved', 'blue'), S('rechazada', 'Rechazada', 'Rejected', 'red'), S('en_oc', 'Convertida en OC', 'Converted to PO', 'green')],
  flow: [T(['solicitada'], 'aprobada', 'Aprobar', 'Approve', ['ADMIN', 'COMP', 'DIR'], { guard: 'reqApprove', sod: true }), T(['solicitada'], 'rechazada', 'Rechazar', 'Reject', ['ADMIN', 'COMP', 'DIR'], { comment: true })],
  initial: 'solicitada',
  actions: [{ k: 'toPO', l: ['Generar orden de compra', 'Create purchase order'], roles: ['ADMIN', 'COMP'], when: ['aprobada'] }],
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }), COMPANY,
    F('area', 'text', 'Área solicitante', 'Requesting area', { list: true, req: true }),
    F('supplier_id', 'ref', 'Proveedor sugerido', 'Suggested supplier', { ref: 'suppliers' }),
    F('total', 'money', 'Total', 'Total', { ro: true, list: true }),
    F('approver_level', 'select', 'Autoriza', 'Approver', { ro: true, opts: [O('COMP', 'Compras', 'Purchasing'), O('DIR', 'Dirección', 'Management')] }),
    F('justification', 'longtext', 'Justificación', 'Justification', { req: true }),
  ],
};
const PO_LINES = [F('description', 'text', 'Descripción', 'Description', { req: true }), F('qty', 'num', 'Cantidad', 'Qty', { req: true }), F('price', 'money', 'Precio', 'Price', { req: true }), F('total', 'money', 'Importe', 'Amount', { ro: true }), F('received', 'num', 'Recibido', 'Received', { ro: true })];
E.purchase_orders = {
  g: 'compras', l: ['Órdenes de compra', 'Purchase orders'], one: ['Orden de compra', 'Purchase order'],
  read: [...INTERNAL, 'PROV'], write: ['ADMIN', 'COMP'], title: 'folio', sort: 'id desc', lines: PO_LINES,
  statuses: [S('emitida', 'Emitida', 'Issued', 'blue'), S('parcial', 'Recibida parcial', 'Partially received', 'purple'), S('recibida', 'Recibida', 'Received', 'green'), S('cancelada', 'Cancelada', 'Cancelled', 'red')],
  flow: [T(['emitida'], 'cancelada', 'Cancelar', 'Cancel', ['ADMIN', 'COMP'], { comment: true })], initial: 'emitida',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }), COMPANY,
    F('supplier_id', 'ref', 'Proveedor', 'Supplier', { ref: 'suppliers', list: true, req: true }),
    F('requisition_id', 'ref', 'Solicitud', 'Requisition', { ref: 'requisitions' }),
    F('warehouse_id', 'ref', 'Entregar en', 'Deliver to', { ref: 'warehouses' }),
    F('date', 'date', 'Fecha', 'Date', { list: true, req: true }),
    F('subtotal', 'money', 'Subtotal', 'Subtotal', { ro: true }),
    F('tax', 'money', 'IVA', 'VAT', { ro: true }),
    F('total', 'money', 'Total', 'Total', { ro: true, list: true }),
  ],
};
E.goods_receipts = {
  g: 'compras', l: ['Entradas de mercancía', 'Goods receipts'], one: ['Entrada', 'Goods receipt'],
  read: [...INTERNAL, 'PROV'], write: ['ADMIN', 'ALM', 'COMP'], title: 'folio', sort: 'id desc',
  lines: [F('line', 'int', 'Partida OC', 'PO line', { ro: true }), F('description', 'text', 'Descripción', 'Description', { ro: true }), F('qty', 'num', 'Cantidad recibida', 'Qty received', { req: true }), F('price', 'money', 'Precio OC', 'PO price', { ro: true })],
  statuses: [S('registrada', 'Registrada', 'Recorded', 'blue'), S('facturada', 'Facturada', 'Invoiced', 'green')], initial: 'registrada',
  fields: [
    F('folio', 'text', 'Folio', 'No.', { list: true, ro: true }),
    F('po_id', 'ref', 'Orden de compra', 'Purchase order', { ref: 'purchase_orders', list: true, req: true }),
    F('supplier_id', 'ref', 'Proveedor', 'Supplier', { ref: 'suppliers', list: true, ro: true }),
    F('date', 'date', 'Fecha de recepción', 'Receipt date', { list: true, req: true }),
    F('amount', 'money', 'Importe recibido', 'Received amount', { ro: true, list: true }),
    F('photo', 'file', 'Foto de remisión', 'Delivery note photo'),
  ],
};
E.supplier_invoices = {
  g: 'compras', l: ['Facturas de proveedor (portal)', 'Supplier invoices (portal)'], one: ['Factura de proveedor', 'Supplier invoice'],
  read: [...INTERNAL, 'PROV'], write: ['ADMIN', 'CXP', 'COMP', 'PROV'], title: 'uuid', sort: 'id desc',
  statuses: [S('recibida', 'Recibida', 'Received', 'gray'), S('validada', 'Conciliada 3 vías', '3-way matched', 'blue'), S('excepcion', 'Excepción', 'Exception', 'red'), S('aprobada', 'Aprobada para pago', 'Approved to pay', 'teal'), S('pagada', 'Pagada', 'Paid', 'green')],
  flow: [
    T(['recibida', 'excepcion'], 'validar', 'Validar 3 vías', 'Run 3-way match', ['ADMIN', 'CXP', 'COMP'], { guard: 'match3' }),
    T(['excepcion'], 'validada', 'Aceptar diferencia', 'Accept difference', ['ADMIN', 'COMP', 'DIR'], { comment: true }),
    T(['validada'], 'aprobada', 'Aprobar para pago', 'Approve for payment', ['ADMIN', 'CXP'], { sod: true }),
  ], initial: 'recibida',
  fields: [
    F('supplier_id', 'ref', 'Proveedor', 'Supplier', { ref: 'suppliers', list: true, req: true }),
    F('gr_id', 'ref', 'Entrada de mercancía', 'Goods receipt', { ref: 'goods_receipts', req: true, help: ['Solo puede facturar contra una entrada ya registrada', 'You can only invoice against a recorded receipt'] }),
    F('xml', 'file', 'CFDI XML', 'CFDI XML', { accept: '.xml' }),
    F('pdf', 'file', 'PDF', 'PDF', { accept: '.pdf' }),
    F('uuid', 'text', 'UUID', 'UUID', { list: true }),
    F('date', 'date', 'Fecha CFDI', 'CFDI date', { list: true }),
    F('subtotal', 'money', 'Subtotal', 'Subtotal'),
    F('tax', 'money', 'IVA', 'VAT'),
    F('retention', 'money', 'Retenciones', 'Withholdings'),
    F('total', 'money', 'Total', 'Total', { list: true }),
    F('due', 'date', 'Vencimiento', 'Due date', { ro: true }),
    F('match_note', 'longtext', 'Resultado de conciliación', 'Match result', { ro: true }),
  ],
};
E.supplier_payments = {
  g: 'compras', l: ['Pagos a proveedores', 'Supplier payments'], one: ['Pago', 'Payment'],
  read: [...INTERNAL, 'PROV'], write: ['ADMIN', 'CXP'], title: 'reference', sort: 'id desc',
  lines: [F('invoice_id', 'ref', 'Factura', 'Invoice', { ref: 'supplier_invoices', req: true }), F('amount', 'money', 'Importe', 'Amount', { req: true })],
  statuses: [S('programado', 'Programado', 'Scheduled', 'amber'), S('pagado', 'Pagado', 'Paid', 'green')],
  flow: [T(['programado'], 'pagado', 'Confirmar pago', 'Confirm payment', ['ADMIN', 'CXP'], { guard: 'payConfirm', sod: true })], initial: 'programado',
  fields: [
    F('supplier_id', 'ref', 'Proveedor', 'Supplier', { ref: 'suppliers', list: true, req: true }),
    F('date', 'date', 'Fecha de pago', 'Payment date', { list: true, req: true }),
    F('amount', 'money', 'Importe', 'Amount', { list: true, ro: true }),
    F('tax_base', 'money', 'Base IVA 16%', 'VAT 16% base', { ro: true }),
    F('tax', 'money', 'IVA pagado', 'VAT paid', { ro: true }),
    F('retention', 'money', 'IVA retenido', 'VAT withheld', { ro: true }),
    F('bank_account_id', 'ref', 'Cuenta bancaria', 'Bank account', { ref: 'bank_accounts' }),
    F('reference', 'text', 'Referencia', 'Reference', { list: true }),
    F('rep_received', 'bool', 'REP recibido del proveedor', 'Payment complement received'),
  ],
};

// ───────────────────────── FINANZAS Y CIERRE ─────────────────────────
E.bank_accounts = {
  g: 'finanzas', l: ['Cuentas bancarias', 'Bank accounts'], one: ['Cuenta bancaria', 'Bank account'],
  read: INTERNAL, write: ['ADMIN', 'CONT', 'CXP'], title: 'name', sort: 'name',
  fields: [F('name', 'text', 'Nombre', 'Name', { list: true, req: true }), F('bank', 'text', 'Banco', 'Bank', { list: true }), F('number', 'text', 'Cuenta', 'Account no.', { list: true }), COMPANY, F('gl_account', 'text', 'Cuenta contable', 'GL account')],
};
E.bank_lines = {
  g: 'finanzas', l: ['Conciliación bancaria', 'Bank reconciliation'], one: ['Movimiento bancario', 'Bank line'],
  read: INTERNAL, write: ['ADMIN', 'CONT', 'CXP'], title: 'description', sort: 'date desc, id desc',
  statuses: [S('pendiente', 'Sin conciliar', 'Unmatched', 'amber'), S('sugerido', 'Sugerido', 'Suggested', 'blue'), S('conciliado', 'Conciliado', 'Matched', 'green'), S('excepcion', 'Excepción', 'Exception', 'red')],
  flow: [T(['sugerido'], 'conciliado', 'Confirmar conciliación', 'Confirm match', ['ADMIN', 'CONT', 'CXP']), T(['pendiente', 'sugerido'], 'excepcion', 'Marcar excepción', 'Flag exception', ['ADMIN', 'CONT', 'CXP'], { comment: true }), T(['excepcion', 'sugerido'], 'pendiente', 'Deshacer', 'Undo', ['ADMIN', 'CONT', 'CXP'])],
  initial: 'pendiente',
  fields: [
    F('bank_account_id', 'ref', 'Cuenta', 'Account', { ref: 'bank_accounts', list: true, filter: true, req: true }),
    F('date', 'date', 'Fecha', 'Date', { list: true, req: true }),
    F('description', 'text', 'Concepto', 'Description', { list: true }),
    F('reference', 'text', 'Referencia', 'Reference'),
    F('amount', 'money', 'Importe (+ depósito / − retiro)', 'Amount (+ deposit / − withdrawal)', { list: true, req: true }),
    F('match_type', 'text', 'Documento conciliado', 'Matched document', { ro: true, list: true }),
    F('match_rule', 'text', 'Regla', 'Rule', { ro: true }),
  ],
};
E.close_templates = {
  g: 'finanzas', l: ['Calendario de precierre (plantilla)', 'Pre-close calendar (template)'], one: ['Tarea de cierre', 'Close task'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'task', sort: 'day_offset, id',
  fields: [
    F('task', 'text', 'Tarea', 'Task', { list: true, req: true }),
    F('area', 'text', 'Área responsable', 'Responsible area', { list: true, req: true }),
    F('owner_id', 'ref', 'Responsable', 'Owner', { ref: 'users', list: true }),
    F('day_offset', 'int', 'Día hábil límite (D+)', 'Deadline business day (D+)', { list: true, req: true }),
    F('required', 'bool', 'Obligatoria para cerrar', 'Required to close', { def: true }),
  ],
};
E.close_periods = {
  g: 'finanzas', l: ['Cierres mensuales', 'Monthly closes'], one: ['Cierre', 'Close'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'period', sort: 'period desc',
  statuses: [S('abierto', 'Abierto', 'Open', 'blue'), S('cerrado', 'Cerrado', 'Closed', 'green')],
  flow: [T(['abierto'], 'cerrado', 'Cerrar periodo', 'Close period', ['ADMIN', 'CONT', 'DIR'], { guard: 'closePeriod' })], initial: 'abierto',
  actions: [{ k: 'genTasks', l: ['Generar tareas del calendario', 'Generate calendar tasks'], roles: ['ADMIN', 'CONT'], when: ['abierto'] }],
  fields: [
    F('period', 'text', 'Periodo (AAAA-MM)', 'Period (YYYY-MM)', { list: true, req: true }), COMPANY,
    F('progress', 'pct', '% tareas validadas', '% tasks validated', { ro: true, list: true }),
    F('late', 'int', 'Tareas atrasadas', 'Late tasks', { ro: true, list: true }),
    F('closed_day', 'int', 'Día de cierre (D+)', 'Close day (D+)', { ro: true, list: true }),
  ],
};
E.close_tasks = {
  g: 'finanzas', l: ['Tareas de cierre', 'Close tasks'], one: ['Tarea', 'Task'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'task', sort: 'due, id',
  statuses: [S('pendiente', 'Pendiente', 'Pending', 'gray'), S('entregada', 'Entregada', 'Delivered', 'blue'), S('validada', 'Validada', 'Validated', 'green'), S('rechazada', 'Rechazada', 'Rejected', 'red')],
  flow: [T(['pendiente', 'rechazada'], 'entregada', 'Marcar entregada', 'Mark delivered', INTERNAL), T(['entregada'], 'validada', 'Validar', 'Validate', ['ADMIN', 'CONT'], { sod: 'last' }), T(['entregada'], 'rechazada', 'Rechazar', 'Reject', ['ADMIN', 'CONT'], { comment: true })],
  initial: 'pendiente',
  fields: [
    F('period_id', 'ref', 'Cierre', 'Close', { ref: 'close_periods', list: true, filter: true }),
    F('task', 'text', 'Tarea', 'Task', { list: true, req: true }),
    F('area', 'text', 'Área', 'Area', { list: true }),
    F('owner_id', 'ref', 'Responsable', 'Owner', { ref: 'users', list: true }),
    F('due', 'date', 'Fecha límite', 'Deadline', { list: true }),
    F('required', 'bool', 'Obligatoria', 'Required', { def: true }),
    F('evidence', 'file', 'Evidencia', 'Evidence'),
  ],
};
E.gl_accounts = {
  g: 'finanzas', l: ['Catálogo de cuentas y balanza', 'Chart of accounts & trial balance'], one: ['Cuenta contable', 'GL account'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'name', sort: 'code',
  fields: [
    F('code', 'text', 'Cuenta', 'Account', { list: true, req: true, unique: true }),
    F('name', 'text', 'Nombre', 'Name', { list: true, req: true }),
    F('nature', 'select', 'Naturaleza', 'Nature', { opts: [O('D', 'Deudora', 'Debit'), O('A', 'Acreedora', 'Credit')], def: 'D' }),
    F('sat_code', 'text', 'Código agrupador SAT', 'SAT grouping code', { list: true }),
    F('level', 'int', 'Nivel', 'Level', { def: 2 }),
    F('risk', 'select', 'Riesgo / frecuencia de conciliación', 'Risk / reconciliation frequency', { opts: [O('alto', 'Alto — mensual', 'High — monthly'), O('medio', 'Medio — trimestral', 'Medium — quarterly'), O('bajo', 'Bajo — anual', 'Low — annual')], def: 'alto' }),
    F('opening', 'money', 'Saldo inicial', 'Opening balance'),
    F('debits', 'money', 'Cargos del periodo', 'Period debits'),
    F('credits', 'money', 'Abonos del periodo', 'Period credits'),
    F('closing', 'money', 'Saldo final', 'Closing balance', { list: true, ro: true }),
  ],
};
E.account_recons = {
  g: 'finanzas', l: ['Conciliación de cuentas de balance', 'Balance sheet reconciliations'], one: ['Conciliación', 'Reconciliation'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'period', sort: 'id desc',
  statuses: [S('pendiente', 'Pendiente', 'Pending', 'gray'), S('preparada', 'Preparada', 'Prepared', 'blue'), S('aprobada', 'Revisada y firmada', 'Reviewed & signed', 'green'), S('rechazada', 'Rechazada', 'Rejected', 'red')],
  flow: [T(['pendiente', 'rechazada'], 'preparada', 'Firmar como preparador', 'Sign as preparer', ['ADMIN', 'CONT'], { guard: 'reconPrepare' }), T(['preparada'], 'aprobada', 'Firmar como revisor', 'Sign as reviewer', ['ADMIN', 'CONT', 'DIR'], { guard: 'reconReview' }), T(['preparada'], 'rechazada', 'Rechazar', 'Reject', ['ADMIN', 'CONT', 'DIR'], { comment: true })],
  initial: 'pendiente',
  fields: [
    F('period', 'text', 'Periodo', 'Period', { list: true, req: true }),
    F('account_id', 'ref', 'Cuenta', 'Account', { ref: 'gl_accounts', list: true, req: true }),
    F('gl_balance', 'money', 'Saldo contable', 'GL balance', { list: true }),
    F('support_balance', 'money', 'Saldo soporte', 'Supporting balance'),
    F('difference', 'money', 'Diferencia', 'Difference', { ro: true, list: true }),
    F('explanation', 'longtext', 'Explicación de diferencias', 'Explanation of differences'),
    F('evidence', 'file', 'Evidencia', 'Evidence'),
    F('preparer', 'text', 'Preparó (firma)', 'Prepared by (signature)', { ro: true }),
    F('reviewer', 'text', 'Revisó (firma)', 'Reviewed by (signature)', { ro: true }),
  ],
};
E.ic_balances = {
  g: 'finanzas', l: ['Intercompañía', 'Intercompany'], one: ['Saldo intercompañía', 'IC balance'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'period', sort: 'period desc',
  fields: [
    F('period', 'text', 'Periodo', 'Period', { list: true, req: true }),
    F('from_co', 'select', 'Sociedad A', 'Company A', { opts: COMPANY.opts, list: true, req: true }),
    F('to_co', 'select', 'Sociedad B', 'Company B', { opts: COMPANY.opts, list: true, req: true }),
    F('amount_a', 'money', 'Saldo en libros de A', 'Balance in A books', { list: true }),
    F('amount_b', 'money', 'Saldo en libros de B', 'Balance in B books', { list: true }),
    F('difference', 'money', 'Diferencia', 'Difference', { ro: true, list: true }),
    F('concept', 'text', 'Concepto (servicio / venta)', 'Concept (service / sale)'),
  ],
};
E.payroll = {
  g: 'finanzas', l: ['Póliza de nómina', 'Payroll journal'], one: ['Nómina', 'Payroll'],
  read: ['ADMIN', 'DIR', 'CONT'], write: ['ADMIN', 'CONT'], title: 'period', sort: 'id desc',
  statuses: [S('capturada', 'Capturada', 'Captured', 'blue'), S('contabilizada', 'Contabilizada', 'Posted', 'green')],
  flow: [T(['capturada'], 'contabilizada', 'Generar póliza', 'Generate journal', ['ADMIN', 'CONT'])], initial: 'capturada',
  fields: [
    F('period', 'text', 'Periodo de pago', 'Pay period', { list: true, req: true }), COMPANY,
    F('gross', 'money', 'Percepciones', 'Gross pay', { list: true, req: true }),
    F('isr', 'money', 'ISR retenido', 'Income tax withheld', { req: true }),
    F('imss', 'money', 'IMSS obrero', 'Social security (employee)'),
    F('net', 'money', 'Neto pagado', 'Net paid', { ro: true, list: true }),
    F('stamp_ref', 'text', 'Referencia del timbrado externo', 'External stamping reference'),
  ],
};

// ───────────────────────── ACTIVOS FIJOS ─────────────────────────
E.asset_classes = {
  g: 'activos', l: ['Clases de activo', 'Asset classes'], one: ['Clase', 'Class'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Clase', 'Class', { list: true, req: true }),
    F('book_months', 'int', 'Vida útil contable (meses)', 'Book life (months)', { list: true, req: true }),
    F('fiscal_rate', 'pct', 'Tasa fiscal anual (LISR)', 'Annual tax rate (LISR)', { list: true, req: true }),
    F('gl_asset', 'text', 'Cuenta de activo', 'Asset account'),
    F('gl_dep', 'text', 'Cuenta depreciación acumulada', 'Accum. depreciation account'),
    F('gl_exp', 'text', 'Cuenta de gasto', 'Expense account'),
  ],
};
E.assets = {
  g: 'activos', l: ['Registro de activos fijos', 'Fixed asset register'], one: ['Activo fijo', 'Fixed asset'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'description', sort: 'tag',
  statuses: [S('activo', 'En uso', 'In service', 'green'), S('baja', 'Dado de baja', 'Disposed', 'gray')], initial: 'activo',
  fields: [
    F('tag', 'text', 'No. de activo', 'Asset tag', { list: true, req: true, unique: true }),
    F('description', 'text', 'Descripción', 'Description', { list: true, req: true }),
    F('class_id', 'ref', 'Clase', 'Class', { ref: 'asset_classes', list: true, filter: true, req: true }), COMPANY,
    F('location', 'text', 'Ubicación', 'Location'),
    F('custodian', 'text', 'Resguardante', 'Custodian'),
    F('in_service', 'date', 'Fecha de inicio de uso', 'In-service date', { req: true }),
    F('cost', 'money', 'MOI (costo original)', 'Original cost', { list: true, req: true }),
    F('salvage', 'money', 'Valor de rescate', 'Salvage value'),
    F('book_accum', 'money', 'Depreciación contable acumulada', 'Accum. book depreciation', { ro: true }),
    F('nbv', 'money', 'Valor en libros', 'Net book value', { ro: true, list: true }),
    F('fiscal_accum', 'money', 'Depreciación fiscal acumulada', 'Accum. tax depreciation', { ro: true }),
    F('cfdi_uuid', 'text', 'UUID factura de compra', 'Purchase invoice UUID'),
  ],
};
E.asset_events = {
  g: 'activos', l: ['Altas, mejoras, traspasos y bajas', 'Additions, transfers & disposals'], one: ['Movimiento de activo', 'Asset event'],
  read: INTERNAL, write: ['ADMIN', 'CONT', 'PROD', 'LOG'], title: 'type', sort: 'id desc',
  statuses: [S('solicitado', 'Solicitado', 'Requested', 'amber'), S('aprobado', 'Aprobado y aplicado', 'Approved & applied', 'green'), S('rechazado', 'Rechazado', 'Rejected', 'red')],
  flow: [T(['solicitado'], 'aprobado', 'Aprobar y aplicar', 'Approve & apply', ['ADMIN', 'CONT', 'DIR'], { guard: 'assetEvent', sod: true }), T(['solicitado'], 'rechazado', 'Rechazar', 'Reject', ['ADMIN', 'CONT', 'DIR'], { comment: true })],
  initial: 'solicitado',
  fields: [
    F('asset_id', 'ref', 'Activo', 'Asset', { ref: 'assets', list: true, req: true }),
    F('type', 'select', 'Tipo', 'Type', { list: true, req: true, opts: [O('mejora', 'Mejora / refacción capitalizable', 'Capitalizable improvement'), O('traspaso', 'Traspaso de ubicación', 'Location transfer'), O('venta', 'Venta', 'Sale'), O('baja', 'Baja por desecho', 'Scrap disposal')] }),
    F('date', 'date', 'Fecha', 'Date', { list: true, req: true }),
    F('amount', 'money', 'Importe (mejora o precio de venta)', 'Amount (improvement or sale price)', { list: true }),
    F('new_location', 'text', 'Nueva ubicación', 'New location'),
    F('gain_loss', 'money', 'Utilidad / pérdida en venta', 'Gain / loss on sale', { ro: true }),
    F('policy_check', 'text', 'Validación de política', 'Policy check', { ro: true }),
    F('justification', 'longtext', 'Justificación', 'Justification', { req: true }),
  ],
};
E.depr_runs = {
  g: 'activos', l: ['Corridas de depreciación', 'Depreciation runs'], one: ['Corrida de depreciación', 'Depreciation run'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'period', sort: 'period desc',
  statuses: [S('borrador', 'Calculada', 'Calculated', 'blue'), S('contabilizada', 'Contabilizada', 'Posted', 'green')],
  flow: [T(['borrador'], 'contabilizada', 'Contabilizar', 'Post', ['ADMIN', 'CONT'], { guard: 'deprPost' })], initial: 'borrador',
  actions: [{ k: 'calc', l: ['Calcular depreciación', 'Calculate depreciation'], roles: ['ADMIN', 'CONT'], when: ['borrador'] }],
  fields: [
    F('period', 'text', 'Periodo (AAAA-MM)', 'Period (YYYY-MM)', { list: true, req: true }),
    F('assets', 'int', 'Activos depreciados', 'Assets depreciated', { ro: true, list: true }),
    F('book_total', 'money', 'Depreciación contable', 'Book depreciation', { ro: true, list: true }),
    F('fiscal_total', 'money', 'Depreciación fiscal', 'Tax depreciation', { ro: true, list: true }),
  ],
};
E.inpc = {
  g: 'activos', l: ['INPC', 'Consumer price index (INPC)'], one: ['Índice', 'Index'],
  read: INTERNAL, write: ['ADMIN', 'CONT'], title: 'period', sort: 'period desc',
  fields: [F('period', 'text', 'Periodo (AAAA-MM)', 'Period (YYYY-MM)', { list: true, req: true, unique: true }), F('value', 'num', 'Valor', 'Value', { list: true, req: true })],
};

// ───────────────────────── COSTOS ─────────────────────────
E.boms = {
  g: 'costos', l: ['Fórmulas / listas de materiales', 'Formulas / BOMs'], one: ['Fórmula', 'Formula'],
  read: ['ADMIN', 'DIR', 'COST'], write: ['ADMIN', 'DIR', 'COST'], title: 'version', sort: 'id desc',
  lines: [F('component', 'text', 'Insumo', 'Component', { req: true }), F('qty_ton', 'num', 'Kg por tonelada', 'Kg per ton', { req: true }), F('std_price', 'money', 'Precio estándar por kg', 'Std price per kg', { req: true }), F('total', 'money', 'Costo por tonelada', 'Cost per ton', { ro: true })],
  statuses: [S('borrador', 'Borrador', 'Draft'), S('vigente', 'Vigente', 'Active', 'green'), S('obsoleta', 'Obsoleta', 'Obsolete', 'gray')],
  flow: [T(['borrador'], 'vigente', 'Activar versión', 'Activate version', ['ADMIN', 'DIR', 'COST'], { guard: 'bomActivate' })], initial: 'borrador',
  fields: [
    F('product_id', 'ref', 'Producto', 'Product', { ref: 'products', list: true, req: true }),
    F('version', 'text', 'Versión', 'Version', { list: true, req: true }),
    F('material_ton', 'money', 'Material por tonelada', 'Material per ton', { ro: true, list: true }),
    F('labor_ton', 'money', 'Mano de obra por tonelada', 'Labor per ton'),
    F('packaging_unit', 'money', 'Empaque por unidad', 'Packaging per unit'),
    F('change_reason', 'longtext', 'Motivo del cambio / sustitución', 'Change / substitution reason'),
  ],
};
E.cost_pools = {
  g: 'costos', l: ['Costos indirectos y prorrateo', 'Overhead pools & allocation'], one: ['Pool de costo', 'Cost pool'],
  read: ['ADMIN', 'DIR', 'COST', 'CONT'], write: ['ADMIN', 'COST', 'CONT'], title: 'name', sort: 'period desc, name',
  fields: [
    F('period', 'text', 'Periodo', 'Period', { list: true, req: true }),
    F('name', 'select', 'Concepto', 'Concept', { list: true, req: true, opts: [O('mantenimiento', 'Mantenimiento', 'Maintenance'), O('energia', 'Energía', 'Energy'), O('fumigacion', 'Fumigación', 'Fumigation'), O('limpieza', 'Limpieza de líneas', 'Line cleaning'), O('moi', 'Mano de obra indirecta', 'Indirect labor'), O('depreciacion', 'Depreciación de planta', 'Plant depreciation')] }),
    F('plant', 'text', 'Planta', 'Plant', { list: true }),
    F('amount', 'money', 'Importe del periodo', 'Period amount', { list: true, req: true }),
    F('driver', 'select', 'Base de prorrateo', 'Allocation driver', { opts: [O('kg', 'Kg producidos', 'Kg produced'), O('horas', 'Horas máquina', 'Machine hours')], def: 'kg' }),
    F('driver_qty', 'num', 'Total de la base', 'Driver total', { req: true }),
    F('rate', 'money', 'Tasa por unidad de base', 'Rate per driver unit', { ro: true, list: true }),
  ],
};

// ───────────────────────── GOBERNANZA ─────────────────────────
E.policies = {
  g: 'gobernanza', l: ['Políticas y procedimientos', 'Policies & procedures'], one: ['Política', 'Policy'],
  read: INTERNAL, write: ['ADMIN', 'DIR', 'CONT'], title: 'name', sort: 'name',
  statuses: [S('borrador', 'Borrador', 'Draft'), S('revision', 'En revisión', 'In review', 'amber'), S('vigente', 'Vigente', 'In force', 'green'), S('obsoleta', 'Obsoleta', 'Obsolete', 'gray')],
  flow: [T(['borrador'], 'revision', 'Enviar a revisión', 'Send to review', ['ADMIN', 'DIR', 'CONT']), T(['revision'], 'vigente', 'Aprobar y publicar', 'Approve & publish', ['ADMIN', 'DIR'], { guard: 'policyPublish' }), T(['vigente'], 'borrador', 'Nueva versión', 'New version', ['ADMIN', 'DIR', 'CONT'], { guard: 'policyNewVersion' }), T(['vigente'], 'obsoleta', 'Marcar obsoleta', 'Retire', ['ADMIN', 'DIR'])],
  initial: 'borrador',
  actions: [{ k: 'ack', l: ['Acusar de leído', 'Acknowledge'], roles: INTERNAL, when: ['vigente'] }],
  fields: [
    F('name', 'text', 'Política', 'Policy', { list: true, req: true }),
    F('process', 'text', 'Proceso', 'Process', { list: true }),
    F('owner_id', 'ref', 'Dueño', 'Owner', { ref: 'users', list: true }),
    F('version', 'int', 'Versión', 'Version', { ro: true, list: true, def: 1 }),
    F('effective', 'date', 'Vigente desde', 'Effective from'),
    F('audience', 'text', 'Roles que deben acusar (separados por coma)', 'Roles that must acknowledge (comma-separated)'),
    F('acks', 'pct', '% de acuse', '% acknowledged', { ro: true, list: true }),
    F('body', 'longtext', 'Contenido', 'Content', { req: true }),
  ],
};
E.raci = {
  g: 'gobernanza', l: ['Dueños de proceso (RACI)', 'Process owners (RACI)'], one: ['Asignación RACI', 'RACI assignment'],
  read: INTERNAL, write: ['ADMIN', 'DIR'], title: 'process', sort: 'process',
  fields: [
    F('process', 'text', 'Proceso / dato maestro', 'Process / master data', { list: true, req: true }),
    F('responsible', 'text', 'R — Ejecuta', 'R — Responsible', { list: true }),
    F('accountable_id', 'ref', 'A — Dueño único', 'A — Single owner', { ref: 'users', list: true, req: true }),
    F('consulted', 'text', 'C — Consultado', 'C — Consulted'),
    F('informed', 'text', 'I — Informado', 'I — Informed'),
  ],
};
E.sod_rules = {
  g: 'gobernanza', l: ['Segregación de funciones', 'Segregation of duties'], one: ['Regla SoD', 'SoD rule'],
  read: INTERNAL, write: ['ADMIN', 'DIR'], title: 'rule', sort: 'id',
  fields: [
    F('rule', 'text', 'Regla', 'Rule', { list: true, req: true }),
    F('control', 'text', 'Cómo se controla en el sistema', 'How the system enforces it', { list: true }),
    F('active', 'bool', 'Activa', 'Active', { def: true, list: true }),
  ],
};
E.corrective_actions = {
  g: 'gobernanza', l: ['Acciones correctivas', 'Corrective actions'], one: ['Acción correctiva', 'Corrective action'],
  read: INTERNAL, write: INTERNAL, title: 'issue', sort: 'id desc',
  statuses: [S('abierta', 'Abierta', 'Open', 'amber'), S('en_proceso', 'En proceso', 'In progress', 'blue'), S('cerrada', 'Cerrada', 'Closed', 'green')],
  flow: [T(['abierta'], 'en_proceso', 'Atender', 'Start', INTERNAL), T(['abierta', 'en_proceso'], 'cerrada', 'Cerrar', 'Close', INTERNAL, { comment: true })], initial: 'abierta',
  fields: [
    F('issue', 'text', 'Error detectado', 'Issue found', { list: true, req: true }),
    F('origin_area', 'text', 'Área que lo originó', 'Originating area', { list: true, filter: true, req: true }),
    F('owner_id', 'ref', 'Responsable de corregir', 'Owner', { ref: 'users', list: true }),
    F('due', 'date', 'Fecha compromiso', 'Due date', { list: true }),
    F('detail', 'longtext', 'Detalle', 'Detail'),
  ],
};

// ───────────────────────── ADMIN ─────────────────────────
E.users = {
  g: 'admin', l: ['Usuarios y roles', 'Users & roles'], one: ['Usuario', 'User'],
  read: INTERNAL, write: ['ADMIN'], title: 'name', sort: 'name',
  fields: [
    F('name', 'text', 'Nombre', 'Name', { list: true, req: true }),
    F('role', 'select', 'Rol', 'Role', { opts: ROLE_OPTS, list: true, filter: true, req: true }),
    F('position', 'text', 'Puesto', 'Position', { list: true }),
    F('email', 'text', 'Correo', 'Email'),
    F('supplier_id', 'ref', 'Proveedor (solo portal)', 'Supplier (portal only)', { ref: 'suppliers' }),
    F('pin', 'pin', 'PIN (4-6 dígitos)', 'PIN (4-6 digits)', { help: ['Deje vacío para conservar el actual', 'Leave blank to keep current'] }),
    F('active', 'bool', 'Activo', 'Active', { def: true, list: true }),
  ],
};

// Defaults
for (const [k, e] of Object.entries(E)) {
  e.k = k;
  e.fields = e.fields || [];
  if (e.statuses && !e.initial) e.initial = e.statuses[0].k;
}

module.exports = { E, ROLES, GROUPS, INTERNAL, F, AREAS, DIAG_STATUS };
