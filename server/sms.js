/* Text messages (SMS) for the Surgical Case Tracker, sent through Twilio.
   Settings come from Admin → Text alerts (doc config/sms); TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM
   (a phone number) or TWILIO_MESSAGING_SERVICE_SID on the host are the fallback. send() never throws.
   Numbers are kept in E.164 (+1XXXXXXXXXX). */
'use strict';
const crypto = require('crypto');

function resolve(cfg) {
  const c = Object.assign({}, cfg || {});
  const sid = c.sid || process.env.TWILIO_ACCOUNT_SID || '', token = c.token || process.env.TWILIO_AUTH_TOKEN || '';
  const from = c.from || process.env.TWILIO_FROM || '', msid = c.msid || process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  if (!sid || !token || (!from && !msid)) return null;
  return { sid, token, from, msid };
}
// what Admin shows about the setup, never the token itself
function info(cfg) {
  const r = resolve(cfg);
  if (!r) return { ready: false, text: 'Not set up yet: paste the Twilio Account SID, Auth token and the number texts come from.' };
  return { ready: true, text: 'Ready: texts go out from ' + (r.msid ? 'messaging service ' + r.msid.slice(0, 6) + '…' : fmtPhone(r.from)) + ' (account ' + r.sid.slice(0, 6) + '…).' };
}
// "(956) 555-0123", "956-555-0123", "+1 956 555 0123" → "+19565550123"; anything else → ''
function normalize(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && /^[2-9]/.test(d)) return '+1' + d;
  if (d.length === 11 && d[0] === '1' && /^[2-9]/.test(d[1])) return '+' + d;
  if (/^\+?[1-9]\d{7,14}$/.test(String(raw || '').replace(/[\s()-]/g, '')) && d.length >= 8) return '+' + d; // other countries
  return '';
}
function fmtPhone(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(e164 || '')); return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : String(e164 || '');
}
function masked(e164) { const s = String(e164 || ''); return s.length > 4 ? '•••' + s.slice(-4) : s; }

async function send(cfg, { to, body }) {
  const c = resolve(cfg);
  if (!c) return { ok: false, error: 'Text messages are not set up.', code: 'not_configured' };
  const num = normalize(to); if (!num) return { ok: false, error: 'That mobile number does not look right.', code: 'bad_number' };
  const text = String(body || '').trim().slice(0, 640);
  if (!text) return { ok: false, error: 'Nothing to send.', code: 'empty' };
  const form = new URLSearchParams({ To: num, Body: text });
  if (c.msid) form.set('MessagingServiceSid', c.msid); else form.set('From', c.from);
  try {
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(c.sid) + '/Messages.json', {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(c.sid + ':' + c.token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form, signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = Number(j.code) || r.status, msg = String(j.message || ('Twilio answered ' + r.status)).split('\n')[0].slice(0, 200);
      // 21610 = this person replied STOP; 21211 = not a valid number; 20003 = wrong SID/token; 21606/21608 = number not usable from this account
      return { ok: false, error: msg, code: code, stopped: code === 21610, badNumber: code === 21211 || code === 21614, auth: code === 20003 };
    }
    return { ok: true, sid: j.sid, status: j.status };
  } catch (e) { return { ok: false, error: 'Could not reach Twilio: ' + String(e.message || e).slice(0, 120), code: 'network' }; }
}
// Twilio signs each webhook call: HMAC-SHA1 over the full URL + the POST fields (sorted by name, name+value concatenated), base64
function validSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params || {}).sort().map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const code6 = () => String(crypto.randomInt(100000, 1000000));

module.exports = { resolve, info, normalize, fmtPhone, masked, send, validSignature, code6 };
