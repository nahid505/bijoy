# Architecture — বিজয় লেনদেন (Bijoy Lenden)

## 1. Principles

1. **The general ledger is the single source of truth.** Every balance, statement, report and dashboard figure is computed from `JournalEntry` rows (or, for quantities, `StockMovement` rows). Nothing is hard-coded or derived from UI state.
2. **Every voucher balances.** `prepareEntries()` in `src/lib/accounting.ts` rejects any voucher where Σ debit ≠ Σ credit (to the paisa), any negative or two-sided line, and any voucher with fewer than two lines. The database enforces the same rule independently: the deferred constraint trigger `JournalEntry_voucher_balanced` rejects any transaction that would commit an unbalanced voucher (SQLSTATE 23514), and CHECK constraints forbid negative or two-sided lines.
3. **All-or-nothing writes.** Each voucher (header + journal entries + inventory lines + stock movements) is written in one `prisma.$transaction`. A failure anywhere rolls everything back.
4. **Tenant isolation.** Every business-owned row has `businessId`. Services re-check that every referenced account, product, unit and warehouse belongs to the caller's business.

## 2. Layers

```
src/lib/                 pure, unit-tested: accounting rules, calc, validation (zod), permissions, formatting
src/server/services/     AccountingService · VoucherService · InventoryService · PostingService · LedgerService · ReportService
                         + aging · backup · bootstrap (new business, default roles) · master (parties/accounts/products) · dashboard
src/server/actions/      "use server" mutations: authorise → validate → service → audit (before/after) → flash toast → redirect
src/server/reports/      report registry (ReportDef → ReportResult) + CSV and XLSX (exceljs) export adapters
src/app/                 App Router pages (server components) · /api/reports/[slug] · /api/backup · /api/health
src/components/          UI: ledger-style tables, voucher forms (client), report renderer, sidebar
```

| Service | File | Responsibility |
|---|---|---|
| AccountingService | `services/accounting.ts` | System-account map, voucher numbering, tenant checks, writing balanced entries, opening balances |
| VoucherService | `services/voucher.ts` | Create / edit (reverse & repost) / delete for all 8 voucher types, in one transaction each |
| InventoryService | `services/inventory.ts` | Row-locking, per-warehouse (and per-batch) availability, stock movements, opening stock |
| PostingService | `services/posting.ts` | `repostVoucher` rebuilds a voucher's journal from its stored data; `revalueProducts` replays each product's timeline to re-cost later movements after a backdated change |
| Aging | `services/aging.ts` | FIFO allocation of payments to invoices → open items, due dates, overdue days, 0–30/31–60/61–90/90+ buckets |
| Backup | `services/backup.ts` | Versioned checksummed export, validation, restore into a new business with id remapping |
| LedgerService | `services/ledger.ts` | Balances, statements with running balance and counter-ledgers, cash/bank books, party summaries |
| ReportService | `services/report.ts` | Trial balance, profit & loss, balance sheet |

## 3. Data model

```
Business 1─* Membership *─1 User          Membership.role → Role (per business, permissions[])
Business 1─* AccountGroup 1─* Account (ledger)      nature: ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
Account  1─* JournalEntry *─1 Voucher (journal)     JournalEntry: debit | credit, date (denormalised)
Voucher  1─* VoucherItem *─1 Product                inventory lines (qty, unit, factor, rate, discount, cost)
Voucher  1─* StockMovement *─1 Product, Warehouse   quantityIn / quantityOut, unitCost, batchNo, expiryDate (linked to its VoucherItem)
Voucher  1─* VoucherPayment *─1 Account (cash/bank) split settlement lines with reference (e.g. bKash TrxID)
Voucher  0..1─* Voucher (returnOf → returns)        a return points at the invoice it reverses
Customer 1─1 Account (Sundry Debtors)   Supplier 1─1 Account (Sundry Creditors)   creditLimit, creditDays
Product  *─1 Unit (base)  Unit *─0..1 Unit (baseUnit, factor)   Product *─0..1 Category, Brand
AuditLog, Counter (gap-free numbering per business & voucher type)
```

How the requested concepts map onto the schema:

| Concept | Model |
|---|---|
| Ledger | `Account` |
| Journal | `Voucher` (header) + `JournalEntry` (lines) |
| Sale / SaleItem, Purchase / PurchaseItem, Invoice | `Voucher` of type SALES / PURCHASE (+ returns) with `VoucherItem` lines. The sales voucher *is* the invoice, printed from `/vouchers/v/[id]/print` |
| Receipt / Payment / Income / Expense | RECEIPT / PAYMENT vouchers against customer, supplier, income or expense ledgers |
| Permission | string keys on `Role.permissions` (catalogue in `src/lib/permissions.ts`) |

## 4. Posting rules (perpetual inventory)

| Voucher | Debit | Credit |
|---|---|---|
| **Sales** | Customer (total), Discount allowed, COGS (avg cost) | Sales (subtotal), VAT payable, Inventory (avg cost) |
| ↳ paid now | Cash/Bank | Customer |
| **Purchase** | Inventory (net total) | Supplier |
| ↳ paid now | Supplier | Cash/Bank |
| **Sales return** | Sales Return (total), Inventory (cost) | Customer, COGS |
| **Purchase return** | Supplier (total) | Inventory (avg cost); difference → COGS |
| **Receipt** | Cash/Bank (Σ lines) | each source ledger |
| **Payment** | each destination ledger | Cash/Bank (Σ lines) |
| **Journal** | any | any (must balance) |
| **Stock journal** | Inventory / Stock adjustment (value difference) | Stock adjustment / Inventory |
| **Opening** | account with a debit opening | Opening-balance equity (or reverse) |

Walk-in trades (no party) post the party side straight to the payment ledgers and must be fully paid. With a party, "paid now" is one settlement line per `VoucherPayment` (cash + bKash + bank can be mixed); the rest stays on the party ledger with `dueDate` = given date or invoice date + credit days. A credit sale that would push the customer above `creditLimit` is rejected on the server.

Opening balances (ledgers, customers, suppliers, opening stock) are **OPENING vouchers** dated on `Business.booksStartDate`, so the trial balance balances from day one.

**Inventory:** `StockMovement` is the truth for quantities. `Product.stock` and `Product.avgCost` are caches. Outgoing stock is checked per warehouse (and per batch for batch-tracked products) under `SELECT … FOR UPDATE` row locks taken in id order (no deadlocks). Alternative units convert via `unitConversionFactor` (same root unit only).

**Backdating and revaluation:** after any change that touches stock, `revalueProducts` replays every affected product's movements in (date, createdAt, id) order with a moving average. It re-costs each outgoing movement and each sales-return inflow, writes the new cost onto the voucher item and reposts every voucher whose COGS changed. A backdated purchase therefore corrects the COGS of every later sale. If the replay finds any date where stock would go negative, the whole transaction is rejected, with a message naming the product and date.

**Edits** clear the voucher's entries, items, payments and movements, rebuild them with the same number, and revalue. **Deletes** do the same and are refused while returns exist against the invoice. A return cannot exceed the quantity sold minus earlier returns. Every write is checked against `Business.lockDate`: nothing dated on or before the lock date can be created, edited or deleted.

## 5. Financial statements
- **Trial balance:** per ledger opening / period debit / period credit / closing. Totals must match.
- **Profit & loss:** direct income (sales − returns) − direct expenses (COGS) = gross profit; + other income − operating expenses = net profit. Sections come from `AccountGroup.isDirect`.
- **Balance sheet:** assets (Dr) = liabilities (Cr) + equity (Cr) + current profit. The report shows the check and any difference (always 0 by construction).

## 6. Security
- bcrypt (12) passwords. **Sessions are server-side** (`Session` table). The httpOnly, SameSite=Lax cookie (Secure behind HTTPS) is an HS256 JWT naming `{user, session}`. Every request (`getCurrentUser`) requires the session row to exist, be unrevoked and unexpired, and the user to be active:
  - logout revokes that session;
  - a password change or admin reset revokes all sessions, and the changing device gets a fresh one.
- **Login throttling** (`services/login-guard.ts`, `AuthThrottle` table):
  - Attempts are reserved atomically *before* the password check, so parallel guesses can't race past the limit.
  - Per account: 5 attempts per 15 min, then a 15-min lock, regardless of client address.
  - Per client address: 20 per 15 min, but only when the address is known.
