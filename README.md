# MY_APPS_MANAGEMENT
## Karaoke Sign-Up (bars & DJs)

Karaoke runs in its own Render workspace ("Karaoke") with its own database, so My Apps talks to it over HTTPS instead of reading its tables.

- Registered automatically as app `karaoke`, code prefix **KAR**, 14-day free trial (`TRIAL_DAYS_KARAOKE` to change).
- Set on this service: `KARAOKE_URL` (e.g. `https://the-dive-karaoke.onrender.com`) and `APP_SECRET_KARAOKE` (same value as Karaoke's `MYAPPS_SECRET`).
- Console → Customers → **Karaoke Sign-Up**: every bar/DJ with plan, hosts, songs sung. Set plan (pushed to Karaoke right away), **Reset PIN**, **Turn off / Turn on**, open host page.
- **Give someone free time** → pick Karaoke Sign-Up → codes like `KAR-30D-XXXX-XXXXXX` that bars enter on sign-up or in Setup.
- `/api/v1/tenant-paid` lets Karaoke report Stripe card subscriptions so they show as Paid here.
- Full Karaoke build guide: https://github.com/WSS5480/Karaoke#readme
