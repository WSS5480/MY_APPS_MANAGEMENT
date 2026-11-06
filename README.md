# MNA de México — Sistema de Operación de Procesos

Operating system for Sales and Accounting built from Baseline Consulting's process diagnostic (Sep-2026).
Spanish (Guatemala, formal "usted") with an English switch at the top of every screen.

- Stack: Node 20+ · Express · PostgreSQL (`DATABASE_URL`). No build step.
- Boot: creates/updates tables automatically and loads demo data when the database is empty.
- Env: `DATABASE_URL`, `SESSION_SECRET`, optional `DEMO_MODE=0` to hide demo PINs on the login screen.
- Tests: `node test/smoke.js` (every module/report for every role) and `node test/flows.js` (end-to-end workflows).

Modules: sales (orders/quotes, blanket orders, promotions, price approvals, credit notes, segmentation, forecast),
warehouse & production (stock, capture lag, lots, production orders, WIP, settlement), logistics (load planning, driver delivery confirmation with photo/GPS, freight vs actual, double freight),
billing & collections (billing queue, invoices, cash application, A/R aging, credit scoring), purchasing (requisitions, POs, goods receipts, supplier portal with CFDI XML + 3-way match, payments),
finance & close (pre-close calendar, close tasks, bank reconciliation auto-match, balance sheet reconciliations with dual signature, intercompany, payroll, DIOT, e-accounting XML),
fixed assets (register, book & tax depreciation runs, journal export, capitalization policy), costing (BOMs, overhead pools, standard cost, variances, cost statement, profitability),
governance (policies with acknowledgments, RACI, segregation of duties, corrective actions), users/roles and audit log.
