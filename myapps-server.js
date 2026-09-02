/* My Apps — a control panel for every service running on Render.
 *
 * Deliberately dependency-free: it runs on Node's own http module and global
 * fetch. Nothing to npm-install means nothing to break on deploy, and the whole
 * thing stays one readable file.
 *
 * It holds a Render API key, so it is password-gated and the key is never sent
 * to the browser.
 */

const http = require('http');
const crypto = require('crypto');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const BUILD = '2026-09-02.9';
const PASSWORD = process.env.APP_PASSWORD || '';
const RENDER_KEY = process.env.RENDER_API_KEY || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const CACHE_MS = 60_000;

/* ------------------------------------------------------------- pricing --- */
/* Render's API reports a plan name, not a price. These are list prices in USD
   per month as a guide only -- they drift, so the UI says "approx". */
const PRICES = {
  free: 0, starter: 7, standard: 25, pro: 85, pro_plus: 175, pro_max: 225, pro_ultra: 450,
  basic_256mb: 6, basic_1gb: 19, basic_4gb: 45,
  pro_4gb: 95, pro_8gb: 135, pro_16gb: 225, pro_32gb: 425, pro_64gb: 795,
  accelerated_16gb: 450, accelerated_32gb: 850
};
const priceOf = plan => (plan in PRICES ? PRICES[plan] : null);

/* ---------------------------------------------------------- render api --- */

// Overridable so the dashboard can be tested against a stand-in API.
const API_BASE = process.env.RENDER_API_BASE || 'https://api.render.com/v1';

