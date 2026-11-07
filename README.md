# Dealer System

Dealer management for independent, buy-here-pay-here and multi-store dealer groups: inventory, leads, customers, deal desk with F&I, in-house financing (BHPH) servicing, collections, repos, service repair orders with text-to-approve inspections, parts, warranty claims, double-entry accounting, reports, a customer pay page, and settings.

- `server.js` — Express + Postgres. Records live in `rec` (JSONB per kind); every money move posts a balanced entry to `jrnl`. Tables are created in the schema named by `DB_SCHEMA` (default `dealer`).
- `public/app.js` — the phone-first app; `public/login.html`, `pay.html` (customer balance page), `approve.html` (inspection approval link).
- `test.js` — end-to-end checks against a running server: `BASE=http://localhost:10000 OWNER_PIN=… node test.js`.

Env vars: `DATABASE_URL`, `OWNER_PIN`, `SESSION_SECRET`, `API_TOKEN` (optional, for the open API), `DB_SCHEMA` (optional).

## Decision log

| Date | Decision | Why / who |
|---|---|---|
| 2026-11-06 | Standalone app (not an ERP module), sold to dealers | Steve |
| 2026-11-06 | Built for independent + BHPH first; big-franchise modules (service, parts, warranty, multi-store, F&I) included | Steve: "Build it all" |
| 2026-11-06 | One copy per dealer group. A group with several dealerships shares one copy across its stores; separate dealers get separate copies | Steve: "Only shared if they have multiple dealerships" |
| 2026-11-06 | Sign-in is PIN + phone code. Code asked on a new device and every 30 days | Steve |
| 2026-11-06 | Texting service for the code is **pending** — until connected, staff sign in with PIN only and managers see a warning banner | Steve: "Leave as a pending item" |
| 2026-11-06 | In-house interest method is picked per deal: simple interest by the day, or precomputed | Steve |
| 2026-11-06 | Precomputed early payoff refunds unearned interest by the actuarial method | Steve |
| 2026-11-06 | Payment order (fees first, or fees last) is a per-store setting; payments are refused until it's set | Steve: "Dealer sets it" |
| 2026-11-06 | No numbers are prefilled (tax, doc fee, late fee, grace days, labor rate, APR/term). Delivery is refused until the needed setup is entered | Steve: "Blank — dealer enters them" |
| 2026-11-06 | Hosting: new Render web service (free plan for now) + its own new paid Postgres (Basic-256mb) in the MY APPS workspace | Steve |
| 2026-11-06 | Name: "Dealer System" is a placeholder; name and selling company to come | Steve: "I'll name it later" |

### Defaults Claude chose that Steve has not reviewed yet
- Signed-in session lasts 12 hours (one shift); the trusted-device period is 30 days as decided.
- Roles: owner, manager, sales, finance, collector, service, parts, accounting — and what each can change.
- Chart of accounts and department grouping for the P&L.
- Trade-ins go on the books at actual cash value; over-allowance reduces vehicle sales.
- Precomputed loans: a partial payment earns the matching share of that installment's scheduled interest.
- Printed finance page is a worksheet; the dealer signs their state-approved contract form.
