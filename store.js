/* Subscriptions for every app, in one place.
 *
 * The code scheme follows the one already proven in the After School Scheduler:
 * a code is SIGNED rather than stored. Its signature is an HMAC of the app, the
 * duration and a nonce, so the server can verify a code it has never seen. That
 * means codes can be minted in bulk offline, nothing accumulates in the database
 * until someone actually uses one, and a code cannot be guessed without the
 * secret. Only redemptions are recorded, to stop a code being spent twice.
 *
 * Plans carry their own expiry. Every read checks it and drops the account back
 * to free when the day passes, so nothing has to sweep up afterwards.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;
const CODE_SECRET = process.env.CODE_SECRET || '';

const pool = connectionString ? new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: 4
}) : null;

const q = (text, params) => {
  if (!pool) throw new Error('DATABASE_URL is not set on this service');
  return pool.query(text, params);
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ma_apps (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,                 -- 2-4 letters that start its codes
  name       TEXT NOT NULL,
  url        TEXT,
  secret     TEXT NOT NULL,                 -- the app proves itself with this
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only redemptions are stored. Issued codes are not, by design.
CREATE TABLE IF NOT EXISTS ma_redemptions (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  app_id      INTEGER REFERENCES ma_apps(id) ON DELETE SET NULL,
  account     TEXT,                          -- email or tenant the app supplied
  days        INTEGER,
  expires_on  DATE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Who is currently on what, across every app.
CREATE TABLE IF NOT EXISTS ma_subscriptions (
  id           SERIAL PRIMARY KEY,
  app_id       INTEGER NOT NULL REFERENCES ma_apps(id) ON DELETE CASCADE,
  account      TEXT NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'free',  -- free | pro
  source       TEXT NOT NULL DEFAULT 'code',  -- code | stripe | manual
  expires_on   DATE,                          -- null = no expiry (paid)
  stripe_sub   TEXT DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, account)
);

CREATE TABLE IF NOT EXISTS ma_revoked_codes (
  code       TEXT PRIMARY KEY,
  reason     TEXT,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const DEFAULT_APPS = [
  ['servetrack', 'SRV', 'ServeTrack', 'https://servetrack.onrender.com'],
  ['scheduler', 'SCH', 'After School Scheduler', 'https://after-school-scheduler.onrender.com'],
  ['dealengine', 'DEA', 'Deal Engine', 'https://deal-engine-app.onrender.com']
];

async function init() {
  if (!pool) { console.log('WARNING: DATABASE_URL not set — subscriptions disabled.'); return false; }
  await q(SCHEMA);
  const { rows } = await q('SELECT count(*)::int n FROM ma_apps');
  if (!rows[0].n) {
    for (const [slug, prefix, name, url] of DEFAULT_APPS) {
      await q('INSERT INTO ma_apps (slug,prefix,name,url,secret) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING',
        [slug, prefix, name, url, crypto.randomBytes(24).toString('hex')]);
    }
    console.log('Seeded app registry.');
  }
  if (!CODE_SECRET) console.log('WARNING: CODE_SECRET not set — codes cannot be issued or verified.');
  return true;
}

/* ------------------------------------------------------------- codes --- */

const NONCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O, no 1/I

function sign(prefix, days, nonce) {
  if (!CODE_SECRET) throw new Error('CODE_SECRET is not set');
  return crypto.createHmac('sha256', CODE_SECRET)
    .update(`${prefix.toUpperCase()}|${days}|${nonce.toUpperCase()}`)
    .digest('hex').slice(0, 6).toUpperCase();
}

// PREFIX-30D-NONCE-SIGNATURE, e.g. SRV-30D-K7QP-A1B2C3
function mintCode(prefix, days) {
  const nonce = Array.from(crypto.randomBytes(4))
    .map(b => NONCE_ALPHABET[b % NONCE_ALPHABET.length]).join('');
  return `${prefix.toUpperCase()}-${days}D-${nonce}-${sign(prefix, days, nonce)}`;
}

const CODE_RE = /^([A-Z]{2,4})-(\d{1,4})D-([A-Z0-9]{4,12})-([A-F0-9]{6})$/;

function parseCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  const m = code.match(CODE_RE);
  if (!m) return null;
  const [, prefix, days, nonce, sig] = m;
  return { code, prefix, days: Number(days), nonce, sig };
}

/* -------------------------------------------------------- redemption --- */

async function redeem({ slug, secret, code, account }) {
  const { rows: ar } = await q('SELECT * FROM ma_apps WHERE slug=$1', [String(slug || '')]);
  const app = ar[0];
  if (!app || !app.active) return { ok: false, status: 404, error: 'Unknown app' };
  if (app.secret !== secret) return { ok: false, status: 403, error: 'Bad app secret' };
  if (!account) return { ok: false, status: 400, error: 'No account supplied' };

  const parsed = parseCode(code);
  if (!parsed) return { ok: false, status: 400, error: 'That code is not valid' };
  if (parsed.prefix !== String(app.prefix).toUpperCase()) {
    return { ok: false, status: 403, error: 'That code is for a different app' };
  }
  let expected;
  try { expected = sign(parsed.prefix, parsed.days, parsed.nonce); }
  catch (e) { return { ok: false, status: 500, error: e.message }; }
  if (expected !== parsed.sig) return { ok: false, status: 400, error: 'That code is not valid' };

  const { rows: rev } = await q('SELECT 1 FROM ma_revoked_codes WHERE code=$1', [parsed.code]);
  if (rev.length) return { ok: false, status: 410, error: 'That code has been revoked' };

  const expires = new Date();
  expires.setDate(expires.getDate() + parsed.days);
  const expiresOn = expires.toISOString().slice(0, 10);

  // The unique index on code is what actually prevents a second redemption,
  // so two simultaneous attempts cannot both succeed.
  try {
    await q(`INSERT INTO ma_redemptions (code, app_id, account, days, expires_on)
             VALUES ($1,$2,$3,$4,$5)`, [parsed.code, app.id, account, parsed.days, expiresOn]);
  } catch (e) {
    if (e.code === '23505') return { ok: false, status: 410, error: 'That code has already been used' };
    throw e;
  }

  await q(`INSERT INTO ma_subscriptions (app_id, account, plan, source, expires_on)
           VALUES ($1,$2,'pro','code',$3)
           ON CONFLICT (app_id, account) DO UPDATE
             SET plan='pro', source='code', expires_on=EXCLUDED.expires_on, updated_at=NOW()`,
    [app.id, account, expiresOn]);

  return { ok: true, plan: 'pro', days: parsed.days, expires_on: expiresOn, app: app.slug };
}

