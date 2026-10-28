/* Email for the Surgical Case Tracker: Microsoft 365 (Graph) sending, the same app registration the peptide store uses.
   Settings come from Admin → Approval emails (doc config/mail); GRAPH_TENANT / GRAPH_CLIENT / GRAPH_SECRET / MAIL_FROM / COO_EMAIL
   on the host are the fallback. send() never throws. */
'use strict';
let tok = { key: '', token: '', exp: 0 };

function resolve(cfg) {
  const c = Object.assign({}, cfg || {});
  const tenant = c.tenant || process.env.GRAPH_TENANT || '', client = c.client || process.env.GRAPH_CLIENT || '', secret = c.secret || process.env.GRAPH_SECRET || '';
  const mailbox = c.mailbox || process.env.MAIL_FROM_MAILBOX || process.env.MAIL_FROM || 'no-reply@360medical.net';
  const from = c.from || process.env.MAIL_FROM || mailbox;
  const to = c.to || process.env.COO_EMAIL || '';
  if (!tenant || !client || !secret) return null;
  return { tenant, client, secret, mailbox: (/<([^>]+)>/.exec(mailbox) || [0, mailbox])[1].trim(), from, to };
}
async function token(c) {
  const key = [c.tenant, c.client, c.secret].join('|');
  if (tok.key === key && tok.exp > Date.now() + 60000) return tok.token;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client, client_secret: c.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Microsoft wouldn't issue a token: " + String(j.error_description || j.error || r.status).split('\n')[0].slice(0, 200));
  tok = { key, token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function graphSend(c, { to, subject, text, html, replyTo }) {
  const t = await token(c);
  const m = /^(.*?)<([^>]+)>$/.exec(c.from);
  const fromAddr = m ? m[2].trim() : c.from, fromName = m ? m[1].trim().replace(/^"|"$/g, '') : '';
  const message = {
    subject, body: { contentType: html ? 'HTML' : 'Text', content: html || text },
    toRecipients: to.map((address) => ({ emailAddress: { address } })),
    ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
    ...(fromAddr && fromAddr.toLowerCase() !== c.mailbox.toLowerCase() ? { from: { emailAddress: { address: fromAddr, ...(fromName ? { name: fromName } : {}) } } } : fromName ? { from: { emailAddress: { address: c.mailbox, name: fromName } } } : {})
  };
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/sendMail`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true })
  });
  if (r.status === 202) return;
  const j = await r.json().catch(() => ({}));
  const msg = (j.error && j.error.message) || `Graph answered ${r.status}`;
  if (r.status === 401 || r.status === 403) throw new Error('Microsoft refused: ' + msg + ' — check the app has Mail.Send (application) permission with admin consent, and the mailbox address.');
  if (r.status === 404) throw new Error("Microsoft can't find that mailbox: " + c.mailbox);
  throw new Error(msg);
}
// { ok: true } or { ok: false, error }
async function send(cfg, { to, subject, text, html, replyTo }) {
  const c = resolve(cfg);
  if (!c) return { ok: false, error: "Email isn't set up yet: add the Microsoft 365 app under Admin → Approval emails." };
  const list = (Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim()).filter(Boolean);
  if (!list.length) return { ok: false, error: 'No address to send to — add the COO email under Admin → Approval emails.' };
  try { await graphSend(c, { to: list, subject, text, html, replyTo }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}
const info = (cfg) => { const c = resolve(cfg); return c ? `Microsoft 365 app · sends as ${c.from} · to ${c.to || '(no COO address yet)'}` : 'not set up'; };
module.exports = { send, resolve, info };