async function render(path) {
  if (!RENDER_KEY) throw new Error('RENDER_API_KEY is not set on this service');
  const res = await fetch(API_BASE + path, {
    headers: { Authorization: 'Bearer ' + RENDER_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Render API ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Render API returned non-JSON on ' + path); }
}

// The list endpoints wrap each row: [{ cursor, service: {...} }]
const unwrap = (rows, key) => (Array.isArray(rows) ? rows : []).map(r => r[key] || r).filter(Boolean);

let cache = { at: 0, data: null, error: null };

/* Hosting figures come from Render's API: a list of services, a list of
 * databases, and then one call per service for its last deploy. On a good day
 * that is a second. On a bad one — Render slow, or this service just woken from
 * a free-plan nap with a cold connection — it is a minute of serial requests.
 *
 * The console must not wait for it either way. Everything that matters here —
 * customers, plans, trials, support — comes from the database, which is fast
 * and always reachable. Hosting is the least important panel on the page and
 * was the one thing capable of making the whole thing hang, or come back blank
 * when the browser gave up first.
 *
 * So: the page is drawn from whatever was last collected, and a refresh runs in
 * the background. One at a time, and never awaited by a request.            */
let refreshing = null;

function refreshHosting() {
  if (refreshing) return refreshing;
  refreshing = collect()
    .then(d => { cache.error = null; return d; })
    .catch(e => {
      cache.error = e.message;
      console.error('collect failed:', e.message);
      return null;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/* What the page gets: instant, always. Stale is fine and says so; empty is
   fine and says that too. */
function hostingNow() {
  const stale = !cache.data || Date.now() - cache.at >= CACHE_MS;
  if (stale && RENDER_KEY) refreshHosting();          // fire and forget
  /* "Loading" only until the first attempt has finished. After that, if it
     failed and there is still nothing to show, say what went wrong rather than
     leaving somebody watching a message that will never change. */
  return {
    data: cache.data,
    error: cache.error,
    loading: !cache.data && !cache.error && Boolean(RENDER_KEY)
  };
}

async function collect() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const owners = unwrap(await render('/owners?limit=50'), 'owner');
  const ownerName = new Map(owners.map(o => [o.id, o.name]));

  const services = unwrap(await render('/services?limit=100'), 'service');
  const databases = unwrap(await render('/postgres?limit=100'), 'postgres');

  // Last deploy per web service, fetched in parallel but tolerant of failures:
  // one bad service must not blank the whole dashboard.
  const deployable = services.filter(s => s.type !== 'static_site' || true);
  const deploys = await Promise.all(deployable.map(async s => {
    try {
      const rows = unwrap(await render(`/services/${s.id}/deploys?limit=1`), 'deploy');
      return [s.id, rows[0] || null];
    } catch (e) { return [s.id, { error: e.message }]; }
  }));
  const deployById = new Map(deploys);

  const now = Date.now();
  const items = [];

  for (const s of services) {
    const d = s.serviceDetails || {};
    const dep = deployById.get(s.id);
    // Static sites are free to host; their buildPlan governs build minutes, so
    // reading it as a monthly charge would inflate the total.
    const isStatic = s.type === 'static_site';
    const planName = isStatic ? 'static (free)' : (d.plan || d.buildPlan || '');
    const planPrice = isStatic ? 0 : priceOf(d.plan || d.buildPlan);
    items.push({
      kind: 'service',
      id: s.id,
      name: s.name,
      type: s.type,
      workspace: ownerName.get(s.ownerId) || s.ownerId,
      url: d.url || '',
      dashboardUrl: s.dashboardUrl,
      repo: s.repo || '',
      branch: s.branch || '',
      region: d.region || '',
      plan: planName,
      price: planPrice,
      suspended: s.suspended !== 'not_suspended',
      autoDeploy: s.autoDeploy,
      deploy: dep && !dep.error ? {
        status: dep.status,
        finishedAt: dep.finishedAt || dep.createdAt,
        commit: dep.commit ? String(dep.commit.message || '').split('\n')[0].slice(0, 60) : ''
      } : null,
      deployError: dep && dep.error ? dep.error : null
    });
  }

  for (const p of databases) {
    const expires = p.expiresAt ? new Date(p.expiresAt).getTime() : null;
    items.push({
      kind: 'database',
      id: p.id,
      name: p.name,
      type: 'postgres',
      workspace: ownerName.get(p.owner ? p.owner.id : p.ownerId) || '',
      dashboardUrl: p.dashboardUrl,
      region: p.region || '',
      plan: p.plan || '',
      price: priceOf(p.plan),
      status: p.status,
      version: p.version,
      suspended: p.suspended && p.suspended !== 'not_suspended',
      expiresAt: p.expiresAt || null,
      expiresInDays: expires ? Math.round((expires - now) / 864e5) : null
    });
  }

  const data = { items, fetchedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

/* Anything that needs your attention, worst first. Free databases silently
   delete themselves, which is the failure mode most worth shouting about. */
function alertsFor(items) {
  const out = [];
  for (const it of items) {
    if (it.kind === 'database' && it.expiresInDays !== null) {
      out.push({
        level: it.expiresInDays <= 7 ? 'bad' : 'warn',
        what: it.name,
        msg: it.expiresInDays <= 0
          ? 'Free database has expired and may already be deleted'
          : `Free database expires in ${it.expiresInDays} day${it.expiresInDays === 1 ? '' : 's'} — it gets deleted, data and all`,
        fix: 'Upgrade to a paid plan on its Render page'
      });
    }
    if (it.suspended) {
      out.push({ level: 'bad', what: it.name, msg: 'Suspended — not serving traffic', fix: 'Check billing and the Render dashboard' });
    }
    if (it.deploy && /fail|canceled|error/i.test(it.deploy.status || '')) {
      out.push({ level: 'bad', what: it.name, msg: 'Last deploy ' + it.deploy.status, fix: 'Read the deploy logs on Render' });
    }
    if (it.deployError) {
      out.push({ level: 'warn', what: it.name, msg: 'Could not read deploy status', fix: it.deployError });
    }
    if (it.kind === 'service' && it.plan === 'free' && it.type === 'web_service') {
      out.push({ level: 'info', what: it.name, msg: 'Free plan — sleeps after 15 min idle, ~50s cold start', fix: 'Starter plan removes the delay' });
    }
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/* --------------------------------------------------------------- auth --- */

const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('hex').slice(0, 32);
function validToken(tok) {
  if (!tok || !tok.includes('.')) return false;
  const v = tok.slice(0, tok.lastIndexOf('.'));
  const expected = sign(v);
  const a = Buffer.from(tok), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  return Number(v) > Date.now() - 30 * 864e5;
}
const cookieOf = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
};
const passwordOk = given => {
  if (!PASSWORD) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ---------------------------------------------------------------- ui --- */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ago = iso => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  if (h < 48) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
};

const CSS = `
:root{--bg:#EDF2FB;--card:#fff;--ink:#101822;--muted:#5A6A80;--line:#DBE4F2;
  --brand:#0B4FD3;--accent:#F2660D;--ok:#0F7B45;--warn:#B45309;--bad:#B42318;--r:12px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.top{background:var(--brand);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;
  padding-top:calc(14px + env(safe-area-inset-top))}
.top b{font-size:17px}.top .sp{flex:1}
.top a{color:#C7DAFB;font-size:13px;text-decoration:none}
.wrap{max-width:1000px;margin:0 auto;padding:14px 14px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;margin-bottom:12px}
h1{font-size:20px;margin:6px 0 14px}h2{font-size:15px;margin:0 0 10px}
.sub{color:var(--muted);font-weight:400;font-size:12px}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.svc{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:11px 12px;background:#fff}
.svc.ok{border-left-color:var(--ok)}.svc.bad{border-left-color:var(--bad)}.svc.warn{border-left-color:var(--warn)}
.svc .n{font-weight:600}
.svc .m{font-size:12.5px;color:var(--muted);margin-top:2px;word-break:break-word}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;background:#eef1f5;color:#41506b}
.pill.ok{background:#e3f5ea;color:var(--ok)}.pill.bad{background:#fde8e6;color:var(--bad)}
.pill.warn{background:#fdf0e3;color:var(--warn)}
.al{padding:10px 12px;border-radius:9px;margin-bottom:8px;font-size:13.5px;border:1px solid}
.al.bad{background:#fde8e6;border-color:#f5c6c2;color:#7a1a14}
.al.warn{background:#fdf3e3;border-color:#f0dcc0;color:#7a4c09}
.al.info{background:#eef2f7;border-color:#dde4ee;color:#41506b}
.al b{display:block}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}
@media(min-width:700px){.stats{grid-template-columns:repeat(4,1fr)}}
.stat{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:12px}
.stat .v{font-size:24px;font-weight:700}.stat .l{font-size:12px;color:var(--muted)}
a.btn,button{font:14px system-ui;padding:9px 15px;border:0;border-radius:9px;background:var(--brand);
  color:#fff;text-decoration:none;display:inline-block;cursor:pointer}
a.link{color:#0A3FA8;font-size:12.5px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;font:15px system-ui}
.login{max-width:340px;margin:12vh auto;padding:0 16px}
.err{color:var(--bad);font-size:13px;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);
  padding:6px;border-bottom:1px solid var(--line)}
td{padding:8px 6px;border-bottom:1px solid var(--line)}
td.num,th.num{text-align:right}
`;

const INSTALL_CSS = "/* The install bar. Sits on the bottom edge, out of the way of the thumb. */\n#a2hs{position:fixed;left:10px;right:10px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:90;\n  display:none;align-items:center;gap:10px;background:var(--card,#fff);\n  border:1px solid var(--line,#DBE4F2);border-radius:14px;padding:10px 12px;\n  box-shadow:0 8px 26px rgba(11,40,90,.16)}\n#a2hs.on{display:flex}\n#a2hs .ai{width:34px;height:34px;border-radius:9px;flex:none}\n#a2hs .at{flex:1;min-width:0;font-size:12.5px;line-height:1.45;color:var(--muted,#5A6A80)}\n#a2hs .at b{color:var(--ink,#101822);display:block;font-size:13px;margin-bottom:1px}\n#a2hs button{background:var(--accent,#F2660D);color:#fff;border:0;border-radius:999px;\n  padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer}\n#a2hs .x{background:none;color:var(--muted,#8894A6);font-size:19px;padding:0 4px;font-weight:600}\n@media all and (display-mode:standalone){#a2hs{display:none!important}}\n";
const INSTALL_JS = "/* ---- installable app -------------------------------------------------------\n   A service worker plus a manifest is the whole difference between a web page\n   and something that lives on the home screen with its own icon and no browser\n   bars. No store, no review, no developer account.\n\n   The bar waits a couple of seconds so it never lands on top of what someone\n   is reading, and once dismissed it stays dismissed on that device.          */\n(function () {\n  if ('serviceWorker' in navigator) {\n    window.addEventListener('load', function () {\n      navigator.serviceWorker.register('/sw.js').catch(function () {});\n    });\n  }\n  var standalone = window.matchMedia('(display-mode: standalone)').matches\n                || window.navigator.standalone === true;\n  if (standalone) return;\n\n  var KEY = 'ma_a2hs';\n  try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}\n\n  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);\n  var bar = null, deferred = null;\n\n  function build(html) {\n    bar = document.createElement('div');\n    bar.id = 'a2hs';\n    bar.innerHTML = '<img class=\"ai\" src=\"/icon-192.png\" alt=\"\">' + html +\n      '<button class=\"x\" aria-label=\"Dismiss\">&times;</button>';\n    document.body.appendChild(bar);\n    bar.querySelector('.x').onclick = function () {\n      bar.classList.remove('on');\n      try { localStorage.setItem(KEY, '1'); } catch (e) {}\n    };\n    setTimeout(function () { bar.classList.add('on'); }, 2600);\n  }\n\n  if (ios) {\n    build('<div class=\"at\"><b>Put My Apps on your home screen</b>' +\n          'Tap Share, then <b style=\"display:inline\">Add to Home Screen</b>.</div>');\n  } else {\n    window.addEventListener('beforeinstallprompt', function (ev) {\n      ev.preventDefault();\n      deferred = ev;\n      if (bar) return;\n      build('<div class=\"at\"><b>Install My Apps</b>Runs full screen, opens straight to your work.</div>' +\n            '<button id=\"a2hsGo\">Install</button>');\n      var go = document.getElementById('a2hsGo');\n      if (go) go.onclick = function () {\n        bar.classList.remove('on');\n        deferred.prompt();\n        deferred = null;\n        try { localStorage.setItem(KEY, '1'); } catch (e) {}\n      };\n    });\n  }\n})();\n";

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0B4FD3"><title>${esc(title)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="My Apps">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}
${INSTALL_CSS}</style></head>
<body>${body}<script>${INSTALL_JS}</script></body></html>`;

/* Forgotten passwords are handled here rather than in each app, because this is
   where passwords live. Every app links to these two pages. Both are public —
   the whole point is that they work for somebody who cannot get in. */
const noticePage = (heading, body) => page('My Apps', `<div class="login">
  <div class="card">
    <h1 style="margin-top:0;font-size:22px">${esc(heading)}</h1>
    ${body}
  </div></div>`);

const forgotPage = (msg, email, app) => noticePage('Reset your password', `
  <p style="color:var(--muted);font-size:14px;margin:0 0 14px">
    One password covers ${esc(app || 'all of your apps')}. Enter the email you sign in with
    and we'll send you a link.</p>
  <form method="POST" action="/forgot">
    <input name="email" type="email" placeholder="you@example.com" autocomplete="email"
           required autofocus value="${esc(email || '')}">
    ${app ? `<input type="hidden" name="app" value="${esc(app)}">` : ''}
    <button style="margin-top:10px;width:100%">Send me a link</button>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
  </form>`);

const resetPage = (token, msg) => noticePage('Choose a new password', `
  <form method="POST" action="/reset">
    <input type="hidden" name="token" value="${esc(token)}">
    <input name="password" type="password" placeholder="New password" autocomplete="new-password"
           required autofocus minlength="8">
    <input name="confirm" type="password" placeholder="Type it again" autocomplete="new-password"
           required minlength="8" style="margin-top:8px">
    <button style="margin-top:10px;width:100%">Save my new password</button>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <div style="margin-top:12px;font-size:12.5px;color:var(--muted)">
      At least 8 characters. This changes your password in every app at once.</div>
  </form>`);

const loginPage = err => page('My Apps', `<div class="login">
  <div class="card">
    <h1 style="margin-top:0">My Apps</h1>
    <form method="POST" action="/login">
      <input name="password" type="password" placeholder="Password" autofocus>
      <button style="margin-top:10px;width:100%">Sign in</button>
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
    </form>
  </div></div>`);

/* The three doors, big enough to be the reason this page is the home screen. */
const launcher = apps => !apps.length ? '' : `
    <div class="card" style="padding:14px 16px">
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${apps.filter(a => a.active).map(a => `
          <a href="${esc(a.url || '#')}" target="_blank" rel="noopener"
             style="flex:1 1 150px;display:block;text-decoration:none;text-align:center;
                    padding:16px 10px;border:1px solid var(--line);border-radius:11px;
                    background:var(--card,#fff)">
            <div style="font-size:17px;font-weight:700;color:#0B4FD3">${esc(a.name)}</div>
            <div style="margin-top:3px;font-size:13px;font-weight:600;color:#F2660D">open app →</div>
          </a>`).join('')}
      </div>
    </div>`;

/* Messages customers send from inside the apps. They used to be readable only
   in the Scheduler's own console; this is the one place now. */
function supportPanel(support) {
  if (!support) return '';
  const { messages = [], open = 0, problems = [] } = support;
  if (!messages.length) {
    return `<div class="card"><h2>Support</h2>
      <div class="sub">No messages. When somebody asks for help from inside an app, it lands here.</div>
      ${problems.length ? `<div class="al warn" style="margin-top:10px">Could not read:
        ${problems.map(esc).join('; ')}</div>` : ''}</div>`;
  }
  return `<div class="card">
    <h2>Support <span class="sub">${open} open${messages.length > open ? ` · ${messages.length - open} closed` : ''}</span></h2>
    ${messages.slice(0, 40).map(m => `
      <div class="al ${m.status === 'open' ? 'warn' : ''}" style="display:flex;gap:10px;align-items:flex-start">
        <div style="flex:1">
          <b>${esc(m.tenant)}</b>
          <span class="sub">${esc(m.fromName || m.fromEmail || 'someone')}${
            m.fromEmail ? ` · <a class="link" href="mailto:${esc(m.fromEmail)}">${esc(m.fromEmail)}</a>` : ''}
            · ${esc(m.created)}</span>
          <div style="margin-top:4px;white-space:pre-wrap">${esc(m.message)}</div>
        </div>
        <form method="POST" action="/support/close">
          <input type="hidden" name="app" value="${esc(m.app)}">
          <input type="hidden" name="id" value="${esc(String(m.id))}">
          ${m.status === 'open' ? '' : '<input type="hidden" name="reopen" value="1">'}
          <button style="padding:5px 10px;font-size:12px">${m.status === 'open' ? 'Done' : 'Reopen'}</button>
        </form>
      </div>`).join('')}
    ${problems.length ? `<div class="al warn">Could not read: ${problems.map(esc).join('; ')}</div>` : ''}
  </div>`;
}

/* What is configured and what is still on a default. The Scheduler used to
   show this for itself; it belongs with everything else now. */
function healthPanel(health, notice) {
  if (!health.length) return '';
  const bad = health.filter(c => !c.ok);
  return `<div class="card">
    <h2>Settings <span class="sub">${bad.length ? bad.length + ' need attention' : 'all set'}</span></h2>
    <table>
      ${health.map(c => `<tr>
        <td style="width:26px">${c.ok ? '<span class="pill ok">ok</span>' : '<span class="pill warn">!</span>'}</td>
        <td><b>${esc(c.label)}</b><div class="sub">${esc(c.ok ? (c.note || c.key) : c.warn)}</div></td>
      </tr>`).join('')}
    </table>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <label class="sub">Send a test email</label>
      <form method="POST" action="/email/test" style="display:flex;gap:8px;margin-top:5px">
        <input name="to" type="email" placeholder="you@example.com" style="flex:1">
        <button>Send</button>
      </form>
      <div class="sub" style="margin-top:6px">Proves password-reset emails will actually arrive.</div>
      ${notice ? `<div class="al ${notice.bad ? 'bad' : 'ok'}" style="margin-top:10px">${esc(notice.text)}</div>` : ''}
    </div>
  </div>`;
}

function dashboard(data, error, apps = [], tenants = [], tenantAlerts = [], kpis = {},
                   tenantProblems = [], minted = null, support = null, health = [], notice = null,
                   hostingLoading = false) {
  const items = data ? data.items : [];
  const alerts = alertsFor(items);
  const services = items.filter(i => i.kind === 'service');
  const dbs = items.filter(i => i.kind === 'database');
  const spend = items.reduce((s, i) => s + (i.price || 0), 0);
  const unknownPrice = items.some(i => i.price === null && i.plan);

  const byWorkspace = {};
  for (const i of items) (byWorkspace[i.workspace] = byWorkspace[i.workspace] || []).push(i);

  const card = i => {
    let cls = 'ok', pill = '<span class="pill ok">ok</span>';
    if (i.suspended) { cls = 'bad'; pill = '<span class="pill bad">suspended</span>'; }
    else if (i.deploy && /fail|canceled|error/i.test(i.deploy.status)) {
      cls = 'bad'; pill = `<span class="pill bad">${esc(i.deploy.status)}</span>`;
    } else if (i.expiresInDays !== null && i.expiresInDays !== undefined && i.expiresInDays <= 30) {
      cls = 'warn'; pill = `<span class="pill warn">${i.expiresInDays}d left</span>`;
    } else if (i.deploy) {
      pill = `<span class="pill ok">${esc(i.deploy.status)}</span>`;
    }
    return `<div class="svc ${cls}">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1"><div class="n">${esc(i.name)}</div>
          <div class="m">${esc(i.type.replace('_', ' '))}${i.plan ? ' · ' + esc(i.plan) : ''}${i.region ? ' · ' + esc(i.region) : ''}${
            i.price !== null && i.price !== undefined ? ' · ~$' + i.price + '/mo' : ''}</div>
          ${i.deploy ? `<div class="m">deployed ${esc(ago(i.deploy.finishedAt))}${i.deploy.commit ? ' · ' + esc(i.deploy.commit) : ''}</div>` : ''}
          ${i.deployError ? `<div class="m" style="color:var(--warn)">${esc(i.deployError)}</div>` : ''}
          <div class="m">${i.url ? `<a class="link" href="${esc(i.url)}" target="_blank">open app</a> · ` : ''}
            <a class="link" href="${esc(i.dashboardUrl)}" target="_blank">render</a></div>
        </div>${pill}
      </div></div>`;
  };

  /* The apps that matter, not everything on the Render account. The other
     workspaces are other businesses and do not belong on this screen. */
  const mine = new Set(apps.map(a => (a.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')));
  const isMine = i => mine.has(String(i.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    || /apps-db/i.test(i.name || '');
  const ours = items.filter(isMine);
  const oursSpend = ours.reduce((t, i) => t + (i.price || 0), 0);
  const oursTrouble = ours.filter(i => i.suspended ||
    (i.deploy && /fail|canceled|error/i.test(i.deploy.status)));

  const planPill = t => {
    const today = new Date().toISOString().slice(0, 10);
    const on = t.expires_on ? String(t.expires_on).slice(0, 10) : null;
    if (t.plan !== 'pro' || (on && on < today)) return '<span class="pill">Free</span>';
    if (!on) return '<span class="pill ok">Paid</span>';
    const left = Math.ceil((new Date(on) - new Date(today)) / 864e5);
    return `<span class="pill ${left <= 7 ? 'warn' : 'ok'}">Trial · ${left}d</span>`;
  };

  const byApp = {};
  for (const t of tenants) (byApp[t.appName] = byApp[t.appName] || []).push(t);

  return page('My Apps', `
  <div class="top"><b>My Apps</b><span class="sub" style="color:#BBD2F7">build ${BUILD}</span>
    <span class="sp"></span><a href="/subscriptions">accounts &amp; codes</a>
    <a href="/?refresh=1">refresh</a> <a href="/logout">sign out</a></div>
  <div class="wrap">
    ${launcher(apps)}

    <div class="stats">
      <div class="stat"><div class="v">${kpis.total}</div><div class="l">Customers</div></div>
      <div class="stat"><div class="v" style="color:var(--ok)">${kpis.paid}</div><div class="l">Paid</div></div>
      <div class="stat"><div class="v" style="color:${kpis.trials ? 'var(--warn)' : 'var(--ink)'}">${kpis.trials}</div><div class="l">On trial</div></div>
      <div class="stat"><div class="v">${kpis.newWeek}</div><div class="l">New this week</div></div>
      <div class="stat"><div class="v">${kpis.people}</div><div class="l">People</div></div>
      <div class="stat"><div class="v">~$${oursSpend}</div><div class="l">Hosting</div></div>
    </div>

    ${tenantAlerts.length ? `<div class="card"><h2>Needs you <span class="sub">newest first</span></h2>
      ${tenantAlerts.map(a => `<div class="al ${a.level}">${esc(a.text)}</div>`).join('')}
    </div>` : '<div class="card"><h2>Needs you</h2><div class="sub">Nothing right now.</div></div>'}

    ${Object.keys(byApp).length ? Object.entries(byApp).map(([appName, list]) => `
      <div class="card"><h2>${esc(appName)} <span class="sub">${list.length} customer${list.length === 1 ? '' : 's'}</span></h2>
        <table>
          <tr><th>${esc(list[0].kind)}</th><th>Plan</th><th class="num">People</th>
              <th class="num">${esc(list[0].workLabel)}</th><th>Administrator</th><th>Since</th><th></th></tr>
          ${list.map(t => `<tr>
            <td><b>${esc(t.name)}</b></td>
            <td>${planPill(t)}${t.expires_on ? `<div class="sub">to ${esc(String(t.expires_on).slice(0, 10))}</div>` : ''}</td>
            <td class="num">${t.people}</td>
            <td class="num">${t.work}</td>
            <td>${t.adminEmail ? `${esc(t.adminName || '')}<div class="sub">${esc(t.adminEmail)}</div>` : '<span class="sub">none yet</span>'}</td>
            <td class="sub">${esc(String(t.created || '').slice(0, 10))}</td>
            <td class="num">
              <form method="POST" action="/tenant/plan" style="display:inline">
                <input type="hidden" name="slug" value="${esc(t.app)}">
                <input type="hidden" name="tenant" value="${esc(t.key)}">
                <input type="hidden" name="name" value="${esc(t.name)}">
                <select name="plan" style="padding:4px;border:1px solid var(--line);border-radius:7px;font-size:12px">
                  <option value="free"${t.plan !== 'pro' ? ' selected' : ''}>Free</option>
                  <option value="pro"${t.plan === 'pro' ? ' selected' : ''}>Paid</option>
                </select>
                <input name="days" placeholder="days" value="" style="width:56px;padding:4px;border:1px solid var(--line);border-radius:7px;font-size:12px">
                <button style="padding:4px 9px;font-size:12px">Set</button>
              </form>
            </td>
          </tr>`).join('')}
        </table>
        <div class="sub" style="margin-top:8px">Leave days blank for a paid plan with no end date;
          put a number in for a trial.</div>
      </div>`).join('')
      : `<div class="card"><h2>Customers</h2><div class="sub">Nobody has signed up yet. Schools and
         companies appear here the moment they register in one of your apps.</div>
         ${tenantProblems.length ? `<div class="al warn" style="margin-top:10px">Could not read:
           ${tenantProblems.map(esc).join('; ')}</div>` : ''}</div>`}

    <div class="card">
      <h2>Give someone free time</h2>
      <div class="sub" style="margin-bottom:10px">Generates signed codes. They are not stored, so copy
        them now. Whoever redeems one gets that many days of the full app — and the days are
        <b>added to whatever they have left</b>, so an extension never shortens a trial that is
        still running.</div>
      <form method="POST" action="/codes/mint">
        <div class="grid">
          <div><label class="sub">App</label>
            <select name="slug" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px">
              ${apps.map(a => `<option value="${esc(a.slug)}">${esc(a.name)}</option>`).join('')}
            </select></div>
          <div><label class="sub">Days</label><input name="days" value="30"></div>
          <div><label class="sub">How many</label><input name="count" value="5"></div>
        </div>
        <button style="margin-top:10px">Generate codes</button>
      </form>
      ${minted ? `<div class="al" style="margin-top:12px"><b>${minted.days}-day codes</b>
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.8;margin-top:6px">
        ${minted.codes.map(esc).join('<br>')}</div></div>` : ''}
    </div>

    ${supportPanel(support)}

    ${healthPanel(health, notice)}

    <div class="card">
      <h2>Hosting <span class="sub">your four apps</span></h2>
      ${hostingLoading
        ? `<div class="sub">Fetching this from Render in the background — reload in a moment.
             Nothing else on this page waits for it.</div>`
        : error ? `<div class="al warn"><b>Couldn't reach Render</b> ${esc(error)}${
            data ? ' — showing what was last collected.' : ''}</div>` : ''}
      ${oursTrouble.length ? oursTrouble.map(i =>
        `<div class="al bad"><b>${esc(i.name)}</b> ${esc(i.suspended ? 'suspended' : i.deploy.status)}</div>`).join('')
        : (data ? '<div class="sub">All running.</div>' : '')}
      <div class="grid" style="margin-top:10px">${ours.map(card).join('')}</div>
      <div class="sub" style="margin-top:8px">${data ? `~$${oursSpend}/mo across these.
        Data from ${esc(ago(data.fetchedAt))} · ` : ''}<a class="link" href="/?refresh=1">refresh</a></div>
    </div>
  </div>`);
}


/* ------------------------------------------------------ subscriptions --- */

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > limit) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

async function subsData() {
  const [apps, subs, redemptions, users] = await Promise.all([
    store.listApps(), store.listSubscriptions(), store.listRedemptions(), store.listUsers()
  ]);
  return { apps, subs, redemptions, users, minted: null, dbError: null };
}

function subsPage({ apps, subs, redemptions, users = [], minted, dbError, notice }) {
  const pro = subs.filter(s => s.state === 'Pro').length;
  return page('Subscriptions — My Apps', `
  <div class="top"><b>My Apps</b><span class="sub" style="color:#BBD2F7">subscriptions</span>
    <span class="sp"></span><a href="/">status</a> <a href="/logout">sign out</a></div>
  <div class="wrap">
    ${dbError ? `<div class="al bad"><b>Database unavailable</b>${esc(dbError)}</div>` : ''}
    ${notice ? `<div class="al info">${esc(notice)}</div>` : ''}

    <div class="stats">
      <div class="stat"><div class="v">${apps.length}</div><div class="l">Apps</div></div>
      <div class="stat"><div class="v">${pro}</div><div class="l">On Pro now</div></div>
      <div class="stat"><div class="v">${redemptions.length}</div><div class="l">Codes redeemed</div></div>
      <div class="stat"><div class="v">${users.length}</div><div class="l">Accounts</div></div>
    </div>

    ${minted ? `<div class="card"><h2>${minted.codes.length} code${minted.codes.length === 1 ? '' : 's'}
      for ${esc(minted.app.name)} <span class="sub">${minted.days} days each</span></h2>
      <p class="sub">Copy these now — they are signed, not stored, so this page cannot show them again.
        They work until redeemed or revoked.</p>
      <textarea readonly style="width:100%;height:${Math.min(220, 28 + minted.codes.length * 20)}px;
        font:13px/1.6 monospace;padding:10px;border:1px solid var(--line);border-radius:9px"
      >${esc(minted.codes.join('\n'))}</textarea></div>` : ''}

    <div class="card">
      <h2>Issue codes <span class="sub">signed, not stored — mint as many as you like</span></h2>
      <form method="POST" action="/codes/issue">
        <div class="grid">
          <div><label class="sub">App</label>
            <select name="app_id" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px">
              ${apps.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.prefix)})</option>`).join('')}
            </select></div>
          <div><label class="sub">Days of Pro</label><input name="days" type="number" min="1" max="3650" value="30"></div>
          <div><label class="sub">How many codes</label><input name="count" type="number" min="1" max="100" value="1"></div>
        </div>
        <button style="margin-top:12px">Generate</button>
      </form>
    </div>

    <div class="card">
      <h2>Who is on what</h2>
      ${subs.length ? `<table><tr><th>Account</th><th>App</th><th>Plan</th><th>Until</th><th>Via</th></tr>
        ${subs.map(x => `<tr><td>${esc(x.account)}</td><td>${esc(x.app_name)}</td>
          <td><span class="pill ${x.state === 'Pro' ? 'ok' : (x.state === 'Expired' ? 'warn' : '')}">${x.state}</span></td>
          <td>${x.expires_on ? esc(String(x.expires_on).slice(0, 10)) : (x.plan === 'pro' ? 'no expiry' : '—')}</td>
          <td>${esc(x.source || '—')}</td></tr>`).join('')}</table>`
        : '<div class="sub">Nobody has redeemed a code yet.</div>'}
    </div>

    <div class="card">
      <h2>Redeemed codes <span class="sub">revoke one to cut off access</span></h2>
      ${redemptions.length ? `<table><tr><th>Code</th><th>App</th><th>Account</th><th>Expires</th><th></th></tr>
        ${redemptions.map(r => `<tr>
          <td><code style="font-size:12px">${esc(r.code)}</code></td>
          <td>${esc(r.app_name || '—')}</td><td>${esc(r.account || '—')}</td>
          <td>${r.expires_on ? esc(String(r.expires_on).slice(0, 10)) : '—'}</td>
          <td class="num"><form method="POST" action="/codes/revoke" style="display:inline">
            <input type="hidden" name="code" value="${esc(r.code)}">
            <button style="background:none;color:#0A3FA8;padding:0;font-size:12.5px">revoke</button></form></td>
        </tr>`).join('')}</table>`
        : '<div class="sub">None yet.</div>'}
    </div>

    <div class="card">
      <h2>Accounts <span class="sub">one sign-in, every app</span></h2>
      ${users.length ? `<table><tr><th>Email</th><th>Name</th><th>On</th><th>Joined</th><th>Last seen</th><th></th></tr>
        ${users.map(u => `<tr>
          <td>${esc(u.email)}${u.role === 'owner' ? ' <span class="pill ok">owner</span>' : ''}${
            u.active ? '' : ' <span class="pill warn">off</span>'}</td>
          <td>${esc(u.name || '—')}</td>
          <td>${(u.plans || []).filter(p => p.plan === 'pro').map(p => `<span class="pill ok">${esc(p.app)}</span>`).join(' ') || '<span class="sub">free</span>'}</td>
          <td>${esc(String(u.created_at).slice(0, 10))}</td>
          <td>${u.last_seen ? esc(String(u.last_seen).slice(0, 10)) : '<span class="sub">never</span>'}</td>
          <td class="num">
            <form method="POST" action="/users/role" style="display:inline">
              <input type="hidden" name="email" value="${esc(u.email)}">
              <input type="hidden" name="role" value="${u.role === 'owner' ? 'user' : 'owner'}">
              <button style="background:none;color:#0A3FA8;padding:0;font-size:12.5px">${
                u.role === 'owner' ? 'remove owner' : 'make owner'}</button></form>
            &nbsp;·&nbsp;
            <form method="POST" action="/users/toggle" style="display:inline">
              <input type="hidden" name="email" value="${esc(u.email)}">
              <button style="background:none;color:#0A3FA8;padding:0;font-size:12.5px">${u.active ? 'suspend' : 'restore'}</button></form></td>
        </tr>`).join('')}</table>`
        : '<div class="sub">No one has signed up yet. Accounts appear here the moment someone registers in any of your apps.</div>'}
      <form method="POST" action="/users/create" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
        <div class="sub" style="margin-bottom:8px"><b>Add someone</b> — an owner is an administrator in
          every app; an ordinary user only gets in where they have been invited.</div>
        <div class="grid">
          <div><label class="sub">Email</label><input name="email" type="email" placeholder="someone@example.com"></div>
          <div><label class="sub">Name</label><input name="name" placeholder="Their name"></div>
          <div><label class="sub">Password</label><input name="password" type="text" placeholder="at least 8 characters"></div>
          <div><label class="sub">Role</label>
            <select name="role" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px">
              <option value="user">Ordinary user</option>
              <option value="owner">Owner — admin everywhere</option>
            </select></div>
        </div>
        <button style="margin-top:10px">Create account</button>
      </form>

      <form method="POST" action="/users/reset" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
        <div class="grid">
          <div><label class="sub">Reset password for</label><input name="email" type="email" placeholder="someone@example.com"></div>
          <div><label class="sub">New password</label><input name="password" type="text" placeholder="at least 8 characters"></div>
        </div>
        <button style="margin-top:10px">Set password</button>
      </form>
    </div>

    <div class="card">
      <h2>App keys <span class="sub">each app needs these to check codes</span></h2>
      <table><tr><th>App</th><th>Slug</th><th>Prefix</th><th>Secret</th></tr>
        ${apps.map(a => `<tr><td>${esc(a.name)}</td><td><code>${esc(a.slug)}</code></td>
          <td><code>${esc(a.prefix)}</code></td>
          <td><code style="font-size:11px;word-break:break-all">${esc(a.secret)}</code></td></tr>`).join('')}
      </table>
      <div class="sub" style="margin-top:8px">An app posts its slug, secret, the code and the account to
        <code>/api/v1/redeem</code>, and asks <code>/api/v1/status</code> what someone is entitled to.
        Secrets belong in each app's environment variables, never in its source.</div>
    </div>
  </div>`);
}

/* -------------------------------------------------------------- server --- */

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, headers));
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

  // Public API: an app asks whether a code is good, and claims a use if it is.
  if (url.pathname === '/api/v1/status' && req.method === 'POST') {
    try {
      const out = await store.status(JSON.parse(await readBody(req) || '{}'));
      return json(res, out.ok ? 200 : out.status, out.ok ? out : { error: out.error });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url.pathname === '/api/v1/redeem' && req.method === 'POST') {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const out = await store.redeem(b);
      return json(res, out.ok ? 200 : out.status, out.ok ? out : { error: out.error });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  /* Central accounts. Every app posts here instead of holding passwords itself,
     so one sign-in works everywhere and suspending someone cuts off all of it. */
  const AUTH = {
    '/api/v1/auth/register': store.register,
    '/api/v1/plan': store.tenantPlan,
    '/api/v1/trial': store.startTrial,
    '/api/v1/redeem-tenant': store.redeemForTenant,
    '/api/v1/auth/login': store.login,
    '/api/v1/auth/change-password': store.changePassword,
    '/api/v1/auth/admin-set-password': store.adminSetPassword
  };
  if (AUTH[url.pathname]) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    try {
      const out = await AUTH[url.pathname](JSON.parse(await readBody(req) || '{}'));
      // On refusal the app still gets `known`/`suspended` — see the note in
      // store.login(). Apps must not relay them to a browser.
      return json(res, out.ok ? 200 : (out.status || 400), out.ok ? out
        : { error: out.error, known: out.known, suspended: out.suspended });
    } catch (e) {
      console.error(url.pathname + ' failed:', e.message);
      return json(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', () => {
      const given = decodeURIComponent((body.split('password=')[1] || '').replace(/\+/g, ' ')).split('&')[0];
      if (!PASSWORD) return send(res, 200, loginPage('APP_PASSWORD is not set on this service.'));
      if (!passwordOk(given)) return send(res, 200, loginPage('Wrong password.'));
      send(res, 302, '', {
        Location: '/',
        'Set-Cookie': `ma=${sign(String(Date.now()))}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` +
          (process.env.NODE_ENV === 'production' ? '; Secure' : '')
      });
    });
    return;
  }

  /* ---- installable ---------------------------------------------------
     Served from here rather than from disk, because this app is one file.  */
  const ICONS = {
    '/icon-192.png': "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAEAUlEQVR42u3dzXETQRCAUc2Ub+JOkQNKgCREqCgJEhA5UNzRWQRAgS3terd/3kvAY1d/2yNE1Y5DMMfz9X6grNvlNCKdZxh2OkcxDD2dYxgGn84hDINP5xCGwadzCMPg0zmEafjJZO0ZGwafzttgGn46b4Np+OkcwTT8dI5gGn46RzANP50jmIafzhFMw0/nCKbhp3ME0/DTOYLpz0Rn09OfzltgGn46R+AKhCuQpz9dt4ANgA3g6U/XLWADYAN4+tN1C9gA2ACe/nTdAjYANgC0DsD1h67XIBsAGwAEAAKAXoYPwNgAIAAQAAgABAACAAGAAEAAUMxL5V/u97fPm//MD19/vPvP+Pnxy+a/16df30vOSLn/CrHH0G8Rwh5D3yGEUgFEGf61Q4gy/BVDmIY/9rkiDn/kc7UMIOrwLz1f9CGrEME0/DHPmWW4skcwDX+882YbqswR+B6A1gSAAFx/4pw763Ui67ltAGwAEAAIAAQAAgABgABAACAAEAAIAAQAAgABgABAACAAEAAIAAQAAgABgABAACAAEAAIAATwkC3exrjHubO+eyvruW0AbABbINZ5sz1NM78x0gbABrAF4p0zy1M1+/uCS2yA6BE8e77ow1XhZdllrkBRI1h6rqhDVuVN8eN4vt4r3emivDts7SCjvIOryuCXDWDvGLbYRHvEUG3wWwQAbT4DgABAACAAEAAIAP7jpfIvV/Xfy6t+v7GHct8DVP3GtOo33AIoOPxrhxBl+CuGMA1/7HNFHP7I52oZQNThX3q+6ENWIYJp+GOeM8twZY9gGv545802VJkj8D0ArQkAAbj+xDl31utE1nPbANgAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAjgIVu8jXGPc2d991bWc9sA2AC2QKzzZnuaZn5jpA2ADWALxDtnlqdq9vcFl9gA0SN49nzRh6vCy7LLXIGiRrD0XFGHrMqb4sfxfL1XutNFeXfY2kFGeQdXlcEvG8DeMWyxifaIodrgtwgA2nwGAAGAAEAAIAAQAAgABAB/B3C7nIY/Ax3dLqdhA+AKBAIAAUDDAHwQpuMHYBsAG8CfAAG4BtHw+mMDYAP8qwyo/vS3AbABXisEqj79bQBsgLeWAtWe/jYANsCjxUCVp/+rG0AEVB5+VyBcgZYWBFmf/m/eACKg4vA/dAUSAdWG/+HPACKg0vA/9SFYBFQZ/qcCEAFVhv/pAERAheFfFIAIyD78iwMQAZmH/3A4HFYdXi/cI8vgr7YBbAOyDv/qG8A2IMvgv3sAQiDDrWKzK4sQiHid3vzOLgQifY7c9UOrGNhj6MMEIArDvrc/SOqVBvDcSi0AAAAASUVORK5CYII=",
    '/icon-512.png': "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",
    '/apple-touch-icon.png': "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAADcUlEQVR42u3dwXETQRRF0Zku72BPkQNKgCQgVJQECUAOFHu0hghUg6TR9P9P5wSA267r57ZMadalgHdffvxdaO9yPq2zz7AKmKTAVxGTFPcqYpLiXoVMUthDzCS9GLAKmaS1HmImaa1XIZO01kPMJK31EDNJUQ8xkxT1EDNJUQ8xkxT1EDNJUQ8xkxT18GUiybDOJK30EDNJUbtykH/lsM50XekhZpKiduUg98phnem+0haa/F8KoX3QrhskXDssNK4cUDpo1w1Srh0WGlcOEDQcYHV/xkKDoEHQIGgEDYIGQYOgQdC8oLekT+bPt0+Hfrz3X38+7d/+9eHzoZ/Lx9/fIxqI+NP30SE/M+yjQ04Lu3XQs0PeM+zZIaeEPcQ8/0zVYq56ptigK8Z879kqh9Mxaq9yEKVd0JXX+dYzdljAbittobHQ1vnxs3Zavk5ntdBYaBA0CBoEjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2C3vLMZ5ocfdZO75Df6awWGgttpfc5Y4fl6/asFQv9wteitJjbBi0arvFYtyLfZJXeVLzzN5kHbxb7ieHBm4KeFrZHIwsa/FIIgkbQIGgQNAgaNr0lfTJJr90mvaZ+pIjXoZP+upb0V09BNwt5z7Ar/b+UzmEPMc8/U7WYq54pNuiKMd97tsrhdIzaqxxEaRd05XW+9YwdFrDbSltoLLR1fvysnZav01ktNBYaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6C3dHoe9dZZO71DfqezWmgstJXe54wdlq/bs1Ys9Atfi9Jibhu0aLjGY92KfJNVelPxzt9kHrxZ7CeGB28KelrYHo0saPBLIQgaQYOgQdAgaBA0goa+QV/Op9WXgQSX82m10LhygKDhqKDdo0m4P1toXDmgRdCuHXS/blhoXDmgTdCuHXS+blho8q8cVpqu63x1oUVNx5hdOci/clhpuq7z5kKLmk4xu3LwOlcOK023df7vhRY1HWK+6cohaqrHfPMdWtRUjvmuXwpFTdWY7wpa1FSN+e6gRU3FmJdlWXaJ0lMAmB3ywwttrakW824Lba2pMoaj+gER89SFttbMHL3D1lTcIj7i40y5HohbxFFBC1zAz/IP4EtxZhGCsT4AAAAASUVORK5CYII=",
  };
  if (ICONS[url.pathname]) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
    return res.end(Buffer.from(ICONS[url.pathname], 'base64'));
  }
  if (url.pathname === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    return res.end(JSON.stringify({
      name: 'My Apps', short_name: 'My Apps',
      description: 'Every customer, plan and app in one place.',
      start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#EDF2FB', theme_color: '#0B4FD3',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    }));
  }
  if (url.pathname === '/sw.js') {
    // Never cached, or a broken worker could never be replaced.
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
    return res.end("/* Service worker \u2014 the piece that makes this installable.\n *\n * Deliberately conservative, because this app shows live data:\n *\n *   the app shell   network first, cache as a fallback  \u2014 a deploy shows up\n *                                                         immediately, and the\n *                                                         app still opens when\n *                                                         the phone has no signal\n *   anything /api/  network only                        \u2014 never serve a stale\n *                                                         job, school or invoice\n *   icons           cache first                         \u2014 they never change\n */\nvar VERSION = 'ma-2026-08-31';\nvar SHELL = VERSION + '-shell';\n\nself.addEventListener('install', function (e) {\n  e.waitUntil(\n    caches.open(SHELL)\n      .then(function (c) { return c.addAll(['/icon-192.png', '/icon-512.png']); })\n      .catch(function () { /* one missing icon must not sink the install */ })\n      .then(function () { return self.skipWaiting(); })\n  );\n});\n\nself.addEventListener('activate', function (e) {\n  e.waitUntil(\n    caches.keys().then(function (keys) {\n      return Promise.all(keys.map(function (k) { if (k !== SHELL) return caches.delete(k); }));\n    }).then(function () { return self.clients.claim(); })\n  );\n});\n\nself.addEventListener('fetch', function (e) {\n  var req = e.request;\n  if (req.method !== 'GET') return;\n  var url;\n  try { url = new URL(req.url); } catch (err) { return; }\n  if (url.origin !== self.location.origin) return;\n\n  // Live data is never cached, and neither is anything that prints.\n  if (/^\\/(api|print|photo|barcode)\\//.test(url.pathname)) return;\n\n  if (/\\.(png|ico|svg|webmanifest)$/.test(url.pathname)) {\n    e.respondWith(\n      caches.match(req).then(function (hit) {\n        return hit || fetch(req).then(function (r) {\n          if (r && r.ok) { var copy = r.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }\n          return r;\n        });\n      })\n    );\n    return;\n  }\n\n  e.respondWith(\n    fetch(req).then(function (r) {\n      if (r && r.ok && req.mode === 'navigate') {\n        var copy = r.clone();\n        caches.open(SHELL).then(function (c) { c.put(req, copy); });\n      }\n      return r;\n    }).catch(function () {\n      return caches.match(req).then(function (hit) {\n        return hit || caches.match('/') || new Response('Offline', { status: 503 });\n      });\n    })\n  );\n});\n");
  }

  if (url.pathname === '/logout') {
    return send(res, 302, '', { Location: '/', 'Set-Cookie': 'ma=; Path=/; Max-Age=0' });
  }

  /* ---- forgotten passwords, for everybody -----------------------------
     These sit above the owner password gate on purpose: somebody locked out
     of an app has no way through it. Nothing here reveals whether an address
     is known, and the reset link is never shown to the browser that asked. */
  const publicBase = () => {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return process.env.PUBLIC_URL || (host ? `${proto}://${host}` : '');
  };

  if (url.pathname === '/forgot') {
    if (req.method === 'GET') {
      return send(res, 200, forgotPage('', url.searchParams.get('email') || '',
                                       url.searchParams.get('app') || ''));
    }
    if (req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      const email = (f.get('email') || '').trim();
      let out = { mail_configured: store.mailEnabled() };
      try {
        out = await store.requestReset({ email, appName: f.get('app') || 'My Apps', baseUrl: publicBase() });
      } catch (e) {
        console.error('Password reset request failed:', e.message);
      }
      /* The same answer whether or not that address has an account. The one
         thing worth saying plainly is when no mail service is set up, because
         then no amount of waiting will produce an email. */
      return send(res, 200, noticePage(
        out.mail_configured ? 'Check your email' : 'Ask the operator',
        out.mail_configured
          ? `<p style="color:var(--muted);font-size:14px">If <b>${esc(email)}</b> has an account,
               a link is on its way. It works once and lasts an hour.</p>
             <p style="font-size:13px;color:var(--muted)">Nothing yet? Look in spam, or
               <a href="/forgot">try again</a>.</p>`
          : `<p style="color:var(--muted);font-size:14px">This service can't send email yet, so a
               reset link can't be mailed to you. Contact
               <a href="mailto:steve.smith@buddyrents.com">steve.smith@buddyrents.com</a> and
               your password will be reset for you.</p>`));
    }
  }

  if (url.pathname === '/reset') {
    if (req.method === 'GET') {
      const token = url.searchParams.get('token') || '';
      if (!token) return send(res, 200, forgotPage('That link is incomplete — ask for a new one.', ''));
      return send(res, 200, resetPage(token, ''));
    }
    if (req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      const token = f.get('token') || '';
      const pw = f.get('password') || '';
      if (pw !== (f.get('confirm') || '')) {
        return send(res, 200, resetPage(token, "Those two didn't match."));
      }
      let out;
      try { out = await store.resetWithToken({ token, newPassword: pw }); }
      catch (e) { out = { ok: false, error: 'Something went wrong. Ask for a new link.' }; }
      if (!out.ok) return send(res, 200, resetPage(token, out.error));
      return send(res, 200, noticePage('Password changed', `
        <p style="color:var(--muted);font-size:14px">You can sign in with your new password now —
          in every app, not just the one you came from.</p>`));
    }
  }

  /* Anything else under /api/ is not a route. Say so in JSON: an app that gets
     an HTML sign-in page back with a 200 could mistake it for a yes. */
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'No such endpoint: ' + url.pathname });

  if (!validToken(cookieOf(req, 'ma'))) return send(res, 200, loginPage(''));

  // --- subscriptions ---
  if (url.pathname === '/codes/issue' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    try {
      const minted = await store.issue(body.get('app_id'), body.get('days'), body.get('count'));
      return send(res, 200, subsPage(Object.assign(await subsData(),
        { minted: { app: minted.app, codes: minted.codes, days: Number(body.get('days')) || 30 } })));
    } catch (e) {
      return send(res, 200, subsPage(Object.assign(await subsData(), { dbError: e.message })));
    }
  }
  if (url.pathname === '/codes/revoke' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    try { await store.revokeCode(body.get('code'), 'revoked from My Apps'); }
    catch (e) { console.error('revoke failed:', e.message); }
    return send(res, 302, '', { Location: '/subscriptions' });
  }
  if (url.pathname === '/users/reset' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const email = body.get('email');
    let notice;
    try {
      notice = await store.setUserPassword(email, body.get('password'))
        ? `Password set for ${email}. Tell them to sign in with it and change it.`
        : `No account here uses ${email}.`;
    } catch (e) { notice = e.message; }
    try { return send(res, 200, subsPage(Object.assign(await subsData(), { notice }))); }
    catch (e) { return send(res, 302, '', { Location: '/subscriptions' }); }
  }
  if (url.pathname === '/users/create' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    let notice;
    try {
      const made = await store.createUser({
        email: body.get('email'), name: body.get('name'),
        password: body.get('password'), role: body.get('role')
      });
      notice = `${made.email} created${made.role === 'owner' ? ' as an owner — they are an administrator in every app' : ''}.`;
    } catch (e) { notice = e.message; }
    try { return send(res, 200, subsPage(Object.assign(await subsData(), { notice }))); }
    catch (e) { return send(res, 302, '', { Location: '/subscriptions' }); }
  }
  if (url.pathname === '/users/role' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    let notice;
    try {
      const u = await store.setUserRole(body.get('email'), body.get('role'));
      notice = u
        ? `${u.email} is ${u.role === 'owner' ? 'now an owner — an administrator in every app' : 'no longer an owner'}.`
        : `No account here uses ${body.get('email')}.`;
    } catch (e) { notice = e.message; }
    try { return send(res, 200, subsPage(Object.assign(await subsData(), { notice }))); }
    catch (e) { return send(res, 302, '', { Location: '/subscriptions' }); }
  }
  if (url.pathname === '/users/toggle' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    let notice;
    try {
      const u = await store.toggleUser(body.get('email'));
      notice = u ? `${u.email} is now ${u.active ? 'active again' : 'suspended from every app'}.`
        : `No account here uses ${body.get('email')}.`;
    } catch (e) { notice = e.message; }
    try { return send(res, 200, subsPage(Object.assign(await subsData(), { notice }))); }
    catch (e) { return send(res, 302, '', { Location: '/subscriptions' }); }
  }
  if (url.pathname === '/subscriptions') {
    try { return send(res, 200, subsPage(await subsData())); }
    catch (e) { return send(res, 200, subsPage({ apps: [], subs: [], redemptions: [], users: [], dbError: e.message })); }
  }

  /* Setting a customer's plan by hand, from the row on the console. */
  if (url.pathname === '/tenant/plan' && req.method === 'POST') {
    const b = new URLSearchParams(await readBody(req));
    try {
      await store.setTenantPlan({
        slug: b.get('slug'), tenantKey: b.get('tenant'), tenantName: b.get('name'),
        plan: b.get('plan'), days: b.get('days'), note: ''
      });
    } catch (e) { console.error('set plan:', e.message); }
    return send(res, 302, '', { Location: '/' });
  }

  /* Codes are signed, not stored, so they are shown once and then gone. They
     are held in memory only long enough to render the page that displays them. */
  /* Support messages, closed or reopened from here rather than from inside the
     app they came from. */
  if (url.pathname === '/support/close' && req.method === 'POST') {
    const b = new URLSearchParams(await readBody(req));
    let notice = null;
    try {
      await store.closeSupport(b.get('app'), b.get('id'), b.get('reopen') === '1');
    } catch (e) {
      notice = { bad: true, text: 'Could not update that message: ' + e.message };
    }
    return renderConsole(res, null, notice);
  }

  if (url.pathname === '/email/test' && req.method === 'POST') {
    const b = new URLSearchParams(await readBody(req));
    const to = b.get('to') || '';
    let notice;
    try {
      const out = await store.testEmail(to);
      notice = out.ok
        ? { text: `Sent to ${to}. If it does not arrive in a minute, look in spam.` }
        : { bad: true, text: out.error };
    } catch (e) {
      notice = { bad: true, text: 'Could not send it: ' + e.message };
    }
    return renderConsole(res, null, notice);
  }

  if (url.pathname === '/codes/mint' && req.method === 'POST') {
    const b = new URLSearchParams(await readBody(req));
    const days = Math.max(1, Math.min(3650, Number(b.get('days')) || 30));
    const count = Math.max(1, Math.min(50, Number(b.get('count')) || 5));
    let minted = null;
    try {
      const apps = await store.listApps();
      const app = apps.find(a => a.slug === b.get('slug'));
      if (app) {
        const codes = [];
        for (let i = 0; i < count; i++) codes.push(store.mintCode(app.prefix, days));
        minted = { days, codes };
      }
    } catch (e) { console.error('mint:', e.message); }
    return renderConsole(res, minted);
  }

  /* Clicking refresh should show new figures if they arrive quickly, but must
     not hang the page if Render is slow. Three seconds, then draw regardless —
     the refresh carries on in the background either way. */
  if (url.searchParams.get('refresh')) {
    cache.at = 0;
    if (RENDER_KEY) {
      await Promise.race([
        refreshHosting(),
        new Promise(r => setTimeout(r, 3000))
      ]).catch(() => {});
    }
  }

  return renderConsole(res, null);
});

/* Every part is fetched on its own and failures are contained: the customer
   list still renders when Render's API is down, and the hosting panel still
   renders when the database is. A console that goes blank when one thing
   breaks is a console you stop trusting. */
async function renderConsole(res, minted, notice) {
  let apps = [];
  try { apps = await store.listApps(); } catch (e) { /* db down: no launcher */ }

  let tenants = [], problems = [], alerts = [], kpis = {};
  try {
    const t = await store.tenants();
    tenants = t.tenants;
    problems = t.problems;
    alerts = store.tenantAlerts(tenants);
    kpis = store.tenantKpis(tenants);
  } catch (e) {
    problems = [e.message];
    console.error('tenants failed:', e.message);
  }

  /* Each of these is wrapped on its own so one broken panel cannot take the
     whole console down with it — the same rule the tenant list follows. */
  let support = null;
  try { support = await store.supportInbox(); }
  catch (e) { console.error('support inbox failed:', e.message); }

  let health = [];
  try { health = store.healthChecks(); }
  catch (e) { console.error('health checks failed:', e.message); }

  /* Never awaited — see hostingNow(). The page goes out now with whatever
     hosting figures exist, and the refresh lands in time for the next load. */
  const hosting = hostingNow();

  send(res, 200, dashboard(hosting.data, hosting.error, apps, tenants, alerts, kpis, problems,
                           minted, support, health, notice, hosting.loading));
}

store.init().catch(e => console.error('store init failed:', e.message));

server.listen(PORT, () => {
  console.log(`My Apps listening on ${PORT} (build ${BUILD})`);
  if (!PASSWORD) console.log('WARNING: APP_PASSWORD is not set — nobody can sign in.');
  if (!RENDER_KEY) console.log('WARNING: RENDER_API_KEY is not set — no data to show.');
});
