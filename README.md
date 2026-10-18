# MY_APPS_MANAGEMENT
## Karaoke Sign-Up (bars & DJs)

Karaoke runs in its own Render workspace ("Karaoke") with its own database, so My Apps talks to it over HTTPS instead of reading its tables.

- Registered automatically as app `karaoke`, code prefix **KAR**, 14-day free trial (`TRIAL_DAYS_KARAOKE` to change).
- Set on this service: `KARAOKE_URL` (e.g. `https://the-dive-karaoke.onrender.com`) and `APP_SECRET_KARAOKE` (same value as Karaoke's `MYAPPS_SECRET`).
- Console → Customers → **Karaoke Sign-Up**: every bar/DJ with plan, hosts, songs sung. Set plan (pushed to Karaoke right away), **Reset PIN**, **Turn off / Turn on**, open host page.
- **Give someone free time** → pick Karaoke Sign-Up → codes like `KAR-30D-XXXX-XXXXXX` that bars enter on sign-up or in Setup.
- `/api/v1/tenant-paid` lets Karaoke report Stripe card subscriptions so they show as Paid here.
- Full Karaoke build guide: https://github.com/WSS5480/Karaoke#readme

## Band Tips (tip jar + follow page for bands)

Band Tips is its own Render service (repo `WSS5480/BAND-TIPS`), so My Apps talks to it over HTTPS like Karaoke.

- Registered automatically as app `bands`, code prefix **BND**, 14-day free trial (`TRIAL_DAYS_BANDS` to change).
- Set on this service: `BANDS_URL` (e.g. `https://band-tips.onrender.com`) and `APP_SECRET_BANDS` (same value as Band Tips' `MYAPPS_SECRET`).
- `SHARED_DB_APPS=bands` lets Band Tips use this service's database (schema `bands`) — it asks for the connection string at start-up with its secret (`/api/v1/shared-db`), so nothing is copied by hand.
- Console → Customers → **Band Tips**: every band with plan, tips and $ tipped. Set plan (pushed to Band Tips right away), **Reset PIN**, **Turn off / Turn on**, open setup page / fan page.
- **Give someone free time** → pick Band Tips → codes like `BND-30D-XXXX-XXXXXX` that bands enter on sign-up or on their setup page. "Copy message" gives a text with the sign-up link and the code.
