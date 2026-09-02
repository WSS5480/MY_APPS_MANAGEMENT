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

/* A plan belongs to the tenant that bought it, not to a person.
 * A law firm buys ServeTrack; a school buys the Scheduler. Whoever happens to
 * be the administrator that week is beside the point, and keying the plan to
 * their email was the reason billing never lined up across the apps.
 *
 * tenant_key is the app's own id for the thing that pays, namespaced so two
 * apps cannot collide: "company:3", "school:7". */
CREATE TABLE IF NOT EXISTS ma_tenant_plans (
  id           SERIAL PRIMARY KEY,
  app_id       INTEGER NOT NULL REFERENCES ma_apps(id) ON DELETE CASCADE,
  tenant_key   TEXT NOT NULL,
  tenant_name  TEXT,
  plan         TEXT NOT NULL DEFAULT 'free',  -- free | pro
  source       TEXT NOT NULL DEFAULT 'manual', -- code | stripe | manual
  expires_on   DATE,                           -- null on a paid plan = no expiry
  note         TEXT DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, tenant_key)
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

/* Forgotten passwords. The token itself is never stored — only its hash — so
 * a copy of this table is not a set of working reset links. One use, one hour,
 * and asking again invalidates whatever was sent before. */
CREATE TABLE IF NOT EXISTS ma_password_resets (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ma_resets_email_idx ON ma_password_resets (email);
`;

const DEFAULT_APPS = [
  ['servetrack', 'SRV', 'ServeTrack', 'https://servetrack.onrender.com'],
  ['scheduler', 'SCH', 'After School Scheduler', 'https://intalsoft-scheduler.onrender.com'],
  ['dealengine', 'DEA', 'Deal Finder', 'https://deal-finder-z4ms.onrender.com']
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

  /* Names and addresses follow this file, so a moved app (Deal Finder used to
     be a static site at another address) corrects itself on the next deploy. */
  for (const [slug, , name, url] of DEFAULT_APPS) {
    await q('UPDATE ma_apps SET name=$1, url=$2 WHERE slug=$3 AND (name<>$1 OR url<>$2)',
      [name, url, slug]);
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

  // Days add to whatever is left, for the same reason as the tenant version
  // below: an extension must never shorten what somebody already had.
  const { rows: had } = await q(
    'SELECT plan, expires_on FROM ma_subscriptions WHERE app_id=$1 AND account=$2', [app.id, account]);
  const now = new Date(new Date().toDateString());
  const runsTo = had[0] && had[0].plan === 'pro' && had[0].expires_on
    ? new Date(had[0].expires_on) : null;
  const expires = new Date(runsTo && runsTo > now ? runsTo : now);
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

/* --------------------------------------------------- forgotten passwords --- */
/* Sending mail needs no dependency: Resend takes an ordinary HTTPS POST, and
   Node has fetch. If no key is configured the reset still works — the link is
   handed back to the caller instead of being emailed, which is what lets the
   owner read it out to someone over the phone. What must never happen is the
   link going to the browser of whoever typed the email address, so the caller
   here is always a server, never a page. */
const MAIL_KEY = process.env.RESEND_KEY || '';
const MAIL_FROM = process.env.EMAIL_FROM || '';
const mailEnabled = () => Boolean(MAIL_KEY && MAIL_FROM);

async function sendMail({ to, subject, html }) {
  if (!mailEnabled()) return { sent: false, reason: 'no mail service configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MAIL_KEY },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error(`Reset email to ${to} refused (${r.status}): ${detail.slice(0, 200)}`);
      return { sent: false, reason: 'the mail service refused it' };
    }
    return { sent: true };
  } catch (e) {
    console.error(`Reset email to ${to} failed: ${e.message}`);
    return { sent: false, reason: 'the mail service could not be reached' };
  }
}

const RESET_MINUTES = 60;
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

const resetEmailHtml = (name, link) => `
<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#101822">
  <p>Hello${name ? ' ' + escapeHtml(name) : ''},</p>
  <p>Someone asked to reset the password for this account. If that was you, use
     the link below within the next hour:</p>
  <p><a href="${link}" style="display:inline-block;background:#F2660D;color:#fff;
     text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">Choose a new password</a></p>
  <p style="color:#5A6A80;font-size:13px">The link works once and then stops working.
     If you did not ask for this, you can ignore this message — nothing has changed.</p>
</div>`;

const escapeHtml = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* "I forgot my password."
 *
 * Always answers the same way, whether or not the address is one we know. An
 * endpoint that says "no such account" is a way to find out who has an account
 * here, and this one is reachable without signing in. */
async function requestReset({ email, appName, baseUrl }) {
  const mail = String(email || '').trim().toLowerCase();
  const answer = { ok: true, mail_configured: mailEnabled() };
  if (!EMAIL_RE.test(mail)) return answer;

  const { rows } = await q('SELECT id, name, active FROM ma_users WHERE email=$1', [mail]);
  const u = rows[0];
  if (!u || !u.active) return answer;

  /* Three an hour. Enough for someone who mistypes their address twice, not
     enough to use this service as a way to send mail to somebody. */
  const { rows: recent } = await q(
    "SELECT count(*)::int n FROM ma_password_resets WHERE email=$1 AND requested_at > NOW() - INTERVAL '1 hour'",
    [mail]);
  if (recent[0].n >= 3) return Object.assign({ throttled: true }, answer);

  // A new request retires the older ones, so only the newest link works.
  await q('UPDATE ma_password_resets SET used_at=NOW() WHERE email=$1 AND used_at IS NULL', [mail]);

  const token = crypto.randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO ma_password_resets (email, token_hash, expires_at)
     VALUES ($1,$2, NOW() + ($3 || ' minutes')::interval)`,
    [mail, hashToken(token), String(RESET_MINUTES)]);

  const base = String(baseUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const link = `${base}/reset?token=${token}`;
  const out = await sendMail({
    to: mail,
    subject: `Reset your ${appName || 'account'} password`,
    html: resetEmailHtml(u.name, link)
  });
  console.log(`Password reset requested for ${mail} — ${out.sent ? 'emailed' : 'not emailed: ' + out.reason}`);
  return Object.assign({ sent: out.sent, link: out.sent ? undefined : link }, answer);
}

