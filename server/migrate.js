/* Moving this app to another Render workspace (Render can't transfer services): copy every table from the old service's
   database to the new one over HTTPS, and make the old address forward to the new one.
   Off unless MIGRATE_SECRET is set on the host.
   Old service:  MIGRATE_SECRET=<same>   (serves /api/migrate/tables and /api/migrate/rows)
   New service:  MIGRATE_SECRET=<same>   then open /api/migrate/pull?s=<secret>&from=<old https url>; progress at /api/migrate/status?s=<secret>
   Forwarding:   REDIRECT_TO=<new https url> on the old service sends every visit (and installed app) to the new address. */
module.exports = function migrate(app, poolOrGetter) {
  const db = () => (typeof poolOrGetter === "function" ? poolOrGetter() : poolOrGetter);
  const SECRET = String(process.env.MIGRATE_SECRET || "");
  const TO = String(process.env.REDIRECT_TO || "").replace(/\/$/, "");
  if (TO) app.use((req, res, next) => {
    if (req.path.startsWith("/api/migrate/")) return next();
    res.set("Cache-Control", "no-store");
    res.redirect(req.method === "GET" || req.method === "HEAD" ? 302 : 307, TO + req.originalUrl);
  });
  if (!SECRET) return;
  const ok = (req) => String(req.query.s || req.headers["x-migrate-secret"] || "") === SECRET;
  const q = (t, p) => { if (!db()) throw new Error("no database"); return db().query(t, p); };
  const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  async function tables() { // every table, parents before children (foreign keys)
    const { rows: ts } = await q("select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
    const { rows: fks } = await q(`select c.conrelid::regclass::text child, c.confrelid::regclass::text parent from pg_constraint c join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname = 'public'`);
    const names = ts.map((r) => r.t), out = [], seen = new Set();
    const visit = (t, stack = new Set()) => { if (seen.has(t) || stack.has(t)) return; stack.add(t); fks.filter((f) => f.child.replace(/"/g, "") === t && f.parent.replace(/"/g, "") !== t).forEach((f) => visit(f.parent.replace(/"/g, ""), stack)); seen.add(t); out.push(t); };
    names.forEach((t) => visit(t));
    return out.filter((t) => names.includes(t));
  }
  app.get("/api/migrate/tables", async (req, res) => {
    if (!ok(req)) return res.status(403).json({ error: "no" });
    try { const list = await tables(); const out = []; for (const t of list) { const { rows: [c] } = await q(`select count(*)::int n from ${ident(t)}`); out.push({ table: t, rows: c.n }); } res.json({ tables: out }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/migrate/rows", async (req, res) => {
    if (!ok(req)) return res.status(403).json({ error: "no" });
    try {
      const t = String(req.query.table || ""); if (!(await tables()).includes(t)) return res.status(400).json({ error: "table?" });
      const off = Math.max(0, parseInt(req.query.offset, 10) || 0), lim = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const { rows } = await q(`select row_to_json(x)::text j from (select * from ${ident(t)} order by ctid offset $1 limit $2) x`, [off, lim]);
      res.type("json").send("[" + rows.map((r) => r.j).join(",") + "]");
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  let job = { state: "idle", log: [] };
  const say = (m) => { job.log.push(new Date().toISOString().slice(11, 19) + " " + m); console.log("[migrate] " + m); };
  app.get("/api/migrate/status", (req, res) => (ok(req) ? res.json(job) : res.status(403).json({ error: "no" })));
  app.get("/api/migrate/pull", async (req, res) => {
    if (!ok(req)) return res.status(403).json({ error: "no" });
    const from = String(req.query.from || "").replace(/\/$/, "");
    if (!/^(https:\/\/[\w.-]+|http:\/\/localhost:\d+)$/.test(from)) return res.status(400).json({ error: "from=https://old-address" });
    if (job.state === "running") return res.json(job);
    job = { state: "running", from, started: new Date().toISOString(), log: [], copied: {} };
    res.json({ ok: true, started: true });
    const get = async (p) => { const r = await fetch(from + p + (p.includes("?") ? "&" : "?") + "s=" + encodeURIComponent(SECRET), { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(p + " → " + r.status); return r.json(); };
    try {
      const src = (await get("/api/migrate/tables")).tables, mine = await tables();
      const list = src.filter((s) => mine.includes(s.table));
      say(`copying ${list.length} tables from ${from}` + (src.length > list.length ? ` (skipping ${src.filter((s) => !mine.includes(s.table)).map((s) => s.table).join(", ")})` : ""));
      const client = await db().connect();
      try {
        await client.query("begin");
        await client.query(`truncate ${mine.map(ident).join(", ")} restart identity cascade`);
        for (const { table, rows } of list) {
          let done = 0, lim = /files/.test(table) ? 5 : /docs|documents|reports|images/.test(table) ? 20 : 100;
          while (done < rows) {
            const batch = await get(`/api/migrate/rows?table=${encodeURIComponent(table)}&offset=${done}&limit=${lim}`);
            if (!batch.length) break;
            await client.query(`insert into ${ident(table)} select * from json_populate_recordset(null::${ident(table)}, $1::json)`, [JSON.stringify(batch)]);
            done += batch.length;
          }
          job.copied[table] = done; say(`${table}: ${done} of ${rows}`);
        }
        // serial counters carry on after the copied ids
        const { rows: seqs } = await client.query(`select c.relname t, a.attname col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) seq from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and pg_get_serial_sequence(quote_ident(c.relname), a.attname) is not null`);
        for (const s of seqs) await client.query(`select setval($1, coalesce((select max(${ident(s.col)}) from ${ident(s.t)}), 0) + 1, false)`, [s.seq]);
        await client.query("commit");
        job.state = "done"; job.finished = new Date().toISOString(); say("done; restarting so the app loads the copied data");
        setTimeout(() => process.exit(0), 1500); // Render starts the service again on its own
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    } catch (e) { job.state = "failed"; job.error = e.message; say("FAILED: " + e.message); }
  });
};
