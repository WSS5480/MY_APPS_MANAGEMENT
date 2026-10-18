# Band Tips

A tip jar + follow page for bands playing live, sold by Stemo Enterprises LLC.

- `/<band>` — the fan page: tip the band (Venmo, Cash App, PayPal open with the amount filled in; Zelle and Apple Cash show the handle), follow buttons, shout-outs / song requests
- `/<band>/poster` — printable QR poster
- `/<band>/setup` — the band's own page (PIN): logo, name, tagline, "tonight at", tip buttons, payment handles, socials, tonight's tips and messages, plan, codes, card checkout
- `/start` — sign up a band: 14-day free trial, or a code from My Apps (`BND-30D-XXXX-XXXXXX`)

Tips never pass through the app. A tap is logged so the band sees tonight's tips; the money moves inside the fan's own payment app.

## Render

Node web service, `npm install` / `npm start`. Environment:

| Variable | What |
|---|---|
| `MYAPPS_URL` | the My Apps console, e.g. `https://my-apps-management.onrender.com` |
| `MYAPPS_SECRET` | same value as `APP_SECRET_BANDS` on My Apps (used for codes, trials, plans, and the band list) |
| `MYAPPS_SLUG` | `bands` (default) |
| `DATABASE_URL` | optional. When unset, the app asks My Apps for the shared database (`SHARED_DB_APPS=bands` there) and uses schema `bands` in it |
| `PRICE_TEXT` | shown to bands, default `$19/month` |
| `TRIAL_DAYS` | default 14 |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | optional card payments (webhook at `/api/stripe/webhook`) |
| `PRODUCT_NAME`, `COMPANY_NAME`, `SUPPORT_EMAIL` | branding in the pages |

My Apps lists every band (`GET /api/platform/bands`, header `x-platform-key`), sets plans, resets PINs and turns bands off (`POST /api/platform/bands/<slug>`).