/* Current standing for one account. Expired plans fall back to free here, so
   no scheduled job is needed to tidy them up. */
async function status({ slug, secret, account }) {
  const { rows: ar } = await q('SELECT * FROM ma_apps WHERE slug=$1', [String(slug || '')]);
  const app = ar[0];
  if (!app || !app.active) return { ok: false, status: 404, error: 'Unknown app' };
  if (app.secret !== secret) return { ok: false, status: 403, error: 'Bad app secret' };

  const { rows } = await q('SELECT * FROM ma_subscriptions WHERE app_id=$1 AND account=$2', [app.id, account]);
  const s = rows[0];
  if (!s) return { ok: true, plan: 'free', expires_on: null, source: null };

  if (s.plan === 'pro' && s.expires_on && new Date(s.expires_on) < new Date(new Date().toDateString())) {
    await q("UPDATE ma_subscriptions SET plan='free', expires_on=NULL, updated_at=NOW() WHERE id=$1", [s.id]);
    return { ok: true, plan: 'free', expires_on: null, source: s.source, note: 'expired' };
  }
  return { ok: true, plan: s.plan, expires_on: s.expires_on, source: s.source };
}

/* ------------------------------------------------------------ admin --- */

const listApps = async () => (await q('SELECT * FROM ma_apps ORDER BY name')).rows;

async function issue(appId, days, count) {
  const { rows } = await q('SELECT * FROM ma_apps WHERE id=$1', [appId]);
  const app = rows[0];
  if (!app) throw new Error('Unknown app');
  const n = Math.min(100, Math.max(1, Number(count) || 1));
  const d = Math.min(3650, Math.max(1, Number(days) || 30));
  return { app, codes: Array.from({ length: n }, () => mintCode(app.prefix, d)) };
}

async function listSubscriptions() {
  const { rows } = await q(`
    SELECT s.*, a.name AS app_name, a.slug AS app_slug
    FROM ma_subscriptions s JOIN ma_apps a ON a.id = s.app_id
    ORDER BY s.updated_at DESC LIMIT 300`);
  const today = new Date(new Date().toDateString());
  return rows.map(s => Object.assign(s, {
    state: s.plan !== 'pro' ? 'Free'
      : (s.expires_on && new Date(s.expires_on) < today ? 'Expired' : 'Pro')
  }));
}

const listRedemptions = async () => (await q(`
  SELECT r.*, a.name AS app_name FROM ma_redemptions r
  LEFT JOIN ma_apps a ON a.id = r.app_id ORDER BY r.redeemed_at DESC LIMIT 200`)).rows;

const revokeCode = async (code, reason) =>
  q('INSERT INTO ma_revoked_codes (code, reason) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING',
    [String(code || '').trim().toUpperCase(), reason || null]);

async function setPlan(appId, account, plan, expiresOn) {
  await q(`INSERT INTO ma_subscriptions (app_id, account, plan, source, expires_on)
           VALUES ($1,$2,$3,'manual',$4)
           ON CONFLICT (app_id, account) DO UPDATE
             SET plan=EXCLUDED.plan, source='manual', expires_on=EXCLUDED.expires_on, updated_at=NOW()`,
    [appId, account, plan, expiresOn || null]);
}

/* Stripe told us someone paid (or stopped paying). */
async function applyStripe({ appSlug, account, subscriptionId, active }) {
  const { rows } = await q('SELECT id FROM ma_apps WHERE slug=$1', [appSlug]);
  if (!rows.length) return false;
  const appId = rows[0].id;
  if (active) {
    await q(`INSERT INTO ma_subscriptions (app_id, account, plan, source, expires_on, stripe_sub)
             VALUES ($1,$2,'pro','stripe',NULL,$3)
             ON CONFLICT (app_id, account) DO UPDATE
               SET plan='pro', source='stripe', expires_on=NULL,
                   stripe_sub=EXCLUDED.stripe_sub, updated_at=NOW()`,
      [appId, account, subscriptionId || '']);
  } else {
    await q(`UPDATE ma_subscriptions SET plan='free', expires_on=NULL, updated_at=NOW()
             WHERE stripe_sub=$1`, [subscriptionId || '']);
  }
  return true;
}

module.exports = {
  init, q, pool, listApps, issue, listSubscriptions, listRedemptions,
  redeem, status, revokeCode, setPlan, applyStripe, mintCode, parseCode, sign
};