- **Client address** (`lib/client-ip.ts`): `X-Forwarded-For` is ignored unless `TRUSTED_PROXY_HOPS` > 0. With trusted proxies, the client is the N-th entry from the right (the address the trusted proxy appended); everything further left is client-supplied. The bundled Caddy replaces client-supplied XFF.
- **Headers:** a per-request nonce CSP is set in the middleware (`script-src 'nonce-…' 'strict-dynamic'`, `object-src`/`frame-ancestors 'none'`). HSTS and `upgrade-insecure-requests` are added when `COOKIE_SECURE=true`. Static headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP) are in `next.config.ts`.
- The selected business comes from a cookie but is **always** validated against the user's active memberships.
- Every page calls `requirePermission`; every action and API route calls `assertPermission`. Voucher permissions map type × action (`voucher-permissions.ts`).
- At least one active Owner per business. Only an Owner can grant or modify the Owner role. A member who also belongs to another business can only have their credentials changed by themselves (prevents cross-tenant account takeover).
- Zod validation on every input; parameterised SQL only; CSV formula-injection guard; security headers; non-root container; DB bound to localhost.

## 7. Reports & export
Each report is a `ReportDef` (`src/server/reports/definitions.ts`) returning a typed `ReportResult` (columns with formats, rows with group/subtotal/total styling, summary). The same result drives:
- the screen (`ReportPage`, with filters for date range, as-of date, search, ledger, warehouse and voucher type),
- print/PDF (A4 print CSS with business letterhead),
- `/api/reports/[slug]` CSV (UTF-8 BOM) and `?format=xlsx` (styled workbook via exceljs).

The **integrity** report re-checks the invariants on live data: every voucher balances, the trial balance totals agree, each party ledger matches its invoices and payments, product stock caches match their movements, and inventory value matches the inventory ledger. The **cash flow** report (direct method) shows opening + net = closing.

## 6a. Batches, expiry & notifications