/* Spend a reset token. Single use is enforced by the row, not by trusting the
   caller: the update only touches a row that is still unused and unexpired, so
   two simultaneous attempts cannot both win. */
async function resetWithToken({ token, newPassword }) {
  if (String(newPassword || '').length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }
  const { rows } = await q(
    `UPDATE ma_password_resets SET used_at=NOW()
      WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING email`,
    [hashToken(token)]);
  if (!rows.length) {
    return { ok: false, status: 400,
             error: 'That link has expired or has already been used. Ask for a new one.' };
  }
  const mail = rows[0].email;
  await q('UPDATE ma_users SET pw=$1 WHERE email=$2', [hashPassword(newPassword), mail]);
  console.log(`Password reset completed for ${mail}`);
  return { ok: true, email: mail };
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

/* ------------------------------------------------------------ tenants --- */
/* Every school and every company, across every app, in one list.
 *
 * The apps share this database, so their tables are readable from here. That is
 * a deliberate trade: the operator console is coupled to the apps' shapes, and
 * in exchange there is one screen instead of one per app. Each read is wrapped
 * on its own — an app whose tables do not exist yet (a fresh database, an app
 * not deployed) simply contributes nothing rather than breaking the page.
 */

const TENANT_SOURCES = [
  {
    slug: 'servetrack', label: 'Company', prefix: 'company',
    sql: `SELECT c.id, c.name,
            to_char(c.created_at,'YYYY-MM-DD') AS created,
            (SELECT count(*)::int FROM users u WHERE u.company_id=c.id AND u.active) AS people,
            (SELECT count(*)::int FROM jobs j WHERE j.company_id=c.id) AS work,
            (SELECT u.email FROM users u WHERE u.company_id=c.id AND u.role='admin'
             ORDER BY u.id LIMIT 1) AS admin_email,
            (SELECT u.name FROM users u WHERE u.company_id=c.id AND u.role='admin'
             ORDER BY u.id LIMIT 1) AS admin_name
          FROM public.companies c ORDER BY c.id`,
    workLabel: 'jobs'
  },
  {
    slug: 'scheduler', label: 'School', prefix: 'school',
    sql: `SELECT s.id, s.name, left(s.created,10) AS created,
            (SELECT count(*)::int FROM scheduler.users u
              WHERE u.school_id=s.id AND u.status='approved') AS people,
            (SELECT count(*)::int FROM scheduler.programs p WHERE p.school_id=s.id) AS work,
            (SELECT u.email FROM scheduler.users u WHERE u.school_id=s.id AND u.role='admin'
             ORDER BY u.id LIMIT 1) AS admin_email,
            (SELECT u.name FROM scheduler.users u WHERE u.school_id=s.id AND u.role='admin'
             ORDER BY u.id LIMIT 1) AS admin_name
          FROM scheduler.schools s ORDER BY s.id`,
    workLabel: 'programs'
  },
];

async function tenants() {
  const { rows: apps } = await q('SELECT id, slug, name, prefix FROM ma_apps');
  const bySlug = Object.fromEntries(apps.map(a => [a.slug, a]));
  const { rows: plans } = await q('SELECT * FROM ma_tenant_plans');
  const planFor = (appId, key) => plans.find(p => p.app_id === appId && p.tenant_key === key);

  const out = [];
  const problems = [];
  for (const src of TENANT_SOURCES) {
    const app = bySlug[src.slug];
    if (!app) continue;
    let rows;
    try { ({ rows } = await q(src.sql)); }
    catch (e) { problems.push(`${src.slug}: ${e.message}`); continue; }
    for (const r of rows) {
      const key = `${src.prefix}:${r.id}`;
      const p = planFor(app.id, key) || {};
      out.push({
        app: app.slug, appName: app.name, prefix: app.prefix,
        kind: src.label, key, id: r.id, name: r.name,
        created: r.created, people: r.people, work: r.work, workLabel: src.workLabel,
        adminEmail: r.admin_email, adminName: r.admin_name,
        plan: p.plan || 'free', expires_on: p.expires_on || null,
        source: p.source || null, note: p.note || '',
      });
    }
  }
  out.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return { tenants: out, problems };
}

/* ------------------------------------------------------- support inbox --- */
/* When a customer inside one of the apps asks for help, the message lands in
 * that app's own table. The apps share this database, so the messages can be
 * read from here — which is the whole point of having one place to manage.
 *
 * Same trade as the tenant list above, and the same protection: each source is
 * read on its own, so an app that has no such table yet contributes nothing
 * instead of emptying the inbox.
 */
const SUPPORT_SOURCES = [
  {
    slug: 'scheduler', label: 'School',
    sql: `SELECT m.id, m.message, m.status, m.created,
            s.name AS tenant, s.slug AS tenant_slug,
            u.name AS from_name, u.email AS from_email
          FROM scheduler.support_messages m
          LEFT JOIN scheduler.schools s ON s.id = m.school_id
          LEFT JOIN scheduler.users   u ON u.id = m.user_id
          ORDER BY (m.status='open') DESC, m.created DESC LIMIT 100`,
    close: 'UPDATE scheduler.support_messages SET status=$1 WHERE id=$2'
  },
];

async function supportInbox() {
  const out = [];
  const problems = [];
  for (const src of SUPPORT_SOURCES) {
    let rows;
    try { ({ rows } = await q(src.sql)); }
    catch (e) { problems.push(`${src.slug}: ${e.message}`); continue; }
    for (const r of rows) {
      out.push({
        app: src.slug, kind: src.label, id: r.id,
        message: r.message, status: r.status || 'open',
        created: r.created ? String(r.created).slice(0, 16) : '',
        tenant: r.tenant || '—', tenantSlug: r.tenant_slug || '',
        fromName: r.from_name || '', fromEmail: r.from_email || ''
      });
    }
  }
  out.sort((a, b) => (a.status === b.status ? String(b.created).localeCompare(String(a.created))
                                            : a.status === 'open' ? -1 : 1));
  return { messages: out, open: out.filter(m => m.status === 'open').length, problems };
}

async function closeSupport(appSlug, id, reopen) {
  const src = SUPPORT_SOURCES.find(s => s.slug === appSlug);
  if (!src) throw new Error('No support inbox for ' + appSlug);
  await q(src.close, [reopen ? 'open' : 'closed', Number(id)]);
  return true;
}

/* ------------------------------------------------------------- health --- */
/* The checklist the Scheduler's own console used to show, for this service
   instead: what is configured, what is still on a default, and what that
   means in practice. Nothing here reveals a secret — only whether one is set. */
function healthChecks() {
  const set = v => Boolean(v && String(v).trim());
  const secretish = process.env.CODE_SECRET || '';
  return [
    { key: 'DATABASE_URL', label: 'Database',
      ok: set(connectionString),
      warn: 'Not set — no customers, plans or accounts can be stored.' },
    { key: 'APP_PASSWORD', label: 'Password for this console',
      ok: set(process.env.APP_PASSWORD),
      warn: 'Not set — nobody can sign in here, including you.' },
    { key: 'CODE_SECRET', label: 'Code signing key',
      ok: secretish.length >= 16,
      warn: secretish ? 'Shorter than 16 characters — codes are easier to forge.'
                      : 'Not set — upgrade codes cannot be generated or checked.' },
    { key: 'RESEND_KEY', label: 'Email (password resets)',
      ok: mailEnabled(),
      warn: 'Not set — people who forget a password have to ask you to reset it.' },
    { key: 'OWNER_EMAIL', label: 'Owner account',
      ok: set(process.env.OWNER_EMAIL),
      warn: 'Not set — no account is marked as the owner of every app.' },
    { key: 'PUBLIC_URL', label: 'Public address',
      ok: set(process.env.PUBLIC_URL),
      warn: 'Not set — reset links are built from the address of the request, which is usually right but not always.' },
    { key: 'TRIAL_DAYS', label: 'Free trial',
      ok: true,
      note: `${TRIAL_DAYS} days for every new customer.` },
  ];
}

/* Send a test email to prove the mail settings work before relying on them. */
async function testEmail(to) {
  const mail = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return { ok: false, error: 'Enter a valid email address' };
  if (!mailEnabled()) {
    return { ok: false, error: 'No mail service is configured — set RESEND_KEY and EMAIL_FROM.' };
  }
  const out = await sendMail({
    to: mail,
    subject: 'My Apps — test message',
    html: `<div style="font:15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif">
      <p>This is a test from My Apps. If you are reading it, password reset
         emails will reach your customers.</p></div>`
  });
  return out.sent ? { ok: true } : { ok: false, error: 'Could not send it — ' + out.reason };
}

/* What the operator is shown at a glance: who is new, whose trial is nearly up.
   Deliberately short — a list of twenty things nobody reads is not an alert. */
function tenantAlerts(list) {
  const day = 864e5;
  const weekAgo = new Date(Date.now() - 7 * day).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const alerts = [];
  for (const t of list) {
    if (t.created && t.created >= weekAgo) {
      alerts.push({ level: 'info', when: t.created,
        text: `New ${t.kind.toLowerCase()}: ${t.name} on ${t.appName}` +
              (t.adminEmail ? ` — ${t.adminEmail}` : '') });
    }
    if (t.plan === 'pro' && t.expires_on) {
      const on = String(t.expires_on).slice(0, 10);
      if (on < today) {
        alerts.push({ level: 'bad', when: on,
          text: `Trial expired ${on}: ${t.name} (${t.appName}) has dropped to free` });
      } else if (on <= in7) {
        alerts.push({ level: 'warn', when: on,
          text: `Trial ends ${on}: ${t.name} (${t.appName}) — worth a call` });
      }
    }
  }
  alerts.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  return alerts.slice(0, 20);
}

function tenantKpis(list) {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const live = t => t.plan === 'pro' && (!t.expires_on || String(t.expires_on).slice(0, 10) >= today);
  return {
    total: list.length,
    newWeek: list.filter(t => t.created && t.created >= weekAgo).length,
    paid: list.filter(t => live(t) && !t.expires_on).length,
    trials: list.filter(t => live(t) && t.expires_on).length,
    free: list.filter(t => !live(t)).length,
    people: list.reduce((a, t) => a + Number(t.people || 0), 0),
  };
}

/* ------------------------------------------------------------- trials --- */
/* Every new customer gets the whole app for a month, no code and no card.
 *
 * The trial is recorded as a pro plan with an end date and source 'trial', so
 * everything downstream — the expiry sweep, the console, the app's own plan
 * check — already knows what to do with it. Nothing new to teach them.
 *
 * It starts once. The row's existence is the proof: an app calls this on every
 * sign-in because it cannot know whether it is the first, and a tenant that
 * already has any plan row is left exactly as it is. That is also what stops a
 * customer restarting the clock by signing out and back in.                  */
const TRIAL_DAYS = Math.max(0, Number(process.env.TRIAL_DAYS || 30));

const daysLeft = expiresOn => {
  if (!expiresOn) return null;
  const end = new Date(expiresOn);
  const today = new Date(new Date().toDateString());
  return Math.max(0, Math.round((end - today) / 86400000));
};

async function startTrial({ slug, secret, tenant, tenantName }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;
  const key = String(tenant || '').trim();
  if (!key) return { ok: false, status: 400, error: 'No tenant given' };
  if (!TRIAL_DAYS) return { ok: true, started: false, plan: 'free', expires_on: null, days_left: null };

  const end = new Date();
  end.setDate(end.getDate() + TRIAL_DAYS);
  const expiresOn = end.toISOString().slice(0, 10);

  /* DO NOTHING on conflict is the whole guarantee. A second call returns no
     rows, and the plan already on file is what gets reported back. */
  const { rows } = await q(
    `INSERT INTO ma_tenant_plans (app_id, tenant_key, tenant_name, plan, source, expires_on, note)
     VALUES ($1,$2,$3,'pro','trial',$4,'free trial')
     ON CONFLICT (app_id, tenant_key) DO NOTHING
     RETURNING *`,
    [app.id, key, tenantName || null, expiresOn]);

  if (rows.length) {
    console.log(`Trial started: ${tenantName || key} on ${app.name} — ${TRIAL_DAYS} days, until ${expiresOn}`);
    return { ok: true, started: true, plan: 'pro', source: 'trial',
             expires_on: expiresOn, days_left: TRIAL_DAYS, trial: true };
  }
  const current = await tenantPlan({ slug, secret, tenant: key });
  return Object.assign({ started: false }, current);
}

/* Set a tenant's plan by hand. `days` gives a trial that expires; leaving it
   out on a pro plan means a paid subscription with no end date. */
async function setTenantPlan({ slug, tenantKey, tenantName, plan, days, note }) {
  const { rows: a } = await q('SELECT id FROM ma_apps WHERE slug=$1', [slug]);
  if (!a.length) throw new Error('No such app: ' + slug);
  let expires = null;
  if (plan === 'pro' && Number(days) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days));
    expires = d.toISOString().slice(0, 10);
  }
  const { rows } = await q(
    `INSERT INTO ma_tenant_plans (app_id, tenant_key, tenant_name, plan, source, expires_on, note)
     VALUES ($1,$2,$3,$4,'manual',$5,$6)
     ON CONFLICT (app_id, tenant_key) DO UPDATE
       SET plan=EXCLUDED.plan, source='manual', expires_on=EXCLUDED.expires_on,
           tenant_name=COALESCE(EXCLUDED.tenant_name, ma_tenant_plans.tenant_name),
           note=EXCLUDED.note, updated_at=NOW()
     RETURNING *`,
    [a[0].id, tenantKey, tenantName || null, plan === 'pro' ? 'pro' : 'free', expires, note || '']);
  return rows[0];
}

