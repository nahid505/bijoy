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
- print/PDF (A4 print CSS with business letterhead; the screen heading is not printed, the letterhead carries the title and the subtitle — the stock report's says the period and the warehouse; every table cell is ruled on paper),
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

> **Change (2026-10-14): companies no longer switch modules themselves.**
> - The company-side "ফিচার ব্যবস্থাপনা" page, its menu, the `features:view` / `features:manage` permissions and the switch action were removed.
> - A module is on when it is AVAILABLE and in the company's plan, adjusted by the platform administrator's per-company override (`/admin/companies/[id]`).
> - Choices stored earlier in `BusinessFeature.enabled` and the activation log are kept but no longer applied.
> - Everything below about enforcement (`!permission` blocks, route gating, guards) still applies.
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

## 6g. Production management (BOM / recipes)
**Recipe.** A `Recipe` with `RecipeLine`s describes one reference batch:
- inputs: materials, quantity in the base unit;
- outputs: products and by-products, each with a cost share (%); the shares total 100.

Example: 100 kg paddy → 65 kg rice (88 %), 5 kg broken rice (5 %), 8 kg bran (5 %), 20 kg husk (2 %); 2 kg process loss.

**Production entry.** A production entry is a `PRODUCTION` voucher plus a `ProductionRun` (recipe, batches, extra cost), saved in one transaction:
- materials leave stock as `PRODUCTION_OUT` movements (moving-average cost on the entry date; the replay refuses negative stock at any date);
- products enter as `PRODUCTION_IN` movements (cost = (materials + extra cost) × share ÷ quantity, split to the paisa by `allocateCost` in `src/lib/production.ts`).

**Ledger.** Materials and products are both inventory, so only the extra cost (labour, power…) is posted: Dr Inventory, Cr the chosen cash, bank or expense account. The normal process loss is absorbed by the products.

**Re-costing.** `revalueProducts` detects production runs whose material cost changed (for example a backdated purchase edit). `recostProduction` re-splits the run's cost and the products are replayed in a cascade (depth guard 20), so later sales of the products get the corrected COGS. Output line costs are owned by `recostProduction`; the replay does not re-derive them from rounded unit costs.

**Access.** Permissions are `production:view` and `production:manage`, owned by the PRODUCTION feature (in PREMIUM, and in the trial).
- Pages: `/production`, `/production/new`, `/production/[id]/edit`, `/production/recipes…`.
- Details are shown at `/vouchers/v/[id]`; delete uses the generic voucher delete.
- "রাইস মিল টেমপ্লেট" creates ধান/চাল/খুদ/কুঁড়া/তুষ in kg and the recipe.

**Backups.** Version 5 carries recipes, recipe lines, runs and each voucher line's `costShare`.

**Migrations.** `20261014000000_production` exists for both PostgreSQL and MySQL.

## 6h. Paddy purchase (weighbridge slip)
**Fields.** A paddy purchase (`/purchases/paddy`) is entered in this order:
1. bag count — information for the slip only, never used in a calculation;
2. gross weight (kg);
3. dhalta (kg) — a manual deduction;
4. net = gross − dhalta;
5. mon = net ÷ 40, rounded to 2 decimals;
6. rate per mon;
7. total = mon × rate, rounded to 2 decimals;
8. notes (vehicle, driver…).

The form recomputes 4, 5 and 7 as you type. The same function (`paddyFigures` in `src/lib/paddy.ts`) produces what the server saves.

**Posting.** Saving creates a normal `PURCHASE` voucher plus a `PaddyPurchase` row in one transaction (`savePaddyPurchase`), so supplier dues, payments, returns, reports and the ledger work as for any purchase:
- the single voucher line is in the unit "মণ (৪০ কেজি)" (created on first use; the product's base unit must be কেজি): quantity = mon, rate = rate per mon, so the amount is exactly the total;
- stock receives the exact net kg through an internal `baseQuantity` override on the trade line, which must lie within half a percent of a unit of quantity × factor;
- with a supplier, "এখন পরিশোধ" is paid now and the rest is owed; without one it is a cash purchase paid in full.

**Edit and delete.** Editing (`/purchases/paddy/[id]/edit`, which the generic voucher edit redirects to) re-posts with the same number. Deleting uses the generic voucher delete; the slip row cascades.

**Display.** The voucher page and the printed চালান ("ধান ক্রয় চালান") show the slip with "১. বস্তার সংখ্যা" first and prominent, before the items table.

**Backups and migrations.** Backups carry `paddyPurchases` (an optional key; older files restore without it). Migration `20261014100000_paddy_purchase` exists for PostgreSQL and MySQL, with CHECK constraints (bags ≥ 0, gross > 0, 0 ≤ dhalta < gross, net > 0).

## 6i. Account groups and sub-groups
**Creating a group.** On `/accounts/new` and `/accounts/[id]/edit`, the "+ নতুন গ্রুপ" button next to the group dropdown opens a popup (`new-group-dialog.tsx`, a native `<dialog>` rendered in a portal so its form is not nested in the ledger form). It calls the server action `createAccountGroupAction` (`accounts:manage`, audited), which calls `createAccountGroup` in `services/master.ts`. The new group is added to the dropdown in tree order and selected; nothing reloads, and the ledger form keeps what was typed.

**Fields.** `AccountGroup` has optional `parentId` (self-relation, ON DELETE SET NULL) and `description`.

**Rules for a sub-group:**
- it takes its parent's nature (it must match) and its P&L section (`isDirect`);
- it sorts with its parent in reports (same `sortOrder`);
- no sub-groups under নগদ, ব্যাংক, দেনাদার or পাওনাদার (`NO_SUBGROUP_KEYS`): their ledgers have their own pages and pickers, which are keyed on the group's system key;
- at most 4 levels below a top group;
- names are unique per business, case-insensitive.

A new top group is listed last and is never "direct".

**Reports.**
- The balance sheet and P&L work per group as before. A sub-group is its own heading, next to its parent.
- The cash-flow statement classifies an account by its effective system key, i.e. the nearest system ancestor (`effectiveGroupKeys` in `src/lib/account-groups.ts`). A sub-group of স্থায়ী সম্পদ is therefore investing, and one of ঋণ or মূলধন is financing.

**Backups and migrations.** Backups carry `parentId` and `description`. Restore links parents after every group exists, and validation refuses a missing parent. Migration `20261014200000_account_group_tree` (PostgreSQL and MySQL) is additive: two nullable columns, an index and an FK.

## 6j. Daily cash book (ডেইলী জমা-খরচ হিসাব)
**Where.** `/reports/daily-cash` (`accounts:view`). It is listed first under "দৈনিক ও হিসাব বই" on the reports page and in the sidebar's রিপোর্ট menu.

**Filters.** A date (default today, with previous/next-day links) and the accounts covered: all cash accounts (default), cash and bank, or one cash/bank account.

**Figures.** `dailyCash` in `src/server/reports/daily-cash.ts` computes, from journal entries only:
- পূর্বের জমা: the balance of the chosen accounts before the date (opening-balance vouchers dated on the day are brought forward here);
- receipts and payments: each voucher netted over the chosen accounts, so a transfer between two of them (cash → bank) drops out; then **one line per ledger, never joined**: a voucher with a party (sale, purchase, collection, supplier payment) is one line for the party; otherwise every counter ledger on the other side (credits for a receipt, debits for a payment, netted per ledger, in entry order) is its own line with its own amount — a payment to rent 300 and bank 200 gives two lines, নং ১ and ২. When a voucher also holds entries that do not touch cash, the cash amount is allotted to those ledgers in entry order, so the lines always add up to the cash moved;
- আজকের রিসিট, মোট রিসিট = পূর্বের জমা + আজকের রিসিট, মোট পেমেন্ট;
- অবশিষ্ট ক্যাশ = মোট রিসিট − মোট পেমেন্ট. This always equals the ledger balance at the end of the day, and it is the next day's পূর্বের জমা.

**Layout and print.** A ruled cash khata in one table (`CashBook`, `#cash-book`): খরচ / পেমেন্ট on the left, জমা / রিসিট on the right, each নং | বিবরণ | টাকা at fixed widths (`table-fixed`: নং 40 px / 8 mm, টাকা 128 px / 27 mm, বিবরণ the rest — the same on both sides), a thicker rule between the sides. Payment line i and receipt line i share a row, so lines and totals always line up whatever a বিবরণ holds; the footer pairs মোট পেমেন্ট / আজকের রিসিট, অবশিষ্ট ক্যাশ, and the balancing সর্বমোট / মোট রিসিট on one row. Every cell of every row, the empty filler rows too, has a 1px `border-slate-300` rule (a shade darker, slate-400, on paper); amounts are right-aligned and never wrap. Cells carry `data-side="pay" | "receipt"`. Phones get the two sides as separate stacked tables (receipts first). Printing uses A4 portrait with the business header, the two columns side by side, the closing in words and signature lines; on phones receipts are stacked above payments. PDF is the browser's print → Save as PDF, as for every report (keeps Bangla shaping). Excel and CSV come from the generic `/api/reports/daily-cash?date=&scope=` export through the `DAILY_CASH_REPORT` registry entry.

**বিবরণ cell: two rows** (`cashLineTitle` / `cashLineDetail`):
- **Row 1** (normal size, `font-medium text-gray-800`): the line's ledger, its address (customer / supplier) after a comma, then who entered the voucher in brackets — "সাইফুল, বীরগঞ্জ, দিনাজপুর (Delower)"; no address → "সাইফুল (Delower)"; no brackets when nobody is recorded.
- **Row 2** (smaller, `text-xs text-gray-500`): "বর্তমান জের:", the balance (debit − credit, shown with its side) of that ledger right after the voucher — a running balance through the day, so on today's sheet the last line of a ledger is its balance now — then the note after a comma: the line's own journal-line note, else the voucher's narration — "বর্তমান জের: ৳ ২,৫৫৫.০০ ডেবিট, চাউল ক্রয় বাবদ". Only the parts there are; no empty commas, brackets or second row.
- No voucher number or type (on screen or on paper). The account name in row 1 links to the voucher (plain text when printed). On paper rows never split across pages and long names / addresses wrap instead of being cut (`.daily-cash` print rules in `globals.css`).
- In English the label and digits are English; the address, the user's name and the note are data (`data-keep-lang`) and stay as written. CSV / Excel carry both rows in the বিবরণ column.

## 6j-2. Daily stock report (দৈনিক স্টক রিপোর্ট)
**Where.** `/reports/daily-stock?date=&warehouseId=` (`reports:view`); the sidebar's রিপোর্ট menu (after the daily purchase report) and "বিক্রয়, ক্রয় ও মজুদ" on the reports page.

**Figures** (`dailyStock`, `src/server/reports/daily-stock.ts`, from stock movements, general products only as in the stock report): per product — পূর্বের মজুদ (in − out before the day), উৎপাদন / ক্রয় (the day's movements in: purchase, production output, stock journal in, returns, opening stock …), বিক্রয় / ব্যবহার (the day's movements out: sale, production input, write-off …), আজকের মজুদ = পূর্বের + উৎপাদন / ক্রয় − বিক্রয় / ব্যবহার. One warehouse or all. Products with no stock and no movement are left out. The totals row adds up each column per unit (units are never added together).

**Layout and print.** The heading is the same on screen and paper: company (left), "দৈনিক স্টক রিপোর্ট" and the warehouse (centre), the date (right). Filters (date, previous / next day, warehouse) and the print, Excel and CSV buttons are not printed; the table is ruled cell by cell and fits an A4 page, with signature lines. Excel / CSV come from the `daily-stock` report entry.

## 6k. Daily purchase report (ডেইলি ক্রয় রিপোর্ট)
**Where.** `/reports/daily-purchase` (`purchases:view`). It belongs to the PURCHASE module (`reports: ["daily-purchase"]`), so a company without the module neither sees it nor can export it. It is listed under "বিক্রয়, ক্রয় ও মজুদ" and in the sidebar's রিপোর্ট menu.

**Filter.** A date (default today), with previous/next-day links.

**Section ১ — অন্যান্য ক্রয়.** `dailyPurchase` in `src/server/reports/daily-purchase.ts` lists every line of the day's PURCHASE vouchers that have no paddy slip:
- columns: নম্বর | পার্টির নাম | পণ্যের নাম | পরিমাণ | দর | মোট টাকা | নোট;
- পার্টির নাম is the supplier (or "নগদ ক্রয়") with the voucher number, পণ্যের নাম is the product, পরিমাণ includes the unit, and মোট টাকা is the line amount (quantity × rate − line discount, as posted);
- নোট holds the batch and the voucher's narration;
- below the total, voucher-level discount and VAT are shown with the net when present.

**Section ২ — ধান ক্রয়.** The day's `PaddyPurchase` rows:
- columns: নম্বর | পার্টির নাম | পণ্যের নাম | বস্তার সংখ্যা | মোট স্কেল | ঢলতা | নীট স্কেল | মণ | দর | মোট টাকা;
- পণ্যের নাম is the product (paddy variety) on the slip's voucher line;
- totals cover bags, kg, mon and money.

Figure cells never wrap, so ৳ stays with the amount on A4.

**Export columns.** The export puts both sections in one sheet: নম্বর | পার্টির নাম | পণ্যের নাম | পরিমাণ | বস্তা | … | দর | মোট টাকা | নোট.

Purchase returns are not included. The grand total is the other purchases' net plus the paddy total.

**Print and export.** Printing uses A4 portrait: business header, two ruled tables, the grand total in words and signature lines. On phones the tables scroll inside their box. PDF is the browser's print → Save as PDF. Excel and CSV come from `/api/reports/daily-purchase?date=` through the `DAILY_PURCHASE_REPORT` registry entry.

## 6l. Daily sales report (ডেইলি বিক্রয় রিপোর্ট)
**Where.** `/reports/daily-sales` (`sales:view`). It belongs to the SALES module (`reports: ["daily-sales"]`). It is listed first under "বিক্রয়, ক্রয় ও মজুদ" and in the sidebar's রিপোর্ট menu.

**Filter.** A date (default today), with previous/next-day links. The shared helpers `dayOrToday` and `addDays` in `src/lib/format.ts` serve all three daily reports.

**Lines.** `dailySales` in `src/server/reports/daily-sales.ts` lists every line of the day's SALES vouchers. The sales form and POS both post SALES vouchers, so POS sales are included. Sales returns are left out. Columns:
- নম্বর;
- পার্টির নাম: the customer, or "নগদ বিক্রয়", with the voucher number;
- পণ্যের নাম;
- পরিমাণ, with the entered unit;
- দর;
- টাকা: the line amount as posted;
- নোট: the reference as চালান, the batch and the narration.

**Summary row.** মোট পরিমাণ is given per unit (e.g. "১৩০ কেজি · ৫ পিস"); different units are never added together. সর্বমোট is the sum of line amounts. Voucher-level discount and VAT, with the net, appear below when present. A summary box shows net sales, cash collected, due and the total in words.

**Print and export.** Printing uses A4 portrait with the business header, the ruled table and signature lines; figure cells never wrap. PDF is the browser's print → Save as PDF. Excel and CSV come from `/api/reports/daily-sales?date=` through `DAILY_SALES_REPORT`. Columns: নম্বর | পার্টির নাম | পণ্যের নাম | পরিমাণ | একক | দর | টাকা | নোট, with পরিমাণ numeric in Excel.

## 6m. Date lock: permission `transaction:change_date`
**Permission.** "লেনদেনের তারিখ পরিবর্তন করার অনুমতি" sits in the roles catalogue under "সাধারণ অনুমতি (লেনদেন)", with a hint line. `*` (Owner) includes it.

**Behaviour.** Defined in `src/lib/entry-date.ts`:
- **with the permission:** any date, back-dated or future;
- **without it:** a new entry is dated today, the business's calendar day (`APP_TIMEZONE`); an edit keeps the entry's own date, so an old voucher is never moved to today.

**Forms.** `EntryDateInput` (`src/components/entry-date-input.tsx`) renders the locked date read-only, with `min = max` = the date and a 🔒 hint. `VoucherEditor` passes `dateLocked` to the sales, purchase, return, receipt, payment, expense, journal and stock-journal forms. The paddy purchase, production, salary payment and advance pages pass it to their forms.

**Server.** Every action that posts an entry calls `assertEntryDate(ctx, input.date, originalEntryDate(...))` (`src/server/entry-date.ts`) after parsing:
- covered: `saveVoucherAction` (all types), `savePaddyPurchaseAction`, `saveProductionAction`, `paySalariesAction`, `giveAdvanceAction`;
- a refused date throws `ForbiddenError`, so the action returns the message ("তারিখ পরিবর্তনের অনুমতি আপনার নেই — শুধু আজকের তারিখে … এন্ট্রি দেওয়া যাবে") and nothing is saved;
- server actions always answer HTTP 200 with the error in the result; a REST route using the same guard would map `ForbiddenError` to 403. No REST endpoint creates entries today.

The payroll month-end posting date is not covered: an accrual must be dated at month end.

**Roles and migration.** Default roles grant the permission to Admin, Manager, Accountant, Purchase and Inventory; Salesperson and Cashier start locked. Migration `20261014300000_transaction_change_date` (PostgreSQL and MySQL/MariaDB) is data-only and idempotent: it grants the permission to every existing role that can create or edit entries, so no current user is locked out. Roles are not part of backups, since restore recreates the defaults.

**Tests.** The test database uses `connection_limit=5`, as production does (`vitest.config.ts`).

## 6n. Depot management (business type `DEPOT`)
**Switching it on.** The owner ticks "ডিপো ব্যবসা" (value `DEPOT`) under business settings → "ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা" (6v); registration no longer asks. The primary type `ctx.business.businessType` is then `DEPOT`, which turns on:
- the "ডিপো ব্যবস্থাপনা" sidebar group, which is highlighted and open by default (`NavEntry.module: "DEPOT"`, `highlight`);
- the dashboard depot panel;
- the depot reports;
- the route field on customers (dealers) and the commission-rate field on products.

Depot pages and the service refuse other businesses with an explanation.

**Delivery challan** (`/depot/deliveries`, `saveDepotDelivery` in `src/server/services/depot.ts`; one `DepotDelivery` row per voucher):
- **কোম্পানি পেইড (ডিও রিলিজ)** — voucher type `DEPOT_DELIVERY`, prefix DO; requires a company (supplier) and a dealer (customer).
  - Stock leaves as `DEPOT_OUT` at moving-average cost, through the normal replay, which refuses negative stock and re-costs after backdated changes.
  - The line rate is the commission per unit, pre-filled from `Product.depotCommissionRate`.
  - Ledger (`depotDeliveryEntries`): Dr the company's ledger / Cr Inventory at cost, so there is no dealer due and no P&L effect; Dr "কমিশন প্রাপ্য — <company>" / Cr "ডিপো কমিশন আয়" for the commission.
- **ডিপো কালেকশন (মার্কেট সেলস)** — a normal `SALES` voucher to the dealer: stock out, sale, cash collected now, and the rest is the dealer's market due. A cash sale needs no dealer.
- **Editing** keeps the number. The mode cannot change; delete and create a new challan instead. The generic voucher edit redirects to the depot form. Detail and print show the challan block; a DO release prints commission columns and no amount in words.

**Commission** (`/depot/commission`):
- Ledgers are created on first use: `DEPOT_COMMISSION_INCOME` (indirect income) and `DEPOT_COMMISSION_RECEIVABLE:<company account id>` (current assets).
- Settlement (`settleCommission`) is either a receipt into cash/bank, or a journal against the company's ledger ("adjusted with the company"). It can never exceed what is outstanding.

**Dashboard** (`depotDashboard`): quick actions are stock in (purchase), delivery challan, market collection (receipt) and company commission. The cards show today's deliveries, commission receivable, dealers' market due and stock value.

**Reports** (`src/server/reports/depot.ts`): `depot-deliveries` (register), `depot-market-dues` (dealer dues grouped by `Customer.route`), and `depot-commission` (earned, settled and outstanding per company). All support print, Excel and CSV.

**Delivery list** (`/depot/deliveries`, `listDepotDeliveries`):
- The **বিক্রয় মূল্য** column shows each challan's goods value, Σ supplied quantity × challan rate (`challanValue` / `challanLineRate`, the same rule as the dealer copy). It applies to every mode, DO releases included.
- The cards and the সর্বমোট footer row total the whole filter, not just the current page.
- "প্রিন্ট / PDF" opens `?print=1`: every matching challan, no pagination, with PrintHeader and auto print.
- "Excel (XLSX)" downloads `/api/reports/depot-deliveries` with the same filters (from, to, mode, q). `all=1` without dates exports every challan instead of the fiscal year.

**Backups and migrations.** Backups carry `depotDeliveries`, the business type, the commission rate and the dealer route. Restore remaps the receivable ledger's system key along with the account ids. Migration `20261017000000_depot` (PostgreSQL and MySQL/MariaDB) is additive: enum values, the `DepotDelivery` table, `Product.depotCommissionRate` and `Customer.route`.

## 6o. Free / scheme goods and the dealer challan
**Field.** `VoucherItem.freeQuantity`, in the entered unit with a default of 0, sits on top of `quantity`. It is allowed on PURCHASE, SALES and DEPOT_DELIVERY lines; return vouchers refuse it, which keeps returnable-quantity checks exact. In forms it appears as the "ফ্রি" column on the depot stock-in (purchase) and sales forms, and as "ফ্রি পরিমাণ" on delivery challans.

**Calculation** (`tradeVoucherTx`, `saveDoRelease`, `depotTotals`):
- stock moves by quantity + free;
- the bill or line amount is quantity × rate − discount; free goods are never billed and earn no commission;
- a purchase's cost is spread over quantity + free (1 000 @ 450 + 50 free → 1 050 at 428.5714 average), so the average cost falls automatically;
- on a sale or DO release the free goods leave at average cost, so cost of goods sold includes them;
- the replay re-costs everything after an edit.

**Free scheme report** (`depot-free`): per product, the free received from the company and given to dealers in the period, and the free stock left (all received − all given up to the end date; negative means free given from the depot's own stock). Totals are shown only when every product has the same unit.

**Dealer copy** (`/depot/deliveries/[id]/print`; the challan's "সংরক্ষণ ও প্রিন্ট চালান (ডিলার কপি)" button and the voucher page's main print button open it):
- columns ক্রমিক | পণ্যের কোড (`Product.code`, "—" when empty) | পণ্য | সরবরাহ | ফ্রি (highlighted) | মোট পরিমাণ | দর | মোট টাকা; the POS slip shows the code after the name;
- then the totals (amount, collected, due), the amount in words, notes, driver, vehicle, and depot-representative and dealer signatures;
- never commission or cost. Every line, in both modes, shows its **challan rate** (`VoucherItem.challanRate`) and amount = supplied quantity × rate, with the grand total and the amount in words. A DO release shows "পরিশোধ: কোম্পানির ডিও-তে" instead of collection/due;
- the challan rate is the product's latest purchase price (`Product.purchasePrice`, updated by every stock-in). It is filled in when a product is chosen on the challan form, can be edited, and is saved with the line, so later price changes never alter an issued challan. On a market sale the sale rate is pre-filled with the purchase price and is itself the challan rate;
- migration `20261017200000_challan_rate` adds the nullable column and fills existing DO-release lines from their product's purchase price;
- `?format=pos` gives an 80 mm slip whose `@page` height is measured from the slip before printing (`PosPageSize`); A4 uses the global `@page`. Print CSS keeps the free highlight (`print-color-adjust: exact`).

The internal voucher print (commission) remains available as "অফিস কপি".

**Migration.** `20261017100000_free_quantity` adds one column with default 0 and a non-negative check. Backups carry `freeQuantity`.

## 6p. Depot permissions (RBAC)

A permission group, **ডিপো ব্যবস্থাপনা**, in `PERMISSION_GROUPS`, marked `depotOnly`. It has 15 keys, in this order: `depot:view`, `depot:delivery_manage`, `depot:dealers_manage`, `depot:products_manage`, `depot:stock_in`, `depot:stock_adjust`, `depot:collection_create`, `depot:company_payment`, `depot:expense_manage`, `depot:reports_view`, `depot:register_view`, `depot:scheme_manage`, `depot:company_ledger`, `depot:profit_loss` and `depot:cashbook`.

**Role form.** The group is shown only in a depot business, or on a role that already holds a depot key. It comes with:
- a "🏬 শুধু ডিপো (ডিপো হিসাবরক্ষক)" preset that ticks exactly the 15 keys and nothing else;
- a master checkbox, "ডিপো ব্যবস্থাপনার সব অনুমতি দিন (Select All)" (`GroupSelectAll`), that ticks or clears the whole group and shows half-ticked (indeterminate) when only some keys are on.

**Upgrade.** Migration `20261018200000_depot_permissions_v2` gives roles made with the first six keys the new keys that used to be part of them (`DEPOT_PERMISSION_UPGRADE`), so no role loses a screen:
- `depot:view` → `register_view`;
- `delivery_manage` → `dealers_manage`;
- `stock_in` → `stock_adjust`, `company_payment`, `company_ledger`;
- `reports_view` → `register_view`, `profit_loss`, `cashbook`.

Migration `20261019000000_depot_expense` then gives `depot:expense_manage` to every role holding `depot:company_payment` (whoever pays the company from the depot cash may also record depot expenses).

Migration `20261022000000_depot_products` gives `depot:products_manage` to every role holding `depot:stock_in`, and to the default depot role.

It only adds keys and runs once, so a key an admin removes later stays removed.

`saveRoleAction` drops depot keys outside a depot business.

**Any-of checks.** `hasPermission`, `can`, `requirePermission`, `assertPermission`, `NavLink.permission` and `ReportDef.permission` all accept a list, and any one key in the list is enough.

**Which screens open.** `DEPOT_ACCESS` in `src/lib/depot.ts` maps each depot screen to its keys. Every entry pairs the depot key with the general key the screen used before, so existing roles keep working:

| Screen | Depot key(s) | General key |
| --- | --- | --- |
| Depot dashboard, challan list, dealer copy | `depot:view` (or `depot:delivery_manage`) | `sales:view` |
| Create / edit challan | `depot:delivery_manage` | `sales:create` / `sales:edit` |
| Dealer list, profile, create / edit (`/depot/dealers`) | `depot:dealers_manage` | `customers:view` / `customers:manage` |
| **Depot products** (`/depot/products`, new, profile, edit, deactivate / delete; "+ নতুন পণ্য" in depot pickers) | `depot:products_manage` | `inventory:view` / `inventory:manage` |
| "+ নতুন ডিলার" inside a challan | `depot:dealers_manage` or `depot:delivery_manage` | `customers:manage` |
| Stock in (`/depot/stock-in`) | `depot:stock_in` | `purchases:create` |
| **Depot stock adjustment** (`/depot/stock-adjust` and sub-routes) | `depot:stock_adjust` **only** | — |
| Market collection (`/depot/collections`), commission settlement | `depot:collection_create` | `vouchers:create` |
| Company payment (`/depot/payments`) | `depot:company_payment` | `vouchers:create` |
| **Depot expenses** (`/depot/expenses`, new, edit, delete) | `depot:expense_manage` **only** | — |
| Fund transfer main cash ⇄ ডিপো ক্যাশ (on `/depot/expenses`) | — | `vouchers:create` (it moves the general cash) |
| Commission page | `depot:reports_view` or `depot:view` | `sales:view` |
| Market dues, commission report | `depot:reports_view` | `reports:view` |
| Delivery register and the list's Excel export | `depot:register_view` | `reports:view` |
| Free scheme report | `depot:scheme_manage` | `reports:view` |
| Company ledger (depot) | `depot:company_ledger` | `reports:view` |
| Depot P&L | `depot:profit_loss` | `reports:view` |
| Depot cash book | `depot:cashbook` | `reports:view` |

Without `depot:stock_adjust` the stock-adjustment menu item is hidden and every `/depot/stock-adjust` route is refused, even for a general `stock:adjust` holder (`kindAllowed` in `depot-vouchers.tsx`). The Owner (`*`) has every key.

**Vouchers.** `voucherAccess(type, action, businessType, book)` in `src/server/voucher-permissions.ts` adds the depot keys to `voucherPermission` — in a depot business, and only for DEPOT-book vouchers (6r) and challans:
- **PURCHASE / PURCHASE_RETURN:** view and create with `depot:stock_in`.
- **PAYMENT** (to the company): view and create with `depot:company_payment`.
- **STOCK_JOURNAL** (depot stock adjustment): view and create with `depot:stock_adjust`.
- **RECEIPT:** view and create with `depot:collection_create`.
- **SALES** (a market-sale challan): view with `depot:view` or `depot:delivery_manage`; edit and delete with `depot:delivery_manage`.
- **DEPOT_DELIVERY:** view with `depot:view` or `depot:delivery_manage`; create, edit and delete with `depot:delivery_manage`.

A GENERAL purchase / receipt / payment is never opened by a depot key. Editing or deleting stock in, collections and payments, and every other voucher type, still needs the general keys. The voucher pages and `saveVoucherAction` / `deleteVoucherAction` use `voucherAccess`.

**Depot-only user.** A user opening a voucher through a depot key alone:
- sees the voucher without its journal postings or ledger links;
- enters stock in, market collection and company payments on the depot pages (`/depot/stock-in`, `/depot/collections`, `/depot/payments`, DEPOT book — see 6r); the general `/vouchers/.../new` pages redirect there.

**Depot-only role.** For a role holding only depot keys:
- **Dashboard:** `/dashboard` shows only the depot panel ("ডিপো ড্যাশবোর্ড"); dashboard cards link only where the user may go.
- **Sidebar:** shows the dashboard, the depot menu and the own-profile page `/account`.
- **Other routes:** every other route, such as ledgers, general vouchers, reports, profit & loss, products, POS and settings, redirects to `/forbidden`. That page shows "403 — Forbidden", and APIs answer 403.
- **Lookups:** `/api/lookup` accepts the depot keys for the dealer, company, product and cash pickers.

**Default role.** `DEPOT_ROLE` is "ডিপো হিসাবরক্ষক (Depot Accountant)", holding all 15 keys. It is created:
- by `createBusiness` for a new depot business;
- by `ensureDefaultRoles` (seed / restore) for existing depot businesses;
- when the owner adds the depot type in business settings (`setBusinessTypes` → `ensureDepotRole`).

No schema change: role permissions are stored as before.

## 6q. User-specific customer / supplier restriction (row-level)

**Permissions.** Two keys in the "কাস্টমার ও সরবরাহকারী" group:
- `customers:assigned_only` — "শুধু নির্ধারিত কাস্টমার দেখতে পারবে";
- `suppliers:assigned_only` — "শুধু নির্ধারিত সরবরাহকারী দেখতে পারবে".

They are restrictions, not grants. They apply only when a role names them explicitly, never through `*` or the Owner role (`restrictionsOf`). If neither is ticked, the role sees every customer and supplier as before.

**Data.** Migration `20261018000000_user_party_assignment` (PostgreSQL and MySQL) only adds tables:
- `UserCustomer` (businessId, userId, customerId) and `UserSupplier` (businessId, userId, supplierId);
- unique per user and party; cascade on user, business and party delete.

**Assignment UI.** On `/users/new` and `/users/[id]/edit`, the "কাস্টমার ও সরবরাহকারী নির্ধারণ" section has:
- two searchable multi-selects (`PartyMultiSelect`, backed by `/api/lookup`), shown as chips and posted as `customerIds` / `supplierIds`;
- a note saying whether the selected role applies the list.

`saveMemberAction` replaces the assignment with `saveAssignments`, ignoring ids from other businesses. An assigned-only admin cannot change assignments. Removing a member clears theirs. `/users` shows "শুধু নির্ধারিত: N কাস্টমার · M সরবরাহকারী".

A restricted user who creates a customer or supplier (form or picker quick-create) gets it assigned automatically (`assignToCreator`).

**Request context.** `ctx.partyScope = { customers, suppliers }` holds the allowed party ledger-account ids; `null` means unrestricted. It is loaded in `getContext` (`loadPartyScope`).

**Filtering.** All rules live in `src/server/party-scope.ts`:

| Area | Rule |
| --- | --- |
| Customer / supplier lists, groups | `partyListWhere` |
| Profile, edit, statement print, toggle / delete actions | `canSeeParty` / `assertPartyRecordAllowed`; another party's profile is a 404 |
| Pickers (`/api/lookup` customers, suppliers, accounts) | `searchParties({ allowed })`, `searchAccounts({ where: accountScopeWhere })`; also the voucher editor's `?party=` / `?from=` prefill and the report filter preload |
| Voucher lists (all types), detail, print, edit | `voucherScopeWhere` / `canSeeVoucher` (see below) |
| Paddy slips, depot challans | The same rule, through `listPaddyPurchases` / `listDepotDeliveries({ scope })` |
| Saving (voucher, paddy, depot, commission settlement) | `assertPartiesAllowed` on the party and every line account; `assertVoucherAllowed` on edit / delete |
| Ledgers | `/accounts` lists no other party's ledger. `/accounts/[id]` and the `ledger` report open only the user's own party ledgers (`canOpenLedger`), because a sales or cash ledger lists every party. |
| Notifications | Overdue alerts of other customers are hidden (`notificationScopeWhere`) |
| SMS | Recipients are limited to the user's customers |
| Dashboard | Instead of business-wide figures, "আমার কাস্টমার / সরবরাহকারী" (count, dues, today's trade) and own recent vouchers (`AssignedDashboard`) |

A voucher is hidden from a restricted user when any of these holds:
- it names (`partyAccountId`) a party outside their list;
- it posts (`JournalEntry`) to a party outside their list, which also covers multi-party receipts;
- it is a walk-in trade voucher (no party) of the restricted kind that someone else entered.

**Reports** (`reportOpenFor` in `src/server/reports/registry.ts`):
- **Filtered to the user's parties:** ledger, customers, suppliers, sales, purchases, customer / supplier dues, statements, collection, daily sales / purchase, depot deliveries, depot market dues.
- **Open because they hold no party data:** stock, payroll and similar reports. Batch-expiry reports that name the supplier open only when suppliers are unrestricted.
- **Refused (`/forbidden`, export API 403):** everything else, such as day book, cash / bank book, trial balance, P&L, balance sheet, daily cash and expenses. These are also hidden from the report index and the sidebar (`reportSlugForPath`).

**Backups.** Assignments are not included, the same as users and memberships.

## 6r. Depot isolation: the DEPOT book and depot dealers

The depot is kept completely apart from the business's general accounting (`src/lib/book.ts`).

**Books.** Two new columns, both `Book { GENERAL, DEPOT }` with default GENERAL:
- `Voucher.book`;
- `JournalEntry.book`, a copy of its voucher's book written by `writeEntries`, indexed `(businessId, book, date)`.

Each voucher balances on its own, so each book is a complete, balanced set of accounts. Ledgers that both books use (cash, inventory, a company that is also a general supplier) keep a separate balance per book.

**What goes in the DEPOT book:**
- challans (`DEPOT_DELIVERY` DO releases and the market-sale SALES voucher);
- stock in (PURCHASE), market collection (RECEIPT) and company payment (PAYMENT), entered on `/depot/stock-in`, `/depot/collections` and `/depot/payments` via `VoucherEditor` with `book="DEPOT"` and `saveDepotVoucherAction`;
- commission settlement;
- dealers' opening balances (`accountBook`).

Depot vouchers are numbered in their own series (`DEPOT_PREFIX`): SI- (stock in), MS- (market sale), MC- (market collection), DP- (company payment), DJ- (journal). DO- is kept for challans. The general series has no gaps.

An edit keeps the voucher's book. The book is never taken from the client.

**Reading.** Every ledger / report function takes a `book` argument, default GENERAL:
- `accountMovements`, `balancesBefore`, `statement`, `partySummaries`, `partyAging`, `trialBalance`, `profitAndLoss`, `balanceSheet`.

Every other general query filters `book: "GENERAL"`:
- voucher lists, day book, sales / purchase registers, daily sales / purchase / cash, collection, expenses, daily summary, cash flow, dashboard, SMS due amounts.

Depot code passes DEPOT:
- depot dashboard, commission, market dues, free scheme, dealer pages.

The integrity report, the stock-valuation comparison and the restore check use ALL, because stock is physical.

**Dealers.** `Customer.isDepotDealer`:
- **List and profile:** dealers are kept out of the general customer list, pickers, reports and the general chart of accounts (`bookAccountWhere`). Their list, profile and statement live at `/depot/dealers` (`PartyListPage` / `PartyDetailPage` kind `DEALER`, read from the DEPOT book). `/customers/<dealer>` redirects there.
- **Creating:** new dealers come from `/depot/dealers/new` (`saveDealerAction`) or from the challan's picker, "+ নতুন ডিলার তৈরি করুন" (`SearchSelect book="depot"` → `/api/lookup/...&book=depot` → `quickCreatePartyAction(..., { dealer: true })`).
- **Challans:** they accept only dealers.
- **Names:** a dealer has a shop / business name, "প্রতিষ্ঠানের নাম *" (`Customer.name`, required), and a proprietor, "মালিকের নাম" (`Customer.ownerName`, optional). Both the form and the challan's quick-create dialog ask for both. `dealerLabel()` (`src/lib/depot.ts`) shows them as "মেসার্স রহমান ট্রেডার্স (মোঃ আব্দুর রহমান)": just the shop name when there is no owner, or when the owner repeats the shop name.
  - The dealer's ledger (`Account.name`) is saved in that form, so vouchers, statements, the daily cash book and every account picker show both names. `saveParty` renames the ledger when either name changes.
  - An edit from a form without the owner field keeps the stored owner. General customers and suppliers keep their plain name.
  - The dealer list, profile, edit page, depot reports and the dealer picker use the same label. The list search and the picker also find a dealer by the owner's name.

`assertBookAccounts` keeps the books apart on save:
- a GENERAL voucher may not use a dealer or a `DEPOT_*` account;
- a DEPOT voucher may not use a general customer.

**Permissions.** The depot permissions (6p) open only depot-book vouchers (`voucherAccess(..., book)`), never a general purchase or receipt. `/vouchers/purchase|receipt|payment/new` sends a depot-only user to the depot page.

**Depot reports.**
- `depot-profit-loss` — the depot's own profit and loss: commission, market-sale margin, depot expenses.
- `depot-cash-book`.
- `depot-dealer-ledger` — the statement tab of the dealer profile.

**Commission → general income.** `transferCommission` on `/depot/commission` is the only link between the books. One transaction writes two vouchers linked by `sourceKey depot-transfer:<uuid>:depot|general`:

| Voucher | Book | Entries |
| --- | --- | --- |
| DJ- | DEPOT | Dr "মূল ব্যবসায় স্থানান্তর (ডিপো)" (equity) / Cr depot cash |
| RECEIPT | GENERAL | Dr general cash / Cr "ডিপো কমিশন আয় (স্থানান্তরিত)" (income) |

- **Limit:** the amount is capped at earned commission minus earlier transfers.
- **Permission:** it needs `vouchers:create`, because it posts to the general books.
- **Edit / delete:** neither voucher can be edited. Deleting either one deletes both.

**Migration** `20261018100000_depot_book` (PostgreSQL + MySQL). It adds the columns, then relabels existing depot data; amounts are never changed:
- customers that received challans → dealers;
- challan vouchers → DEPOT;
- in depot businesses, purchases / returns / payments with a depot company, and receipts / payments / journals / openings / returns that post to a dealer or a `DEPOT_*` account → DEPOT;
- entries follow their voucher.

**Backups** carry `book`, `isDepotDealer` and `ownerName`. Older backups restore as GENERAL, with no owner.

**Further depot-book rules (integration audit):**
- **Returns:** a return always lives in its invoice's book (`tradeVoucherTx`); forcing the other book is refused. A stock-in return (SIR-) or market-sale return (MSR-) stays in the depot book, and the return editor loads dealers for a depot invoice. The voucher page's "বাকি আদায়" opens the depot collection for a depot sale.
- **Depot stock adjustment** (`/depot/stock-adjust`): a STOCK_JOURNAL in the DEPOT book (DSA-), opened with `depot:stock_adjust` only. The value moves the depot's inventory and the depot P&L; the general inventory and stock journal list are untouched. Product quantities stay physical (one stock).
- **Company ledger** (`depot-company-ledger`): a company's depot-book account — stock in, DO releases, payments, commission adjustments. The commission page links to it.
- **Party restriction:** the user form has a separate "নির্ধারিত ডিপো ডিলারসমূহ" selector in depot businesses. Backups (page, export API, restore) are refused to assigned-only users, because a backup holds every party. The commission page shows a supplier-restricted user only their companies, and hides the transfer.

**Integrity audit:** `npm run audit:integrity` (scripts/audit-integrity.ts, read-only) checks what the schema does not enforce:
- tenant copies of businessId match their parent, and audit user columns point at real users;
- every voucher and each book balances; entries carry their voucher's book;
- no dealer in GENERAL vouchers and no general customer in DEPOT vouchers;
- stock equals the movements, and paid + free equals what a line moved;
- assignments stay inside one business.

It exits 1 on any problem.

## 6s. User-specific account heads (row-level, chart of accounts)

**Permission.** `accounts:assigned_only` — "শুধু নির্ধারিত হিসাব খাত দেখতে পারবে", in the "হিসাব (লেজার)" group. Like the party keys it is a restriction, not a grant: it applies only when a role names it, never through `*` or the Owner role (`restrictionsOf`).

**Data.** Migration `20261018300000_user_account_assignment` (PostgreSQL and MySQL) adds the table `UserAccount` (businessId, userId, accountId):
- unique per user and account;
- cascade on user, business and account delete.

Only general heads can be assigned: cash, bank, income, expense, capital and other non-party ledgers. Customer and supplier ledgers follow the party restriction (6q); `saveAssignments` drops them from `accountIds`.

**User form.** A third multi-select, "নির্ধারিত হিসাব খাতসমূহ" (`PartyMultiSelect kind="accounts"`), searches `/api/lookup/accounts?scope=heads`, which offers no party ledgers. It saves through the same `saveAssignments`. `/users` shows "N হিসাব খাত"; removing a member clears the list.

**Scope.** `ctx.partyScope.accounts` holds the assigned head ids (null = every head) — `allowedAccounts(ctx)` in `src/server/party-scope.ts`:

| Area | Rule |
| --- | --- |
| Ledger list, account pickers (`/api/lookup/accounts`, cash / bank selects on vouchers, POS, payroll, depot) | `accountScopeWhere`: unassigned heads are hidden (`hiddenAccounts`) |
| Ledger page / ledger report by id | `canOpenLedger`: an unassigned head → `/forbidden`, and the export returns nothing |
| Vouchers (lists, detail, print, edit, delete) | `voucherScopeWhere`: a voucher is visible when it posts to at least one assigned head; otherwise `/forbidden` by URL |
| Saving | `assertPartiesAllowed` checks the cash / payment / line accounts of receipts, payments, journals, sales / purchases, paddy, depot challans, commission settlement / transfer and salary / advance payments: "হিসাব খাত … আপনার জন্য নির্ধারিত নয়" |
| Reports | With only this restriction, the cash book, bank book (assigned cash / bank heads) and day book (vouchers of my heads) open as well; trial balance, P&L, balance sheet, daily cash and expenses stay closed (`reportOpenFor`) |
| Dashboard | The assigned-user dashboard adds "আমার হিসাব খাত" (heads with balances) |
| Cash / bank balance strip | My heads only |

Backups are refused, as for every restricted user.

A user with the restriction and no heads sees no general ledger.

The integrity audit checks that assignments stay inside one business and never hold a party ledger.

## 6t. Depot cash (ডিপো ক্যাশ) and depot expenses (ডিপো খরচ)

**The cash box.** Every depot business has one ledger "ডিপো ক্যাশ": kind CASH, group নগদ (`CASH_IN_HAND`), code 1002 when free, systemKey `GENERAL_DEPOT_CASH`, `isSystem`. It is not a `DEPOT_*` key, so both books may use it. `ensureDepotCash` (`src/server/services/bootstrap.ts`) creates it:
- in `createBusiness` for a new depot business;
- in `ensureDefaultRoles` (seed / restore);
- when the owner adds the depot type in business settings (`setBusinessTypes`);
- on first use (the expense pages, fund transfer) for existing depot businesses.

No schema change and no data migration.

**Postings** (`src/server/services/depot-cash.ts`) — both in the **GENERAL** book:

| Action | Voucher | Entries | sourceKey |
| --- | --- | --- | --- |
| Fund transfer IN (main → depot) | JOURNAL (JV-) | Dr ডিপো ক্যাশ / Cr main cash or bank | `depot-fund:<uuid>` |
| Fund transfer OUT (depot → main) | JOURNAL (JV-) | Dr main cash or bank / Cr ডিপো ক্যাশ | `depot-fund:<uuid>` |
| Depot expense | PAYMENT (PV-) | Dr expense head / Cr ডিপো ক্যাশ (or the chosen cash / bank) | `depot-expense:<uuid>` |

So a depot expense is part of the business's P&L, cash flow (operating outflow), day book and expense report. It is not part of the depot-only P&L (6r).

A fund transfer is cash → cash. It is neither income nor expense, and the cash flow statement does not count it.

**Cash check.** The real balance of a cash box is the sum over both books (`cashInHand`), because depot-book collections and company payments may also use ডিপো ক্যাশ. Spending more than a CASH ledger holds is refused: "… পর্যাপ্ত টাকা নেই — বর্তমান ব্যালেন্স …". This applies to the expense (an edit counts its own amount back) and to the fund transfer's source. A bank account may go into overdraft.

**Validation.**
- The expense head must be an EXPENSE-nature ledger. The payment method must be a cash or bank account. Both must be general-book accounts (`assertBookAccounts`).
- The lock date and the entry-date permission apply.
- Restricted users are checked with `assertPartiesAllowed` (heads) and `assertVoucherAllowed` (edit / delete).

**Screens.**
- **`/depot/expenses`** (menu "ডিপো খরচ"): date, head and text filters; cards for the box balance, the period total and the count; edit and delete per row; the fund-transfer panel (`#depot-fund`, needs `vouchers:create`, hidden from restricted users).
- **`/depot/expenses/new`** and **`/depot/expenses/[id]/edit`**: date, expense head (the `expense` picker), payment method (defaults to ডিপো ক্যাশ), amount (the hint shows the box before and after), memo no and description. "সংরক্ষণ ও আরেকটি" returns to a new form.
- **Depot dashboard:** a "ডিপো খরচ এন্ট্রি" quick action and a "ডিপো ক্যাশ — বর্তমান ব্যালেন্স" card.
- **Depot cash book** (`depot-cash-book`):
  - By default it shows every cash ledger's depot-book movements (collections, company payments, as before) plus ডিপো ক্যাশ's general-book ones (fund transfers, expenses), with one running balance (`statement(…, { parts })`).
  - Picking **ডিপো ক্যাশ** in the filter shows that ledger alone across both books (`"ALL"`); its closing balance is the cash in the box.
  - Picking another cash account shows its depot-book movements.

**Edit / delete.** Depot expenses are edited and deleted on the depot pages; delete returns the money to the box. As general PAYMENT vouchers they also open through `/vouchers/v/[id]` for holders of the general voucher keys.

**Backups.** Backups keep the `depot-expense:` and `depot-fund:` sourceKeys unchanged (`RANDOM_SOURCE_PREFIXES`).

**Tests:** `tests/integration/depot-cash.test.ts`.

## 6u. Depot products (ডিপো পণ্য তালিকা)

**Data.** Migration `20261022000000_depot_products` (PostgreSQL and MySQL) adds two columns to `Product`:
- `isDepotProduct` (boolean, default false), indexed with businessId;
- `depotCommissionType` (`FIXED` | `PERCENT`, default FIXED).

`depotCommissionRate` holds taka per base unit (FIXED) or a percent of the company price / DP, which is `purchasePrice` (PERCENT). `commissionPerUnit` in `src/lib/depot.ts` turns either into taka per unit; the product pickers hand the challan that value.

**Backfill** (existing depot businesses; it only sets flags, amounts and quantities are unchanged):
- **Marked as depot product:** a product with a depot-book stock movement or a DO commission rate, that has no general-book movement other than its own opening stock and no recipe line.
- **Opening stock:** such a product's opening-stock voucher and its entries are relabelled to the DEPOT book.
- **Stays general:** a product used by both books. The integrity audit lists the vouchers that mix books, as `product-book`.

**One product, one book.** `assertBookProducts` (`src/server/services/inventory.ts`):
- A general-book voucher refuses a depot product: sale, POS, purchase, returns, stock journal, expiry write-off, production, paddy purchase.
- A depot-book voucher refuses a general product: stock in, market sale, DO release, depot stock adjustment.
- Lines already on an edited voucher stay valid.

`saveProduct` changes the flag only while the product has no voucher lines. A depot product's opening stock posts in the DEPOT book (DOB-); moving an unused product re-posts it in the new book.

**Pickers and lists.**
- `searchProducts(…, { book })` and `/api/lookup/products?book=depot`: depot forms see only depot products; every other picker, `inventoryOptions` (POS tiles), `/products`, the stock and stock-valuation reports never see them.
- A depot picker's "+ নতুন পণ্য" creates a depot product (`quickCreateProductAction({ depot: true })`, `DEPOT_ACCESS.products`).
- The depot dashboard's stock value counts depot products only. The general dashboard's low-stock list, the batch / expiry list and reports (`listBatches`, unless `depot: true`) count general products only.
- Low-stock and expiry alerts for a depot product are marked "ডিপো —" (low stock) and open `/depot/products/[id]`.

**Screens.**
- **`/depot/products`** (menu "ডিপো পণ্য তালিকা", just before "ডিলার তালিকা"): serial, code, name, product group, company / brand, DP, dealer rate, commission, current depot stock and stock value; search, product group (`?group=<id>` or `none`), brand and status filters; active count and stock value.
  - **Grouped view** (`?view=grouped`, "☰ তালিকা | ▤ গ্রুপ অনুযায়ী"): every matching product (no paging) under its group's heading, groups by name with "গ্রুপ ছাড়া" last; each group ends with a subtotal of stock and stock value (at average cost), and the list with a grand total. Stock of different units is never added up: "১২০ কার্টন · ৪০ পিস".
  - **Print / PDF:** "🖨 প্রিন্ট" prints at once when every row is on the page (grouped view, or a single page); otherwise it opens `?print=1`, which lists every matching product and opens the print dialog by itself. On paper: the business letterhead (`PrintHeader`) with "ডিপো পণ্য তালিকা", the date and the filters; a boxed table (`.print-grid` in `globals.css`) of serial, code, name, group, DP, dealer rate, stock and value; sidebar, header, filters, view switch, buttons, brand and commission columns hidden. Every label follows the UI language.
- **`/depot/products/new`** and **`/[id]/edit`**: name, code / barcode, product group / category and company / brand (pick one, or type a new name — created on save, reused by name in any case), unit, company price / DP, dealer sale rate (the market-sale challan's default rate), commission type and value (the % shows its taka per unit), minimum stock, batch tracking and opening stock.
- **`/depot/products/[id]`**: stock card.
- A depot product opened at `/products/…` redirects to `/depot/products/…`, and the other way round.
- In a depot business both product forms show a "ডিপো পণ্য" switch, disabled once the product has transactions.

Backups carry both fields.

**Tests:** `tests/integration/depot-products.test.ts`.

## 6v. Business types and modules (ব্যবসার ধরন ও মডিউল)

**Data.** Migration `20261028000000_business_types` (PostgreSQL and MySQL) adds `Business.businessTypes`: a list of `BUSINESS_TYPES` keys (PostgreSQL text array, MySQL JSON), default empty.
- **Backfill:** a business's existing single type becomes its list (`["DEPOT"]`, …), so nothing changes for existing businesses.
- **Primary type:** `businessType` stays as the primary type, derived by `primaryBusinessType`: `DEPOT` when chosen, else the first. Every depot check (`isDepot(ctx.business.businessType)`, `voucherAccess`, the depot services) reads it unchanged.

**Registration** no longer asks for a type (form, `registrationSchema`, audit). A new business starts as a general business with no type.

**Settings.** Business settings → "ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা" (`#business-types-section`, `BusinessTypesForm`):
- one checkbox per type (খুচরা দোকান, পাইকারি ব্যবসা, ডিপো ব্যবসা, ফার্মেসি, মুদি / সুপারশপ …), any number at once;
- a live list of the modules they switch on;
- save through `saveBusinessTypesAction`.

**Who may change them:** the owner only (`ctx.isOwner`; a manager with `business:manage` sees the section locked).

**Saving** (`setBusinessTypes` in `src/server/services/bootstrap.ts`) stores the list and the primary type. Adding DEPOT also creates the depot-only role and the ডিপো ক্যাশ ledger if missing. Removing a type deletes no data: its menus hide and come back with the type.

**API.**
- `GET /api/settings/company/business-types` returns `{ businessTypes, primary, modules }` (any signed-in user of the business).
- `PUT` with `{ "businessTypes": [...] }`: owner only (403 otherwise), JSON only (415), same-origin only (the `Origin` host must match `X-Forwarded-Host` / `Host`, as for server actions), validated by `businessTypesSchema` (400 on an unknown type), audited.

**Modules** (`businessModules` in `src/lib/business-types.ts`):

| Module | On when | Menus (`NavEntry.module` / `NavLink.module`) |
| --- | --- | --- |
| `TRADING` | no type chosen, or any type other than DEPOT | পস বিক্রয় (and the mobile tab), the "পণ্য" group, and in "লেনদেন": বিক্রয়, ক্রয়, ধান ক্রয়, both returns, স্টক জার্নাল |
| `DEPOT` | DEPOT chosen | the "ডিপো ব্যবস্থাপনা" group |
| core | always | dashboard, receipt / payment / journal, হিসাব, customers, suppliers, বাকি, খরচ, reports, SMS, users, billing, settings, backup |

The sidebar (`src/app/(app)/layout.tsx`) hides a menu whose module is off before the permission and feature checks; notifications stay on the header bell. Pages are still guarded by their permissions, as before.

**Elsewhere.**
- `ctx.business.businessTypes` carries the list.
- Backups carry it; an older backup's single type becomes the list.
- Billing and the super-admin company page show every type (`businessTypesText`).

**Tests:** `tests/integration/business-types.test.ts`.

## 6w. Auto rice mill (অটো রাইস মিল)

**Switching it on.** The owner ticks "অটো রাইস মিল" (`AUTO_RICE_MILL`, the API also takes `auto_rice_mill`) under business types (6v). That turns on the `RICE_MILL` module, and the general sales / inventory module stays on.

**Sidebar.** The "অটো রাইস মিল ব্যবস্থাপনা" group is highlighted:

| Menu | Route | Permission |
| --- | --- | --- |
| ধান ক্রয় ও স্কেল | `/purchases/paddy` | `purchases:view` |
| মিলিং ও প্রসেসিং | `/production` (PRODUCTION feature) | `production:view` |
| চাল ও উপজাত স্টক | `/rice-mill/stock` | `inventory:view` |
| চাল ও কুঁড়া/ভূসি বিক্রয় | `/rice-mill/sales` | `sales:view` |
| মিল লাভ-ক্ষতি ও স্টক রিপোর্ট | `/reports/rice-mill` | `reports:view` |

While the module is on, the "ধান ক্রয়" link under লেনদেন is hidden (`NavLink.hiddenWithModule`).

**Built on what exists.**
- **Paddy:** the paddy slip is a PURCHASE voucher plus a `PaddyPurchase` row (6h).
- **Milling:** a PRODUCTION voucher (6g). The rice-mill recipe template gives ধান → চাল, খুদ, কুঁড়া, তুষ; the form shows yield % and process loss live.
- **Sales:** sales of rice and by-products are ordinary sales vouchers, so the customer's ledger, cash and stock post as usual.

No separate tables were added for milling or by-product sales.

**Paddy slip additions** (migration `20261029000000_rice_mill`, columns only):
- `variety` — ধানের জাত, with a suggestion list (`PADDY_VARIETIES`).
- `moisturePct` — আর্দ্রতা %, information only.
- `vehicleGrossKg` / `vehicleTareKg` — the weighbridge. Gross = loaded − empty vehicle (`weighbridgeGross`); both or neither; the empty vehicle must weigh less. The schema and the service both apply it, and a typed gross still works when the vehicle weights are empty.
- `labourCost` — unloading / carrying labour. It is posted as a linked PAYMENT voucher (sourceKey `paddy-labour:<purchase voucher id>`): Dr "ধান ক্রয়ের লেবার খরচ" (`PADDY_LABOUR`, direct expense) / Cr the slip's cash / bank, which is required when there is labour.
  - It is created, updated or removed (labour 0) with the slip, and deleted with it.
  - On its own it can be neither edited nor deleted ("স্লিপ থেকে পরিবর্তন বা মুছুন").

All slip number fields convert Bangla / mixed digits. The voucher page, the printed slip and backups show and carry the new fields.

**Read models** (`src/server/services/rice-mill.ts`, no writes):
- **`millProducts`:** paddy = slip products and production / recipe inputs; rice and by-products = production / recipe outputs.
- **`millStock`:** stock, মণ, average cost and value.
- **`millSales`:** general sales minus returns of the outputs. Revenue = line amounts; cost = the stock movements' value.
- **`millSummary`:** purchases by variety, labour, milled vs produced with yield % and process loss (kg units), production extra cost.
- **Report `rice-mill`** (`RICE_MILL_REPORT`) puts these together:
  - purchases, milling and yield;
  - sales per product with cost and margin;
  - gross profit, and mill profit after labour;
  - stock now.
  It is business-wide (closed to party-restricted users) and listed under "অটো রাইস মিল" on the reports page only when the module is on.

**Fix:** the production form's default date used UTC, so between midnight and 6 am in Bangladesh it was the previous day. It now uses `toDateInput()` (Asia/Dhaka) like every other form.

**ডেইলি ধান ভাঙানো হিসাব** (`/reports/daily-milling?date=`, `reports:view`; in the sidebar's রিপোর্ট menu between the daily purchase and the daily stock report — only while the rice mill module is on — and on the reports page). `dailyMilling` (`services/rice-mill.ts`) turns each production entry of the day with paddy going in into one row: batch no. (the entry's number) and date, the paddy varieties (input product names), bags and weight (kg and মণ), the rice, কুঁড়া, খুদ and তুষ / ভূসি produced (kg and bags), each one's yield against the paddy plus the process loss, and who entered it; then the day's totals and summary cards.
- Output kind from the product name (`millOutputKind`): কুঁড়া / bran, খুদ / ভাঙা চাল / broken, তুষ / ভূসি / husk; anything else is rice.
- Weights in kg (`toKg`: মণ ×40, টন ×1000, গ্রাম ÷1000). Bags: the quantity when entered in a bag unit (বস্তা), else kg ÷ the business's one bag unit on that base unit; "—" when unknown.
- No party data, so open to party-restricted users. Print: A4 landscape with letterhead and signature lines; Excel / CSV from the `daily-milling` report entry (one row per batch and the total).

**Production batch** (`/production/[id]`, `production:view`; the production list, the daily milling report and its export link here). Cards: batch no. and date, raw material used (kg, মণ, bags), output and yield, wastage / process loss (kg when every line is a weight, else in the one shared unit); date, recipe, who entered it, reference; the raw material table (bags, quantity, মণ, cost at average rate) and the output table (kind badge on a rice mill, bags, quantity, yield, cost share, cost) with total output and loss; material, extra and output costs. "প্রিন্ট চালান" prints it as a production slip with letterhead and signature lines; links to the accounting entry and, with `production:manage`, the edit page. Bags use the same rule as the milling report (`bagUnits` / `lineBags`).

**Recipe print** (`/production/recipes/[id]`): "প্রিন্ট / PDF" beside the other buttons. On paper the edit form gives way to a recipe sheet — letterhead, name, code, description, raw materials per batch, products and by-products per batch with each one's % of the main raw material and cost share, total output and process loss. Users who may only view see the same sheet on screen.

**Tests:** `tests/integration/rice-mill.test.ts`.

## 6x. Ledger / খতিয়ান statement (`/accounts/[id]`)
The page reads the account and `statement()` for the period (`?from=&to=`, default this fiscal year) on the server; `LedgerStatement` (`src/components/ledger-statement.tsx`) renders it.
- **Toolbar:** ← back (to the party's profile, else the account list), the name, live search and filter icons, a date-range picker ("১ জুলাই ২০২৬ – ২৮ অক্টোবর ২০২৬"; this month, all since the books' start, or any two dates), "বিস্তারিত দেখান" (voucher no., note and who entered it on / off), a voucher-type filter, print, Excel / CSV (the ledger report export, with `reports:view`) and share (the Web Share sheet; the link is copied where there is none).
- **Table:** তারিখ (type badge, then the date) | বিবরণ | জমা (credit) | খরচ (debit) | ব্যালেন্স (running, "Dr" / "Cr"). Badges: Opening slate-500, Purchase indigo-700, Journal pink-700, Payment purple-700, Sale sky-600, Receipt amber-600, the rest teal. বিবরণ: the counter ledgers, then the voucher no. (amber, mono), the note (grey) and who entered it (emerald). The first line is the balance brought forward. Rows highlight on hover and open the voucher on click.
- **Footer:** "[n] মোট" (entries shown), the জমা and খরচ totals of the lines shown (marked when a search or filter is on) and the net at the end of the period — পাওনা (Dr) in green, দেনা (Cr) in red.
- **Search / filter** run in the browser over the period's lines: voucher no., who entered it, counter ledgers, note or type.
- **Phones:** the same lines as cards (badge, date, ± amount, বিবরণ, balance) and the totals. **Paper:** the business letterhead with the party's mobile / address, a ruled table (`.print-grid`), badges as outlines; toolbar, top bar and sidebar hidden; columns sized for A4.
- **Languages:** every label through the dictionary; the ledger columns read জমা / খরচ in Bangla and Credit / Debit in English; names and notes are data (`data-keep-lang`).

## 7b. UI runtime notes
- **Language** (`bl_lang` cookie, 1 year; default `bn`):
  - The header switch (`#lang-switch`, "বাংলা | English") sets the cookie through `setLangAction`; server components read it with `getLang` / `getT`, client components with `useT`.
  - Bangla strings are the dictionary keys: `src/locales/en.json` maps Bangla to English, `src/locales/bn.json` maps Bangla to the Bangla wording, and a missing key shows as written.
  - `Field` labels and hints, `SubmitButton` / `ActionButton` / `PrintButton` text, confirm dialogs, `StatCard`, `EmptyState`, `FilterBar` / `FilterField`, `DetailRow`, `Pagination`, `PageHeader` and picker placeholders translate themselves.
  - A unit test requires every sidebar label to have an English translation.
  - **Client / server split:** `src/lib/i18n.ts` is client-safe and holds no dictionary (types, `translateWith`, `loadDict`). `src/lib/i18n-dict.ts` bundles both dictionaries for the server (`src/server/i18n.ts`, `server-only`) and tests. `<LangProvider>` loads only the current language's file, as its own chunk (`use(loadDict(lang))`), so a page never ships both dictionaries. `npm run check:client-imports` (and `tests/client-imports.test.ts`) fails when a `"use client"` file reaches `server-only`, `next/headers` or `@/server/*`, directly or through a shared module (Server Actions excepted).
  - **Keys:** `npm run i18n:missing` (`scripts/i18n-extract.mjs`) lists every Bangla UI text in `src/` without an English translation. It scans string literals, template literals (`${…}` → `{0}`, `{1}`, nested ones too), JSX text (entities decoded) and the default data in `src/lib/business-defaults.json`. `npm run i18n:check` and `tests/screen-translate.test.ts` fail on any missing key. New translations go in `scripts/translations/*.mjs`; `node scripts/compile-final-locales.mjs` merges them into `en.json` and adds the keys to `bn.json` (Bangla rewording already in `bn.json` is kept).
  - **English screen:** `EnglishScreen` (`src/components/digit-display.tsx`, with `src/lib/screen-translate.ts`) translates in place any Bangla UI text rendered without `t()`: text, placeholders, titles, aria-labels, button values, options and the tab title, kept up by a MutationObserver. It knows exact keys, keys inside marks ("+ …", "… *", "…:"), template keys, lists and lines built from pieces ("A, B · C"), numbers with a unit, and bilingual labels ("ফ্রি (Free)" → "Free"). Text it does not recognise — the business's own data (names, notes, renamed ledgers) — stays as written; a short key such as "{0} কেজি" only fills in numbers, dates or other UI text, so "মিনিকেট চাল ২৫ কেজি" is left alone. While its first pass runs an English page is hidden (`html[data-lang-pending]`, shown anyway after 1.5 s), so it does not flash Bangla. `data-keep-lang` excludes an element.
  - **Default data and plans:** the ledgers, groups, units and roles every business starts with, and the seeded plans, have dictionary entries, so they read in English until the business renames them. Sidebar entries can have a menu-specific English name (`NAV_LABEL_EN` in `src/lib/nav.ts`: "Products", "Reports" …).
  - **Amount in words:** `<AmountInWords>` (receipts, challans, payslips, invoices, daily reports) writes "One Lakh Twenty Thousand Taka Only" in English and the Bangla words otherwise (`src/lib/words.ts`).
- **Digits** (`src/lib/digits.ts`, one utility for the browser and the server):
  - **Number fields** are `<input type="text" inputMode="decimal" data-numeric>`. A `type="number"` field silently dropped Bangla digits: "১২451৩৩" became "451".
  - `DigitInputs` (root layout) rewrites `data-numeric` and `type="tel"` fields on every input event, in the capture phase and through the prototype `value` setter, so controlled fields' `onChange` sees the corrected value. Typing or pasting "১২451৩৩" gives 1245133, and "১,২৫০.৫০ টাকা" gives 1250.50 (`sanitizeNumber`).
  - **On the server**, `formToObject` / `parseJsonPayload` pass every value through `normalizeNumericInput`. A number in any digit script becomes plain English ("১,২৫,০০০" gives "125000"). A digits-and-separators value (a mobile list, a date) gets English digits. Any other text, such as "Miniket চাল ৫০kg", and passwords stay exactly as typed.
  - **Search:** `digitVariants` matches names in both digit scripts, case-insensitively: `ci()` on PostgreSQL, and `utf8mb4_unicode_ci` on MySQL / MariaDB, which every table already uses. This applies to the customer, supplier, product and ledger pickers, the product, party and depot-product lists, the stock and party reports and the batch list.
  - **Display:** amounts and dates are formatted with Bangla digits. In English, `EnglishScreen` (below) also rewrites the digits of rendered text and attributes, and the month names of dates (a month followed by a year, e.g. "২৮ অক্টোবর ২০২৬" → "28 October 2026"), after hydration and on every change (MutationObserver), skipping form fields and `[data-keep-digits]`.
- **Placeholders:** `t(text, vars)` fills `{name}` placeholders after translating, e.g. `t("ফ্রি ট্রায়াল চলছে — আর {n} দিন বাকি।", { n })`.
- **Dashboard:** every text of the dashboard and its panels goes through `t()`: account / subscription, the trial banner, the depot panel, today, position, expiry, charts, recent lists, cash & bank, and the assigned-only view. Plan, subscription-status and module names use their stored English names. `tests/dashboard-i18n.test.ts` fails on any Bangla text there without an English translation.
- **Notifications** are stored in Bangla. `localizeNotification` (`src/lib/notification-text.ts`, through `notificationLocalizer`) shows the known shapes in English on the dashboard and the notifications page: stock, expiry, overdue dues, trial / subscription / payment. Names and amounts are kept, and plan names use their English names.
- Toasts after redirects travel in the short-lived `bl_flash` cookie.
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
