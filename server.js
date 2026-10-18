/* Band Tips — a tip jar and follow page for bands playing live (Stemo Enterprises LLC)
 *
 *   https://<site>/<band>          the fan page: tip the band, follow them, send a shout-out
 *   https://<site>/<band>/poster   printable QR poster for the stage / tip jar / merch table
 *   https://<site>/<band>/setup    the band's own page: logo, name, payment handles, links, tonight's tips, plan
 *   https://<site>/start           sign up a band (14-day free trial, or a code from My Apps)
 *
 * Tips never pass through here. A fan picks an amount and a payment app, and the phone opens
 * the band's own Venmo / Cash App / PayPal (or shows the Zelle / Apple Cash handle to send to).
 * We only log the tap, so the band can see tonight's tips and shout-outs on their page.
 *
 * Plans, trials and codes live in My Apps (MYAPPS_URL); card payments in Stripe (optional).
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const PORT = process.env.PORT || 4020;
const PRODUCT = process.env.PRODUCT_NAME || "Band Tips";
const COMPANY = process.env.COMPANY_NAME || "Stemo Enterprises";
const SUPPORT = process.env.SUPPORT_EMAIL || "steve.smith@buddyrents.com";
const PRICE_TEXT = process.env.PRICE_TEXT || "$19/month";
const TRIAL_DAYS = Math.max(0, Number(process.env.TRIAL_DAYS || 14));
const MYAPPS = { url: (process.env.MYAPPS_URL || "").replace(/\/$/, ""), slug: process.env.MYAPPS_SLUG || "bands", secret: process.env.MYAPPS_SECRET || "" };
const PLATFORM_KEY = process.env.PLATFORM_KEY || MYAPPS.secret;   // My Apps uses this to list and manage bands
const STRIPE = { key: process.env.STRIPE_SECRET_KEY || "", price: process.env.STRIPE_PRICE_ID || "", wh: process.env.STRIPE_WEBHOOK_SECRET || "" };
const TERMS_V = "2026-10-17";

/* ---------- small helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// names go into pages and scripts: keep them plain text
const cleanName = (s, max) => clean(s, max).replace(/[<>"\\`$\{\}]/g, "").replace(/'/g, "’");
const slugify = s => String(s || "").toLowerCase().replace(/['’]/g, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);
const RESERVED = new Set(["start", "setup", "api", "admin", "terms", "poster", "logo", "qr", "www", "app", "help", "support", "billing", "login", "static", "assets", "band", "bands", "stemo", "tip", "tips", "default-logo"]);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: "Something went wrong on our end. Try again." }); });
function siteUrl(req) { return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, ""); }
function normPhone(p) {
  const raw = String(p || "").trim(), d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && d.length >= 10 && d.length <= 15) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}
function hashPin(pin) { const salt = crypto.randomBytes(8).toString("hex"); return salt + ":" + crypto.scryptSync(String(pin), salt, 32).toString("hex"); }
function pinMatches(pin, stored) {
  if (!pin || !stored || !stored.includes(":")) return false;
  const [salt, h] = stored.split(":"), got = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return got.length === h.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(h));
}
// a sliding-window counter per key (phone, address…) so nobody can hammer the tip log or the PIN
const hits = new Map();
function limited(bucket, key, max, windowMs) {
  const k = bucket + ":" + key, now = Date.now(), l = (hits.get(k) || []).filter(x => now - x < windowMs);
  if (l.length >= max) { hits.set(k, l); return true; }
  l.push(now); hits.set(k, l); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, l] of hits) if (!l.length || now - l[l.length - 1] > 3600e3) hits.delete(k); }, 600e3).unref();

/* ---------- storage: the shared APPS database on Render (schema "bands"), memory when run without one ----------
   DATABASE_URL is used when it is set. Otherwise the app asks My Apps for the shared database it manages
   (My Apps knows the app by MYAPPS_SLUG + MYAPPS_SECRET), so nothing has to be copied by hand. */
