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

-- One account, usable in every app. Apps never store passwords.
CREATE TABLE IF NOT EXISTS ma_users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  pw         TEXT NOT NULL,                 -- scrypt: salt:hash
  role       TEXT NOT NULL DEFAULT 'user',  -- owner | user
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ
);

-- for accounts created before roles existed
ALTER TABLE ma_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

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

  /* An app's secret can also be set from the environment: APP_SECRET_SERVETRACK
     and so on. That is what makes it possible to configure both ends without
     anybody copying a long hex string off a web page onto a phone — the same
     value goes into this service and into the app that uses it. Set here, it
     wins; leave it unset and whatever is already stored stays. */
  for (const [slug] of DEFAULT_APPS) {
    const supplied = process.env['APP_SECRET_' + slug.toUpperCase()];
    if (!supplied || supplied.length < 16) continue;
    const { rows: changed } = await q(
      'UPDATE ma_apps SET secret=$1 WHERE slug=$2 AND secret<>$1 RETURNING slug', [supplied, slug]);
    if (changed.length) console.log(`App secret for ${slug} taken from the environment.`);
  }

  /* OWNER_EMAIL names the person who owns all of this. Their account is the
     owner everywhere, in every app, and setting it here means it survives a
     database that gets rebuilt. It only marks an account that already exists —
     it never creates one, and never sets a password. */
  const owner = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner) {
    const { rows: made } = await q(
      "UPDATE ma_users SET role='owner' WHERE email=$1 AND role<>'owner' RETURNING email", [owner]);
    if (made.length) console.log(`${owner} is now the owner.`);
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


/* ------------------------------------------------------------- accounts --- */
/* scrypt from Node's own crypto: no dependency, and deliberately slow to brute
   force. Format is salt:hash so the salt travels with the hash. */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  let candidate;
  try { candidate = crypto.scryptSync(String(plain), salt, 64).toString('hex'); }
  catch (e) { return false; }
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function appFromCredentials(slug, secret) {
  const { rows } = await q('SELECT * FROM ma_apps WHERE slug=$1', [String(slug || '')]);
  const app = rows[0];
  if (!app || !app.active) return { error: { ok: false, status: 404, error: 'Unknown app' } };
  if (app.secret !== secret) return { error: { ok: false, status: 403, error: 'Bad app secret' } };
  return { app };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function planFor(appId, account) {
  const { rows } = await q('SELECT * FROM ma_subscriptions WHERE app_id=$1 AND account=$2', [appId, account]);
  const s = rows[0];
  if (!s) return { plan: 'free', expires_on: null, source: null };
  if (s.plan === 'pro' && s.expires_on && new Date(s.expires_on) < new Date(new Date().toDateString())) {
    await q("UPDATE ma_subscriptions SET plan='free', expires_on=NULL, updated_at=NOW() WHERE id=$1", [s.id]);
    return { plan: 'free', expires_on: null, source: s.source };
  }
  return { plan: s.plan, expires_on: s.expires_on, source: s.source };
}

/* Register an account. A code can be supplied at the same time so someone can
   sign up and be on Pro in a single step. */
async function register({ slug, secret, email, password, name, code }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;

  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return { ok: false, status: 400, error: 'Enter a valid email address' };
  if (String(password || '').length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };

  const { rows: existing } = await q('SELECT id FROM ma_users WHERE email=$1', [mail]);
  if (existing.length) return { ok: false, status: 409, error: 'An account already uses that email — sign in instead' };

  const { rows } = await q(
    'INSERT INTO ma_users (email, name, pw) VALUES ($1,$2,$3) RETURNING id, email, name',
    [mail, String(name || '').trim(), hashPassword(password)]);
  const user = rows[0];

  let redeemed = null;
  if (code) {
    const r = await redeem({ slug, secret, code, account: mail });
    if (!r.ok) return { ok: true, status: 200, user, plan: 'free', expires_on: null, codeError: r.error };
    redeemed = r;
  }
  const p = redeemed ? { plan: 'pro', expires_on: redeemed.expires_on } : await planFor(app.id, mail);
  return { ok: true, user, role: 'user', plan: p.plan, expires_on: p.expires_on };
}

/* Verify a sign-in. Apps call this instead of holding passwords themselves. */
async function login({ slug, secret, email, password }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;

  const mail = String(email || '').trim().toLowerCase();
  const { rows } = await q('SELECT * FROM ma_users WHERE email=$1', [mail]);
  const u = rows[0];
  // Same message either way, so this cannot be used to discover which emails
  // exist. `known` and `suspended` ride alongside for the app's own benefit —
  // an app had to present its secret to ask, and must not pass them to the
  // browser. They are what let an app tell "no such account here, use your own
  // records" apart from "that password is wrong".
  if (!u || !u.active || !checkPassword(password, u.pw)) {
    return {
      ok: false, status: 401, error: 'Wrong email or password',
      known: !!u, suspended: !!(u && !u.active)
    };
  }
  await q('UPDATE ma_users SET last_seen=NOW() WHERE id=$1', [u.id]);
  const p = await planFor(app.id, mail);
  /* `role` is the whole point of one sign-in: the owner is the owner in every
     app, and each app maps that onto whatever it calls an administrator. */
  return {
    ok: true, user: { id: u.id, email: u.email, name: u.name },
    role: u.role || 'user', plan: p.plan, expires_on: p.expires_on
  };
}

async function changePassword({ slug, secret, email, oldPassword, newPassword }) {
  const { error } = await appFromCredentials(slug, secret);
  if (error) return error;
  if (String(newPassword || '').length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  const mail = String(email || '').trim().toLowerCase();
  const { rows } = await q('SELECT * FROM ma_users WHERE email=$1', [mail]);
  const u = rows[0];
  if (!u || !checkPassword(oldPassword, u.pw)) {
    return { ok: false, status: 401, error: 'Current password is wrong', known: !!u };
  }
  await q('UPDATE ma_users SET pw=$1 WHERE id=$2', [hashPassword(newPassword), u.id]);
  return { ok: true };
}

/* An app resetting a password on someone's behalf — the "I forgot mine" case,
   handled by the owner from inside whichever app is to hand.
 *
 * This is a real privilege: it needs only the app secret, and it changes the
 * password for every app at once. It is here because one person owns all of
 * these apps and would otherwise have to come to My Apps to do it. Every use is
 * logged. If an app secret ever leaks, rotate it in ma_apps and in that app's
 * environment, and this power goes with it. */
async function adminSetPassword({ slug, secret, email, newPassword }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;
  if (String(newPassword || '').length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }
  const mail = String(email || '').trim().toLowerCase();
  const { rows } = await q('UPDATE ma_users SET pw=$1 WHERE email=$2 RETURNING email',
    [hashPassword(newPassword), mail]);
  if (!rows.length) return { ok: false, status: 404, error: 'No central account uses that email', known: false };
  console.log(`ADMIN PASSWORD RESET: ${mail} reset via ${app.name}`);
  return { ok: true };
}

/* Create an account from the owner console. This is how the first owner comes
   into being, and how somebody is added without waiting for them to sign up. */
async function createUser({ email, name, password, role }) {
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) throw new Error('Enter a valid email address');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters');
  const { rows: taken } = await q('SELECT 1 FROM ma_users WHERE email=$1', [mail]);
  if (taken.length) throw new Error('An account already uses ' + mail);
  const { rows } = await q(
    'INSERT INTO ma_users (email, name, pw, role) VALUES ($1,$2,$3,$4) RETURNING email, role',
    [mail, String(name || '').trim(), hashPassword(password), role === 'owner' ? 'owner' : 'user']);
  console.log(`Account created: ${mail} (${rows[0].role})`);
  return rows[0];
}

/* The owner is the owner in every app. Making someone an owner here makes them
   an administrator everywhere, so it is a deliberate act with a log line. */
async function setUserRole(email, role) {
  const { rows } = await q('UPDATE ma_users SET role=$1 WHERE email=$2 RETURNING email, role',
    [role === 'owner' ? 'owner' : 'user', String(email || '').trim().toLowerCase()]);
  if (rows.length) console.log(`${rows[0].email} is now ${rows[0].role === 'owner' ? 'an owner' : 'an ordinary user'}.`);
  return rows[0] || null;
}

const listUsers = async () => (await q(`
  SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.last_seen,
    (SELECT json_agg(json_build_object('app', a.name, 'plan', s.plan, 'expires_on', s.expires_on))
     FROM ma_subscriptions s JOIN ma_apps a ON a.id = s.app_id WHERE s.account = u.email) AS plans
  FROM ma_users u ORDER BY u.created_at DESC LIMIT 300`)).rows;

async function setUserPassword(email, plain) {
  if (String(plain || '').length < 8) throw new Error('Password must be at least 8 characters');
  const { rows } = await q('UPDATE ma_users SET pw=$1 WHERE email=$2 RETURNING email',
    [hashPassword(plain), String(email || '').trim().toLowerCase()]);
  return rows.length > 0;
}

/* Suspending an account locks it out of every app at once, without deleting
   anything — restoring it puts things back exactly as they were. */
async function toggleUser(email) {
  const { rows } = await q('UPDATE ma_users SET active = NOT active WHERE email=$1 RETURNING email, active',
    [String(email || '').trim().toLowerCase()]);
  return rows[0] || null;
}

module.exports = {
  init, q, pool, listApps, issue, listSubscriptions, listRedemptions,
  redeem, status, revokeCode, setPlan, applyStripe, mintCode, parseCode, sign,
  register, login, changePassword, adminSetPassword, listUsers, setUserPassword, toggleUser,
  createUser, setUserRole,
  hashPassword, checkPassword
};
