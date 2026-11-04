# Dev Billing (Stemo Enterprises)

Estimates, scope of work, final bills, monthly costs and licensing for app builds, with build history from GitHub + Render.

- `server.js` — Express + Postgres (`docs` table), PIN login
- `public/index.html` — the app; `public/shim.js` — connects it to this server's API

Env vars: `DATABASE_URL`, `APP_PIN`, `SESSION_SECRET`, `SYNC_TOKEN` (for scripted history sync).