**Data model.** `ProductBatch` (unique per product + batch number) holds the lot: mfg / expiry date, supplier, first purchase date, purchase cost per base unit, sale price and a cached on-hand `quantity`. `StockMovement.batchId` and `VoucherItem.batchId` reference it (`ON DELETE RESTRICT`: a lot with history can't disappear). Quantities are always derived from movements; `revalueProducts` re-syncs `ProductBatch.quantity` after every replay. CHECK constraints: quantity ≥ 0, prices ≥ 0, mfg ≤ expiry, non-blank batch no. Expiry is never stored on the product.

**Status** (`src/lib/expiry.ts`, pure): expired once the expiry day has passed; the expiry day itself is "expiring today" (still sellable); otherwise the smallest configured threshold ≥ days left (`Business.expiryWarningDays`, default 60/30/15/7) or valid.

**Receipts** (purchase, sales return, stock-in) create or match the lot; a second receipt may not contradict the stored expiry (corrections go through the audited batch edit page).

**Sales.** An explicit batch must exist and must not be expired on the sale date unless `Business.allowExpiredSale`. Without a batch, **FEFO** takes unexpired stock in the warehouse in expiry order (no-expiry lots last). A line may span batches: the invoice line stays one `VoucherItem` and the split lives in one `StockMovement` per batch, so totals never change and line COGS is Σ movement costs. Expired lots are never chosen automatically, even when expired selling is allowed.

**Write-off.** `writeOffExpired` posts a stock journal with `Voucher.adjustmentAccountId = EXPIRY_LOSS` ("মেয়াদোত্তীর্ণ পণ্যের ক্ষতি", indirect expense): Dr expiry loss / Cr inventory at the moving-average cost. It writes an `ExpiryWriteOff` audit row in the same transaction.

**Notifications.** `runDailyChecks` (`services/notifications.ts`) reconciles alerts for expiry (per batch and band), low stock and overdue dues:
- **Duplicates impossible:** each alert has a deterministic `dedupeKey` (unique per business), and each business's run holds `pg_advisory_xact_lock`.
- **One run per day:** `JobRun` records one row per business per Asia/Dhaka day.
- **History kept:** a later band or a solved condition sets `resolvedAt` rather than deleting. `NotificationRead` marks reads per user without hiding the alert.

**Scheduler.** `src/instrumentation.ts` starts `src/server/scheduler.ts` in every Node server process, including Docker. It ticks every `SCHEDULER_INTERVAL_MINUTES` (default 60). Several replicas are safe because of the lock and the unique keys. The dashboard and notification pages also run the check lazily if today's run is missing. `POST /api/cron/daily-check` with `CRON_SECRET` serves external schedulers.

## 6b. SMS

- **Provider layer** (`src/server/sms/providers.ts`): one `SmsProvider` interface (send / balance / delivery status). Adapters: BulkSMSBD, generic HTTP, mock (demo). Every failure is classified **temporary** (network, timeout, HTTP 5xx/429, gateway busy → retried) or **permanent** (bad number, credentials, balance → not retried).
- **Credentials:** platform credentials come from `SMS_*` env variables and are used for security codes and by businesses that choose "platform". A business's own API key is stored AES-256-GCM-encrypted (`secret.ts`; key from `SMS_ENCRYPTION_KEY` or HKDF of `AUTH_SECRET`); the browser only ever sees a hint, and audit entries never contain the key.
- **Queue = log** (`SmsMessage`):
  - **Duplicates:** `dedupeKey` is unique, so the same event can't be queued twice. Insert-or-ignore makes this race-safe.
  - **Concurrency:** the worker (in-process, every `SMS_QUEUE_INTERVAL_SECONDS`) claims rows with `FOR UPDATE SKIP LOCKED`, so several instances never send the same SMS. Rows stuck in SENDING return to the queue after 10 minutes.
  - **Retries:** back-off of 1, 5, 15, 60 and 180 minutes, up to `maxAttempts`. An admin can manually retry FAILED messages from the log.
  - **Delivery:** reports arrive by polling (round-robin, so no starvation) or by the webhook `/api/sms/dlr` (`SMS_WEBHOOK_SECRET`).
- **Accounting rule:** voucher actions queue SMS *after* the accounting transaction has committed, inside their own try/catch (`sms/events.ts`). A gateway outage leaves the voucher saved and the SMS QUEUED for retry; it can never roll back a sale, purchase or payment.
- **Daily:** after the daily check, `dailySms` queues due reminders (one per customer per N days, rolling window), supplier statements, low-stock alerts (once per low-stock episode) and expiry alerts per batch and band (90/60/30/15/7 + expired). Every message has a dedupe key, so re-runs are harmless.
- **OTP** (`sms/otp.ts`):
  - **Generation and storage:** `crypto.randomInt` 6-digit codes; only a keyed HMAC is stored, bound to purpose and number.
  - **Validity:** 5 minutes, 5 tries, single use (atomic consume); a new code invalidates older ones.
  - **Rate limits:** 60-second cooldown, 3 per number per 15 minutes, 10 per IP per hour (trusted proxy only).
  - **Sending:** codes are sent immediately and logged with the code redacted.
  - **Flows:** registration requires a code when the platform can send SMS. Login OTP is a per-user setting; a signed 10-minute challenge carries the verified password step. Password reset gives the same answer for unknown numbers and revokes all sessions.
- **Manual / bulk** (`sms/manual.ts`):
  - **Permissions:** one customer needs `sms:send`; several customers, a group or a segment need `sms:bulk`.
  - **Limits:** at most 500 recipients; 10 bulk jobs per hour per business.
  - **Duplicates:** the same text to the same number is sent at most once per day.
  - **Confirmation and logging:** the confirmation echoes the recipient count, and every job is audit-logged.
- **Isolation:** every query is scoped to `ctx.business.id`; settings, templates and logs are per business.

## 7a. Backup & restore
`exportBusiness` writes `{format: "bijoy-lenden-backup", version: 4, checksum: sha256(data), data}`. Version history:
- v4 adds `data.payroll`: settings, departments, employees, components, structures, revisions, attendance, runs, payslips and lines, advances, salary payments.
- v3 added `productBatches` and `notifications`.
- v2 and v3 files are still accepted. For v2 files, lots are rebuilt from batch numbers.

Payroll voucher `sourceKey`s are remapped with the same id map as the payroll rows. `validateBackup` checks the format, version, checksum, every foreign reference, the balance of each voucher and the system accounts. `restoreBackup` always creates a **new** business: every id is remapped in one transaction, default roles are added, the restoring user becomes Owner, products are revalued, and the trial balance is verified before the restore is reported as successful. Existing data is never overwritten.

## 6c. Payroll
Payroll has no ledger of its own. Money reaches the books only through vouchers created by the existing engine (`writeEntries`, period lock, voucher numbering). Those vouchers carry `sourceKey` `payroll:run:<id>`, `payroll:payment:<uuid>` or `payroll:advance:<id>`. `voucher.ts` refuses to edit or delete them, so they can only be changed from the payroll module.

**Code layout**
- `src/lib/payroll.ts`: the pure calculation engine and `payrollJournalLines`, both unit-tested.
- `src/server/services/payroll.ts`: workflows.
- `src/server/actions/payroll.ts`: permission, validation and audit.
- `src/server/reports/payroll.ts`: reports.
- Pages live under `src/app/(app)/payroll`. They call `requirePayroll()`, which also runs `ensurePayrollSetup`.

**Setup (`ensurePayrollSetup`)**
It is idempotent and upgrades existing businesses on first use. It creates:
- the ledgers *বেতন প্রদেয়* (SALARY_PAYABLE, 2201, system) and *কর্মচারী অগ্রিম ও ঋণ* (EMPLOYEE_ADVANCE, 1402, system), reusing SALARY and OTHER_INCOME;
- `PayrollSettings`;
- 17 standard `PayComponent`s.

**Components**
Each component has a kind (EARNING / DEDUCTION / EMPLOYER), a calculation (FIXED, % of basic, % of gross, or RULE) and the ledgers it posts to.
- **Automatic:** BASIC, OVERTIME, ABSENCE, ADVANCE and LOAN.
- **Bangladesh items:** INCOME_TAX, PF_EMPLOYEE, PF_EMPLOYER and GRATUITY are seeded inactive with no ledger. They need their ledgers and rates set before use.
- **Festival bonus:** FESTIVAL_BONUS applies to BONUS runs.
- **New statutory rules** (e.g. a TDS slab) are added to `PAY_RULES` in `src/lib/payroll.ts` and selected on a component. The engine itself does not change.

**Calculation (per employee and month)**
- Basic and allowances are prorated for joining or leaving mid-month.
- Only attendance exceptions are recorded; unmarked working days count as present.
- Deducted days = absent + unpaid leave + ½ × half days + ⌊late ÷ `lateDaysPerAbsence`⌋. The deduction is that many days of basic (or of fixed gross) ÷ working days.
- Overtime = hours × (employee rate, or basic ÷ (working days × hours per day) × multiplier, which defaults to 2 as in the Bangladesh Labour Act).
- Advance and loan installments are capped by what is outstanding and by net salary.
- Net salary may not be negative.

**Run lifecycle (`PayrollRun`, unique per business, month and kind)**
- DRAFT runs can be recalculated; review adjustments (extra overtime hours, one-off bonus or fine lines) are kept.
- `postPayrollRun` refuses stale figures, i.e. attendance or employee changed after the calculation. It posts one JOURNAL voucher, aggregated per ledger:
  - Dr each earning's expense ledger and each employer contribution's expense ledger;
  - Cr each deduction's ledger, each contribution's liability ledger, and Salary Payable for the net.
- A POSTED run is locked:
  - no recalculation or adjustment;
  - no attendance changes for that month;
  - `Payslip` has a unique key on (employee, year, month, kind).
- `reopenPayrollRun` is allowed only while nothing has been paid and the period is open.

**Payments and advances**
- `paySalaries` creates one PAYMENT voucher (Dr Salary Payable, Cr cash or bank). It allocates to the employee's oldest unpaid payslips and never more than is payable.
- Advances post Dr Employee Advance, Cr cash, and are recovered by payroll deductions.
- `payableReconciliation` compares the Salary Payable ledger with the sum of employee payables. It is shown on the dashboard and in the payable report.

**Permissions**
The permissions are `payroll:view`, `payroll:manage`, `payroll:attendance` (attendance only, no salary figures), `payroll:process` and `payroll:pay`.
- Only the Owner role (`*`) has them by default.
- Payroll audit entries are hidden from audit-log viewers without `payroll:view`.

## 6d. Feature & module management
Optional modules are declared once in `src/lib/features.ts`: key, Bengali/English name and description, icon, FREE/PAID, AVAILABLE/COMING_SOON, default, and the module's permissions per action (VIEW/CREATE/EDIT/DELETE/EXPORT/APPROVE). Each entry also lists:
- `owns`: permissions used only by that module;
- `routes`: page path prefixes;
- `reports`: report slugs.

**Database**
- `Feature` and `FeaturePermission`: the catalogue, seeded by migration `20261005100000_feature_management` and re-synced from the registry by `ensureFeatureCatalog()`.
- `BusinessFeature`: one row per business choice; no row means the default.
- `FeatureActivationLog`: the change log. Changes are also written to `AuditLog`.

**Defaults and safety**
- Every AVAILABLE module defaults to on, so existing businesses behave exactly as before.
- COMING_SOON modules can never be switched on.
- Switching off never deletes data.

**Enforcement (server side)**
1. `getContext` adds `!permission` blocks for the `owns` permissions of switched-off modules. `hasPermission` honours `!` even for `*`, so every existing page, action and API check refuses them, and permission-based menus disappear.
2. `src/middleware.ts` passes `x-pathname`. `(app)/layout.tsx` redirects pages of switched-off modules to `/forbidden?feature=` and hides their menu links. `/api/reports/[slug]` and `ReportPage` check report slugs.
3. Module-specific checks:
   - expiry write-off (`assertFeature`);
   - daily expiry alerts and expiry SMS (`featureIsOn`, in `services/feature-state.ts`, usable outside a request);
   - the dashboard expiry panel;
   - warehouse management and new vouchers (main warehouse) for Multi Warehouse;
   - Multi User: without it only the Owner role keeps permissions, and only an Owner may switch it off.

**Who can see and change it**
- Activation needs `features:manage`; viewing the page needs `features:view`. The Owner has both, and new businesses' Admin role gets both.
- The role editor shows permissions of switched-off modules as locked ("ফিচার বন্ধ") and keeps existing grants.

**Backups:** backups carry the business's feature choices (`data.features`).

## 6e. Multi-tenant SaaS: subscriptions, billing, super admin
**Tenant = `Business`.**
- Every business table carries `businessId`.
- `getContext()` resolves the business only from the caller's active membership; a forged business cookie falls back to one of the caller's own businesses.
- Services, pages and API routes always filter by `ctx.business.id`. Billing pages look records up by `{ id, businessId }`.

**Database** (migration `20261005200000_saas_subscriptions`, additive only):
- `PlatformSetting` (single row "platform"): trial days/plan, fallback plan, grace days, reminder days, VAT, currency, invoice prefix and sequence.
- `Plan` + `PlanFeature`: prices, user limit, features. Everything is edited in `/admin/plans`; the seed in `scripts/saas-seed-sql.ts` only sets initial values.
- `Subscription` (one per business; `amount` and `paymentStatus` of the latest payment), `SubscriptionEvent` (history).
- `PaymentTransaction` (`@@unique([provider, providerTrxId])`), `SubscriptionPayment`, `Invoice`.
- `User.isSuperAdmin`, `Business.businessType`, `BusinessFeature.adminOverride`.
- Businesses that existed before the migration received PREMIUM, ACTIVE, for one year, so nothing changed for them.

- Migration `20261005300000_saas_inventory_payment_status` adds the INVENTORY feature (products, units, stock) to every existing plan, `Subscription.amount/paymentStatus` and the notification kinds `TRIAL_STARTED` / `SUBSCRIPTION_ACTIVATED`.
- Feature routes resolve to the most specific prefix (`/products/batches` → PRODUCT_EXPIRY, `/products` → INVENTORY).

**Rules** (`src/lib/subscription.ts`, pure and unit-tested):
- Statuses: TRIAL, ACTIVE, EXPIRING, EXPIRED, CANCELLED, SUSPENDED.
- After the end date plus the grace period, a business gets only the fallback (FREE) plan's features. Data is never deleted.
- SUSPENDED leaves only `billing:*` permissions; `(app)/layout` redirects to `/billing`.
- Renewal continues from the end date; a plan change starts a new period (no proration).

**Entitlement:**
- Entitled features = plan (or fallback) ± super-admin overrides. The company's own on/off choice in `/features` applies on top.
- This plugs into the feature enforcement in 6d (`loadFeatureAccess`), so a feature outside the plan is refused by actions, API and pages exactly like a switched-off one.
- User limit: `assertUserSlot` runs on member add and on reactivation.

**Payments** (`src/server/billing/`):
- Flow: checkout creates a `PaymentTransaction` (INITIATED, amount from the DB). The provider redirects to its callback or webhook. The adapter verifies the result server side, then `finalizePayment` runs.
- `finalizePayment`: compare-and-set to SUCCESS (only once), then an amount check and a gateway-TrxID reuse check. On failure the transaction is recorded as FAILED and nothing is activated. On success it creates the invoice (`BL-YYYY-000001`), the `SubscriptionPayment`, the subscription period, an event and a notification.
- Providers: `mock` (HMAC-signed; development only, refused when `NODE_ENV=production` unless explicitly allowed), `manual` (TrxID, then super-admin approval), `bkash` (Tokenized Checkout; needs credentials), `nagad`/`card` (placeholders).
- Gateway credentials exist only in environment variables.

**Notifications:**
- Daily `subscriptionDailyCheck`: reminders 7/3/1 days before the end (deduplicated), then the EXPIRED transition.
- `notifyBusiness` produces an in-app notification plus SMS/email to the owner (email: `EMAIL_PROVIDER` log|http).

**Super Admin** (`/admin`):
- Pages answer 404 and actions throw Forbidden for everyone else.
- Granted only from the shell: `npm run super-admin -- grant <email|mobile>`.
- Covers the dashboard, companies (search by company/owner name, mobile, e-mail; filters for plan, status, payment status and registration date; plan change, extend, suspend, per-feature override), users, plans, features (plan matrix), subscriptions, payments (date/plan filters; approve/reject manual; record refunds), revenue (monthly/yearly, by plan, date range), invoices, platform-wide audit log, and settings.
- Every change is written to `AuditLog`. Payment success, failure and refunds are audited too.
- A refund marks the payment and the invoice REFUNDED; the money goes back through the gateway or a transfer, and the subscription is changed separately by the administrator.

**Public pages:** `/` (landing) and `/pricing` read plans from the DB; `/register?plan=CODE` starts a trial on that public plan.

## 6f. Databases: PostgreSQL and MySQL / MariaDB
**One codebase, two providers.** The provider is chosen by `DATABASE_URL`:
- `postgresql://` — Docker / VPS;
- `mysql://` — cPanel shared hosting; needs MySQL 8.0.16+ or MariaDB 10.6+.

**Schemas.** `prisma/schema.prisma` (PostgreSQL) is the source of truth. `scripts/mysql-schema.mjs` generates `prisma/mysql/schema.prisma`:
- lists become `Json`;
- free-text strings become `@db.Text`.

`scripts/mysql-migration.mjs` builds the MySQL baseline migration, including the CHECK constraints and the seed.

**`src/lib/dialect.ts`** keeps the rest of the code provider-neutral:
- `ci` / `ciEquals` — case-insensitive filters;
- `listHas` / `strList` / `intList` — list columns;
- `jsonKey` — JSON path filter;
- `sql` + `rawRows` / `rawExec` — raw SQL written in PostgreSQL style and translated for MySQL, with the same result shapes on both;
- `lockKey` — advisory lock on PostgreSQL, an `AppLock` row `FOR UPDATE` on MySQL.

**Statements MySQL lacks** have their own branch, selected with `isMySql()`:
- login throttle (`ON DUPLICATE KEY UPDATE` with row lock and deadlock retry);
- SMS claim (`SKIP LOCKED`, then update, then read);
- batch re-sync and legacy backup linking (`UPDATE … JOIN`).

**Double entry.** On PostgreSQL a deferred trigger enforces it at commit. On MySQL, `assertVouchersBalanced()` re-sums the entries inside the posting transaction.

**Transactions.** MySQL uses READ COMMITTED, as PostgreSQL does.

**Tests.** `npm test` runs on PostgreSQL. `npm run test:mysql` runs the same suite on MySQL.

See docs/MYSQL-MIGRATION-PLAN.md.

## 7b. UI runtime notes
- Language: the `bl_lang` cookie selects Bangla or English. Bangla strings are the dictionary keys (`src/lib/i18n.ts`). Toasts after redirects travel in the short-lived `bl_flash` cookie.
- All `<Link>`s use `prefetch={false}`. Automatic prefetching fired many DB-heavy RSC renders at once and exhausted the connection pool. `src/lib/db.ts` also sets explicit pool limits.
- There is intentionally **no route-group `loading.tsx`**. With a Suspense boundary at `(app)` level, Next.js 15.5 intermittently received a complete RSC payload but never committed the navigation. This affected about 80% of server-action redirects and about 5% of link clicks, and froze every later navigation. As a safety net for that upstream bug, `NavWatchdog` (`src/components/nav-watchdog.tsx`) watches router fetches and falls back to a full page load if the URL has not changed 3 s after the response finished.
- **Customer, supplier and product pickers.** These are never static `<select>` lists. Every one uses `SearchSelect` (`src/components/search-select.tsx`), or `SearchSelectField` in plain GET filter forms: in sales/purchase/return vouchers, stock journal, POS, report party filters and the batch-list product filter.
  - **API:** they query `GET /api/lookup/{customers|suppliers|products}?q=` (`src/server/lookup.ts`).
  - **Search fields:**
    - Parties: name, mobile (by digits only, so formatted, Bangla-digit and +880 forms all match), ledger code and id.
    - Products: name, code/SKU, barcode and id.
  - **Results:** scoped to the signed-in business; at most 20 per query, ranked with exact identifiers first.
  - **UX:** 250 ms debounce with cancellation, ARIA combobox keyboard support (↑ ↓ Home End Enter Esc Tab), plus loading, empty and error rows. An Enter pressed before the results catch up (a barcode scanner) picks the best match once they arrive.
  - **Create new:** the "create new" row is shown only when the API reports `canCreate`, i.e. the user has `customers:manage`, `suppliers:manage` or `inventory:manage` for that kind.
  - **Initial data:** voucher editors load only the party and products already on the voucher (`inventoryOptions(…, { productIds })`). POS still loads all products for its tiles.
- **Ledger account pickers.** Every account choice uses `SearchableAccountSelect` (`src/components/account-select.tsx`), or `SearchableAccountField` in GET filter forms. That covers:
  - receipt, payment and expense: the cash/bank field and the lines;
  - journal lines;
  - payment modes in sales, purchase and POS;
  - the ledger, cash-book and bank-book report filters.
  - **UI:** a button opens a dropdown with "🔍 হিসাব খুঁজুন..." on top. While browsing, results are grouped by account group; "আরও হিসাব দেখুন" loads the next 30.
  - **Search:** `searchAccounts` in `src/server/lookup.ts`, via `GET /api/lookup/accounts?scope=…`. It matches:
    - account name, with a small English↔Bangla word list (e.g. cash↔ক্যাশ/নগদ, bkash↔বিকাশ, rent↔ভাড়া) plus the system key, so "cash" and "salary" work;
    - account code and Bangla digits;
    - bank name and account number;
    - linked customer/supplier name and mobile.
  - **Scopes:**
    - `cash`: CASH and BANK accounts;
    - `cash-in-hand` / `bank`: the cash-book and bank-book filters;
    - `expense`: non-direct, non-system expenses, as before;
    - `all`.
  - **Create new:** "+ নতুন হিসাব তৈরি করুন" (needs `accounts:manage`) uses the existing `saveAccount`, offering only groups that fit the scope. The opening balance is 0, so there is no journal entry. The new account is selected straight away.
  - **Initial data:** forms receive only the accounts already on the voucher, plus the short cash/bank list (it supplies the defaults).

## 8. Dates
Business dates are stored as UTC midnight of the chosen day. Display and "today" use **Asia/Dhaka**. The fiscal year defaults to July–June and is configurable per business.

## 9. Testing
- Unit (`tests/*.test.ts`): every posting rule balances, plus rejection rules, unit conversion, totals, permissions/role catalogue, validation and fiscal periods.
- Integration (`tests/integration`): a full accounting scenario against PostgreSQL, with hand-worked expected values for every ledger and statement, plus atomicity, edit/delete safety and tenant isolation.

## 10. Migration note
Migration `20261002000000_double_entry_accounting` replaced the earlier single-entry model. Pre-existing development rows were backed up (`backups/`) and cleared. The seed rebuilds an admin, a business and demo data through the new engine.

Migration `20261003100000_product_batches_expiry_notifications` is additive. It creates `ProductBatch` rows from the batch numbers already in stock history, links movements and lines, and adds the `EXPIRY_LOSS` ledger to every business. Trial balances are unchanged.

Migration `20261002100000_payments_credit_batches_integrity` is additive. It backfills `VoucherPayment` rows from the old single cash-account fields and links existing stock movements to their voucher items, so no data is lost. It then adds the CHECK constraints and the balance trigger. `ensureDefaultRoles` (run by the seed) renames legacy role names and adds missing roles in existing businesses.
