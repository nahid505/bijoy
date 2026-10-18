# বিজয় লেনদেন (Bijoy Lenden)

A Bangla-first, **double-entry** accounting, inventory, sales (POS) and customer-credit (বাকি) system for Bangladeshi businesses. It covers vouchers, ledgers, inventory with batches, parties with credit terms and aging, financial statements, backup/restore, multiple businesses and role-based access. The UI can switch between Bangla and English.

**Stack:** Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · Prisma 6 · Zod · Vitest · Docker

---

## What it does

| Area | Features |
|---|---|
| **Accounting core** | Chart of accounts (groups × ledgers, five natures), journal entries, and a balanced-voucher engine: *Σ debit = Σ credit or the voucher is rejected*. Every save runs inside one DB transaction |
| **POS (পস বিক্রয়)** | Search or scan by name / code / barcode (Enter adds to cart), cash / credit / partial sale, discount, VAT, **split payment** across cash, bKash/mobile banking and bank with references, tendered/change, due date, credit-limit warning, F2/F9 shortcuts, "save & print" |
| **Vouchers (লেনদেন)** | Receipt, Payment, Journal, Sales, Purchase, Sales Return, Purchase Return, Stock Journal. Auto numbering (RV/PV/JV/INV/PUR/SR/PR/SJ), edit (reverse & repost), delete, invoice / money-receipt print with the amount in Bangla words. Returns are created *against an invoice* and are limited to the quantity still returnable |
| **Customer credit (বাকি ও আদায়)** | Opening balance, credit limit (enforced on the server), credit days → due date, FIFO aging (0–30 / 31–60 / 61–90 / 90+), overdue dues, partial collection, invoice and payment history, printable / WhatsApp-shareable statement, customer and supplier dues lists |
| **Books (হিসাব)** | Ledger for any account, Cash Book, Bank Book, Debtors (দেনাদার), Creditors (পাওনাদার) |
| **Inventory (পণ্য)** | Products (code, barcode, category, brand, unit, purchase/sale/wholesale price, minimum stock, opening stock & value), units with conversions (1 বস্তা = 50 কেজি), warehouses, optional **batch / expiry** tracking, stock adjustments, movement history, moving-average cost, stock card, low-stock and expiry alerts |
| **Expiry management (মেয়াদ)** | Batches / lots as their own table (batch no, manufacturing & expiry date, supplier, purchase date, purchase & sale price, quantity); one product can have many batches. Status 🔴 expired · 🟠 expiring today / within 7·15·30·60 days · 🟢 valid, with warning periods set per business. **FEFO**: a sale without a batch takes the earliest unexpired batch (splitting across batches when needed); expired stock is never picked automatically and cannot be sold unless an admin allows it ("এই পণ্যের মেয়াদ শেষ হয়ে গেছে। বিক্রি করা যাবে না।"). Batch list with filters/sorting, dashboard expiry cards, write-off of expired stock (Dr মেয়াদোত্তীর্ণ পণ্যের ক্ষতি / Cr inventory, audited), five expiry reports |
| **Notifications (নোটিফিকেশন)** | A daily background check (runs inside the app, Docker-compatible) records expired / expiring batches, low stock and overdue customer dues. Each alert is created once (no duplicates). Reading an alert does not remove it: it moves to history when the problem is solved. A bell in the header shows the unread count |
| **SMS (এসএমএস)** | Automatic SMS for customers (invoice, payment, due reminder, return, cancellation) and suppliers (purchase, payment, return, statement); low-stock and expiry alerts (90/60/30/15/7 days); OTP for registration, login (optional 2-step) and password reset; new-login alerts. Manual SMS to one customer, selected customers, a customer group or a dues segment, with confirmation, rate limits and same-day duplicate blocking. Templates with variables, Bangla/Unicode multi-part counting, a database queue with retries, delivery reports, a log with cost, a dashboard with balance and low-balance alert. Provider-independent: BulkSMSBD, generic HTTP, demo |
| **Accounting integrity** | Backdated transactions re-cost every later sale (COGS) and reject any date where stock would go negative; a database trigger refuses any unbalanced voucher at commit; period lock date; an integrity report reconciles party ledgers, stock and the trial balance |
| **Reports (রিপোর্ট)** | Daily summary, Day Book, Ledger, Trial Balance, Profit & Loss, Balance Sheet, Cash Flow, Cash/Bank Book, Stock, Stock valuation, Expiry, Customer/Supplier dues & statements, Collection, Expenses, Sales, Purchase, Income-Expense, Integrity. All support filters, print/PDF, **Excel (XLSX)** and CSV export |
| **Dashboard** | Today's sales, purchases, collection, expenses and profit; receivable, payable, cash, bank, stock value; overdue dues; low stock; expiring batches; recent sales and payments; 30-day and monthly sales-vs-collection charts; seven quick actions |
| **Multi-business** | Business profile (logo, address, BIN/TIN, trade licence, fiscal year, currency, invoice settings, lock date). A user can belong to several businesses and only ever sees the selected one |
| **Users & roles** | Owner, Admin, Manager, Accountant, Salesperson, Purchase, Viewer (editable, per business), with granular permissions checked on the server. Audit log of every change with before/after snapshots |
| **Backup & restore** | Versioned, SHA-256-checksummed JSON backup per business; validation (checksum, references, balance) before restore; restore always creates a **new** business and verifies its trial balance. Plus `pg_dump` instructions for full backups |

---

