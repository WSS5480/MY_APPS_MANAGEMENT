# 360 MEDICAL - SURGICAL CASE TRACKER

Case log, quota pace, commission estimates and target-surgeon pathway for 360 Medical reps, with an admin page and an installable app (Windows, iPhone, Android).

Lives on branch `surgical-case-tracker` of MY_APPS_MANAGEMENT; Render service `360-medical-surgical-case-tracker` in the MY APPS workspace.

## Pages
- `/` tracker. Admin (COO) sees the team view, scorecard, every rep and private COO notes. A rep sees only their own quota, cases, targets and SIM events (enforced on the server).
- `/admin` reps and plans (quota, counts, product, carry, commission %, floor, draw/salary, SIM quota), PINs, access on/off, rename (moves their records), admin PIN, backup/restore.
- `/download` install steps + QR code. `/login` sign-in.

## Render env
- `DATABASE_URL` Postgres connection string (table `sct360_docs`). Without it data is kept in a local file and resets when the service restarts.
- `ADMIN_PIN` starting admin PIN (change it from /admin afterwards).
- `SESSION_SECRET` long random string.