/* What an app asks for: "what plan is this tenant on?" Expired trials fall back
   to free here, so an app never has to work that out for itself. */
async function tenantPlan({ slug, secret, tenant }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;
  const key = String(tenant || '').trim();
  if (!key) return { ok: false, status: 400, error: 'No tenant given' };

  const { rows } = await q(
    'SELECT * FROM ma_tenant_plans WHERE app_id=$1 AND tenant_key=$2', [app.id, key]);
  const s = rows[0];
  if (!s) return { ok: true, plan: 'free', expires_on: null, source: null, days_left: null, trial: false };
  if (s.plan === 'pro' && s.expires_on &&
      new Date(s.expires_on) < new Date(new Date().toDateString())) {
    /* The plan lapses but the source is kept, so the app can say "your trial
       has ended" rather than the colder "you are on the free plan". */
    await q("UPDATE ma_tenant_plans SET plan='free', updated_at=NOW() WHERE id=$1", [s.id]);
    return { ok: true, plan: 'free', expires_on: s.expires_on, source: s.source,
             days_left: 0, trial: s.source === 'trial', note: 'expired',
             trial_over: s.source === 'trial' };
  }
  return { ok: true, plan: s.plan, expires_on: s.expires_on, source: s.source,
           days_left: s.plan === 'pro' ? daysLeft(s.expires_on) : null,
           trial: s.plan === 'pro' && s.source === 'trial' };
}