let db;
const MEM = { tenants: {}, tips: [], seq: 0 };
function memoryDb() {
  const now = () => new Date().toISOString();
  return {
    kind: "memory",
    async init() {},
    async getTenant(slug) { return MEM.tenants[slug] ? JSON.parse(JSON.stringify(MEM.tenants[slug])) : null; },
    async saveTenant(t) { MEM.tenants[t.slug] = { created_at: (MEM.tenants[t.slug] || {}).created_at || now(), ...JSON.parse(JSON.stringify(t)) }; },
    async listTenants() { return Object.values(MEM.tenants).map(t => JSON.parse(JSON.stringify(t))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async addTip(r) { const row = { id: ++MEM.seq, at: now(), ...r }; MEM.tips.push(row); return row; },
    async tipsSince(slug, since) { return MEM.tips.filter(t => t.slug === slug && new Date(t.at) >= since).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200); },
    async tipTotals(slug, since) {
      const l = MEM.tips.filter(t => t.slug === slug && (!since || new Date(t.at) >= since) && t.kind === "tip");
      return { tips: l.length, amount: Math.round(l.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100, last: l.length ? l[l.length - 1].at : null };
    },
    async tipCounts() { const o = {}; for (const t of MEM.tips) { if (t.kind !== "tip") continue; const c = o[t.slug] = o[t.slug] || { tips: 0, amount: 0, last: null }; c.tips++; c.amount += Number(t.amount); c.last = t.at; } return o; },
  };
}
function pgDb(url) {
  const { Pool } = require("pg");
  const ssl = /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === "off" ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  const Q = (text, params) => pool.query(text, params);
  return {
    kind: "postgres",
    async init() {
      await Q(`CREATE SCHEMA IF NOT EXISTS bands`);
      await Q(`CREATE TABLE IF NOT EXISTS bands.tenants (slug TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await Q(`CREATE TABLE IF NOT EXISTS bands.tips (id SERIAL PRIMARY KEY, slug TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL DEFAULT 'tip', amount NUMERIC(8,2) NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '')`);
      await Q(`CREATE INDEX IF NOT EXISTS bands_tips_slug_at ON bands.tips (slug, at DESC)`);
    },
    async getTenant(slug) { const r = (await Q(`SELECT data, created_at FROM bands.tenants WHERE slug=$1`, [slug])).rows[0]; return r ? { ...JSON.parse(r.data), slug, created_at: r.created_at } : null; },
    async saveTenant(t) { const { slug, created_at, ...data } = t; await Q(`INSERT INTO bands.tenants (slug,data) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET data=$2`, [slug, JSON.stringify(data)]); },
    async listTenants() { return (await Q(`SELECT slug, data, created_at FROM bands.tenants ORDER BY created_at DESC`)).rows.map(r => ({ ...JSON.parse(r.data), slug: r.slug, created_at: r.created_at })); },
    async addTip(r) { return (await Q(`INSERT INTO bands.tips (slug, kind, amount, method, name, note, device) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [r.slug, r.kind, r.amount, r.method, r.name, r.note, r.device])).rows[0]; },
    async tipsSince(slug, since) { return (await Q(`SELECT * FROM bands.tips WHERE slug=$1 AND at >= $2 ORDER BY at DESC LIMIT 200`, [slug, since])).rows; },
    async tipTotals(slug, since) {
      const r = (await Q(`SELECT count(*)::int AS tips, coalesce(sum(amount),0)::float AS amount, max(at) AS last FROM bands.tips WHERE slug=$1 AND kind='tip'` + (since ? ` AND at >= $2` : ``), since ? [slug, since] : [slug])).rows[0];
      return { tips: r.tips, amount: Math.round(r.amount * 100) / 100, last: r.last };
    },
    async tipCounts() { const o = {}; for (const r of (await Q(`SELECT slug, count(*)::int AS tips, coalesce(sum(amount),0)::float AS amount, max(at) AS last FROM bands.tips WHERE kind='tip' GROUP BY slug`)).rows) o[r.slug] = { tips: r.tips, amount: Math.round(r.amount * 100) / 100, last: r.last }; return o; },
  };
}
const DB_OK = u => /^postgres(ql)?:\/\/[^\s]+@[^\s/]+\/\S+$/.test(u || "");
async function sharedDbUrl() {
  // My Apps hands out the shared database to the apps it manages (SHARED_DB_APPS on that service).
  // Keep asking for a couple of minutes: right after a deploy My Apps may still be coming up.
  if (!MYAPPS.url || !MYAPPS.secret) return "";
  for (let i = 0; i < 24; i++) {
    try {
      const r = await fetch(MYAPPS.url + "/api/v1/shared-db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: MYAPPS.slug, secret: MYAPPS.secret }), signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && DB_OK(j.url)) return j.url;
      console.error("My Apps shared database: " + (j.error || "HTTP " + r.status) + " (trying again)");
    } catch (e) { console.error("My Apps unreachable for the database: " + e.message + " (trying again)"); }
    await new Promise(r => setTimeout(r, 5000));
  }
  return "";
}
async function openDb() {
  let url = (process.env.DATABASE_URL || "").trim();
  if (url && !DB_OK(url)) { console.error(`DATABASE_URL doesn't look like a Postgres link (it should start with postgresql://). Ignoring it.`); url = ""; }
  const wanted = !!(url || (MYAPPS.url && MYAPPS.secret));   // a database was configured one way or the other
  if (!url) url = await sharedDbUrl();
  if (url) {
    const d = pgDb(url);
    try { await d.init(); console.log("Database ready" + (process.env.DATABASE_URL ? "" : " (shared, from My Apps)")); return d; }
    catch (e) { console.error("Database failed: " + e.message); }
  }
  // Running without a database would quietly lose every band on the next restart, so when one was
  // configured and can't be reached we stop here and let Render restart us (the last good deploy stays up).
  if (wanted && process.env.ALLOW_MEMORY !== "1") { console.error("No database available. Stopping so this doesn't run on memory. Check SHARED_DB_APPS / APP_SECRET_BANDS on My Apps, or set DATABASE_URL."); process.exit(1); }
  console.error("No database: running in memory. Bands and tips will be lost on restart.");
  return memoryDb();
}

/* ---------- bands (tenants) ---------- */
const tenantCache = new Map();
async function loadTenant(slug) {
  const c = tenantCache.get(slug);
  if (c && Date.now() - c.at < 30000) return c.t;
  const t = await db.getTenant(slug); tenantCache.set(slug, { t, at: Date.now() }); return t;
}
async function saveTenant(t) { t.v = (t.v || 0) + 1; await db.saveTenant(t); tenantCache.delete(t.slug); }

const PAY_KEYS = ["venmo", "cashapp", "paypal", "zelle", "apple"];
const PAY_NAMES = { venmo: "Venmo", cashapp: "Cash App", paypal: "PayPal", zelle: "Zelle", apple: "Apple Cash" };
function cleanPay(b) {
  b = b || {}; const o = {};
  const ven = String(b.venmo || "").trim().replace(/^@/, "").replace(/^https?:\/\/(account\.)?venmo\.com\/(u\/)?/i, "").replace(/\/.*$/, "");
  if (ven) { if (!/^[A-Za-z0-9_-]{2,30}$/.test(ven)) throw new Error("Venmo username looks wrong. Example: @The-Rockers"); o.venmo = ven; }
  const cash = String(b.cashapp || "").trim().replace(/^https?:\/\/cash\.app\//i, "").replace(/^\$/, "").replace(/\/.*$/, "");
  if (cash) { if (!/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(cash)) throw new Error("Cash App tag looks wrong. Example: $TheRockers"); o.cashapp = cash; }
  const pp = String(b.paypal || "").trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
  if (pp) { if (!/^[A-Za-z0-9]{1,20}$/.test(pp)) throw new Error("PayPal.me name looks wrong. Example: TheRockers"); o.paypal = pp; }
  const contact = (v, label) => {
    v = String(v || "").trim(); if (!v) return null;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 80) return v.toLowerCase();
    const p = normPhone(v); if (p) return p;
    throw new Error(label + " needs the phone number or email it's set up with.");
  };
  const z = contact(b.zelle, "Zelle"); if (z) o.zelle = z;
  const a = contact(b.apple, "Apple Cash"); if (a) o.apple = a;
  return o;
}
const SOCIAL = {
  instagram: { name: "Instagram", url: h => "https://instagram.com/" + h, clean: v => handle(v, /instagram\.com\//i, /^[A-Za-z0-9._]{1,30}$/) },
  tiktok: { name: "TikTok", url: h => "https://tiktok.com/@" + h, clean: v => handle(v, /tiktok\.com\/@?/i, /^[A-Za-z0-9._]{1,30}$/) },
  facebook: { name: "Facebook", url: h => /^https?:/.test(h) ? h : "https://facebook.com/" + h, clean: v => urlOr(v, /facebook\.com\//i, /^[A-Za-z0-9.\-]{1,60}$/) },
  youtube: { name: "YouTube", url: h => /^https?:/.test(h) ? h : "https://youtube.com/" + (h.startsWith("@") ? h : "@" + h), clean: v => urlOr(v, /youtube\.com\//i, /^@?[A-Za-z0-9._\-]{1,40}$/) },
  spotify: { name: "Spotify", url: h => h, clean: v => fullUrl(v, /^https:\/\/open\.spotify\.com\//i, "a Spotify artist link (open.spotify.com/artist/…)") },
  applemusic: { name: "Apple Music", url: h => h, clean: v => fullUrl(v, /^https:\/\/music\.apple\.com\//i, "an Apple Music link (music.apple.com/…)") },
  website: { name: "Website", url: h => h, clean: v => fullUrl(v, /^https?:\/\/[^\s/]+\.[^\s/]+/i, "a full web address (https://…)") },
};
function handle(v, strip, re) { v = String(v || "").trim().replace(strip, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/^@/, "").replace(/[/?#].*$/, ""); if (!v) return ""; if (!re.test(v)) throw new Error("That handle looks wrong."); return v; }
function urlOr(v, strip, re) { v = String(v || "").trim(); if (!v) return ""; if (/^https?:\/\//i.test(v)) { if (v.length > 200 || /[\s"'<>]/.test(v)) throw new Error("That link looks wrong."); return v; } v = v.replace(strip, "").replace(/^@/, "").replace(/[/?#].*$/, ""); if (!re.test(v)) throw new Error("That handle looks wrong."); return v; }
function fullUrl(v, re, what) { v = String(v || "").trim(); if (!v) return ""; if (!/^https?:\/\//i.test(v)) v = "https://" + v; if (v.length > 300 || /[\s"'<>]/.test(v) || !re.test(v)) throw new Error("Use " + what + "."); return v; }

function cleanBandFields(b, t) {
  if (b.name !== undefined) { const n = cleanName(b.name, 50); if (!n) return "Enter the band's name."; t.name = n; }
  if (b.tagline !== undefined) t.tagline = cleanName(b.tagline, 90);
  if (b.tonight !== undefined) t.tonight = cleanName(b.tonight, 80);
  if (b.thanks !== undefined) t.thanks = cleanName(b.thanks, 140);
  if (b.email !== undefined) { const e = clean(b.email, 120).toLowerCase(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return "That email doesn't look right."; t.email = e; }
  if (b.accent !== undefined) { const a = String(b.accent || "").trim(); if (a && !/^#[0-9a-fA-F]{6}$/.test(a)) return "Pick a color."; t.accent = a; }
  if (b.tz !== undefined) { const z = String(b.tz || "").trim(); try { if (z) new Intl.DateTimeFormat("en-US", { timeZone: z }); t.tz = z; } catch (e) { return "That time zone isn't right."; } }
  if (b.notes !== undefined) t.notes = b.notes !== false && b.notes !== "off";
  if (b.amounts !== undefined) {
    const l = [...new Set((Array.isArray(b.amounts) ? b.amounts : String(b.amounts).split(/[,\s]+/)).map(x => Math.round(Number(String(x).replace(/[$]/g, "")))).filter(x => x >= 1 && x <= 500))].slice(0, 5);
    if (!l.length) return "Give at least one tip amount, like 5, 10, 20.";
    t.amounts = l;
  }
  if (b.pay !== undefined) { try { t.pay = cleanPay(b.pay); } catch (e) { return e.message; } }
  if (b.social !== undefined) {
    const o = {};
    for (const k of Object.keys(SOCIAL)) { try { const v = SOCIAL[k].clean((b.social || {})[k]); if (v) o[k] = v; } catch (e) { return SOCIAL[k].name + ": " + e.message; } }
    t.social = o;
  }
  if (b.logo !== undefined) {
    if (!b.logo) t.logo = "";
    else if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo) && b.logo.length < 600000) t.logo = b.logo;
    else return "That logo didn't work. Try a PNG or JPG under 400 KB.";
  }
  return null;
}

/* ---------- plan: is this band's page on? ---------- */
function planSummary(t) {
  if (t.disabled) return { active: false, label: "Turned off by " + COMPANY };
  const s = t.stripe || {};
  if (["active", "trialing", "past_due"].includes(s.status)) return { active: true, paid: true, label: "Paid monthly", status: s.status };
  const p = t.plan || {};
  if (p.plan === "pro" && !p.expires_on) return { active: true, label: "Active" + (p.source === "manual" ? " (set by " + COMPANY + ")" : "") };
  if (p.plan === "pro" && p.expires_on >= today()) {
    const left = Math.max(0, Math.round((new Date(p.expires_on) - new Date(today())) / 864e5));
    return { active: true, trial: p.source === "trial", code: p.source === "code", expires_on: p.expires_on, days_left: left,
      label: (p.source === "trial" ? "Free trial" : p.source === "code" ? "Active (code)" : "Active") + " · " + left + " day" + (left === 1 ? "" : "s") + " left" };
  }
  return { active: false, ended: !!p.expires_on, label: p.source === "trial" ? "Free trial ended" : "Not active" };
}
async function myApps(pathname, body) {
  if (!MYAPPS.url || !MYAPPS.secret) return null;
  try {
    const r = await fetch(MYAPPS.url + pathname, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: MYAPPS.slug, secret: MYAPPS.secret, ...body }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return { httpOk: r.ok, ...j };
  } catch (e) { console.error("My Apps unreachable:", e.message); return null; }
}
const tkey = slug => "band:" + slug;
// pick up changes made in the My Apps manager office (extend, cancel…) in the background
const planChecked = new Map();
function refreshPlan(t) {
  if (!MYAPPS.url || Date.now() - (planChecked.get(t.slug) || 0) < 10 * 60000) return;
  planChecked.set(t.slug, Date.now());
  myApps("/api/v1/plan", { tenant: tkey(t.slug) }).then(async j => {
    if (!j || !j.ok) return;
    const fresh = await db.getTenant(t.slug); if (!fresh) return;
    const p = { plan: j.plan, expires_on: j.expires_on ? String(j.expires_on).slice(0, 10) : null, source: j.source || null };
    const cur = fresh.plan || {};
    if (JSON.stringify(p) !== JSON.stringify({ plan: cur.plan, expires_on: cur.expires_on || null, source: cur.source || null })) { fresh.plan = p; await saveTenant(fresh); }
  }).catch(() => {});
}

/* ---------- "tonight": a band's day runs 6 AM to 6 AM in their time zone ---------- */
function tonightStart(tz) {
  const now = new Date();
  let parts;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Chicago", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now).map(p => [p.type, p.value])); }
  catch (e) { parts = { hour: String(now.getHours()), minute: String(now.getMinutes()) }; }
  let m = ((Number(parts.hour) % 24) * 60 + Number(parts.minute)) - 360; if (m < 0) m += 1440;
  return new Date(now.getTime() - m * 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
}

/* ---------- Stripe (card payments for the monthly plan) — needs no npm package ---------- */
async function stripeApi(pathname, form) {
  const r = await fetch("https://api.stripe.com/v1/" + pathname, { method: "POST", headers: { Authorization: "Bearer " + STRIPE.key, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Stripe error " + r.status);
  return j;
}
function stripeSigOk(raw, header) {
  if (!STRIPE.wh || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map(x => x.split("=")).filter(x => x.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header).split(",").filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  if (!parts.t || !sigs.length || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const want = crypto.createHmac("sha256", STRIPE.wh).update(parts.t + "." + raw).digest("hex");
  return sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}
app.post("/api/stripe/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const raw = req.body ? req.body.toString("utf8") : "";
  if (!stripeSigOk(raw, req.headers["stripe-signature"])) return res.status(400).send("bad signature");
  let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).send("bad json"); }
  try {
    const o = ev.data && ev.data.object || {};
    const slug = (o.metadata && o.metadata.tenant) || o.client_reference_id;
    const t = slug && await db.getTenant(slug);
    if (t) {
      if (ev.type === "checkout.session.completed") t.stripe = { customer: o.customer, sub: o.subscription, status: "active" };
      else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) t.stripe = { ...(t.stripe || {}), customer: o.customer, sub: o.id, status: ev.type.endsWith("deleted") ? "canceled" : o.status };
      await saveTenant(t);
      const on = ["active", "trialing", "past_due"].includes(t.stripe.status);
      myApps("/api/v1/tenant-paid", { tenant: tkey(t.slug), tenantName: t.name, active: on });
      console.log(`Stripe: ${t.name} subscription ${t.stripe.status}`);
    }
  } catch (e) { console.error("webhook:", e.message); }
  res.json({ received: true });
});

app.use(["/api/start", "/api/setup"], express.json({ limit: "1mb" }));   // logos
app.use(express.json({ limit: "20kb" }));

/* ---------- pages ---------- */
const pageCache = new Map();
function pageFile(name) {
  if (!pageCache.has(name)) pageCache.set(name, fs.readFileSync(path.join(__dirname, name), "utf8"));
  return pageCache.get(name);
}
// {{KEY}} in a page becomes the escaped value; {{{KEY}}} is put in as-is (for JSON we built ourselves)
function fill(html, vars) {
  return html.replace(/\{\{\{(\w+)\}\}\}/g, (m, k) => (vars[k] ?? "")).replace(/\{\{(\w+)\}\}/g, (m, k) => esc(vars[k] ?? ""));
}
const baseVars = req => ({ PRODUCT, COMPANY, SUPPORT, PRICE: PRICE_TEXT, TRIAL_DAYS: String(TRIAL_DAYS), SITE: siteUrl(req), HOST: siteUrl(req).replace(/^https?:\/\//, "") });
const simplePage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#0c0b10;color:#f1eef7;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box;text-align:center}main{max-width:420px}h1{font-size:26px;margin:16px 0 6px}p{color:#a8a3b8;line-height:1.5}a{color:#ffb347}</style></head><body><main>${body}</main></body></html>`;
function sendHtml(res, html) { res.type("html").set("Cache-Control", "no-cache").send(html); }

app.get("/health", (req, res) => res.type("text").send("ok"));
app.get(["/", "/start"], (req, res) => sendHtml(res, fill(pageFile("start.html"), baseVars(req))));
app.get("/terms", (req, res) => sendHtml(res, fill(pageFile("terms.html"), { ...baseVars(req), TERMS_V })));
app.get("/default-logo.png", (req, res) => res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(__dirname, "default-logo.png")));
app.get("/favicon.ico", (req, res) => res.redirect(301, "/default-logo.png"));

// public shape of a band: what the fan page needs, nothing private
function fanView(t, req) {
  const plan = planSummary(t), pay = t.pay || {};
  return { slug: t.slug, name: t.name, tagline: t.tagline || "", tonight: t.tonight || "", thanks: t.thanks || "", accent: t.accent || "", v: t.v || 0,
    active: plan.active, paused: !plan.active, amounts: t.amounts && t.amounts.length ? t.amounts : [5, 10, 20], notes: t.notes !== false,
    pay: PAY_KEYS.filter(k => pay[k]).map(k => ({ key: k, name: PAY_NAMES[k] })),
    social: Object.keys(SOCIAL).filter(k => (t.social || {})[k]).map(k => ({ key: k, name: SOCIAL[k].name, url: SOCIAL[k].url((t.social || {})[k]) })),
    logo: siteUrl(req) + "/" + t.slug + "/logo.png?v=" + (t.v || 0), url: siteUrl(req) + "/" + t.slug, product: PRODUCT };
}
app.param("slug", async (req, res, next, slug) => {
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || RESERVED.has(slug)) return next("route");
  try { const t = await loadTenant(slug); if (!t) return next("route"); req.band = t; refreshPlan(t); next(); }
  catch (e) { console.error(e); res.status(500).type("html").send(simplePage("Error", "<h1>Something went wrong</h1><p>Try again in a moment.</p>")); }
});
app.get("/:slug", (req, res) => {
  const t = req.band, v = fanView(t, req);
  sendHtml(res, fill(pageFile("fan.html"), { ...baseVars(req), NAME: t.name, TAGLINE: t.tagline || "Tip the band and follow us", SLUG: t.slug, LOGO: v.logo, URL: v.url, ACCENT: t.accent || "#ffb347", BAND_JSON: JSON.stringify(v).replace(/</g, "\\u003c") }));
});
app.get("/:slug/setup", (req, res) => sendHtml(res, fill(pageFile("setup.html"), { ...baseVars(req), NAME: req.band.name, SLUG: req.band.slug })));
app.get("/:slug/logo.png", (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(req.band.logo || "");
  if (!m) return res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "default-logo.png"));
  res.type(m[1]).set("Cache-Control", "public, max-age=300").send(Buffer.from(m[2], "base64"));
});
async function qrSvg(req, slug, dark) {
  return QRCode.toString(siteUrl(req) + "/" + slug + "?qr=1", { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: dark || "#0c0b10", light: "#ffffff" } });
}
app.get("/:slug/qr.svg", wrap(async (req, res) => { res.type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(await qrSvg(req, req.band.slug)); }));
app.get("/:slug/poster", wrap(async (req, res) => {
  const t = req.band, pay = PAY_KEYS.filter(k => (t.pay || {})[k]).map(k => PAY_NAMES[k]);
  sendHtml(res, fill(pageFile("poster.html"), { ...baseVars(req), NAME: t.name, TAGLINE: t.tagline || "", SLUG: t.slug, URL: siteUrl(req).replace(/^https?:\/\//, "") + "/" + t.slug,
    LOGO: "/" + t.slug + "/logo.png?v=" + (t.v || 0), PAY: pay.join(" · "), ACCENT: t.accent || "#ffb347", QR: await qrSvg(req, t.slug) }));
}));
app.get("/:slug/api", (req, res) => res.json(fanView(req.band, req)));

/* ---------- fans: tips and shout-outs ---------- */
function device(req, res) {
  let d = (req.headers.cookie || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === "bt_device");
  d = d && /^[a-f0-9]{32}$/.test(d[1]) ? d[1] : null;
  if (!d) { d = crypto.randomBytes(16).toString("hex"); res.append("Set-Cookie", `bt_device=${d}; Path=/; Max-Age=63072000; SameSite=Lax` + (req.secure ? "; Secure" : "")); }
  return d;
}
app.post("/:slug/api/tip", wrap(async (req, res) => {
  const t = req.band, d = device(req, res), b = req.body || {};
  if (!planSummary(t).active) return res.status(402).json({ error: "This band's tip page is paused right now." });
  if (limited("tip", d, 8, 600e3) || limited("tipip", req.ip, 80, 600e3)) return res.status(429).json({ error: "That's a lot of tips! Wait a few minutes." });
  const method = String(b.method || ""), to = (t.pay || {})[method];
  if (!PAY_KEYS.includes(method) || !to) return res.status(400).json({ error: "Pick how you want to pay." });
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount >= 1 && amount <= 500)) return res.status(400).json({ error: "Tip between $1 and $500." });
  const name = cleanName(b.name, 30), note = clean(b.note, 140);
  await db.addTip({ slug: t.slug, kind: "tip", amount, method, name, note, device: d });
  res.json({ ok: true, to, amount, method, name: PAY_NAMES[method] });
}));
app.post("/:slug/api/note", wrap(async (req, res) => {
  const t = req.band, d = device(req, res), b = req.body || {};
  if (!planSummary(t).active) return res.status(402).json({ error: "This band's page is paused right now." });
  if (t.notes === false) return res.status(400).json({ error: "This band isn't taking messages right now." });
  if (limited("note", d, 6, 600e3) || limited("noteip", req.ip, 60, 600e3)) return res.status(429).json({ error: "Slow down a little." });
  const name = cleanName(b.name, 30), note = clean(b.note, 140);
  if (!note) return res.status(400).json({ error: "Type your message first." });
  await db.addTip({ slug: t.slug, kind: "note", amount: 0, method: "", name, note, device: d });
  res.json({ ok: true });
}));

/* ---------- sign up a band (/start) ---------- */
app.get("/api/start/check", wrap(async (req, res) => {
  const slug = slugify(req.query.slug);
  if (slug.length < 3) return res.json({ ok: false, slug, error: "Use at least 3 letters or numbers." });
  if (RESERVED.has(slug) || await db.getTenant(slug)) return res.json({ ok: false, slug, error: "That web name is taken. Try another." });
  res.json({ ok: true, slug });
}));
app.post("/api/start", wrap(async (req, res) => {
  if (limited("start", req.ip, 5, 3600e3)) return res.status(429).json({ error: "Too many sign-ups from here. Try again in an hour." });
  const b = req.body || {};
  const name = cleanName(b.name, 50); if (!name) return res.status(400).json({ error: "Enter the band's name." });
  const slug = slugify(b.slug || name);
  if (slug.length < 3) return res.status(400).json({ error: "Pick a web name with at least 3 letters or numbers." });
  if (RESERVED.has(slug) || await db.getTenant(slug)) return res.status(409).json({ error: "That web name is taken. Try another." });
  const email = clean(b.email, 120).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a good email address." });
  const pin = String(b.pin || "").replace(/\D/g, ""); if (pin.length < 4 || pin.length > 8) return res.status(400).json({ error: "Pick a PIN of 4 to 8 digits." });
  if (b.agree !== true) return res.status(400).json({ error: "Check the box to agree to the service terms." });
  const t = { slug, name, email, pinHash: hashPin(pin), amounts: [5, 10, 20], notes: true, pay: {}, social: {}, plan: null, created: new Date().toISOString(), agreedAt: new Date().toISOString(), agreedIp: req.ip, termsV: TERMS_V };
  const err = cleanBandFields({ ...b, name: undefined, email: undefined }, t); if (err) return res.status(400).json({ error: err });
  // plan: a code from My Apps, otherwise the free trial
  let note = "";
  const code = clean(b.code, 40).toUpperCase();
  if (code) {
    const j = await myApps("/api/v1/redeem-tenant", { tenant: tkey(slug), tenantName: name, code });
    if (!j) return res.status(503).json({ error: "We couldn't check the code right now. Try again, or leave the code blank to start the free trial." });
    if (!j.ok) return res.status(400).json({ error: j.error || "That code didn't work." });
    t.plan = { plan: "pro", expires_on: j.expires_on ? String(j.expires_on).slice(0, 10) : null, source: "code" }; note = "Code applied: " + j.days + " days.";
  } else {
    const j = await myApps("/api/v1/trial", { tenant: tkey(slug), tenantName: name, days: TRIAL_DAYS });
    t.plan = j && j.ok && j.plan === "pro" ? { plan: "pro", expires_on: String(j.expires_on).slice(0, 10), source: j.source || "trial" } : { plan: "pro", expires_on: addDays(TRIAL_DAYS), source: "trial" };
    note = "Your " + TRIAL_DAYS + "-day free trial has started.";
  }
  await saveTenant(t);
  console.log(`New band: ${name} (/${slug})`);
  res.json({ ok: true, slug, url: siteUrl(req) + "/" + slug, note, plan: planSummary(t) });
}));

/* ---------- the band's own page (/<band>/setup) ---------- */
async function ownerAuth(req, res) {
  if (limited("pin", req.ip, 20, 600e3)) { res.status(429).json({ error: "Too many wrong PINs. Wait 10 minutes." }); return null; }
  const fresh = await db.getTenant(req.band.slug);
  if (!fresh || !pinMatches(String(req.headers["x-band-pin"] || ""), fresh.pinHash)) { res.status(401).json({ error: "Wrong PIN." }); return null; }
  hits.get("pin:" + req.ip).pop();   // a right PIN doesn't count against them
  return fresh;
}
async function ownerView(t, req) {
  const since = tonightStart(t.tz), feed = await db.tipsSince(t.slug, since);
  const tonight = await db.tipTotals(t.slug, since), ever = await db.tipTotals(t.slug, null);
  const byMethod = {}; for (const r of feed) if (r.kind === "tip") byMethod[r.method] = Math.round(((byMethod[r.method] || 0) + Number(r.amount)) * 100) / 100;
  return { slug: t.slug, name: t.name, tagline: t.tagline || "", tonight: t.tonight || "", thanks: t.thanks || "", email: t.email || "", accent: t.accent || "", tz: t.tz || "America/Chicago",
    amounts: t.amounts && t.amounts.length ? t.amounts : [5, 10, 20], notes: t.notes !== false, pay: t.pay || {}, social: t.social || {}, logo: t.logo || "", hasLogo: !!t.logo, v: t.v || 0,
    plan: planSummary(t), price: PRICE_TEXT, cardReady: !!(STRIPE.key && STRIPE.price), paid: !!(t.stripe && t.stripe.customer), product: PRODUCT, company: COMPANY, support: SUPPORT,
    links: { page: siteUrl(req) + "/" + t.slug, poster: siteUrl(req) + "/" + t.slug + "/poster", qr: siteUrl(req) + "/" + t.slug + "/qr.svg", setup: siteUrl(req) + "/" + t.slug + "/setup" },
    feed: feed.map(r => ({ id: r.id, at: r.at, kind: r.kind, amount: Number(r.amount), method: r.method, methodName: PAY_NAMES[r.method] || r.method, name: r.name, note: r.note })),
    totals: { tonight, ever, byMethod, notesTonight: feed.filter(r => r.kind === "note").length } };
}
app.post("/:slug/api/me", wrap(async (req, res) => { const t = await ownerAuth(req, res); if (t) res.json(await ownerView(t, req)); }));
app.post("/:slug/api/save", wrap(async (req, res) => {
  const t = await ownerAuth(req, res); if (!t) return;
  const b = req.body || {};
  const err = cleanBandFields(b, t); if (err) return res.status(400).json({ error: err });
  if (b.newPin) { const p = String(b.newPin).replace(/\D/g, ""); if (p.length < 4 || p.length > 8) return res.status(400).json({ error: "New PIN must be 4 to 8 digits." }); t.pinHash = hashPin(p); }
  await saveTenant(t); res.json({ ok: true, ...(await ownerView(t, req)) });
}));
app.post("/:slug/api/code", wrap(async (req, res) => {
  const t = await ownerAuth(req, res); if (!t) return;
  const code = clean((req.body || {}).code, 40).toUpperCase(); if (!code) return res.status(400).json({ error: "Enter the code." });
  const j = await myApps("/api/v1/redeem-tenant", { tenant: tkey(t.slug), tenantName: t.name, code });
  if (!j) return res.status(503).json({ error: "We couldn't check the code right now. Try again in a minute." });
  if (!j.ok) return res.status(400).json({ error: j.error || "That code didn't work." });
  t.plan = { plan: "pro", expires_on: j.expires_on ? String(j.expires_on).slice(0, 10) : null, source: "code" }; await saveTenant(t);
  res.json({ ok: true, message: "Code applied: " + j.days + " days added.", ...(await ownerView(t, req)) });
}));
app.post("/:slug/api/checkout", wrap(async (req, res) => {
  const t = await ownerAuth(req, res); if (!t) return;
  if (!STRIPE.key || !STRIPE.price) return res.status(400).json({ error: "Card payments aren't turned on yet. Ask " + COMPANY + " for a code." });
  const back = siteUrl(req) + "/" + t.slug + "/setup";
  const form = { mode: "subscription", "line_items[0][price]": STRIPE.price, "line_items[0][quantity]": "1", success_url: back + "?paid=1", cancel_url: back,
    client_reference_id: t.slug, "metadata[tenant]": t.slug, "subscription_data[metadata][tenant]": t.slug, allow_promotion_codes: "true" };
  if (t.stripe && t.stripe.customer) form.customer = t.stripe.customer; else if (t.email) form.customer_email = t.email;
  try { const s = await stripeApi("checkout/sessions", form); res.json({ url: s.url }); }
  catch (e) { console.error("checkout:", e.message); res.status(502).json({ error: "Card checkout isn't working right now: " + e.message }); }
}));
app.post("/:slug/api/portal", wrap(async (req, res) => {
  const t = await ownerAuth(req, res); if (!t) return;
  if (!STRIPE.key || !(t.stripe && t.stripe.customer)) return res.status(400).json({ error: "There's no card subscription to manage yet." });
  try { const s = await stripeApi("billing_portal/sessions", { customer: t.stripe.customer, return_url: siteUrl(req) + "/" + t.slug + "/setup" }); res.json({ url: s.url }); }
  catch (e) { res.status(502).json({ error: "Billing page isn't working right now: " + e.message }); }
}));

/* ---------- for My Apps (the manager office): list and manage bands ---------- */
function platformAuth(req, res) {
  const k = String(req.headers["x-platform-key"] || "");
  if (!PLATFORM_KEY || k.length !== PLATFORM_KEY.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(PLATFORM_KEY))) { res.status(401).json({ error: "Wrong platform key." }); return false; }
  return true;
}
app.get("/api/platform/bands", wrap(async (req, res) => {
  if (!platformAuth(req, res)) return;
  const [list, counts] = [await db.listTenants(), await db.tipCounts()];
  res.json({ bands: list.map(t => ({ slug: t.slug, key: tkey(t.slug), name: t.name, email: t.email || "", created: t.created || t.created_at,
    tips: (counts[t.slug] || {}).tips || 0, tipped: (counts[t.slug] || {}).amount || 0, lastTip: (counts[t.slug] || {}).last || null,
    payMethods: PAY_KEYS.filter(k => (t.pay || {})[k]).length, socials: Object.keys(t.social || {}).length, plan: planSummary(t), disabled: !!t.disabled,
    url: siteUrl(req) + "/" + t.slug, setup: siteUrl(req) + "/" + t.slug + "/setup", poster: siteUrl(req) + "/" + t.slug + "/poster" })),
    signup: siteUrl(req) + "/start", product: PRODUCT, price: PRICE_TEXT });
}));
app.post("/api/platform/bands/:slug", wrap(async (req, res) => {
  if (!platformAuth(req, res)) return;
  const t = await db.getTenant(req.params.slug); if (!t) return res.status(404).json({ error: "No such band." });
  const b = req.body || {};
  if (b.action === "disable") t.disabled = true;
  else if (b.action === "enable") t.disabled = false;
  else if (b.action === "pin") { const p = String(b.pin || "").replace(/\D/g, ""); if (p.length < 4 || p.length > 8) return res.status(400).json({ error: "PIN must be 4 to 8 digits." }); t.pinHash = hashPin(p); }
  else if (b.action === "plan") { t.plan = { plan: b.plan === "pro" ? "pro" : "free", expires_on: b.expires_on ? String(b.expires_on).slice(0, 10) : null, source: b.source || "manual" }; }
  else return res.status(400).json({ error: "Unknown action." });
  await saveTenant(t); planChecked.delete(t.slug); res.json({ ok: true, plan: planSummary(t) });
}));

app.use((req, res) => {
  if (req.path.startsWith("/api/") || /\/api\//.test(req.path)) return res.status(404).json({ error: "Not found." });
  res.status(404).type("html").send(simplePage("Not found", `<h1>We couldn't find that band</h1><p>Check the link, or scan the band's QR code again.</p><p><a href="/">${esc(PRODUCT)}</a></p>`));
});

openDb().then(d => {
  db = d;
  app.listen(PORT, () => console.log(`${PRODUCT} listening on ${PORT} (${db.kind}${MYAPPS.url ? ", My Apps: " + MYAPPS.url : ", no My Apps"})`));
});
