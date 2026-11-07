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
| 2026-11-06 | Owner PIN is the same as Dev Billing | Steve |
| 2026-11-06 | Deployed as Render service dealer-system (free plan) with its own Basic-256mb database; servetrack deleted to make room under the Hobby 25-service cap | Steve |
| 2026-11-06 | Build the rest: everything that needs no outside account now; each outside connection switches on when its key is pasted into Settings → Integrations | Steve: "Build the rest" |
| 2026-11-06 | Texting and card/ACH processor still pending | Steve |
| 2026-11-06 | E-sign: built-in signature pad with e-sign consent (no outside account) | Steve |
| 2026-11-06 | Payroll: commissions + hours, exported to the payroll company (no tax withholding in-app) | Steve |
| 2026-11-06 | Paperwork: all states, set per store (generic forms + state fee table + links to official state forms) | Steve |
| 2026-11-06 | Service video goes to cloud storage (Cloudflare R2 recommended); photos stored in-app now | Steve |
| 2026-11-06 | Market pricing from a bought data feed (MarketCheck recommended) | Steve |
| 2026-11-06 | Backups: Render's own database backups only | Steve |
| 2026-11-06 | Data sources picked: MarketCheck, VinAudit, Cloudflare R2, Telnyx, 700Credit, PassTime, Repay/Stripe, Black Book; RouteOne/OEM/Metro 2 need certification | Steve: "Find a good data source api for all" |
| 2026-11-06 | Independent reviewers check every phase before it ships | Steve: "Get our trusted reviewers to check once you're done" |

### Defaults Claude chose that Steve has not reviewed yet
- 2026-11-06 — **Sales reps don't see vehicle cost**, floorplan details or recon cost; they see price. Reason: industry norm (protects front gross). Easy to change.
- 2026-11-06 — **Who sees what:** loans/payments/collector notes → finance, collector, accounting; deals → sales, finance, accounting; leads/appraisals → sales, finance; repair orders/claims/parts → service, parts, accounting. Owner and managers see all. Reason: least access needed for each job.
- 2026-11-06 — **One-store staff stay in their store:** no store picker, a one-store manager can only add/edit staff for that store and can't create managers. Nobody can change their own role, store or access.
- 2026-11-06 — **With several stores, money entries need a store:** counter sales, manual journal entries, bank imports and bank reconciliation. Reason: each store has its own books and bank account.
- 2026-11-06 — **Drawer count** shows only in-house cash payments as "expected cash"; other cash receipts are listed separately for reference.
- Automatic late fees (store setting): one fee per missed installment, only for payments that go late after the setting is turned on.
- FTC Buyers Guide: the app prints the fill-in details and points to the FTC's official forms (wording and layout are set by federal rule), rather than redrawing the form.
- Website credit application collects no Social Security number until a credit-pull service is connected.
- Website leads rotate among salespeople when lead routing is on (off by default).
- Offline mode is read-only and the cached data is cleared at sign-out.
- Signed-in session lasts 12 hours (one shift); the trusted-device period is 30 days as decided.
- Roles: owner, manager, sales, finance, collector, service, parts, accounting — and what each can change.
- Chart of accounts and department grouping for the P&L.
- Trade-ins go on the books at actual cash value; over-allowance reduces vehicle sales.
- Precomputed loans: a partial payment earns the matching share of that installment's scheduled interest.
- Printed finance page is a worksheet; the dealer signs their state-approved contract form.