/* Redeeming a code against a tenant rather than a person. Same signed codes,
   same one-use guarantee — what changes is who ends up holding the plan. */
async function redeemForTenant({ slug, secret, tenant, tenantName, code }) {
  const { app, error } = await appFromCredentials(slug, secret);
  if (error) return error;
  const key = String(tenant || '').trim();
  if (!key) return { ok: false, status: 400, error: 'No tenant given' };

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

  /* Days are added to whatever is left, not counted from today.
   *
   * Handing someone a month while they still have twelve days of trial should
   * leave them forty-two, not thirty. Counted from today, a generous gesture
   * would quietly take ten days off them — which is the opposite of what
   * anyone means by giving out an extension.
   *
   * A plan already paid for with no end date has nothing to add to, so it is
   * left alone and the code is refused rather than silently spent. */
  const { rows: held } = await q(
    'SELECT plan, expires_on FROM ma_tenant_plans WHERE app_id=$1 AND tenant_key=$2', [app.id, key]);
  const current = held[0];
  if (current && current.plan === 'pro' && !current.expires_on) {
    return { ok: false, status: 409,
             error: 'This account is already on a paid plan with no end date — the code has not been used.' };
  }

  const today = new Date(new Date().toDateString());
  const standing = current && current.plan === 'pro' && current.expires_on
    ? new Date(current.expires_on) : null;
  const from = standing && standing > today ? standing : today;
  const expires = new Date(from);
  expires.setDate(expires.getDate() + parsed.days);
  const expiresOn = expires.toISOString().slice(0, 10);
  const added = standing && standing > today;

  try {
    await q(`INSERT INTO ma_redemptions (code, app_id, account, days, expires_on)
             VALUES ($1,$2,$3,$4,$5)`, [parsed.code, app.id, key, parsed.days, expiresOn]);
  } catch (e) {
    if (e.code === '23505') return { ok: false, status: 410, error: 'That code has already been used' };
    throw e;
  }

  await q(`INSERT INTO ma_tenant_plans (app_id, tenant_key, tenant_name, plan, source, expires_on)
           VALUES ($1,$2,$3,'pro','code',$4)
           ON CONFLICT (app_id, tenant_key) DO UPDATE
             SET plan='pro', source='code', expires_on=EXCLUDED.expires_on,
                 tenant_name=COALESCE(EXCLUDED.tenant_name, ma_tenant_plans.tenant_name),
                 updated_at=NOW()`,
    [app.id, key, tenantName || null, expiresOn]);

  return { ok: true, plan: 'pro', days: parsed.days, expires_on: expiresOn,
           days_left: daysLeft(expiresOn), added_to_existing: !!added, app: app.slug };
}

module.exports = {
  init, q, pool, listApps, issue, listSubscriptions, listRedemptions,
  redeem, status, revokeCode, setPlan, applyStripe, mintCode, parseCode, sign,
  register, login, changePassword, adminSetPassword, listUsers, setUserPassword, toggleUser,
  createUser, setUserRole,
  tenants, tenantAlerts, tenantKpis, setTenantPlan, tenantPlan, redeemForTenant,
  startTrial, TRIAL_DAYS, daysLeft,
  supportInbox, closeSupport, healthChecks, testEmail,
  requestReset, resetWithToken, mailEnabled,
  hashPassword, checkPassword
};
