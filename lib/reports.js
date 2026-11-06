'use strict';
const db = require('./db');
const L = () => require('./logic');
const { INTERNAL } = require('./meta');
const H = () => L().helpers;
const n = v => Number(v) || 0;
const r2 = v => Math.round(n(v) * 100) / 100;
const C = (k, es, en, t) => ({ k, l: [es, en], t });
const per = q => (q.period && /^\d{4}-\d{2}$/.test(q.period) ? q.period : H().period());
const PERIOD = { k: 'period', l: ['Periodo', 'Period'], t: 'period' };

const REPORTS = [
  { k: 'availability', g: 'ventas', l: ['Disponibilidad de inventario', 'Inventory availability'], d: ['Existencia − apartado por pedidos, por bodega', 'On hand − reserved, by warehouse'], roles: INTERNAL,
    filters: [{ k: 'warehouse', l: ['Bodega', 'Warehouse'], t: 'ref', ref: 'warehouses' }, { k: 'q', l: ['Producto', 'Product'], t: 'text' }],
    async run(q) {
      const rows = await db.all(`WITH st AS (SELECT warehouse_id, product_id, sum(qty)::float q FROM stock GROUP BY 1,2),
        rs AS (SELECT o.warehouse_id, (l->>'product_id')::int product_id, sum((l->>'qty')::numeric)::float q FROM orders o, jsonb_array_elements(o.lines) l WHERE o.status IN ('confirmado','en_produccion','listo','programado') GROUP BY 1,2),
        pr AS (SELECT warehouse_id, product_id, sum(qty)::float q FROM production_orders WHERE status IN ('solicitada','programada','en_proceso') GROUP BY 1,2)
        SELECT w.name wh, p.code, p.name, p.uom, coalesce(st.q,0) stock, coalesce(rs.q,0) reserved, coalesce(st.q,0)-coalesce(rs.q,0) available, coalesce(pr.q,0) incoming
        FROM st FULL JOIN rs USING (warehouse_id, product_id) LEFT JOIN pr USING (warehouse_id, product_id) JOIN products p ON p.id = product_id JOIN warehouses w ON w.id = warehouse_id
        WHERE ($1::int IS NULL OR warehouse_id=$1) AND ($2::text IS NULL OR p.name ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%') ORDER BY w.name, p.code`, [parseInt(q.warehouse, 10) || null, q.q || null]);
      const snap = await db.one('SELECT max(updated_at) t FROM stock');
      return { kpis: [{ l: ['Productos sin disponibilidad', 'Products out of stock'], v: rows.filter(r => r.available <= 0).length, t: 'num', tone: 'bad' }, { l: ['Unidades disponibles', 'Units available'], v: rows.reduce((s, r) => s + Math.max(0, r.available), 0), t: 'num' }, { l: ['Unidades apartadas', 'Units reserved'], v: rows.reduce((s, r) => s + r.reserved, 0), t: 'num' }, { l: ['Última actualización de inventario', 'Last stock update'], v: snap && snap.t ? new Date(snap.t).toLocaleString('es-GT', { timeZone: 'America/Mexico_City' }) : '—', t: 'text' }],
        table: { cols: [C('wh', 'Bodega', 'Warehouse'), C('code', 'Código', 'Code'), C('name', 'Producto', 'Product'), C('stock', 'Existencia', 'On hand', 'num'), C('reserved', 'Apartado', 'Reserved', 'num'), C('available', 'Disponible', 'Available', 'num'), C('incoming', 'En producción', 'In production', 'num')], rows } };
    } },
  { k: 'credit_notes', g: 'ventas', l: ['Análisis de notas de crédito', 'Credit note analysis'], d: ['Volumen por motivo, cliente y mes', 'Volume by reason, customer and month'], roles: INTERNAL,
    async run() {
      const byM = await db.all(`SELECT to_char(created_at,'YYYY-MM') m, count(*)::int c, sum(amount)::float a FROM credit_notes WHERE status<>'rechazada' AND created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 1`);
      const byR = await db.all(`SELECT reason, count(*)::int c, sum(amount)::float a FROM credit_notes WHERE status<>'rechazada' AND created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 3 DESC`);
      const byC = await db.all(`SELECT c.name, count(*)::int cnt, sum(cn.amount)::float amount, string_agg(DISTINCT cn.reason, ', ') reasons FROM credit_notes cn JOIN customers c ON c.id=cn.customer_id WHERE cn.status<>'rechazada' AND cn.created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 3 DESC LIMIT 25`);
      const RL = { entrega: ['Entrega', 'Delivery'], flete: ['Flete', 'Freight'], promocion: ['Promoción', 'Promotion'], devolucion: ['Devolución', 'Return'], precio: ['Precio', 'Price'], calidad: ['Calidad', 'Quality'], otro: ['Otro', 'Other'] };
      const cur = byM[byM.length - 1] || { c: 0, a: 0 }, first = byM[0] || { c: 0, a: 0 };
      const avoidable = byR.filter(r => ['promocion', 'flete', 'precio'].includes(r.reason)).reduce((s, r) => s + r.a, 0);
      return { kpis: [{ l: ['Notas este mes', 'Notes this month'], v: cur.c, t: 'num' }, { l: ['Importe este mes', 'Amount this month'], v: cur.a, t: 'money' }, { l: ['Variación vs. hace 6 meses', 'Change vs 6 months ago'], v: first.c ? r2((cur.c - first.c) / first.c * 100) : 0, t: 'pct', tone: cur.c <= first.c ? 'good' : 'bad' }, { l: ['Evitables (promo, flete, precio) 6m', 'Avoidable (promo, freight, price) 6m'], v: avoidable, t: 'money', tone: 'bad' }],
        charts: [{ type: 'bar', l: ['Notas de crédito por mes (importe)', 'Credit notes per month (amount)'], t: 'money', items: byM.map(r => ({ label: [r.m, r.m], v: r.a })) }, { type: 'hbar', l: ['Por motivo (6 meses)', 'By reason (6 months)'], t: 'money', items: byR.map(r => ({ label: RL[r.reason] || [r.reason, r.reason], v: r.a })) }],
        table: { cols: [C('name', 'Cliente', 'Customer'), C('cnt', 'Notas', 'Notes', 'num'), C('amount', 'Importe', 'Amount', 'money'), C('reasons', 'Motivos', 'Reasons')], rows: byC },
        note: ['Meta: que las notas por promoción y flete tiendan a cero, porque ahora se configuran en el pedido.', 'Goal: promo and freight notes trend to zero as they are now configured on the order.'] };
    } },
  { k: 'sales', g: 'ventas', l: ['Reportería comercial', 'Sales analytics'], d: ['Ventas por familia, zona, asesor o producto', 'Sales by family, zone, advisor or product'], roles: ['ADMIN', 'DIR', 'GV', 'VTA', 'COST', 'CONT'],
    filters: [{ k: 'dim', l: ['Agrupar por', 'Group by'], t: 'select', opts: [['family', 'Familia', 'Family'], ['zone', 'Zona', 'Zone'], ['advisor', 'Asesor', 'Advisor'], ['product', 'Producto', 'Product'], ['channel', 'Canal', 'Channel'], ['customer', 'Cliente', 'Customer']] }, { k: 'months', l: ['Meses', 'Months'], t: 'select', opts: [['3', '3', '3'], ['6', '6', '6'], ['12', '12', '12']] }],
    async run(q) {
      const dim = { family: 'coalesce(f.name,\'—\')', zone: 'coalesce(c.zone,\'—\')', advisor: 'coalesce(u.name,\'—\')', product: 'p.code||\' · \'||p.name', channel: 'coalesce(c.channel,\'—\')', customer: 'c.name' }[q.dim] || 'coalesce(f.name,\'—\')';
      const months = parseInt(q.months, 10) || 6;
      const rows = await db.all(`SELECT ${dim} g, sum((l->>'qty')::numeric)::float units, sum((l->>'total')::numeric)::float revenue, count(DISTINCT i.id)::int invoices, count(DISTINCT c.id)::int customers
        FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=c.advisor_id, jsonb_array_elements(i.lines) l JOIN products p ON p.id=(l->>'product_id')::int LEFT JOIN product_families f ON f.id=p.family_id
        WHERE i.status<>'cancelada' AND i.date >= (current_date - ($1 || ' months')::interval) GROUP BY 1 ORDER BY 3 DESC`, [String(months)]);
      const tot = rows.reduce((s, r) => s + r.revenue, 0);
      rows.forEach(r => { r.share = tot ? r2(r.revenue / tot * 100) : 0; });
      return { kpis: [{ l: ['Venta del periodo', 'Period sales'], v: tot, t: 'money' }, { l: ['Facturas', 'Invoices'], v: rows.reduce((s, r) => Math.max(s, 0) + r.invoices, 0), t: 'num' }], charts: [{ type: 'hbar', l: ['Top 12', 'Top 12'], t: 'money', items: rows.slice(0, 12).map(r => ({ label: [r.g, r.g], v: r.revenue })) }],
        table: { cols: [C('g', 'Grupo', 'Group'), C('units', 'Unidades', 'Units', 'num'), C('revenue', 'Venta', 'Sales', 'money'), C('share', '% del total', '% of total', 'pct'), C('customers', 'Clientes', 'Customers', 'num')], rows } };
    } },
  { k: 'keep_discontinue', g: 'ventas', l: ['Mantener o descontinuar productos', 'Keep or discontinue products'], d: ['Volumen, margen y tendencia de 12 meses', '12-month volume, margin and trend'], roles: ['ADMIN', 'DIR', 'GV', 'COST'],
    async run() {
      const rows = await db.all(`SELECT p.id, p.code, p.name, coalesce(p.std_cost,0)::float cost,
        sum((l->>'qty')::numeric)::float units, sum((l->>'total')::numeric)::float revenue,
        sum(CASE WHEN i.date >= current_date - interval '3 months' THEN (l->>'qty')::numeric ELSE 0 END)::float last3,
        sum(CASE WHEN i.date < current_date - interval '3 months' AND i.date >= current_date - interval '6 months' THEN (l->>'qty')::numeric ELSE 0 END)::float prev3
        FROM products p LEFT JOIN invoices i ON i.status<>'cancelada' AND i.date >= current_date - interval '12 months' LEFT JOIN LATERAL jsonb_array_elements(i.lines) l ON (l->>'product_id')::int = p.id
        GROUP BY p.id ORDER BY revenue DESC NULLS LAST`);
      const list = rows.map(r => { const units = n(r.units), rev = n(r.revenue); const margin = rev ? r2((rev - units * r.cost) / rev * 100) : 0; const trend = r.prev3 ? r2((r.last3 - r.prev3) / r.prev3 * 100) : (r.last3 ? 100 : -100); return { code: r.code, name: r.name, units, revenue: rev, margin, trend }; });
      const sorted = [...list].sort((a, b) => a.revenue - b.revenue);
      list.forEach(x => { const rank = sorted.indexOf(x) / Math.max(1, sorted.length - 1); x.score = r2(rank * 40 + Math.max(0, Math.min(40, x.margin)) + Math.max(-20, Math.min(20, x.trend / 5))); x.rec = x.score < 25 && x.trend < 0 ? 'Evaluar descontinuar' : x.score < 40 ? 'Vigilar' : 'Mantener'; });
      list.sort((a, b) => a.score - b.score);
      return { kpis: [{ l: ['Sugeridos para descontinuar', 'Suggested to discontinue'], v: list.filter(x => x.rec === 'Evaluar descontinuar').length, t: 'num', tone: 'bad' }, { l: ['A vigilar', 'To watch'], v: list.filter(x => x.rec === 'Vigilar').length, t: 'num' }],
        table: { cols: [C('code', 'Código', 'Code'), C('name', 'Producto', 'Product'), C('units', 'Unidades 12m', 'Units 12m', 'num'), C('revenue', 'Venta 12m', 'Sales 12m', 'money'), C('margin', 'Margen %', 'Margin %', 'pct'), C('trend', 'Tendencia 3m', '3m trend', 'pct'), C('score', 'Score', 'Score', 'num'), C('rec', 'Recomendación', 'Recommendation')], rows: list },
        note: ['Antes tomaba un día completo en Excel; ahora se calcula al instante con datos de facturación y costo estándar.', 'Previously a full day in Excel; now instant from billing and standard cost.'] };
    } },
  { k: 'forecast', g: 'ventas', l: ['Precisión del pronóstico', 'Forecast accuracy'], d: ['Pronóstico vs. real por asesor', 'Forecast vs actual by advisor'], roles: ['ADMIN', 'DIR', 'GV', 'VTA', 'PROD'],
    async run() {
      const rows = await db.all(`SELECT f.period, coalesce(u.name,'—') advisor, sum(f.qty)::float fc, sum(f.actual)::float act FROM forecasts f LEFT JOIN users u ON u.id=f.advisor_id GROUP BY 1,2 ORDER BY 1 DESC, 2`);
      rows.forEach(r => { r.accuracy = r.fc ? r2(Math.max(0, 1 - Math.abs(r.fc - r.act) / r.fc) * 100) : 0; r.bias = r.act ? r2((r.fc - r.act) / r.act * 100) : 0; });
      const avg = rows.length ? r2(rows.reduce((s, r) => s + r.accuracy, 0) / rows.length) : 0;
      return { kpis: [{ l: ['Precisión promedio', 'Average accuracy'], v: avg, t: 'pct' }, { l: ['Sobre-pronóstico promedio', 'Average over-forecast'], v: rows.length ? r2(rows.reduce((s, r) => s + r.bias, 0) / rows.length) : 0, t: 'pct', tone: 'bad' }],
        table: { cols: [C('period', 'Periodo', 'Period'), C('advisor', 'Asesor', 'Advisor'), C('fc', 'Pronóstico', 'Forecast', 'num'), C('act', 'Real', 'Actual', 'num'), C('accuracy', 'Precisión', 'Accuracy', 'pct'), C('bias', 'Sesgo', 'Bias', 'pct')], rows } };
    } },
  { k: 'capture_lag', g: 'operacion', l: ['Retraso de captura por bodega', 'Capture lag by warehouse'], d: ['Horas entre el movimiento físico y su captura en SAP', 'Hours between physical move and SAP capture'], roles: INTERNAL,
    async run() {
      const rows = await db.all(`SELECT w.name, coalesce(u.name,'Sin responsable') resp, w.lag_target::float target, count(m.id)::int moves, coalesce(avg(m.lag_hours),0)::float avg_lag, coalesce(max(m.lag_hours),0)::float max_lag, count(*) FILTER (WHERE m.lag_hours > w.lag_target)::int late, count(*) FILTER (WHERE m.captured_at IS NULL)::int pending
        FROM warehouses w LEFT JOIN users u ON u.id=w.coordinator_id LEFT JOIN wh_movements m ON m.warehouse_id=w.id AND m.physical_at > now() - interval '60 days' GROUP BY w.id, u.name ORDER BY avg_lag DESC`);
      rows.forEach(r => { r.avg_lag = r2(r.avg_lag); r.max_lag = r2(r.max_lag); });
      return { kpis: [{ l: ['Retraso promedio (h)', 'Average lag (h)'], v: rows.length ? r2(rows.reduce((s, r) => s + r.avg_lag, 0) / rows.length) : 0, t: 'num' }, { l: ['Movimientos fuera de meta', 'Moves over target'], v: rows.reduce((s, r) => s + r.late, 0), t: 'num', tone: 'bad' }, { l: ['Sin capturar en SAP', 'Not captured in SAP'], v: rows.reduce((s, r) => s + r.pending, 0), t: 'num', tone: 'bad' }],
        charts: [{ type: 'hbar', l: ['Retraso promedio por bodega (horas)', 'Average lag by warehouse (hours)'], t: 'num', items: rows.map(r => ({ label: [r.name, r.name], v: r.avg_lag })) }],
        table: { cols: [C('name', 'Bodega', 'Warehouse'), C('resp', 'Responsable', 'Owner'), C('moves', 'Movimientos', 'Moves', 'num'), C('avg_lag', 'Prom. (h)', 'Avg (h)', 'num'), C('max_lag', 'Máx. (h)', 'Max (h)', 'num'), C('late', 'Fuera de meta', 'Over target', 'num'), C('pending', 'Pendientes', 'Pending', 'num')], rows } };
    } },
  { k: 'wip', g: 'operacion', l: ['Producción en proceso (WIP)', 'Work in process (WIP)'], d: ['Órdenes por etapa, línea y atraso', 'Orders by stage, line and delay'], roles: INTERNAL,
    async run() {
      const rows = await db.all(`SELECT po.folio, p.code||' · '||p.name product, coalesce(pl.name,'Sin línea') line, po.status, po.kg::float kg, po.need_by, po.sched_date, o.folio order_folio, GREATEST(0, current_date - po.need_by)::int late_days
        FROM production_orders po JOIN products p ON p.id=po.product_id LEFT JOIN production_lines pl ON pl.id=po.line_id LEFT JOIN orders o ON o.id=po.order_id WHERE po.status IN ('solicitada','programada','en_proceso') ORDER BY po.need_by NULLS LAST`);
      const st = s => rows.filter(r => r.status === s);
      return { kpis: [{ l: ['Solicitadas sin programar', 'Requested, unscheduled'], v: st('solicitada').length, t: 'num', tone: st('solicitada').length ? 'bad' : '' }, { l: ['Programadas', 'Scheduled'], v: st('programada').length, t: 'num' }, { l: ['Kg en proceso (WIP)', 'Kg in process (WIP)'], v: st('en_proceso').reduce((s, r) => s + r.kg, 0), t: 'num' }, { l: ['Órdenes atrasadas', 'Late orders'], v: rows.filter(r => r.late_days > 0).length, t: 'num', tone: 'bad' }],
        table: { cols: [C('folio', 'OF', 'PO'), C('product', 'Producto', 'Product'), C('line', 'Línea', 'Line'), C('status', 'Etapa', 'Stage', 'status:production_orders'), C('kg', 'Kg', 'Kg', 'num'), C('need_by', 'Requerida', 'Needed', 'date'), C('order_folio', 'Pedido', 'Order'), C('late_days', 'Días de atraso', 'Days late', 'num')], rows } };
    } },
  { k: 'lots', g: 'operacion', l: ['Trazabilidad de lotes', 'Lot traceability'], d: ['Lote → producción → bodega', 'Lot → production → warehouse'], roles: INTERNAL, filters: [{ k: 'q', l: ['Lote o producto', 'Lot or product'], t: 'text' }],
    async run(q) {
      const rows = await db.all(`SELECT s.lot, p.code||' · '||p.name product, w.name wh, s.qty::float qty, s.expires, po.folio prod_folio, po.sched_date FROM stock s JOIN products p ON p.id=s.product_id JOIN warehouses w ON w.id=s.warehouse_id LEFT JOIN production_orders po ON po.lot=s.lot WHERE s.lot IS NOT NULL AND ($1::text IS NULL OR s.lot ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%' OR p.code ILIKE '%'||$1||'%') ORDER BY s.expires NULLS LAST LIMIT 500`, [q.q || null]);
      const soon = rows.filter(r => r.expires && r.expires <= H().addDays(H().today(), 30)).length;
      return { kpis: [{ l: ['Lotes en inventario', 'Lots in stock'], v: rows.length, t: 'num' }, { l: ['Caducan en 30 días', 'Expiring in 30 days'], v: soon, t: 'num', tone: soon ? 'bad' : '' }], table: { cols: [C('lot', 'Lote', 'Lot'), C('product', 'Producto', 'Product'), C('wh', 'Bodega', 'Warehouse'), C('qty', 'Cantidad', 'Qty', 'num'), C('expires', 'Caducidad', 'Expiry', 'date'), C('prod_folio', 'OF origen', 'Source PO')], rows } };
    } },
  { k: 'freight', g: 'logistica', l: ['Flete cobrado vs. real', 'Freight charged vs. actual'], d: ['Por pedido, ruta y dobles fletes', 'By order, route and double freight'], roles: ['ADMIN', 'DIR', 'GV', 'LOG', 'CONT', 'COST'],
    async run() {
      const rows = await db.all(`SELECT r.name route, count(o.id)::int orders, sum(o.freight)::float charged, sum(o.freight_actual)::float actual FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN routes r ON r.id=c.route_id WHERE o.freight_actual > 0 GROUP BY 1 ORDER BY 1`);
      rows.forEach(r => { r.margin = r2(n(r.charged) - n(r.actual)); r.pct = r.charged ? r2(r.margin / r.charged * 100) : 0; });
      const df = await db.all(`SELECT cause, count(*)::int c, sum(cost)::float a FROM double_freight WHERE date >= current_date - interval '90 days' GROUP BY 1 ORDER BY 3 DESC`);
      const CL = { produccion: ['Producción tardía', 'Late production'], bodega: ['Bodega', 'Warehouse'], venta: ['Venta sin disponibilidad', 'Sales w/o stock'], cliente: ['Cliente', 'Customer'], transporte: ['Transporte', 'Transport'] };
      const ch = rows.reduce((s, r) => s + n(r.charged), 0), ac = rows.reduce((s, r) => s + n(r.actual), 0);
      return { kpis: [{ l: ['Flete cobrado', 'Freight charged'], v: ch, t: 'money' }, { l: ['Flete real', 'Actual freight'], v: ac, t: 'money' }, { l: ['Resultado del transporte', 'Transport result'], v: r2(ch - ac), t: 'money', tone: ch >= ac ? 'good' : 'bad' }, { l: ['Dobles fletes 90 días', 'Double freight 90 days'], v: df.reduce((s, r) => s + r.a, 0), t: 'money', tone: 'bad' }],
        charts: [{ type: 'hbar', l: ['Dobles fletes por causa (90 días)', 'Double freight by cause (90 days)'], t: 'money', items: df.map(r => ({ label: CL[r.cause] || [r.cause, r.cause], v: r.a })) }],
        table: { cols: [C('route', 'Ruta', 'Route'), C('orders', 'Pedidos', 'Orders', 'num'), C('charged', 'Cobrado', 'Charged', 'money'), C('actual', 'Real', 'Actual', 'money'), C('margin', 'Diferencia', 'Difference', 'money'), C('pct', '%', '%', 'pct')], rows },
        note: ['La empresa de transporte se mide como unidad de negocio: lo cobrado al cliente contra el costo real de cada viaje.', 'Transport is measured as a business unit: charged to customer vs. actual trip cost.'] };
    } },
  { k: 'billing_queue', g: 'cobranza', l: ['Cola de facturación', 'Billing queue'], d: ['Pedidos entregados pendientes de facturar', 'Delivered orders pending invoice'], roles: ['ADMIN', 'DIR', 'FACT', 'COB', 'GV', 'LOG', 'CONT'],
    async run() {
      const rows = await db.all(`SELECT o.id, o.folio, c.name customer, o.total::float total, d.delivered_at, d.photo, round(extract(epoch from now()-d.delivered_at)/3600)::int hours FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN LATERAL (SELECT delivered_at, photo FROM deliveries WHERE order_id=o.id AND status IN ('entregado','parcial') ORDER BY id DESC LIMIT 1) d ON true WHERE o.status='entregado' ORDER BY d.delivered_at NULLS FIRST`);
      rows.forEach(r => { r.link = `#/e/orders/${r.id}`; r.evidence = r.photo ? 'Sí' : 'No'; });
      return { kpis: [{ l: ['Pedidos por facturar', 'Orders to invoice'], v: rows.length, t: 'num' }, { l: ['Importe por facturar', 'Amount to invoice'], v: rows.reduce((s, r) => s + r.total, 0), t: 'money' }, { l: ['Horas promedio desde la entrega', 'Avg hours since delivery'], v: rows.length ? Math.round(rows.reduce((s, r) => s + n(r.hours), 0) / rows.length) : 0, t: 'num' }],
        table: { cols: [C('folio', 'Pedido', 'Order', 'link'), C('customer', 'Cliente', 'Customer'), C('total', 'Total', 'Total', 'money'), C('delivered_at', 'Entregado', 'Delivered', 'datetime'), C('hours', 'Horas', 'Hours', 'num'), C('evidence', 'Remisión firmada', 'Signed note')], rows } };
    } },
  { k: 'ar_aging', g: 'cobranza', l: ['Antigüedad de saldos (CxC)', 'A/R aging'], d: ['Por cliente, asesor y bodega', 'By customer, advisor and warehouse'], roles: ['ADMIN', 'DIR', 'COB', 'CONT', 'GV', 'FACT'],
    async run() {
      const rows = await db.all(`SELECT c.name customer, coalesce(u.name,'—') advisor, c.credit_limit::float credit_limit,
        sum(CASE WHEN i.due >= current_date THEN i.balance ELSE 0 END)::float current,
        sum(CASE WHEN current_date - i.due BETWEEN 1 AND 30 THEN i.balance ELSE 0 END)::float d30,
        sum(CASE WHEN current_date - i.due BETWEEN 31 AND 60 THEN i.balance ELSE 0 END)::float d60,
        sum(CASE WHEN current_date - i.due BETWEEN 61 AND 90 THEN i.balance ELSE 0 END)::float d90,
        sum(CASE WHEN current_date - i.due > 90 THEN i.balance ELSE 0 END)::float d90p, sum(i.balance)::float total
        FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=c.advisor_id WHERE i.status='abierta' AND i.balance > 0.01 GROUP BY c.id, u.name ORDER BY total DESC`);
      const S = k => rows.reduce((s, r) => s + n(r[k]), 0);
      return { kpis: [{ l: ['Cartera total', 'Total A/R'], v: S('total'), t: 'money' }, { l: ['Vencido', 'Past due'], v: S('d30') + S('d60') + S('d90') + S('d90p'), t: 'money', tone: 'bad' }, { l: ['Más de 90 días', 'Over 90 days'], v: S('d90p'), t: 'money', tone: 'bad' }],
        charts: [{ type: 'bar', l: ['Cartera por antigüedad', 'A/R by age'], t: 'money', items: [{ label: ['Por vencer', 'Current'], v: S('current') }, { label: ['1-30', '1-30'], v: S('d30') }, { label: ['31-60', '31-60'], v: S('d60') }, { label: ['61-90', '61-90'], v: S('d90') }, { label: ['+90', '90+'], v: S('d90p') }] }],
        table: { cols: [C('customer', 'Cliente', 'Customer'), C('advisor', 'Asesor', 'Advisor'), C('current', 'Por vencer', 'Current', 'money'), C('d30', '1-30', '1-30', 'money'), C('d60', '31-60', '31-60', 'money'), C('d90', '61-90', '61-90', 'money'), C('d90p', '+90', '90+', 'money'), C('total', 'Total', 'Total', 'money')], rows } };
    } },
  { k: 'payment_proposal', g: 'compras', l: ['Propuesta de pagos a proveedores', 'Supplier payment proposal'], d: ['Facturas aprobadas que vencen en 7 días', 'Approved invoices due in 7 days'], roles: ['ADMIN', 'DIR', 'CXP', 'CONT'],
    async run() {
      const rows = await db.all(`SELECT s.name supplier, s.rfc, s.clabe, count(si.id)::int invoices, sum(si.total - coalesce(p.paid,0))::float amount, min(si.due) first_due FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id
        LEFT JOIN LATERAL (SELECT sum((l->>'amount')::numeric) paid FROM supplier_payments sp, jsonb_array_elements(sp.lines) l WHERE (l->>'invoice_id')::int=si.id) p ON true
        WHERE si.status='aprobada' AND si.due <= current_date + 7 GROUP BY s.id ORDER BY first_due`);
      return { kpis: [{ l: ['Total a pagar', 'Total to pay'], v: rows.reduce((s, r) => s + r.amount, 0), t: 'money' }, { l: ['Proveedores', 'Suppliers'], v: rows.length, t: 'num' }],
        table: { cols: [C('supplier', 'Proveedor', 'Supplier'), C('rfc', 'RFC', 'RFC'), C('clabe', 'Banco / CLABE', 'Bank / CLABE'), C('invoices', 'Facturas', 'Invoices', 'num'), C('first_due', 'Primer vencimiento', 'First due', 'date'), C('amount', 'Importe', 'Amount', 'money')], rows },
        note: ['Descargue el CSV como layout para el portal bancario; luego registre el pago en "Pagos a proveedores".', 'Download CSV as the bank layout; then record the payment in "Supplier payments".'] };
    } },
  { k: 'diot', g: 'finanzas', l: ['DIOT del periodo', 'DIOT for period'], d: ['IVA pagado a proveedores por RFC', 'VAT paid to suppliers by RFC'], roles: ['ADMIN', 'CONT', 'DIR'], filters: [PERIOD],
    async run(q) {
      const p = per(q);
      const rows = await db.all(`SELECT s.third_type tipo_tercero, '85' tipo_operacion, s.rfc, s.name, round(sum(sp.tax_base))::int base16, round(sum(sp.tax))::int iva16, round(sum(sp.retention))::int iva_ret FROM supplier_payments sp JOIN suppliers s ON s.id=sp.supplier_id WHERE sp.status='pagado' AND to_char(sp.date,'YYYY-MM')=$1 GROUP BY s.id ORDER BY s.rfc`, [p]);
      const bad = rows.filter(r => !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(r.rfc || ''));
      return { kpis: [{ l: ['Proveedores en DIOT', 'Suppliers in DIOT'], v: rows.length, t: 'num' }, { l: ['IVA acreditable pagado', 'Creditable VAT paid'], v: rows.reduce((s, r) => s + r.iva16, 0), t: 'money' }, { l: ['RFC con error', 'Invalid RFCs'], v: bad.length, t: 'num', tone: bad.length ? 'bad' : 'good' }],
        table: { cols: [C('tipo_tercero', 'Tipo tercero', 'Third type'), C('tipo_operacion', 'Tipo operación', 'Operation type'), C('rfc', 'RFC', 'RFC'), C('name', 'Proveedor', 'Supplier'), C('base16', 'Base 16%', 'Base 16%', 'money'), C('iva16', 'IVA 16%', 'VAT 16%', 'money'), C('iva_ret', 'IVA retenido', 'VAT withheld', 'money')], rows },
        note: ['Base de flujo de efectivo (pagos efectivamente realizados). Exporte a CSV y ajuste columnas al layout vigente del SAT.', 'Cash basis. Export CSV and adjust to the current SAT layout.'] };
    } },
  { k: 'e_accounting', g: 'finanzas', l: ['Contabilidad electrónica (XML)', 'Electronic accounting (XML)'], d: ['Catálogo y balanza para el SAT', 'Chart and trial balance for SAT'], roles: ['ADMIN', 'CONT'], filters: [PERIOD, { k: 'type', l: ['Archivo', 'File'], t: 'select', opts: [['balanza', 'Balanza de comprobación', 'Trial balance'], ['catalogo', 'Catálogo de cuentas', 'Chart of accounts']] }],
    async run(q) {
      const p = per(q); const [y, m] = p.split('-');
      const rfcs = await H().setting('company_rfcs', {}); const rfc = rfcs.MNA || 'XAXX010101000';
      const acc = await db.all('SELECT * FROM gl_accounts ORDER BY code');
      const missing = acc.filter(a => !a.sat_code);
      const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      let xml;
      if (q.type === 'catalogo') xml = `<?xml version="1.0" encoding="UTF-8"?>\n<catalogocuentas:Catalogo xmlns:catalogocuentas="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas" Version="1.3" RFC="${rfc}" Mes="${m}" Anio="${y}">\n` + acc.map(a => `  <catalogocuentas:Ctas CodAgrup="${esc(a.sat_code)}" NumCta="${esc(a.code)}" Desc="${esc(a.name)}" Nivel="${a.level || 2}" Natur="${a.nature || 'D'}"/>`).join('\n') + '\n</catalogocuentas:Catalogo>';
      else xml = `<?xml version="1.0" encoding="UTF-8"?>\n<BCE:Balanza xmlns:BCE="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion" Version="1.3" RFC="${rfc}" Mes="${m}" Anio="${y}" TipoEnvio="N">\n` + acc.map(a => `  <BCE:Ctas NumCta="${esc(a.code)}" SaldoIni="${n(a.opening).toFixed(2)}" Debe="${n(a.debits).toFixed(2)}" Haber="${n(a.credits).toFixed(2)}" SaldoFin="${n(a.closing).toFixed(2)}"/>`).join('\n') + '\n</BCE:Balanza>';
      const d = acc.reduce((s, a) => s + n(a.debits), 0), c = acc.reduce((s, a) => s + n(a.credits), 0);
      return { kpis: [{ l: ['Cuentas', 'Accounts'], v: acc.length, t: 'num' }, { l: ['Sin código agrupador', 'Missing SAT code'], v: missing.length, t: 'num', tone: missing.length ? 'bad' : 'good' }, { l: ['Cargos = Abonos', 'Debits = Credits'], v: Math.abs(d - c) < 0.01 ? 'Cuadra ✓' : 'Diferencia ' + r2(d - c), t: 'text', tone: Math.abs(d - c) < 0.01 ? 'good' : 'bad' }],
        xml, xmlName: `${rfc}${y}${m}${q.type === 'catalogo' ? 'CT' : 'BN'}.xml`, links: [{ l: ['Descargar XML', 'Download XML'], href: `/api/report/e_accounting?format=xml&period=${p}&type=${q.type || 'balanza'}` }],
        table: { cols: [C('code', 'Cuenta', 'Account'), C('name', 'Nombre', 'Name'), C('sat_code', 'Cód. agrupador', 'SAT code'), C('opening', 'Saldo inicial', 'Opening', 'money'), C('debits', 'Cargos', 'Debits', 'money'), C('credits', 'Abonos', 'Credits', 'money'), C('closing', 'Saldo final', 'Closing', 'money')], rows: acc } };
    } },
  { k: 'close_status', g: 'finanzas', l: ['Tablero de cierre mensual', 'Monthly close board'], d: ['Quién va atrasado por área', 'Who is late, by area'], roles: INTERNAL,
    async run() {
      const p = await db.one(`SELECT * FROM close_periods ORDER BY period DESC LIMIT 1`);
      if (!p) return { kpis: [], table: { cols: [], rows: [] } };
      const rows = await db.all(`SELECT t.area, t.task, coalesce(u.name,'—') owner, t.due, t.status, CASE WHEN t.status IN ('pendiente','rechazada') AND t.due < current_date THEN (current_date - t.due) ELSE 0 END::int late FROM close_tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.period_id=$1 ORDER BY t.due, t.area`, [p.id]);
      const hist = await db.all(`SELECT period, closed_day FROM close_periods WHERE closed_day IS NOT NULL ORDER BY period DESC LIMIT 6`);
      return { kpis: [{ l: ['Periodo', 'Period'], v: p.period, t: 'text' }, { l: ['Avance', 'Progress'], v: n(p.progress), t: 'pct' }, { l: ['Tareas atrasadas', 'Late tasks'], v: rows.filter(r => r.late > 0).length, t: 'num', tone: rows.some(r => r.late > 0) ? 'bad' : 'good' }, { l: ['Último cierre (día hábil)', 'Last close (business day)'], v: hist[0] ? 'D+' + hist[0].closed_day : '—', t: 'text' }],
        charts: hist.length ? [{ type: 'bar', l: ['Días para cerrar (meta D+5)', 'Days to close (target D+5)'], t: 'num', items: hist.reverse().map(h => ({ label: [h.period, h.period], v: h.closed_day })) }] : [],
        table: { cols: [C('area', 'Área', 'Area'), C('task', 'Tarea', 'Task'), C('owner', 'Responsable', 'Owner'), C('due', 'Límite', 'Due', 'date'), C('status', 'Estatus', 'Status', 'status:close_tasks'), C('late', 'Días de atraso', 'Days late', 'num')], rows }, links: [{ l: ['Abrir cierre ' + p.period, 'Open close ' + p.period], href: `#/e/close_periods/${p.id}` }] };
    } },
  { k: 'bank_summary', g: 'finanzas', l: ['Resumen de conciliación bancaria', 'Bank reconciliation summary'], d: ['Conciliado vs. pendiente por cuenta', 'Matched vs pending by account'], roles: ['ADMIN', 'CONT', 'CXP', 'DIR'],
    async run() {
      const rows = await db.all(`SELECT a.name, count(l.id)::int lines, count(*) FILTER (WHERE l.status='conciliado')::int matched, count(*) FILTER (WHERE l.status='sugerido')::int suggested, count(*) FILTER (WHERE l.status IN ('pendiente','excepcion'))::int open, coalesce(sum(l.amount),0)::float net FROM bank_accounts a LEFT JOIN bank_lines l ON l.bank_account_id=a.id GROUP BY a.id ORDER BY a.name`);
      rows.forEach(r => { r.pct = r.lines ? r2(r.matched / r.lines * 100) : 0; });
      return { kpis: [{ l: ['Movimientos conciliados', 'Matched lines'], v: rows.reduce((s, r) => s + r.matched, 0), t: 'num' }, { l: ['Pendientes / excepciones', 'Open / exceptions'], v: rows.reduce((s, r) => s + r.open, 0), t: 'num', tone: 'bad' }],
        table: { cols: [C('name', 'Cuenta', 'Account'), C('lines', 'Movimientos', 'Lines', 'num'), C('matched', 'Conciliados', 'Matched', 'num'), C('suggested', 'Sugeridos', 'Suggested', 'num'), C('open', 'Pendientes', 'Open', 'num'), C('pct', '% conciliado', '% matched', 'pct'), C('net', 'Neto', 'Net', 'money')], rows },
        links: [{ l: ['Ejecutar conciliación automática', 'Run automatic matching'], href: '#/bankmatch' }] };
    } },
  { k: 'depreciation', g: 'activos', l: ['Depreciación contable vs. fiscal', 'Book vs. tax depreciation'], d: ['Por clase de activo', 'By asset class'], roles: ['ADMIN', 'CONT', 'DIR', 'COST'],
    async run() {
      const rows = await db.all(`SELECT c.name cls, count(a.id)::int assets, sum(a.cost)::float cost, sum(a.book_accum)::float book, sum(a.fiscal_accum)::float fiscal, sum(a.cost - coalesce(a.book_accum,0))::float nbv FROM assets a JOIN asset_classes c ON c.id=a.class_id WHERE a.status='activo' GROUP BY c.name ORDER BY cost DESC`);
      rows.forEach(r => { r.diff = r2(n(r.fiscal) - n(r.book)); });
      const S = k => rows.reduce((s, r) => s + n(r[k]), 0);
      return { kpis: [{ l: ['Activos en uso', 'Assets in service'], v: S('assets'), t: 'num' }, { l: ['MOI total', 'Total cost'], v: S('cost'), t: 'money' }, { l: ['Valor en libros', 'Net book value'], v: S('nbv'), t: 'money' }, { l: ['Diferencia fiscal − contable', 'Tax − book difference'], v: S('diff'), t: 'money' }],
        table: { cols: [C('cls', 'Clase', 'Class'), C('assets', 'Activos', 'Assets', 'num'), C('cost', 'MOI', 'Cost', 'money'), C('book', 'Dep. contable acum.', 'Accum. book', 'money'), C('fiscal', 'Dep. fiscal acum.', 'Accum. tax', 'money'), C('diff', 'Diferencia (ISR diferido)', 'Difference (deferred tax)', 'money'), C('nbv', 'Valor en libros', 'NBV', 'money')], rows } };
    } },
  { k: 'depr_journal', g: 'activos', hidden: true, l: ['Póliza de depreciación', 'Depreciation journal'], roles: ['ADMIN', 'CONT'],
    async run(q) {
      const run = await db.one('SELECT * FROM depr_runs WHERE id=$1', [parseInt(q.run, 10) || 0]);
      const by = {};
      for (const l of (run && run.lines) || []) { const k1 = l.gl_exp || '6000', k2 = l.gl_dep || '1290'; by[k1] = by[k1] || { account: k1, debit: 0, credit: 0 }; by[k2] = by[k2] || { account: k2, debit: 0, credit: 0 }; by[k1].debit += l.book; by[k2].credit += l.book; }
      const rows = Object.values(by).map(r => ({ account: r.account, debit: r2(r.debit), credit: r2(r.credit), concept: 'Depreciación ' + (run ? run.period : '') }));
      return { table: { cols: [C('account', 'Cuenta', 'Account'), C('concept', 'Concepto', 'Concept'), C('debit', 'Cargo', 'Debit', 'money'), C('credit', 'Abono', 'Credit', 'money')], rows } };
    } },
  { k: 'profitability', g: 'costos', l: ['Rentabilidad', 'Profitability'], d: ['Por producto, cliente o canal (pecuario vs. PET)', 'By product, customer or channel'], roles: ['ADMIN', 'DIR', 'COST', 'CONT', 'GV'],
    filters: [{ k: 'dim', l: ['Ver por', 'View by'], t: 'select', opts: [['product', 'Producto', 'Product'], ['customer', 'Cliente', 'Customer'], ['channel', 'Canal', 'Channel'], ['family', 'Familia', 'Family']] }],
    async run(q) {
      const dim = { product: 'p.code||\' · \'||p.name', customer: 'c.name', channel: 'coalesce(c.channel,\'—\')', family: 'coalesce(f.name,\'—\')' }[q.dim] || 'coalesce(c.channel,\'—\')';
      const rows = await db.all(`SELECT ${dim} g, sum((l->>'total')::numeric)::float sales, sum((l->>'qty')::numeric * coalesce(p.std_cost,0))::float cost
        FROM invoices i JOIN customers c ON c.id=i.customer_id, jsonb_array_elements(i.lines) l JOIN products p ON p.id=(l->>'product_id')::int LEFT JOIN product_families f ON f.id=p.family_id
        WHERE i.status<>'cancelada' AND i.date >= current_date - interval '12 months' GROUP BY 1 ORDER BY 2 DESC`);
      const cnSql = { customer: `SELECT c.name g, sum(cn.amount)::float a FROM credit_notes cn JOIN customers c ON c.id=cn.customer_id WHERE cn.status IN ('aprobada','aplicada') AND cn.created_at > now()-interval '12 months' GROUP BY 1`, channel: `SELECT coalesce(c.channel,'—') g, sum(cn.amount)::float a FROM credit_notes cn JOIN customers c ON c.id=cn.customer_id WHERE cn.status IN ('aprobada','aplicada') AND cn.created_at > now()-interval '12 months' GROUP BY 1` }[q.dim || 'channel'];
      const cn = cnSql ? Object.fromEntries((await db.all(cnSql)).map(x => [x.g, x.a])) : {};
      const frSql = { customer: `SELECT c.name g, sum(o.freight_actual - o.freight)::float a FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='facturado' GROUP BY 1`, channel: `SELECT coalesce(c.channel,'—') g, sum(o.freight_actual - o.freight)::float a FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='facturado' GROUP BY 1` }[q.dim || 'channel'];
      const fr = frSql ? Object.fromEntries((await db.all(frSql)).map(x => [x.g, x.a])) : {};
      rows.forEach(r => { r.notes = r2(cn[r.g] || 0); r.freight = r2(Math.max(0, fr[r.g] || 0)); r.margin = r2(r.sales - r.cost - r.notes - r.freight); r.pct = r.sales ? r2(r.margin / r.sales * 100) : 0; });
      const S = k => rows.reduce((s, r) => s + n(r[k]), 0);
      return { kpis: [{ l: ['Venta 12 meses', 'Sales 12 months'], v: S('sales'), t: 'money' }, { l: ['Costo estándar', 'Standard cost'], v: S('cost'), t: 'money' }, { l: ['Margen después de notas y flete', 'Margin after notes & freight'], v: S('margin'), t: 'money', tone: 'good' }, { l: ['Margen %', 'Margin %'], v: S('sales') ? r2(S('margin') / S('sales') * 100) : 0, t: 'pct' }],
        charts: [{ type: 'hbar', l: ['Margen % por grupo', 'Margin % by group'], t: 'pct', items: rows.slice(0, 12).map(r => ({ label: [r.g, r.g], v: r.pct })) }],
        table: { cols: [C('g', 'Grupo', 'Group'), C('sales', 'Venta', 'Sales', 'money'), C('cost', 'Costo estándar', 'Std cost', 'money'), C('notes', 'Notas de crédito', 'Credit notes', 'money'), C('freight', 'Flete no recuperado', 'Unrecovered freight', 'money'), C('margin', 'Margen', 'Margin', 'money'), C('pct', 'Margen %', 'Margin %', 'pct')], rows },
        note: ['Costo estándar incluye material de la fórmula vigente, mano de obra, empaque e indirectos prorrateados por kg.', 'Standard cost includes formula material, labor, packaging and overhead allocated per kg.'] };
    } },
  { k: 'cost_statement', g: 'costos', l: ['Estado de costo de producción', 'Cost of production statement'], d: ['Material, mano de obra, indirectos y WIP', 'Material, labor, overhead and WIP'], roles: ['ADMIN', 'DIR', 'COST', 'CONT'], filters: [PERIOD],
    async run(q) {
      const p = per(q);
      const lr = n(await H().setting('labor_rate_hour', 180));
      const done = await db.one(`SELECT coalesce(sum(material_actual),0)::float mat, coalesce(sum(labor_hours),0)::float hrs, coalesce(sum(actual_total),0)::float act, coalesce(sum(std_total),0)::float std, coalesce(sum(kg),0)::float kg FROM production_orders WHERE status IN ('terminada','liquidada') AND to_char(coalesce(sched_date, created_at::date),'YYYY-MM')=$1`, [p]);
      const wip = await db.one(`SELECT coalesce(sum(std_total),0)::float v, count(*)::int c FROM production_orders WHERE status='en_proceso'`);
      const pools = await db.one(`SELECT coalesce(sum(amount),0)::float a FROM cost_pools WHERE period=$1`, [p]);
      const labor = r2(done.hrs * lr);
      const rows = [
        { c: 'Materia prima consumida', v: done.mat }, { c: 'Mano de obra directa', v: labor }, { c: 'Costos indirectos de fabricación', v: pools.a },
        { c: '= Costo de producción del periodo', v: r2(done.mat + labor + pools.a) }, { c: '+ Inventario inicial de producción en proceso', v: 0 }, { c: '− Inventario final de producción en proceso', v: -wip.v },
        { c: '= Costo de producción terminada', v: r2(done.mat + labor + pools.a - wip.v) }, { c: 'Costo estándar de lo producido', v: done.std }, { c: 'Variación total (real − estándar)', v: r2(done.act - done.std) },
      ];
      return { kpis: [{ l: ['Kg producidos', 'Kg produced'], v: done.kg, t: 'num' }, { l: ['WIP (órdenes en proceso)', 'WIP (orders in process)'], v: wip.v, t: 'money' }, { l: ['Variación vs. estándar', 'Variance vs standard'], v: r2(done.act - done.std), t: 'money', tone: done.act > done.std ? 'bad' : 'good' }],
        table: { cols: [C('c', 'Concepto', 'Concept'), C('v', 'Importe', 'Amount', 'money')], rows } };
    } },
  { k: 'variances', g: 'costos', l: ['Variaciones por orden', 'Variances by order'], d: ['Real vs. estándar en órdenes liquidadas', 'Actual vs standard on settled orders'], roles: ['ADMIN', 'DIR', 'COST', 'CONT'],
    async run() {
      const rows = await db.all(`SELECT po.folio, p.code||' · '||p.name product, po.qty_done::float qty, po.std_total::float std, po.actual_total::float actual, po.variance::float variance FROM production_orders po JOIN products p ON p.id=po.product_id WHERE po.status='liquidada' ORDER BY abs(po.variance) DESC NULLS LAST LIMIT 200`);
      rows.forEach(r => { r.pct = r.std ? r2(r.variance / r.std * 100) : 0; });
      return { kpis: [{ l: ['Órdenes liquidadas', 'Settled orders'], v: rows.length, t: 'num' }, { l: ['Variación neta', 'Net variance'], v: rows.reduce((s, r) => s + n(r.variance), 0), t: 'money' }],
        table: { cols: [C('folio', 'OF', 'Order'), C('product', 'Producto', 'Product'), C('qty', 'Cantidad', 'Qty', 'num'), C('std', 'Estándar', 'Standard', 'money'), C('actual', 'Real', 'Actual', 'money'), C('variance', 'Variación', 'Variance', 'money'), C('pct', '%', '%', 'pct')], rows } };
    } },
  { k: 'policy_acks', g: 'gobernanza', l: ['Acuse de políticas', 'Policy acknowledgments'], d: ['Quién falta por leer cada política vigente', 'Who still needs to read each policy'], roles: INTERNAL,
    async run() {
      const pols = await db.all(`SELECT id, name, version, audience, acks FROM policies WHERE status='vigente' ORDER BY name`);
      const rows = [];
      for (const p of pols) {
        const roles = String(p.audience || '').split(',').map(s => s.trim()).filter(Boolean);
        const miss = await db.all(`SELECT name FROM users u WHERE active AND role<>'PROV' AND (cardinality($1::text[])=0 OR role = ANY($1)) AND NOT EXISTS (SELECT 1 FROM policy_acks a WHERE a.policy_id=$2 AND a.version=$3 AND a.user_id=u.id) ORDER BY name`, [roles, p.id, p.version]);
        rows.push({ name: p.name, version: p.version, acks: n(p.acks), missing: miss.map(m => m.name).join(', ') || '—' });
      }
      return { kpis: [{ l: ['Políticas vigentes', 'Policies in force'], v: pols.length, t: 'num' }, { l: ['Acuse promedio', 'Average acknowledged'], v: pols.length ? r2(pols.reduce((s, p) => s + n(p.acks), 0) / pols.length) : 0, t: 'pct' }],
        table: { cols: [C('name', 'Política', 'Policy'), C('version', 'Versión', 'Version', 'num'), C('acks', '% acuse', '% ack', 'pct'), C('missing', 'Pendientes de acusar', 'Still to acknowledge')], rows } };
    } },
  { k: 'sod_log', g: 'gobernanza', l: ['Bitácora de autorizaciones', 'Approval log'], d: ['Quién autorizó qué (auditoría)', 'Who approved what (audit)'], roles: ['ADMIN', 'DIR', 'CONT'],
    async run() {
      const rows = await db.all(`SELECT a.ts, a.user_name, a.role, a.entity, a.record_id, a.detail->>'from' "from", a.detail->>'to' "to", a.detail->>'comment' comment FROM audit_log a WHERE a.action='status' ORDER BY a.id DESC LIMIT 300`);
      return { table: { cols: [C('ts', 'Fecha', 'Date', 'datetime'), C('user_name', 'Usuario', 'User'), C('role', 'Rol', 'Role'), C('entity', 'Módulo', 'Module'), C('record_id', 'Registro', 'Record', 'num'), C('from', 'De', 'From'), C('to', 'A', 'To'), C('comment', 'Comentario', 'Comment')], rows } };
    } },
];

