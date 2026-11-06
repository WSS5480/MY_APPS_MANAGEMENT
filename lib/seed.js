'use strict';
const crypto = require('crypto');
const db = require('./db');
const { E } = require('./meta');
const B = (es, en) => (en ? es + ' ‖ ' + en : es);

// deterministic pseudo-random so the demo is stable
let S = 20260921;
const rnd = () => { S = (S * 1103515245 + 12345) % 2147483648; return S / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
const r2 = n => Math.round(n * 100) / 100;
const TZ = 'America/Mexico_City';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ts = (d, h = 10) => new Date(d + `T${String(h).padStart(2, '0')}:00:00-06:00`).toISOString();
const FOL = { orders: 'PV', contracts: 'CT', credit_notes: 'NC', production_orders: 'OF', loads: 'CG', invoices: 'FA', requisitions: 'SC', purchase_orders: 'OC', goods_receipts: 'EM' };

async function ins(c, table, o) {
  const d = Object.assign({}, o);
  if (d.lines) d.lines = JSON.stringify(d.lines);
  const k = Object.keys(d);
  const r = (await c.query(`INSERT INTO ${table}(${k.join(',')}) VALUES(${k.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, k.map(x => d[x]))).rows[0];
  if (FOL[table] && !r.folio) { r.folio = FOL[table] + '-' + String(r.id).padStart(5, '0'); await c.query(`UPDATE ${table} SET folio=$1 WHERE id=$2`, [r.folio, r.id]); }
  return r;
}

async function seedAll(hashPin) {
  S = 20260921;
  const T = today(); const P = T.slice(0, 7);
  await db.tx(async c => {
    const set = (k, v) => c.query('INSERT INTO settings(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v=$2', [k, JSON.stringify(v)]);
    await set('company_rfcs', { MNA: 'MME0103157K2', CAG: 'CAG1209187B4', PET: 'PMM1505206H1' });
    for (const [k, v] of Object.entries({ cn_gv_limit: 20000, req_dir_limit: 50000, cap_threshold: 15000, recon_threshold: 5000, credit_band_low: 40, credit_band_high: 60, credit_auto_max: 300000, labor_rate_hour: 180, minutes_saved_per_doc: 12 })) await set(k, v);

    // ── users ──
    const U = {}; const pins = {};
    const users = [
      ['admin', 'Steve Smith', 'ADMIN', 'Administrador del sistema', '5480'], ['dir', 'Dr. Kawas', 'DIR', 'Director General', '1001'],
      ['gv', 'Laura Treviño', 'GV', 'Gerente Comercial', '1002'], ['vta1', 'Carlos Méndez', 'VTA', 'Asesor — Zona Norte', '1003'], ['vta2', 'Ana Garza', 'VTA', 'Asesora — Zona Bajío/Occidente', '1013'],
      ['atc', 'Sofía Ramírez', 'ATC', 'Atención a Clientes', '1004'], ['fact', 'Guadalupe "Meme" Torres', 'FACT', 'Facturación', '1005'], ['cob', 'Patricia Leal', 'COB', 'Crédito y Cobranza', '1006'],
      ['cont1', 'Jordan', 'CONT', 'Contralor', '1007'], ['cont2', 'Ángel', 'CONT', 'Contador General', '1017'], ['cost', 'Ricardo Salinas', 'COST', 'Analista de Costos', '1008'],
      ['cxp', 'Mónica Ríos', 'CXP', 'Cuentas por Pagar y Tesorería', '1009'], ['comp', 'Javier Ortiz', 'COMP', 'Jefe de Compras y Abastecimiento (dueño WMS)', '1010'], ['alm', 'Luis Herrera', 'ALM', 'Coordinador de Bodegas', '1011'],
      ['prod', 'Ing. Raúl Cantú', 'PROD', 'Gerente de Planta', '1012'], ['log', 'Daniel Flores', 'LOG', 'Jefe de Logística', '1014'], ['chof', 'José Martínez', 'CHOF', 'Chofer', '1015'], ['ti', 'Belarmino', 'ADMIN', 'Sistemas (TI)', '1016'],
    ];
    for (const [key, name, role, position, pin] of users) { U[key] = await ins(c, 'users', { name, role, position, pin_hash: hashPin(pin), active: true }); if (role !== 'ADMIN' || key === 'ti') pins[U[key].id] = pin; }
    delete pins[U.ti.id];

    // ── master data ──
    const fam = {};
    for (const [k, n, ch] of [['PEC', 'Pecuario', 'pecuario'], ['PET', 'PET / Mascotas', 'pet'], ['ESP', 'Especiales', 'pecuario'], ['CA', 'Centroamérica', 'ca']]) fam[k] = await ins(c, 'product_families', { name: n, channel: ch });
    for (const [k, n, p, ch] of [['POR', 'Porcinos', 'PEC', 'pecuario'], ['BOV', 'Bovinos', 'PEC', 'pecuario'], ['AVE', 'Aves', 'PEC', 'pecuario'], ['ACU', 'Acuícola', 'PEC', 'pecuario'], ['EQU', 'Equinos', 'PEC', 'pecuario'], ['PER', 'Perro', 'PET', 'pet'], ['GAT', 'Gato', 'PET', 'pet']]) fam[k] = await ins(c, 'product_families', { name: n, parent_id: fam[p].id, channel: ch });
    const prods = [];
    const P_ = [
      ['POR-INI-40', 'Iniciador lechón 40 kg', 'POR', 'pecuario', 'linea', 'mts', 40, 720], ['POR-DES-40', 'Desarrollo cerdo 40 kg', 'POR', 'pecuario', 'linea', 'mts', 40, 560], ['POR-ENG-40', 'Engorda cerdo 40 kg', 'POR', 'pecuario', 'linea', 'mts', 40, 520], ['POR-GES-40', 'Gestación cerda 40 kg', 'POR', 'pecuario', 'linea', 'mts', 40, 540],
      ['BOV-ENG-40', 'Engorda bovino 40 kg', 'BOV', 'pecuario', 'linea', 'mts', 40, 430], ['BOV-LEC-40', 'Lechero alta producción 40 kg', 'BOV', 'pecuario', 'linea', 'mts', 40, 470], ['BOV-BEC-25', 'Becerro arranque 25 kg', 'BOV', 'pecuario', 'linea', 'mts', 25, 390], ['BOV-MIN-25', 'Mineral bovino 25 kg', 'BOV', 'pecuario', 'linea', 'mts', 25, 610],
      ['AVE-POS-40', 'Gallina postura 40 kg', 'AVE', 'pecuario', 'linea', 'mts', 40, 495], ['AVE-ENG-40', 'Pollo engorda 40 kg', 'AVE', 'pecuario', 'linea', 'mts', 40, 505], ['ACU-TIL-25', 'Tilapia engorda 25 kg', 'ACU', 'pecuario', 'linea', 'mts', 25, 640], ['ACU-CAM-25', 'Camarón 35% 25 kg', 'ACU', 'pecuario', 'linea', 'mto', 25, 890],
      ['EQU-MAN-25', 'Equino mantenimiento 25 kg', 'EQU', 'pecuario', 'linea', 'mts', 25, 455], ['ESP-PRE-40', 'Premezcla especial cliente 40 kg', 'ESP', 'pecuario', 'especial', 'mto', 40, 980], ['ESP-MED-25', 'Medicado preventivo 25 kg', 'ESP', 'pecuario', 'especial', 'mto', 25, 1150],
      ['PER-ADU-20', 'Croqueta perro adulto 20 kg', 'PER', 'pet', 'linea', 'mts', 20, 780], ['PER-CAC-20', 'Croqueta cachorro 20 kg', 'PER', 'pet', 'linea', 'mts', 20, 860], ['PER-PRE-15', 'Croqueta premium razas grandes 15 kg', 'PER', 'pet', 'linea', 'mts', 15, 990], ['PER-ECO-25', 'Croqueta económica 25 kg', 'PER', 'pet', 'linea', 'mts', 25, 560],
      ['GAT-ADU-10', 'Croqueta gato adulto 10 kg', 'GAT', 'pet', 'linea', 'mts', 10, 640], ['GAT-GAT-03', 'Croqueta gatito 3 kg', 'GAT', 'pet', 'linea', 'mts', 3, 245],
      ['CA-POR-40', 'Engorda cerdo exportación CA 40 kg', 'CA', 'ca', 'ca', 'mto', 40, 590], ['CA-PER-20', 'Croqueta perro exportación CA 20 kg', 'CA', 'ca', 'ca', 'mto', 20, 820],
    ];
    for (const [code, name, f, ch, lt, mode, kg, price] of P_) prods.push(await ins(c, 'products', { code, name, family_id: fam[f].id, channel: ch, line_type: lt, mode, uom: `Saco ${kg} kg`, kg_unit: kg, barcode: '750' + String(1000000000 + prods.length * 7919).slice(0, 10), list_price: price, std_cost: r2(price * (0.62 + rnd() * 0.12)), discontinue: false }));

    const whs = [];
    for (const [code, name, state, co] of [['MTY', 'Planta Monterrey', 'Nuevo León', 'MNA'], ['SAL', 'Bodega Saltillo', 'Coahuila', 'MNA'], ['TRC', 'Bodega Torreón', 'Coahuila', 'MNA'], ['CHI', 'Bodega Chihuahua', 'Chihuahua', 'MNA'], ['CUL', 'Bodega Culiacán', 'Sinaloa', 'MNA'], ['GDL', 'Bodega Guadalajara', 'Jalisco', 'CAG'], ['LEO', 'Bodega León', 'Guanajuato', 'CAG'], ['QRO', 'Bodega Querétaro', 'Querétaro', 'CAG'], ['MER', 'Bodega Mérida', 'Yucatán', 'MNA'], ['VHS', 'Bodega Villahermosa', 'Tabasco', 'MNA'], ['VER', 'Bodega Veracruz', 'Veracruz', 'MNA'], ['TAP', 'Bodega Tapachula (CA)', 'Chiapas', 'MNA']])
      whs.push(await ins(c, 'warehouses', { code, name, state, company: co, coordinator_id: code === 'MTY' ? U.alm.id : (rnd() > 0.5 ? U.alm.id : null), lag_target: 24 }));

    const routes = {};
    for (const [k, km, rate, days] of [['Norte — Monterrey/Saltillo', 220, 0.45, 1], ['Laguna — Torreón', 680, 0.85, 1], ['Chihuahua', 1580, 1.35, 2], ['Pacífico — Culiacán', 2100, 1.6, 2], ['Occidente — Guadalajara', 1560, 1.25, 2], ['Bajío — León/Querétaro', 1350, 1.1, 2], ['Golfo — Veracruz/Villahermosa', 1900, 1.45, 2], ['Sureste — Mérida', 2700, 1.9, 3], ['Centroamérica — Tapachula', 3100, 2.2, 3]]) routes[k] = await ins(c, 'routes', { name: k, km, rate_kg: rate, ship_days: days });
    const R = Object.values(routes);
    await ins(c, 'trucks', { name: 'Tractocamión MNA-01 (RT-4512)', type: 'propia', cap_kg: 30000, cost_km: 18.5, driver_id: U.chof.id });
    await ins(c, 'trucks', { name: 'Torton MNA-02 (RT-7781)', type: 'propia', cap_kg: 14000, cost_km: 13.2, driver_id: U.chof.id });
    await ins(c, 'trucks', { name: 'Rabón MNA-03 (RT-2210)', type: 'propia', cap_kg: 8000, cost_km: 10.4, driver_id: U.chof.id });
    await ins(c, 'trucks', { name: 'Transportes del Bajío — Full', type: 'externa', carrier: 'Transportes del Bajío', cap_kg: 45000 });
    await ins(c, 'trucks', { name: 'Fletes Sureste — Caja seca', type: 'externa', carrier: 'Fletes del Sureste', cap_kg: 28000 });

    for (const [seg, vol, months, dpd, dv, dg, days, line] of [['AAA', 3000000, 24, 15, 3, 8, 45, 1500000], ['AA', 1200000, 12, 30, 3, 7, 30, 700000], ['A', 300000, 6, 45, 2, 5, 30, 250000], ['B', 0, 0, 9999, 0, 3, 15, 80000]]) await ins(c, 'segment_rules', { segment: seg, min_volume: vol, min_months: months, max_dpd: dpd, max_disc_vta: dv, max_disc_gv: dg, credit_days: days, max_line: line });
    for (const [f, w, d] of [['years', 15, '5 años o más = 1; proporcional por debajo'], ['history', 30, 'Sin atraso = 1; <15 días = 0.7; <45 días = 0.4; mayor = 0.1; cliente nuevo = 0.5'], ['volume', 15, 'Compra mensual × 2 ÷ línea solicitada (máx. 1)'], ['guarantee', 20, 'Pagaré o garantía ÷ línea solicitada (máx. 1)'], ['references', 10, 'Referencias positivas ÷ 3'], ['bureau', 10, 'Bueno 1 · Regular 0.6 · Sin historial 0.4 · Malo 0']]) await ins(c, 'credit_policies', { factor: f, weight: w, description: d });

    // customers
    const CU = [];
    const names = ['Granjas El Porvenir', 'Agropecuaria Los Altos', 'Rancho San Isidro', 'Porcícola del Norte', 'Avícola La Laguna', 'Lácteos de Delicias', 'Ganadera Santa Rosa', 'Acuícola del Pacífico', 'Distribuidora Agro Bajío', 'Forrajes y Granos de Jalisco', 'Agroservicios Querétaro', 'Pet Center Monterrey', 'Mascotas Felices Distribución', 'Veterinaria El Establo', 'Comercializadora Agro Golfo', 'Granja Avícola Yucatán', 'Unión Ganadera Tabasco', 'Distribuidora Pecuaria Chihuahua', 'Agroinsumos Culiacán', 'Rancho Las Palmas', 'Engordas del Valle', 'Pet Shop Premium GDL', 'Tiendas Agro León', 'Cooperativa Porcícola Saltillo', 'Agrocomercial Guatemala SA', 'Distribuidora Pecuaria Honduras', 'Rancho El Mezquite', 'Huevo Fresco del Sureste', 'Camaronera Mar de Cortés', 'Forrajera Torreón'];
    const zoneOf = i => [['Norte', R[0], whs[0], U.vta1], ['Norte', R[1], whs[2], U.vta1], ['Norte', R[2], whs[3], U.vta1], ['Pacífico', R[3], whs[4], U.vta2], ['Occidente', R[4], whs[5], U.vta2], ['Bajío', R[5], whs[6], U.vta2], ['Golfo', R[6], whs[10], U.vta1], ['Sureste', R[7], whs[8], U.vta2], ['Centroamérica', R[8], whs[11], U.vta2]][i % 9];
    for (let i = 0; i < names.length; i++) {
      const [zone, rt, wh, adv] = zoneOf(i);
      const pet = /Pet|Mascotas/.test(names[i]); const ca = /Guatemala|Honduras/.test(names[i]);
      const months = between(3, 120);
      CU.push(await ins(c, 'customers', { code: 'C' + String(10001 + i), name: names[i], rfc: ca ? 'XEXX010101000' : (names[i].replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase() + String(between(800101, 991231)) + 'AB' + between(1, 9)), channel: ca ? 'ca' : pet ? 'pet' : 'pecuario', zone: ca ? 'Centroamérica' : zone, route_id: rt.id, advisor_id: adv.id, warehouse_id: wh.id, credit_limit: pick([150000, 250000, 400000, 600000, 900000, 1500000]), credit_days: pick([15, 30, 30, 45]), months_active: months, email: 'compras@' + names[i].toLowerCase().replace(/[^a-z]/g, '').slice(0, 14) + '.com.mx', phone: '81' + between(10000000, 99999999), address: `${zone}, México`, status: 'activo', balance: 0 }));
    }

    // stock
    for (const w of whs) for (const p of prods) {
      if (p.mode === 'mto' || (w.code !== 'MTY' && rnd() < 0.35)) continue;
      const lot = 'L' + addDays(T, -between(5, 60)).replace(/-/g, '').slice(2) + '-' + between(100, 999);
      await ins(c, 'stock', { warehouse_id: w.id, product_id: p.id, qty: w.code === 'MTY' ? between(200, 1500) : between(0, 260), lot, expires: addDays(T, between(20, 200)) });
    }
    // production lines
    const PL = [await ins(c, 'production_lines', { name: 'Extrusión 1 (PET)', plant: 'Monterrey', kg_day: 60000, lead_days: 4 }), await ins(c, 'production_lines', { name: 'Peletizado 1 (pecuario)', plant: 'Monterrey', kg_day: 120000, lead_days: 4 }), await ins(c, 'production_lines', { name: 'Peletizado 2 (pecuario)', plant: 'Monterrey', kg_day: 90000, lead_days: 5 }), await ins(c, 'production_lines', { name: 'Premezclas y medicados', plant: 'Monterrey', kg_day: 25000, lead_days: 3 })];

    // promotions
    const promo1 = await ins(c, 'promotions', { name: 'PET Bimestral 1+1 gatito', type: 'nxm', buy: 10, get: 1, channel: 'pet', product_id: prods.find(p => p.code === 'GAT-GAT-03').id, starts: addDays(T, -20), ends: addDays(T, 40), status: 'activa', cost: 0 });
    await ins(c, 'promotions', { name: 'PET 10% croqueta adulto', type: 'pct', pct: 10, channel: 'pet', product_id: prods.find(p => p.code === 'PER-ADU-20').id, starts: addDays(T, -10), ends: addDays(T, 50), status: 'activa', cost: 0 });
    await ins(c, 'promotions', { name: 'Pecuario volumen bovino (próxima)', type: 'pct', pct: 4, channel: 'pecuario', family_id: fam.BOV.id, starts: addDays(T, 30), ends: addDays(T, 90), status: 'borrador', cost: 0 });

    // contract
    const ctr = await ins(c, 'contracts', { customer_id: CU[0].id, valid_from: addDays(T, -60), valid_to: addDays(T, 120), status: 'vigente', lines: [{ product_id: prods[2].id, qty: 3000, price: 495, released: 0 }, { product_id: prods[3].id, qty: 1200, price: 515, released: 0 }], pct_used: 0 });

    // ── orders, invoices history (6 months) ──
    const mkLines = (cust) => {
      const pool = prods.filter(p => p.channel === cust.channel || (cust.channel === 'ca' && p.channel !== 'pet'));
      const k = between(1, 4); const ls = [];
      for (let i = 0; i < k; i++) { const p = pick(pool); if (ls.some(l => l.product_id === p.id)) continue; const qty = between(20, 400); const disc = rnd() < 0.25 ? pick([2, 3, 5]) : 0; ls.push({ product_id: p.id, qty, price: Number(p.list_price), disc, total: r2(qty * p.list_price * (1 - disc / 100)) }); }
      return ls;
    };
    const kgOf = ls => ls.reduce((s, l) => s + l.qty * Number(prods.find(p => p.id === l.product_id).kg_unit), 0);
    const routeRate = cu => Number(R.find(r => r.id === cu.route_id).rate_kg);
    const invoices = [];
    for (let i = 0; i < 170; i++) {
      const cu = pick(CU); const d = addDays(T, -between(3, 180)); const ls = mkLines(cu); if (!ls.length) continue;
      const sub = r2(ls.reduce((s, l) => s + l.total, 0)); const kg = kgOf(ls); const fr = r2(kg * routeRate(cu));
      const o = await ins(c, 'orders', { company: cu.channel === 'pet' ? 'PET' : 'MNA', doc_type: 'pedido', customer_id: cu.id, source: pick(['whatsapp', 'correo', 'telefono', 'oc', 'asesor', 'asesor']), warehouse_id: cu.warehouse_id, promised_date: addDays(d, 5), earliest_date: addDays(d, 5), subtotal: sub, freight: fr, freight_actual: r2(fr * (0.8 + rnd() * 0.5)), total: r2(sub + fr), kg, lines: ls, status: 'facturado', approval_level: '', created_at: ts(d), created_by: pick([U.vta1, U.vta2, U.atc]).id });
      const due = addDays(d, Number(cu.credit_days) || 30);
      const age = Math.floor((new Date(T) - new Date(due)) / 864e5);
      const paid = age > 0 ? rnd() < 0.86 : rnd() < 0.3;
      const bal = paid ? 0 : r2((sub + fr) * (rnd() < 0.2 ? 0.5 : 1));
      invoices.push(await ins(c, 'invoices', { company: o.company, customer_id: cu.id, order_id: o.id, date: d, due, method: 'PPD', lines: ls, subtotal: sub, freight: fr, total: r2(sub + fr), balance: bal, uuid: crypto.randomUUID().toUpperCase(), status: bal > 0 ? 'abierta' : 'pagada', created_at: ts(d, 16), created_by: U.fact.id }));
    }
    // receipts (applied) for paid invoices + a few unapplied this month
    const ba1 = await ins(c, 'bank_accounts', { name: 'BBVA Concentradora MNA', bank: 'BBVA', number: '0112233445', company: 'MNA', gl_account: '1102-01' });
    const ba2 = await ins(c, 'bank_accounts', { name: 'Banorte Pagos MNA', bank: 'Banorte', number: '0987766554', company: 'MNA', gl_account: '1102-02' });
    const recs = [];
    for (const inv of invoices.filter(x => x.status === 'pagada')) {
      const d = addDays(inv.due, -between(-12, 8)); if (d > T) continue;
      recs.push(await ins(c, 'receipts', { customer_id: inv.customer_id, date: d, amount: inv.total, reference: 'SPEI ' + inv.folio, bank_account_id: ba1.id, status: 'aplicado', lines: [{ invoice_id: inv.id, amount: Number(inv.total) }], rep_uuid: crypto.randomUUID().toUpperCase(), created_at: ts(d) }));
    }
    for (const inv of invoices.filter(x => x.status === 'abierta').slice(0, 4)) recs.push(await ins(c, 'receipts', { customer_id: inv.customer_id, date: addDays(T, -between(0, 6)), amount: Number(inv.balance), reference: 'DEP ' + between(100000, 999999), bank_account_id: ba1.id, status: 'por_aplicar', lines: [] }));

    // current pipeline orders in every status
    const pipe = [['cotizacion', 3], ['borrador', 3], ['por_aprobar', 2], ['retenido', 1], ['confirmado', 4], ['en_produccion', 2], ['listo', 5], ['en_ruta', 3], ['entregado', 4]];
    const pipeOrders = {};
    for (const [st, k] of pipe) for (let i = 0; i < k; i++) {
      const cu = st === 'listo' ? CU[i % 3 === 0 ? 0 : i % 3 === 1 ? 9 : 18] : pick(CU);
      let ls = mkLines(cu); if (!ls.length) ls = [{ product_id: prods[2].id, qty: 120, price: 520, disc: 0, total: 62400 }];
      if (st === 'por_aprobar') ls[0].disc = i ? 9 : 6, ls[0].total = r2(ls[0].qty * ls[0].price * (1 - ls[0].disc / 100));
      const sub = r2(ls.reduce((s, l) => s + l.total, 0)); const kg = kgOf(ls); const fr = r2(kg * routeRate(cu));
      const d = addDays(T, -between(0, 6));
      const o = await ins(c, 'orders', { company: cu.channel === 'pet' ? 'PET' : 'MNA', doc_type: st === 'cotizacion' ? 'cotizacion' : 'pedido', customer_id: cu.id, source: pick(['whatsapp', 'correo', 'telefono', 'oc', 'asesor']), warehouse_id: cu.warehouse_id, promised_date: addDays(T, between(2, 9)), earliest_date: addDays(T, 3), subtotal: sub, freight: fr, total: r2(sub + fr), kg, lines: ls, status: st, approval_level: st === 'por_aprobar' ? (i ? 'DIR' : 'GV') : '', alerts: st === 'por_aprobar' ? `Descuento ${ls[0].disc}% excede el límite del segmento → requiere autorización.` : st === 'retenido' ? 'Retenido: Excede línea de crédito' : null, created_at: ts(d), created_by: (i % 2 ? U.vta1 : U.vta2).id });
      (pipeOrders[st] = pipeOrders[st] || []).push(o);
    }
    // loads & deliveries
    const trucks = (await c.query('SELECT * FROM trucks ORDER BY id')).rows;
    const enRuta = pipeOrders.en_ruta;
    const ld = await ins(c, 'loads', { date: addDays(T, -1), route_id: R[0].id, truck_id: trucks[0].id, status: 'en_ruta', lines: enRuta.map(o => ({ order_id: o.id, kg: Number(o.kg), customer: CU.find(x => x.id === o.customer_id).name })), kg: enRuta.reduce((s, o) => s + Number(o.kg), 0), fill: r2(enRuta.reduce((s, o) => s + Number(o.kg), 0) / 30000 * 100), tolls: 2850 });
    for (const o of enRuta) await ins(c, 'deliveries', { load_id: ld.id, order_id: o.id, customer_id: o.customer_id, driver_id: U.chof.id, status: 'pendiente' });
    const ld2 = await ins(c, 'loads', { date: addDays(T, -3), route_id: R[5].id, truck_id: trucks[3].id, status: 'cerrada', lines: pipeOrders.entregado.map(o => ({ order_id: o.id, kg: Number(o.kg), customer: CU.find(x => x.id === o.customer_id).name })), kg: pipeOrders.entregado.reduce((s, o) => s + Number(o.kg), 0), fill: 62, carrier_cost: 38500, tolls: 0, actual_cost: 38500 });
    for (const o of pipeOrders.entregado) await ins(c, 'deliveries', { load_id: ld2.id, order_id: o.id, customer_id: o.customer_id, driver_id: U.chof.id, status: 'entregado', received_by: 'Encargado de almacén', delivered_at: new Date(Date.now() - between(4, 40) * 36e5).toISOString() });
    await ins(c, 'loads', { date: addDays(T, 1), route_id: R[0].id, truck_id: trucks[1].id, status: 'planeada', lines: [], kg: 0, fill: 0 });

    // double freight
    for (let i = 0; i < 9; i++) { const inv = pick(invoices); await ins(c, 'double_freight', { order_id: inv.order_id, date: addDays(T, -between(0, 85)), cost: between(4500, 18000), cause: pick(['produccion', 'bodega', 'venta', 'venta', 'cliente', 'transporte']), responsible_id: pick([U.prod, U.alm, U.vta1, U.vta2, U.log]).id, note: 'Pedido incompleto al llegar el camión; se envió segundo viaje para completar.' }); }

    // production orders
    for (const [st, k] of [['solicitada', 3], ['programada', 3], ['en_proceso', 3], ['terminada', 2], ['liquidada', 6]]) for (let i = 0; i < k; i++) {
      const p = pick(prods); const qty = between(200, 1500); const kg = qty * Number(p.kg_unit); const d = st === 'solicitada' ? null : addDays(T, st === 'programada' ? between(1, 6) : -between(1, 25));
      const std = r2(qty * Number(p.std_cost)); const act = st === 'liquidada' ? r2(std * (0.95 + rnd() * 0.12)) : null;
      const o = await ins(c, 'production_orders', { product_id: p.id, order_id: st === 'en_produccion' ? null : null, line_id: st === 'solicitada' ? null : (p.channel === 'pet' ? PL[0] : p.mode === 'mto' && p.line_type === 'especial' ? PL[3] : pick([PL[1], PL[2]])).id, warehouse_id: whs[0].id, qty, kg, need_by: addDays(T, between(-3, 10)), sched_date: d, qty_done: ['terminada', 'liquidada'].includes(st) ? qty : null, lot: ['terminada', 'liquidada'].includes(st) ? 'L' + (d || T).replace(/-/g, '').slice(2) + '-P' + i : null, material_actual: ['terminada', 'liquidada'].includes(st) ? r2(std * 0.7 * (0.95 + rnd() * 0.1)) : null, labor_hours: ['terminada', 'liquidada'].includes(st) ? between(8, 40) : null, std_total: std, actual_total: act, variance: act ? r2(act - std) : null, status: st, sap_folio: st !== 'solicitada' ? 'OF' + between(40000, 49999) : null });
      if (st === 'en_proceso' && pipeOrders.en_produccion && pipeOrders.en_produccion[i]) await c.query('UPDATE production_orders SET order_id=$1 WHERE id=$2', [pipeOrders.en_produccion[i].id, o.id]);
    }
    // forecasts
    for (const per of [addMonths(P, -2), addMonths(P, -1), P]) for (const adv of [U.vta1, U.vta2]) for (const p of prods.slice(0, 8)) {
      const fc = between(100, 900); const act = per === P ? Math.round(fc * (0.3 + rnd() * 0.3)) : Math.round(fc * (0.55 + rnd() * 0.45));
      await ins(c, 'forecasts', { period: per, advisor_id: adv.id, product_id: p.id, qty: fc, actual: act, accuracy: r2(Math.max(0, 1 - Math.abs(fc - act) / fc) * 100) });
    }
    // warehouse movements (lag)
    for (let i = 0; i < 160; i++) {
      const w = pick(whs); const d = addDays(T, -between(0, 55)); const phys = new Date(ts(d, between(7, 17)));
      const lag = w.code === 'MTY' ? between(0, 12) : between(2, w.id % 3 === 0 ? 120 : 60);
      const cap = rnd() < 0.05 ? null : new Date(phys.getTime() + lag * 36e5).toISOString();
      await ins(c, 'wh_movements', { warehouse_id: w.id, type: pick(['salida', 'salida', 'entrada', 'traslado']), reference: 'REM-' + between(10000, 99999), product_id: pick(prods).id, qty: between(10, 300), physical_at: phys.toISOString(), captured_at: cap, lag_hours: cap ? lag : null });
    }

    // credit notes (6 months, trending down as the system takes over)
    for (let m = 5; m >= 0; m--) {
      const k = [22, 20, 17, 15, 12, 7][5 - m];
      for (let i = 0; i < k; i++) {
        const inv = pick(invoices); const dom = +T.slice(8, 10); const d = m === 0 ? addDays(T, -between(0, Math.max(0, dom - 1))) : addDays(T, -(m * 30 + between(0, 27))); const reason = pick(['promocion', 'promocion', 'flete', 'flete', 'entrega', 'precio', 'devolucion', 'calidad']);
        const amt = between(1500, 42000);
        await ins(c, 'credit_notes', { company: inv.company, customer_id: inv.customer_id, invoice_id: inv.id, reason, amount: amt, approver_level: amt > 20000 || reason === 'precio' ? 'DIR' : 'GV', description: { promocion: 'Promoción bimestral aplicada retroactivamente', flete: 'Ajuste de flete por volumen', entrega: 'Producto dañado en entrega', precio: 'Diferencia contra precio pactado', devolucion: 'Devolución de producto', calidad: 'Reclamo de calidad' }[reason], status: m === 0 && i < 4 ? 'solicitada' : m === 0 && i < 5 ? 'aprobada' : 'aplicada', uuid: m === 0 && i < 5 ? null : crypto.randomUUID().toUpperCase(), created_at: ts(d), created_by: pick([U.vta1, U.vta2, U.atc]).id });
      }
    }
    // credit requests
    await ins(c, 'credit_requests', { applicant: 'Agroveterinaria La Huasteca', rfc: 'AHU150312KJ8', segment: 'A', line_req: 250000, days_req: 30, years: 6, monthly_volume: 180000, guarantee: 250000, references_ok: 3, bureau: 'bueno', status: 'borrador', created_by: U.vta1.id });
    await ins(c, 'credit_requests', { applicant: 'Granja Porcícola Los Pinos', rfc: 'GPP180921TT2', segment: 'AA', line_req: 800000, days_req: 45, years: 4, monthly_volume: 350000, guarantee: 500000, references_ok: 2, bureau: 'regular', score: 58.4, decision: 'Score 58.4% entre 40% y 60% → revisión de Dirección.', status: 'revision_direccion', created_by: U.vta2.id });

    // ── purchasing ──
    const SU = [];
    for (const [name, rfc, kind, days] of [['Empaques del Norte SA de CV', 'ENO0807146T3', 'general', 30], ['Granos y Oleaginosas del Bajío', 'GOB990415AB2', 'mp', 15], ['Minerales y Premezclas MX', 'MPM1102283K1', 'mp', 30], ['Refacciones Industriales Monterrey', 'RIM0505175J9', 'general', 30], ['Servicios de Fumigación Integral', 'SFI1309024M7', 'servicio', 15], ['Energía y Gas del Noreste', 'EGN0001019P4', 'servicio', 15], ['Transportes del Bajío', 'TBA0611082S6', 'flete', 30], ['Laboratorio Analítico Regio', 'LAR1407316D2', 'servicio', 30]]) SU.push(await ins(c, 'suppliers', { name, rfc, kind, third_type: '04', pay_days: days, email: 'facturas@' + name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + '.mx', clabe: '012580' + between(100000000000, 999999999999) }));
    await ins(c, 'users', { name: 'Portal — Empaques del Norte', role: 'PROV', position: 'Proveedor', supplier_id: SU[0].id, pin_hash: hashPin('2001'), active: true }).then(u => { pins[u.id] = '2001'; });
    const reqA = await ins(c, 'requisitions', { company: 'MNA', area: 'Mantenimiento planta', supplier_id: SU[3].id, lines: [{ description: 'Rodamiento SKF 22320 para peletizadora', qty: 4, price: 6800, total: 27200 }, { description: 'Dados de peletizado 4 mm', qty: 2, price: 18500, total: 37000 }], total: 64200, approver_level: 'DIR', justification: 'Mantenimiento preventivo línea Peletizado 2', status: 'solicitada', created_by: U.prod.id });
    await ins(c, 'requisitions', { company: 'MNA', area: 'Laboratorio', supplier_id: SU[7].id, lines: [{ description: 'Análisis bromatológico (lote)', qty: 10, price: 950, total: 9500 }], total: 9500, approver_level: 'COMP', justification: 'Control de calidad mensual', status: 'solicitada', created_by: U.prod.id });
    void reqA;
    const mkPO = async (sup, lines, st, d) => { const ls = lines.map(([desc, q, p]) => ({ description: desc, qty: q, price: p, total: r2(q * p), received: st === 'emitida' ? 0 : q })); const sub = r2(ls.reduce((s, l) => s + l.total, 0)); return ins(c, 'purchase_orders', { company: 'MNA', supplier_id: sup.id, warehouse_id: whs[0].id, date: d, lines: ls, subtotal: sub, tax: r2(sub * 0.16), total: r2(sub * 1.16), status: st, created_by: U.comp.id }); };
    const po1 = await mkPO(SU[0], [['Saco laminado 40 kg impreso', 20000, 6.8], ['Saco PET 20 kg con zipper', 8000, 11.5]], 'recibida', addDays(T, -12));
    const po2 = await mkPO(SU[1], [['Sorgo grano (ton)', 300, 4950], ['Pasta de soya (ton)', 120, 9100]], 'recibida', addDays(T, -9));
    const po3 = await mkPO(SU[2], [['Premezcla vitamínica cerdo (kg)', 2500, 38]], 'recibida', addDays(T, -6));
    const po4 = await mkPO(SU[3], [['Banda transportadora 24"', 2, 21500]], 'emitida', addDays(T, -2));
    const po5 = await mkPO(SU[0], [['Etiqueta código de barras rollo', 300, 145]], 'emitida', addDays(T, -1));
    void po4; void po5;
    const mkGR = async (po, st) => { const ls = po.lines.map((l, i) => ({ line: i + 1, description: l.description, qty: l.qty, price: l.price })); return ins(c, 'goods_receipts', { po_id: po.id, supplier_id: po.supplier_id, date: addDays(po.date, 2), lines: ls, amount: Number(po.subtotal), status: st, created_by: U.alm.id }); };
    const gr1 = await mkGR(po1, 'facturada'), gr2 = await mkGR(po2, 'facturada'), gr3 = await mkGR(po3, 'registrada');
    void gr3;
    const si1 = await ins(c, 'supplier_invoices', { supplier_id: SU[0].id, gr_id: gr1.id, uuid: crypto.randomUUID().toUpperCase(), date: addDays(T, -9), subtotal: po1.subtotal, tax: po1.tax, retention: 0, total: po1.total, due: addDays(T, 21), status: 'aprobada', match_note: `OC ${po1.folio} · Entrada ${gr1.folio} · Diferencia $0.00` });
    const si2 = await ins(c, 'supplier_invoices', { supplier_id: SU[1].id, gr_id: gr2.id, uuid: crypto.randomUUID().toUpperCase(), date: addDays(T, -6), subtotal: po2.subtotal, tax: 0, retention: 0, total: po2.subtotal, due: addDays(T, 9), status: 'validada', match_note: `OC ${po2.folio} · Entrada ${gr2.folio} · Diferencia $0.00` });
    void si2;
    // paid history for DIOT (last month)
    for (let i = 0; i < 14; i++) {
      const s = pick(SU); const base = between(15000, 380000); const tax = r2(base * 0.16); const ret = s.kind === 'flete' ? r2(base * 0.04) : 0;
      const inv = await ins(c, 'supplier_invoices', { supplier_id: s.id, uuid: crypto.randomUUID().toUpperCase(), date: addDays(T, -between(25, 50)), subtotal: base, tax, retention: ret, total: r2(base + tax - ret), status: 'pagada', match_note: 'Histórico' });
      const pd = addDays(T, -between(5, 35));
      await ins(c, 'supplier_payments', { supplier_id: s.id, date: pd, amount: inv.total, tax_base: base, tax, retention: ret, bank_account_id: ba2.id, reference: 'SPEI-' + between(100000, 999999), status: 'pagado', lines: [{ invoice_id: inv.id, amount: Number(inv.total) }], rep_received: rnd() > 0.3 });
    }
    await ins(c, 'supplier_payments', { supplier_id: SU[0].id, date: addDays(T, 2), amount: si1.total, tax_base: po1.subtotal, tax: po1.tax, retention: 0, bank_account_id: ba2.id, reference: 'Programado', status: 'programado', lines: [{ invoice_id: si1.id, amount: Number(si1.total) }] });

    // bank lines (current + prior month) from receipts and payments + noise
    const pays = (await c.query("SELECT * FROM supplier_payments WHERE status='pagado'")).rows;
    for (const r of recs.filter(x => x.date >= addDays(T, -40))) await ins(c, 'bank_lines', { bank_account_id: ba1.id, date: addDays(r.date, between(0, 1)), description: 'SPEI RECIBIDO ' + (CU.find(x => x.id === r.customer_id) || {}).name, reference: r.reference, amount: Number(r.amount), status: 'pendiente' });
    for (const p of pays.filter(x => x.date >= addDays(T, -40))) await ins(c, 'bank_lines', { bank_account_id: ba2.id, date: p.date, description: 'SPEI ENVIADO ' + (SU.find(x => x.id === p.supplier_id) || {}).name, reference: p.reference, amount: -Number(p.amount), status: 'pendiente' });
    for (const [desc, amt] of [['COMISION POR MANEJO DE CUENTA', -1450], ['IVA COMISION', -232], ['DEPOSITO EN EFECTIVO SUC 0451', 18500], ['CARGO DOMICILIADO CFE', -86420]]) await ins(c, 'bank_lines', { bank_account_id: pick([ba1, ba2]).id, date: addDays(T, -between(1, 20)), description: desc, reference: '', amount: amt, status: 'pendiente' });

    // ── GL / close ──
    const GL = [['1101', 'Caja', 'D', '101.01', 50000, 120000, 115000], ['1102-01', 'Bancos BBVA', 'D', '102.01', 4200000, 18500000, 17900000], ['1102-02', 'Bancos Banorte', 'D', '102.01', 1800000, 6200000, 6900000], ['1105', 'Clientes', 'D', '105.01', 21500000, 32000000, 30500000], ['1115', 'Inventario materia prima', 'D', '115.01', 9800000, 14200000, 13900000], ['1116', 'Inventario producto terminado', 'D', '115.03', 12400000, 19000000, 18700000], ['1117', 'Producción en proceso', 'D', '115.02', 0, 2100000, 1950000], ['1118', 'IVA acreditable', 'D', '118.01', 850000, 2900000, 2700000],
      ['1201', 'Edificios', 'D', '152.01', 48000000, 0, 0], ['1202', 'Maquinaria y equipo', 'D', '153.01', 96000000, 1400000, 0], ['1203', 'Equipo de transporte', 'D', '154.01', 22000000, 0, 850000], ['1204', 'Equipo de cómputo', 'D', '156.01', 3100000, 120000, 0], ['1290', 'Depreciación acumulada', 'A', '171.01', 61000000, 0, 1180000],
      ['2101', 'Proveedores', 'A', '201.01', 16800000, 15200000, 15900000], ['2105', 'Acreedores diversos', 'A', '205.01', 2400000, 1800000, 1900000], ['2108', 'IVA trasladado', 'A', '208.01', 1200000, 4100000, 4400000], ['2110', 'Impuestos por pagar', 'A', '213.01', 900000, 900000, 1100000], ['2120', 'Partes relacionadas (intercompañía)', 'A', '206.01', 5200000, 600000, 750000],
      ['3101', 'Capital social', 'A', '301.01', 80000000, 0, 0], ['3201', 'Resultados acumulados', 'A', '304.01', 47450000, 0, 0], ['4101', 'Ventas', 'A', '401.01', 0, 450000, 27600000], ['4201', 'Devoluciones y descuentos (notas de crédito)', 'D', '402.01', 0, 610000, 0],
      ['5101', 'Costo de ventas', 'D', '501.01', 0, 19800000, 0], ['6101', 'Gastos de operación', 'D', '601.01', 0, 3800000, 0], ['6102', 'Mantenimiento y energía (indirectos)', 'D', '601.02', 0, 1900000, 0], ['6103', 'Depreciación', 'D', '613.01', 0, 1180000, 0], ['6201', 'Fletes', 'D', '601.03', 0, 1250000, 0]];
    for (const [code, name, nat, sat, op, de, cr] of GL) await ins(c, 'gl_accounts', { code, name, nature: nat, sat_code: sat, level: code.includes('-') ? 3 : 2, risk: /^1[12]|^2/.test(code) ? 'alto' : 'medio', opening: op, debits: de, credits: cr, closing: nat === 'A' ? op - de + cr : op + de - cr });
    // balance debits/credits: add a balancing figure to an account
    const tot = (await c.query('SELECT sum(debits)::float d, sum(credits)::float c FROM gl_accounts')).rows[0];
    if (Math.abs(tot.d - tot.c) > 0.01) { const diff = tot.d - tot.c; await c.query("UPDATE gl_accounts SET credits = credits + $1, closing = CASE WHEN nature='A' THEN opening - debits + credits + $1 ELSE opening + debits - credits - $1 END WHERE code='4101'", [diff]); }

    const tpl = [[B('Bodegas: captura de remisiones y entradas del mes', 'Warehouses: capture delivery notes and receipts'), 'Almacenes', U.alm, 1], [B('Compras generales: entrega de facturas físicas pendientes', 'General purchasing: hand in pending paper invoices'), 'Compras', U.comp, 1], [B('Facturación: corte de facturas del mes', 'Billing: month-end invoice cutoff'), 'Facturación', U.fact, 1], [B('Ventas: notas de crédito del mes autorizadas', 'Sales: month credit notes approved'), 'Ventas', U.gv, 2], [B('Cobranza: aplicación de cobros del mes', 'Collections: apply month receipts'), 'Cobranza', U.cob, 2], [B('Producción: cierre de órdenes de fabricación', 'Production: close production orders'), 'Producción', U.prod, 2], [B('Nómina: póliza contabilizada', 'Payroll: journal posted'), 'Contabilidad', U.cont2, 3], [B('Activos fijos: corrida de depreciación', 'Fixed assets: depreciation run'), 'Contabilidad', U.cont2, 3], [B('Costos: liquidación de órdenes y variaciones', 'Costing: order settlement and variances'), 'Costos', U.cost, 3], [B('Tesorería: conciliaciones bancarias', 'Treasury: bank reconciliations'), 'Tesorería', U.cxp, 4], [B('Contabilidad: conciliaciones de cuentas de balance', 'Accounting: balance sheet reconciliations'), 'Contabilidad', U.cont1, 4], [B('Contabilidad: intercompañía conciliada', 'Accounting: intercompany reconciled'), 'Contabilidad', U.cont1, 4], [B('Contraloría: revisión de estados financieros y cierre', 'Controller: financial statement review and close'), 'Contabilidad', U.cont1, 5]];
    for (const [task, area, own, off] of tpl) await ins(c, 'close_templates', { task, area, owner_id: own.id, day_offset: off, required: true });
    const prev = addMonths(P, -1);
    const bizAdd = (d, n) => { let x = d, k = 0; while (k < n) { x = addDays(x, 1); const w = new Date(x + 'T12:00:00Z').getUTCDay(); if (w && w !== 6) k++; } return x; };
    const mEnd = p => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
    for (let m = 6, i = 0; m >= 2; m--, i++) await ins(c, 'close_periods', { period: addMonths(P, -m), company: 'MNA', status: 'cerrado', progress: 100, late: 0, closed_day: [8, 8, 7, 7, 6][i] });
    const cp = await ins(c, 'close_periods', { period: prev, company: 'MNA', status: 'abierto', progress: 0, late: 0 });
    let v = 0, late = 0;
    for (const [task, area, own, off] of tpl) {
      const due = bizAdd(mEnd(prev), off);
      const st = due < T ? (rnd() < 0.7 ? 'validada' : rnd() < 0.5 ? 'entregada' : 'pendiente') : (rnd() < 0.3 ? 'entregada' : 'pendiente');
      if (st === 'validada') v++; if (st === 'pendiente' && due < T) late++;
      await ins(c, 'close_tasks', { period_id: cp.id, task, area, owner_id: own.id, due, required: true, status: st });
    }
    await c.query('UPDATE close_periods SET progress=$1, late=$2 WHERE id=$3', [r2(v / tpl.length * 100), late, cp.id]);
    // account reconciliations
    const glr = (await c.query("SELECT * FROM gl_accounts WHERE risk='alto' ORDER BY code LIMIT 8")).rows;
    for (const [i, a] of glr.entries()) await ins(c, 'account_recons', { period: prev, account_id: a.id, gl_balance: a.closing, support_balance: i % 3 === 0 ? r2(Number(a.closing) - between(800, 12000)) : a.closing, difference: i % 3 === 0 ? null : 0, status: i < 3 ? 'aprobada' : i < 5 ? 'preparada' : 'pendiente', preparer: i < 5 ? `Ángel · ${prev}-0${i + 3}#${U.cont2.id}` : null, reviewer: i < 3 ? `Jordan · ${prev}-0${i + 5}` : null, explanation: i % 3 === 0 ? 'Partidas en tránsito al cierre; se depuran en el siguiente periodo.' : null });
    await c.query('UPDATE account_recons SET difference = gl_balance - support_balance');
    for (const [a, b, x, y, cpt] of [['MNA', 'PET', 1250000, 1250000, 'Servicios administrativos'], ['MNA', 'CAG', 3400000, 3380000, 'Venta de producto'], ['MNA', 'TRA', 860000, 0, 'Servicios de flete (sin registrar en TRA)'], ['MNA', 'AQUA', 145000, 145000, 'Análisis de laboratorio']]) await ins(c, 'ic_balances', { period: prev, from_co: a, to_co: b, amount_a: x, amount_b: y, difference: x - y, concept: cpt });
    await ins(c, 'payroll', { period: prev + ' Q2', company: 'MNA', gross: 4850000, isr: 690000, imss: 132000, net: 4028000, stamp_ref: 'Timbrado externo #8841', status: 'contabilizada' });
    await ins(c, 'payroll', { period: P + ' Q1', company: 'MNA', gross: 4790000, isr: 681000, imss: 130500, net: 3978500, stamp_ref: 'Timbrado externo #8902', status: 'capturada' });

    // ── fixed assets ──
    const AC = {};
    for (const [k, n, months, rate, ga, gd, ge] of [['EDI', 'Edificios y construcciones', 240, 5, '1201', '1290', '6103'], ['MAQ', 'Maquinaria y equipo industrial', 120, 10, '1202', '1290', '6103'], ['TRA', 'Equipo de transporte', 48, 25, '1203', '1290', '6103'], ['COM', 'Equipo de cómputo', 36, 30, '1204', '1290', '6103'], ['MOB', 'Mobiliario y equipo de oficina', 120, 10, '1205', '1290', '6103'], ['LAB', 'Equipo de laboratorio', 120, 10, '1206', '1290', '6103']]) AC[k] = await ins(c, 'asset_classes', { name: n, book_months: months, fiscal_rate: rate, gl_asset: ga, gl_dep: gd, gl_exp: ge });
    const assetDefs = [['EDI', 'Nave industrial', 6, 12000000, 30000000], ['MAQ', 'Peletizadora', 18, 1800000, 6500000], ['MAQ', 'Extrusor', 6, 4500000, 12000000], ['MAQ', 'Molino de martillos', 14, 350000, 1200000], ['MAQ', 'Mezcladora horizontal', 12, 420000, 1600000], ['MAQ', 'Montacargas', 16, 380000, 850000], ['MAQ', 'Báscula camionera', 4, 450000, 900000], ['TRA', 'Tractocamión', 8, 1900000, 2800000], ['TRA', 'Camioneta pick-up', 22, 420000, 780000], ['TRA', 'Caja seca 53 pies', 8, 650000, 980000], ['COM', 'Laptop', 30, 18000, 42000], ['COM', 'Servidor', 3, 120000, 380000], ['MOB', 'Mobiliario de oficina', 12, 25000, 120000], ['LAB', 'Equipo de laboratorio Aqua', 8, 90000, 650000]];
    let tag = 1;
    for (const [cls, d, k, lo, hi] of assetDefs) for (let i = 0; i < k; i++) {
      const cost = between(lo, hi); const ins_ = addDays(T, -between(60, 2900)); const months = Math.max(0, Math.floor((new Date(T) - new Date(ins_)) / (30.44 * 864e5)) - 1);
      const cl = AC[cls]; const book = Math.min(cost, r2(cost / cl.book_months * months)); const fiscal = Math.min(cost, r2(cost * cl.fiscal_rate / 100 / 12 * months));
      await ins(c, 'assets', { tag: 'AF-' + String(tag++).padStart(4, '0'), description: `${d} ${i + 1}`, class_id: cl.id, company: cls === 'LAB' ? 'AQUA' : cls === 'TRA' ? 'TRA' : 'MNA', location: cls === 'LAB' ? 'Aqua Laboratorios' : cls === 'TRA' ? 'Patio Monterrey' : pick(['Planta Monterrey', 'Planta Monterrey', 'Bodega Saltillo', 'Oficinas corporativas']), custodian: pick(['Ing. Raúl Cantú', 'Daniel Flores', 'Belarmino', 'Luis Herrera']), in_service: ins_, cost, salvage: 0, book_accum: book, nbv: r2(cost - book), fiscal_accum: fiscal, status: 'activo' });
    }
    const someAsset = (await c.query("SELECT id FROM assets WHERE description LIKE 'Peletizadora%' LIMIT 1")).rows[0];
    await ins(c, 'asset_events', { asset_id: someAsset.id, type: 'mejora', date: addDays(T, -3), amount: 64200, policy_check: 'Cumple política: ≥ $15,000.00 se capitaliza como mejora.', justification: 'Reemplazo de dados y rodamientos que extiende la vida útil 3 años', status: 'solicitado', created_by: U.prod.id });
    const truck = (await c.query("SELECT * FROM assets WHERE description LIKE 'Camioneta%' LIMIT 1")).rows[0];
    await ins(c, 'asset_events', { asset_id: truck.id, type: 'venta', date: addDays(T, -1), amount: 185000, gain_loss: r2(185000 - Number(truck.nbv)), justification: 'Venta de unidad con alto kilometraje', status: 'solicitado', created_by: U.log.id });
    await ins(c, 'depr_runs', { period: prev, status: 'contabilizada', assets: 0, book_total: 0, fiscal_total: 0 });
    await ins(c, 'depr_runs', { period: P, status: 'borrador' });
    let inpc = 138.2;
    for (let m = 22; m >= 0; m--) { inpc = r2(inpc * (1 + 0.0035 + rnd() * 0.002)); await ins(c, 'inpc', { period: addMonths(P, -m - 1), value: inpc }); }

    // ── costing ──
    const per = addMonths(P, -1);
    for (const [name, amt, drv, qty] of [['mantenimiento', 1450000, 'kg', 8200000], ['energia', 2380000, 'kg', 8200000], ['fumigacion', 185000, 'kg', 8200000], ['limpieza', 240000, 'kg', 8200000], ['moi', 1960000, 'horas', 5200], ['depreciacion', 1180000, 'kg', 8200000]]) await ins(c, 'cost_pools', { period: per, name, plant: 'Monterrey', amount: amt, driver: drv, driver_qty: qty, rate: Math.round(amt / qty * 10000) / 10000 });
    for (const code of ['POR-ENG-40', 'PER-ADU-20', 'BOV-ENG-40', 'AVE-POS-40']) {
      const p = prods.find(x => x.code === code);
      const comps = code.startsWith('PER') ? [['Harina de carne y hueso', 280, 11.5], ['Maíz molido', 360, 5.2], ['Arroz quebrado', 150, 7.8], ['Grasa animal', 90, 16.4], ['Premezcla vitamínica', 20, 38], ['Palatabilizante', 15, 62]] : [['Sorgo grano', 520, 4.95], ['Pasta de soya', 240, 9.1], ['Salvado de trigo', 120, 4.1], ['Melaza', 60, 3.6], ['Premezcla mineral', 25, 38], ['Carbonato de calcio', 35, 1.9]];
      const lines = comps.map(([n_, q, pz]) => ({ component: n_, qty_ton: q, std_price: pz, total: r2(q * pz) }));
      await ins(c, 'boms', { product_id: p.id, version: 'v' + P.replace('-', '.') + '.1', lines, material_ton: r2(lines.reduce((s, l) => s + l.total, 0)), labor_ton: code.startsWith('PER') ? 420 : 260, packaging_unit: code.startsWith('PER') ? 11.5 : 6.8, change_reason: 'Versión base cargada al arranque del sistema', status: 'vigente' });
    }

    // ── governance ──
    const pol = [
      [B('Política de cierre contable mensual', 'Monthly close policy'), 'Record to Report', U.cont1, 'vigente', 'ALM,COMP,FACT,GV,COB,PROD,CONT,COST,CXP', 'Objetivo: cerrar a más tardar el día hábil 5 (D+5).\n1. Cada área entrega su información según el calendario de precierre del sistema.\n2. Bodegas capturan remisiones y entradas a más tardar D+1.\n3. Compras generales entrega todas las facturas a D+1; desde el portal de proveedores no hay facturas físicas.\n4. Contabilidad valida cada tarea; el periodo solo se cierra con todas las tareas obligatorias validadas.\n5. Atrasos se reportan a Dirección en el tablero de cierre.'],
      [B('Política de crédito y cobranza', 'Credit and collections policy'), 'Order to Cash', U.cob, 'vigente', 'VTA,GV,COB,DIR,ATC', 'Requisitos: RFC, constancia de situación fiscal (≤ 3 meses) y pagaré firmado por el monto de la línea.\nEvaluación por score: menor a 40% se rechaza; entre 40% y 60% decide Dirección; mayor a 60% se aprueba automáticamente hasta $300,000.\nDías de crédito estándar por segmento: AAA 45, AA 30, A 30, B 15.\nPedidos de clientes con facturas vencidas más de 15 días o que excedan su línea quedan retenidos hasta que Cobranza los libere.'],
      [B('Política de precios especiales y descuentos', 'Special pricing and discount policy'), 'Order to Cash', U.gv, 'vigente', 'VTA,GV,ATC,DIR', 'Los precios de lista no requieren autorización.\nDescuentos máximos por segmento (asesor / Gerencia): AAA 3% / 8%, AA 3% / 7%, A 2% / 5%, B 0% / 3%.\nArriba del límite de Gerencia autoriza Dirección. Toda autorización queda registrada en el pedido.'],
      [B('Política de notas de crédito', 'Credit note policy'), 'Order to Cash', U.gv, 'vigente', 'VTA,GV,ATC,FACT,DIR', 'Toda nota se solicita en el sistema con motivo y evidencia.\nHasta $20,000 autoriza Gerencia de Ventas; montos mayores o motivo "precio" autoriza Dirección.\nLas promociones y fletes se configuran en el pedido; no se emiten notas retroactivas por promoción.'],
      [B('Política de capitalización de activos fijos', 'Fixed asset capitalization policy'), 'Record to Report', U.cont1, 'vigente', 'CONT,PROD,LOG,DIR', 'Se capitaliza toda adquisición o mejora mayor o igual a $15,000 que extienda vida útil o capacidad.\nMenores se registran como gasto de mantenimiento.\nBajas y ventas requieren aprobación de Contabilidad y Dirección.'],
      [B('Política de compras y autorizaciones', 'Purchasing and approvals policy'), 'Procure to Pay', U.comp, 'revision', 'COMP,ALM,CXP,PROD', 'Solicitudes hasta $50,000 autoriza Compras; mayores autoriza Dirección.\nNingún proveedor factura sin entrada de mercancía registrada (portal de proveedores).\nConciliación a 3 vías con tolerancia de ±1% o $100.'],
      [B('Política de conciliación de cuentas de balance', 'Balance sheet reconciliation policy'), 'Record to Report', U.cont1, 'borrador', 'CONT', 'Cuentas de riesgo alto se concilian mensualmente; medio trimestral; bajo anual.\nDiferencias mayores a $5,000 requieren explicación y plan de acción.\nPreparador y revisor deben ser personas distintas.'],
    ];
    for (const [name, process, own, st, aud, body] of pol) await ins(c, 'policies', { name, process, owner_id: own.id, version: 1, effective: st === 'vigente' ? addDays(T, -20) : null, audience: aud, body, status: st, acks: 0 });
    const vig = (await c.query("SELECT id FROM policies WHERE status='vigente'")).rows;
    for (const p of vig) for (const u of [U.dir, U.gv, U.cont1, U.cont2, U.cob, U.vta1]) if (rnd() < 0.6) await c.query('INSERT INTO policy_acks(policy_id,version,user_id) VALUES($1,1,$2) ON CONFLICT DO NOTHING', [p.id, u.id]);
    for (const [process, r, a, cc, ii] of [['Maestro de materiales (productos)', 'Compras, Costos', U.comp, 'Ventas, Producción, Contabilidad', 'Todos'], ['Maestro de clientes', 'Atención a Clientes', U.gv, 'Cobranza', 'Contabilidad'], ['Maestro de proveedores', 'Compras', U.comp, 'Cuentas por Pagar', 'Contabilidad'], ['Catálogo de cuentas', 'Contabilidad', U.cont1, 'Costos', 'Dirección'], ['Order to Cash', 'Ventas, ATC, Facturación', U.gv, 'Cobranza, Logística', 'Dirección'], ['Procure to Pay', 'Compras, Almacén, CxP', U.comp, 'Contabilidad', 'Dirección'], ['Plan to Produce', 'Producción', U.prod, 'Ventas, Costos', 'Dirección'], ['Record to Report', 'Contabilidad', U.cont1, 'Todas las áreas', 'Dirección'], ['Almacenes / WMS', 'Coordinador de Bodegas', U.comp, 'TI, Contabilidad', 'Ventas'], ['Logística y fletes', 'Logística', U.log, 'Ventas', 'Contabilidad']]) await ins(c, 'raci', { process, responsible: r, accountable_id: a.id, consulted: cc, informed: ii });
    for (const [rule, ctl] of [['Quien captura un documento no puede autorizarlo', 'Bloqueo automático en notas de crédito, solicitudes de compra, pagos, tareas de cierre y movimientos de activo'], ['Preparador ≠ revisor en conciliaciones de balance', 'Firma de revisor rechazada si es el mismo usuario'], ['Quien recibe mercancía no aprueba la factura del proveedor', 'Roles separados: Almacén registra entrada; CxP aprueba'], ['Descuentos fuera de rango requieren nivel superior', 'Pedido pasa a "Por aprobar" con el nivel requerido'], ['Fórmulas (BOM) confidenciales', 'Solo Costos y Dirección pueden ver fórmulas y costos de material'], ['Proveedores solo ven sus propios documentos', 'Filtro por proveedor en el portal']]) await ins(c, 'sod_rules', { rule, control: ctl, active: true });
    for (const [issue, area, own, d] of [['Remisiones de Bodega Culiacán capturadas con 5 días de retraso', 'Almacenes', U.alm, 3], ['Factura de compras generales sin entrada de mercancía', 'Compras', U.comp, 5], ['Pedido facturado con flete distinto a la tarifa de ruta', 'Ventas', U.gv, 7]]) await ins(c, 'corrective_actions', { issue, origin_area: area, owner_id: own.id, due: addDays(T, d), detail: 'Registrado por Contabilidad durante el cierre.', status: 'abierta', created_by: U.cont1.id });

    // finalize computed balances & segments
    await c.query(`UPDATE customers c SET balance = coalesce((SELECT sum(balance) FROM invoices i WHERE i.customer_id=c.id AND i.status='abierta'),0)`);
    await c.query(`UPDATE customers c SET segment = CASE WHEN v >= 3000000 AND months_active>=24 THEN 'AAA' WHEN v >= 1200000 AND months_active>=12 THEN 'AA' WHEN v >= 300000 AND months_active>=6 THEN 'A' ELSE 'B' END FROM (SELECT customer_id, sum(total) v FROM invoices GROUP BY 1) x WHERE x.customer_id=c.id`);
    await c.query(`UPDATE customers SET segment='B' WHERE segment IS NULL`);
    await c.query(`UPDATE policies p SET acks = round(100.0 * (SELECT count(*) FROM policy_acks a WHERE a.policy_id=p.id) / greatest(1,(SELECT count(*) FROM users WHERE active AND role<>'PROV' AND role = ANY(string_to_array(replace(p.audience,' ',''),','))))::numeric, 1) WHERE status='vigente'`);
    await c.query(`UPDATE policies SET acks = least(acks, 100)`);
    await set('demo_pins', pins);
    await set('seeded_at', new Date().toISOString());
    void promo1; void ctr;
    for (const n of [['GV', 'Precio especial por autorizar', 'Hay pedidos esperando su autorización', '#/e/orders?status=por_aprobar'], ['DIR', 'Solicitud de crédito por decidir', 'Granja Porcícola Los Pinos — $800,000', '#/e/credit_requests?status=revision_direccion'], ['FACT', 'Pedidos entregados por facturar', 'Revise la cola de facturación', '#/r/billing_queue'], ['CHOF', 'Ruta asignada', 'Tiene entregas pendientes de confirmar', '#/e/deliveries?status=pendiente']]) await c.query('INSERT INTO notifications(role,title,body,link) VALUES($1,$2,$3,$4)', n);
  });
}

async function ensure(hashPin) {
  const r = await db.one('SELECT count(*)::int n FROM users');
  if (r.n === 0) { console.log('[seed] empty database — loading initial data'); await seedAll(hashPin); console.log('[seed] done'); }
}
async function reset(hashPin) {
  const tables = [...Object.keys(E), 'files', 'audit_log', 'notifications', 'policy_acks', 'settings'];
  await db.q(`TRUNCATE ${tables.join(',')} RESTART IDENTITY CASCADE`);
  await seedAll(hashPin);
}
module.exports = { ensure, reset, seedAll };