## Run with Docker (recommended)

```bash
cp .env.example .env        # then set real secrets (see below)
docker compose up -d --build
# open http://localhost:3000 and log in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

Startup order: `db` (healthy) → `migrate` (runs `prisma migrate deploy` and the idempotent seed) → `app`.

```bash
docker compose ps              # status (app has a healthcheck)
docker compose logs -f app     # logs
docker compose down            # stop, keep data
docker compose down -v         # stop and DELETE all data
```

## Local development (app on host, DB in Docker)

Requires Node.js ≥ 22.9.

```bash
cp .env.example .env           # DATABASE_URL must use 127.0.0.1 and DB_PORT
npm install
docker compose up -d db
npm run db:deploy              # apply migrations
npm run db:seed                # admin + business (+ demo data if SEED_DEMO_DATA=true)
npm run dev                    # http://localhost:3000
```

If port 5432 is taken, set `DB_PORT=5433` and use the same port in `DATABASE_URL` / `TEST_DATABASE_URL`.

## Tests

```bash
docker compose exec db createdb -U <POSTGRES_USER> bijoy_lenden_test   # once
npm test            # unit tests + integration tests against TEST_DATABASE_URL
npm run check       # typecheck + lint (zero warnings) + tests
npm run build       # production build
```

Integration tests (`tests/integration`) post real vouchers through the services into the separate test database. They cover sale, purchase, receipt, payment, journal, both returns, stock journal, stock updates, customer and supplier dues, trial balance, P&L and balance sheet, edit/delete rules and tenant isolation. They also cover split payments, credit limits, the database balance trigger, return limits, backdated COGS revaluation, batches, FIFO aging, the lock date, and backup export → tamper detection → restore. Expiry tests cover expired detection, the 7/15/30/60-day warnings, multiple batches, FEFO, the expired-sale rule, batch stock deduction, duplicate-free notifications, write-off and its journal entry, and backup of batches. They also assert *Σ debit = Σ credit* for every voucher. They are skipped if `TEST_DATABASE_URL` is unset, and the setup refuses to run against the development database.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Develop / build / serve |
| `npm run typecheck` · `lint` · `test` · `check` | Quality gates |
| `npm run db:migrate` | Create a migration after editing `prisma/schema.prisma` (dev) |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Idempotent seed (TypeScript, reuses the accounting services) |
| `npm run db:studio` | Prisma Studio |
| `npm run deploy:cpanel` | Clean build → trimmed cPanel / Recohost package `dist/deploy.tar.gz` (with `SHA256SUMS.txt`); steps in [deploy-guide.md](deploy-guide.md) |
| `npm run audit:integrity` | Read-only data-integrity audit of the database |

## Environment

All secrets come from the environment. `.env` is git- and docker-ignored. See [`.env.example`](.env.example).

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL URL (Compose builds its own for containers) |
| `AUTH_SECRET` | ≥ 32 random chars: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | DB bootstrap (URL-safe password) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | First admin, only when no users exist |
| `SEED_BUSINESS_NAME` | First business name |
| `SEED_DEMO_DATA` / `SEED_DEMO_BUSINESS_NAME` | `true` creates a separate demo business (default name "রহমান এন্টারপ্রাইজ (ডেমো)") with realistic data |
| `TEST_DATABASE_URL` | Separate DB for integration tests |
| `DISABLE_SCHEDULER` / `SCHEDULER_INTERVAL_MINUTES` | In-app daily check (default on, ticks hourly, runs once per business per day) |
| `CRON_SECRET` | Optional: enables `POST /api/cron/daily-check` (Bearer token) for an external scheduler |
| `COOKIE_SECURE` | `true` behind HTTPS (Secure cookies, HSTS, `upgrade-insecure-requests`) |
| `TRUSTED_PROXY_HOPS` | Trusted reverse proxies in front of the app (`1` with the bundled Caddy). `0` = forwarded headers are never trusted |
| `APP_BIND` / `APP_DOMAIN` | Interface the app port is published on (default `0.0.0.0` = local network; `127.0.0.1` = this computer only) / domain for the HTTPS proxy |

## Production checklist
- HTTPS: `docker compose --profile https up -d` with `APP_DOMAIN`, `COOKIE_SECURE=true` and `TRUSTED_PROXY_HOPS=1` in `.env` (Caddy obtains certificates and sends HSTS). Keep `APP_BIND=127.0.0.1` so nothing bypasses the proxy.
- Strong unique secrets; change the admin password after first login.
- Scheduled `pg_dump` backups (see the **ব্যাকআপ** page).
- Run the built app with `node .next/standalone/server.js` (what the Docker image does), not `next start`. `next start` does not support `output: "standalone"`.

## Security model (summary)
- Server-side sessions: the cookie only names a session row. Logout revokes that session; a password change or an admin password reset revokes every session of the user immediately.
- Login protection is stored in PostgreSQL and shared by all instances. An account locks for 15 min after 5 attempts, whatever address the attempts come from. Behind a trusted proxy, each client address is also limited to 20 attempts per 15 min.
- Content-Security-Policy with a per-request script nonce, `frame-ancestors none`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP; HSTS on HTTPS deployments.

## Known limitations
- English translation covers navigation, page headers, the dashboard and common UI. Reports, forms and printed documents stay in Bangla, and numerals are always Bangla.
- PDFs are produced with the browser's "Print → Save as PDF" (A4 print styles); there is no server-side PDF renderer.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the accounting model and design.