// ── Automatic bank matching (C-3) ──
async function bankMatch(user, accountId) {
  const H_ = H();
  return db.tx(async c => {
    const lines = (await c.query(`SELECT * FROM bank_lines WHERE status='pendiente' AND ($1::int IS NULL OR bank_account_id=$1) ORDER BY date`, [accountId || null])).rows;
    const used = new Set((await c.query(`SELECT match_type FROM bank_lines WHERE status IN ('sugerido','conciliado') AND match_type IS NOT NULL`)).rows.map(r => r.match_type));
    const rec = (await c.query(`SELECT id, date, amount::float a, reference, bank_account_id FROM receipts`)).rows;
    const pay = (await c.query(`SELECT id, date, amount::float a, reference, bank_account_id FROM supplier_payments WHERE status='pagado'`)).rows;
    let m = 0;
    for (const l of lines) {
      const amt = n(l.amount);
      const B = L().B;
      const pool = (amt >= 0 ? rec.map(x => Object.assign({ key: B('Cobro #' + x.id, 'Receipt #' + x.id) }, x)) : pay.map(x => Object.assign({ key: B('Pago proveedor #' + x.id, 'Supplier payment #' + x.id) }, x))).filter(x => !x.bank_account_id || x.bank_account_id === l.bank_account_id);
      const target = Math.abs(amt);
      const free = pool.filter(x => !used.has(x.key));
      const near = x => Math.abs((new Date(x.date) - new Date(l.date)) / 864e5) <= 3;
      let hit = free.find(x => Math.abs(x.a - target) < 0.01 && x.reference && l.reference && String(l.reference).includes(String(x.reference))), rule = B('Importe + referencia', 'Amount + reference');
      if (!hit) { hit = free.find(x => Math.abs(x.a - target) < 0.01 && near(x)); rule = B('Importe exacto ±3 días', 'Exact amount ±3 days'); }
      if (hit) { used.add(hit.key); m++; await c.query(`UPDATE bank_lines SET status='sugerido', match_type=$1, match_rule=$2, updated_at=now() WHERE id=$3`, [hit.key, rule, l.id]); }
    }
    await c.query('INSERT INTO audit_log(user_id,user_name,role,entity,action,detail) VALUES($1,$2,$3,$4,$5,$6)', [user.id, user.name, user.role, 'bank_lines', 'automatch', JSON.stringify({ lines: lines.length, matched: m })]);
    return { checked: lines.length, matched: m, date: H_.today() };
  });
}

