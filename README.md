# 360 MEDICAL - SURGICAL CASE TRACKER

Case log, quota pace, commission estimates and target-surgeon pathway for 360 Medical reps, with an admin page and an installable app (Windows, iPhone, Android).

Lives on branch `surgical-case-tracker` of MY_APPS_MANAGEMENT; Render service `360-medical-surgical-case-tracker` in the MY APPS workspace.

## Pages
- `/` tracker. Admin (COO) sees the team view, scorecard, every rep and private COO notes. A rep sees only their own quota, cases, targets and SIM events (enforced on the server).
- `/admin` reps and plans (quota, counts, product, carry, commission %, floor, draw/salary, SIM quota), PINs, access on/off, rename (moves their records), admin PIN, backup/restore.
- `/download` install steps + QR code. `/login` sign-in.

## Features
- Case log with barcode/UDI scan (camera or keyboard scanner; GS1 lot/expiry parsed; FDA AccessGUDID lookup), lot and expiration fields, case time.
- Price book (Admin): net sales auto-fill as units × contract price; off-contract cases flagged.
- Billing pipeline: Completed → PO received → Invoiced → Paid with auto-dated steps, aging, days-to-bill, PO/sticker-sheet photos on each case.
- Checks: required fields before a case counts, PO # before PO received/Invoiced/Paid, duplicate warning, patient-identifier detector.
- Change history on every case (server audit log); COO can close a month to lock it.
- Commission statement per rep and month, printable to PDF.
- Upcoming 14 days + private calendar feed (/cal/…ics) for iPhone/Google/Outlook.
- Surgeon preference cards (prefill cases), pathway visit log with next steps, hospital vendor credential tracker.
- Target visit calendar (month + agenda) for each rep and for all reps in Admin. Reps plan visits; at the visit they tap Check in and the phone's location (one reading, at that moment) is compared with the facility address (Admin → Facilities, geocoded with OpenStreetMap) and the visit window. Green = verified, red = not at the facility / outside the window / missed (COO gets a push alert), amber = facility has no address.
- Voice dictation on notes; works offline (changes queue on the device and sync later).
- Weekly digest push notifications (Monday morning) via web push; Render cron job `360-medical-weekly-digest` wakes the service.

## Sign-in
- Sales reps: PIN, or (once invited) email + password + authenticator app code; Face ID / passkey on their phone.
- Managers: invited from Admin → Sign-in accounts (setup link, password, authenticator app), Face ID on phone. "Can manage managers" = can add/remove accounts and change the COO PIN. The COO PIN sign-in can be turned off once a manager account exists.
- Computers sign out after 10 minutes without activity (IDLE_MIN env to change); phones stay signed in 30 days.

## Render env
- `DATABASE_URL` Postgres connection string (table `sct360_docs`). Without it data is kept in a local file and resets when the service restarts.
- `ADMIN_PIN` starting admin PIN (change it from /admin afterwards).
- `SESSION_SECRET` long random string.
- `CRON_SECRET` shared with the cron job that triggers the Monday digest.
- `PUBLIC_URL` the public https address (used for calendar links).