// ── Dashboard ──
async function dashboard(u) {
  const cnM = await db.one(`SELECT count(*)::int c, coalesce(sum(amount),0)::float a FROM credit_notes WHERE status<>'rechazada' AND created_at >= date_trunc('month', now())`);
  const cnP = await db.one(`SELECT count(*)::int c FROM credit_notes WHERE status<>'rechazada' AND created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())`);
  const close = await db.one(`SELECT period, closed_day FROM close_periods WHERE closed_day IS NOT NULL ORDER BY period DESC LIMIT 1`);
  const open = await db.one(`SELECT period, progress, late FROM close_periods WHERE status='abierto' ORDER BY period DESC LIMIT 1`);
  const dfr = await db.one(`SELECT coalesce(sum(cost),0)::float a, count(*)::int c FROM double_freight WHERE date >= date_trunc('month', current_date)`);
  const sales = await db.one(`SELECT coalesce(sum(total),0)::float a, count(*)::int c FROM invoices WHERE status<>'cancelada' AND date >= date_trunc('month', current_date)`);
  const toInv = await db.one(`SELECT count(*)::int c, coalesce(sum(total),0)::float a FROM orders WHERE status='entregado'`);
  const od = await db.one(`SELECT coalesce(sum(balance),0)::float a, count(*)::int c FROM invoices WHERE status='abierta' AND due < current_date`);
  const ap = await db.one(`SELECT coalesce(sum(total),0)::float a, count(*)::int c FROM supplier_invoices WHERE status IN ('aprobada','validada') AND due <= current_date + 7`);
  const s6 = await db.all(`SELECT to_char(date,'YYYY-MM') m, sum(total)::float a FROM invoices WHERE status<>'cancelada' AND date >= date_trunc('month', current_date) - interval '5 months' GROUP BY 1 ORDER BY 1`);
  const cn6 = await db.all(`SELECT to_char(created_at,'YYYY-MM') m, count(*)::int c, sum(amount)::float a FROM credit_notes WHERE status<>'rechazada' AND created_at > date_trunc('month', now()) - interval '5 months' GROUP BY 1 ORDER BY 1`);
  const ord = await db.all(`SELECT status, count(*)::int c FROM orders WHERE status NOT IN ('facturado','cancelado') GROUP BY 1`);
  const f$ = H().fmt$;
  return {
    kpis: [
      { k: 'sales', l: ['Venta facturada del mes', 'Invoiced sales this month'], v: sales.a, sub: [`${sales.c} factura(s)`, `${sales.c} invoice(s)`], t: 'money', href: '#/r/sales' },
      { k: 'toinv', l: ['Entregado por facturar', 'Delivered, to invoice'], v: toInv.a, sub: [`${toInv.c} pedido(s)`, `${toInv.c} order(s)`], t: 'money', href: '#/r/billing_queue' },
      { k: 'od', l: ['Cartera vencida', 'Past-due A/R'], v: od.a, sub: [`${od.c} factura(s)`, `${od.c} invoice(s)`], t: 'money', tone: od.a > 0 ? 'bad' : 'good', href: '#/r/ar_aging' },
      { k: 'ap', l: ['Pagos a proveedores (7 días)', 'Supplier payments (7 days)'], v: ap.a, sub: [`${ap.c} factura(s)`, `${ap.c} invoice(s)`], t: 'money', href: '#/r/payment_proposal' },
      { k: 'cn', l: ['Notas de crédito del mes', 'Credit notes this month'], v: cnM.c, sub: [`${f$(cnM.a)} · mes anterior ${cnP.c}`, `${f$(cnM.a)} · prior month ${cnP.c}`], t: 'num', tone: cnM.c > cnP.c ? 'bad' : 'good', href: '#/r/credit_notes' },
      { k: 'dfr', l: ['Dobles fletes del mes', 'Double freight this month'], v: dfr.a, sub: [`${dfr.c} evento(s)`, `${dfr.c} event(s)`], t: 'money', tone: dfr.a > 0 ? 'bad' : 'good', href: '#/r/freight' },
      { k: 'close', l: ['Último cierre contable', 'Last accounting close'], v: close ? close.closed_day : null, sub: close ? [`Periodo ${close.period} · meta D+5`, `Period ${close.period} · target D+5`] : null, t: 'day', tone: close && close.closed_day <= 5 ? 'good' : 'bad', href: '#/r/close_status' },
      { k: 'open', l: ['Cierre en curso', 'Close in progress'], v: open ? open.progress : null, sub: open ? [`${open.period} · ${open.late} tarea(s) atrasada(s)`, `${open.period} · ${open.late} late task(s)`] : null, t: 'pct', href: '#/r/close_status' },
    ],
    s6: s6.map(r => ({ label: [r.m, r.m], v: r.a })),
    cn6: cn6.map(r => ({ label: [r.m, r.m], v: r.c, a: r.a })),
    pipeline: ord,
  };
}

// ── Inbox: what each person must act on now ──
const INBOX = [
  { ent: 'orders', status: ['por_aprobar'], roles: ['GV', 'DIR'], l: ['Precios especiales por autorizar', 'Special prices to approve'], extra: (u) => (u.role === 'GV' ? "approval_level='GV'" : null) },
  { ent: 'orders', status: ['retenido'], roles: ['COB', 'DIR'], l: ['Pedidos retenidos por crédito', 'Orders on credit hold'] },
  { ent: 'orders', status: ['entregado'], roles: ['FACT'], l: ['Pedidos entregados por facturar', 'Delivered orders to invoice'] },
  { ent: 'orders', status: ['confirmado', 'en_produccion'], roles: ['ALM', 'LOG'], l: ['Pedidos por surtir', 'Orders to fulfill'] },
  { ent: 'orders', status: ['listo'], roles: ['LOG'], l: ['Pedidos listos para programar en carga', 'Orders ready to schedule'] },
  { ent: 'orders', status: ['borrador', 'cotizacion'], roles: ['VTA', 'ATC'], l: ['Mis borradores y cotizaciones', 'My drafts and quotes'], mine: true },
  { ent: 'credit_notes', status: ['solicitada'], roles: ['GV', 'DIR'], l: ['Notas de crédito por autorizar', 'Credit notes to approve'], extra: (u) => (u.role === 'GV' ? "approver_level='GV'" : null) },
  { ent: 'credit_notes', status: ['aprobada'], roles: ['FACT', 'CONT'], l: ['Notas aprobadas por timbrar', 'Approved notes to stamp'] },
  { ent: 'credit_requests', status: ['revision_direccion'], roles: ['DIR'], l: ['Solicitudes de crédito por decidir', 'Credit applications to decide'] },
  { ent: 'credit_requests', status: ['borrador'], roles: ['COB'], l: ['Solicitudes de crédito por evaluar', 'Credit applications to evaluate'] },
  { ent: 'receipts', status: ['por_aplicar'], roles: ['COB', 'CONT'], l: ['Cobros por aplicar', 'Receipts to apply'] },
  { ent: 'production_orders', status: ['solicitada'], roles: ['PROD'], l: ['Órdenes de fabricación por programar', 'Production orders to schedule'] },
  { ent: 'production_orders', status: ['terminada'], roles: ['COST'], l: ['Órdenes por liquidar', 'Orders to settle'] },
  { ent: 'loads', status: ['planeada', 'en_ruta'], roles: ['LOG'], l: ['Cargas abiertas', 'Open loads'] },
  { ent: 'deliveries', status: ['pendiente'], roles: ['CHOF', 'LOG'], l: ['Entregas por confirmar', 'Deliveries to confirm'], own: 'driver_id' },
  { ent: 'requisitions', status: ['solicitada'], roles: ['COMP', 'DIR'], l: ['Solicitudes de compra por autorizar', 'Requisitions to approve'], extra: (u) => (u.role === 'COMP' ? "approver_level='COMP'" : null) },
  { ent: 'requisitions', status: ['aprobada'], roles: ['COMP'], l: ['Solicitudes aprobadas por convertir en OC', 'Approved requisitions to convert'] },
  { ent: 'purchase_orders', status: ['emitida', 'parcial'], roles: ['ALM'], l: ['Órdenes de compra por recibir', 'POs to receive'] },
  { ent: 'supplier_invoices', status: ['recibida'], roles: ['CXP'], l: ['Facturas de proveedor por validar', 'Supplier invoices to validate'] },
  { ent: 'supplier_invoices', status: ['excepcion'], roles: ['COMP', 'CXP'], l: ['Facturas con excepción', 'Invoices with exceptions'] },
  { ent: 'supplier_invoices', status: ['validada'], roles: ['CXP'], l: ['Facturas por aprobar para pago', 'Invoices to approve for payment'] },
  { ent: 'supplier_payments', status: ['programado'], roles: ['CXP'], l: ['Pagos programados por confirmar', 'Scheduled payments to confirm'] },
  { ent: 'supplier_invoices', status: ['excepcion', 'recibida'], roles: ['PROV'], l: ['Mis facturas en revisión', 'My invoices under review'] },
  { ent: 'close_tasks', status: ['pendiente', 'rechazada'], roles: INTERNAL, l: ['Mis tareas de cierre', 'My close tasks'], own: 'owner_id' },
  { ent: 'close_tasks', status: ['entregada'], roles: ['CONT'], l: ['Tareas de cierre por validar', 'Close tasks to validate'] },
  { ent: 'account_recons', status: ['pendiente', 'rechazada'], roles: ['CONT'], l: ['Conciliaciones por preparar', 'Reconciliations to prepare'] },
  { ent: 'account_recons', status: ['preparada'], roles: ['CONT', 'DIR'], l: ['Conciliaciones por revisar y firmar', 'Reconciliations to review'] },
  { ent: 'asset_events', status: ['solicitado'], roles: ['CONT', 'DIR'], l: ['Movimientos de activo por aprobar', 'Asset events to approve'] },
  { ent: 'bank_lines', status: ['sugerido'], roles: ['CONT', 'CXP'], l: ['Conciliaciones bancarias sugeridas', 'Suggested bank matches'] },
  { ent: 'corrective_actions', status: ['abierta', 'en_proceso'], roles: INTERNAL, l: ['Mis acciones correctivas', 'My corrective actions'], own: 'owner_id' },
];
async function inbox(u) {
  const out = [];
  const { E } = require('./meta');
  for (const b of INBOX) {
    if (!(b.roles.includes(u.role) || (u.role === 'ADMIN' && !b.own && !b.mine))) continue;
    const where = [];
    const params = [];
    if (b.status) { params.push(b.status); where.push(`status = ANY($${params.length})`); }
    if (b.own) { params.push(u.id); where.push(`${b.own} = $${params.length}`); }
    if (b.mine) { params.push(u.id); where.push(`created_by = $${params.length}`); }
    if (u.role === 'PROV' && E[b.ent].fields.some(f => f.k === 'supplier_id')) where.push('supplier_id = ' + (parseInt(u.supplier_id, 10) || -1));
    const ex = b.extra && b.extra(u); if (ex) where.push(ex);
    const r = await db.one(`SELECT count(*)::int c FROM ${b.ent} WHERE ${where.join(' AND ') || 'true'}`, params);
    if (r.c) out.push({ l: b.l, n: r.c, ent: b.ent, href: `#/e/${b.ent}?status=${(b.status || []).join(',')}${b.own ? '&f_' + b.own + '=' + u.id : ''}` });
  }
  // policies pending my acknowledgment
  const pol = await db.all(`SELECT p.id, p.name FROM policies p WHERE p.status='vigente' AND (coalesce(p.audience,'')='' OR $1 = ANY(string_to_array(replace(p.audience,' ',''),','))) AND NOT EXISTS (SELECT 1 FROM policy_acks a WHERE a.policy_id=p.id AND a.version=p.version AND a.user_id=$2)`, [u.role, u.id]);
  if (pol.length && u.role !== 'PROV') out.push({ l: ['Políticas pendientes de acusar', 'Policies to acknowledge'], n: pol.length, ent: 'policies', href: '#/e/policies?status=vigente' });
  const notes = await db.all('SELECT n.id, n.ts, n.title, n.body, n.link, (n.read OR EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)) AS read FROM notifications n WHERE n.user_id=$1 OR n.role=$2 ORDER BY n.id DESC LIMIT 40', [u.id, u.role]);
  return { items: out, notes };
}

module.exports = { REPORTS: REPORTS.filter(r => r), dashboard, inbox, bankMatch };
