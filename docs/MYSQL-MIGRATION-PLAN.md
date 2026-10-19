# PostgreSQL → MySQL / MariaDB: compatibility work (DONE)

**Status:** complete and verified. One codebase runs on **PostgreSQL 13+** (Docker / VPS, unchanged) and on
**MySQL 8.0.16+ / MariaDB 10.6+** (cPanel shared hosting, e.g. RecoHost). The provider comes from
`DATABASE_URL` (`postgresql://…` or `mysql://…`). The matching Prisma Client is generated from:
- `prisma/schema.prisma` for PostgreSQL (the source of truth);
- `prisma/mysql/schema.prisma` for MySQL, generated from it.

## Verification (2026-10-07)

| Check | PostgreSQL 17 | MySQL 8.0 | MariaDB 10.11 |
|---|---|---|---|
| TypeScript, against the generated client | ✅ 0 errors | ✅ 0 errors | (same client as MySQL) |
| Full test suite (25 files, 292 tests: accounting, inventory/FEFO, expiry, payroll, SMS, security/brute-force races, registration, tenant isolation, features, SaaS billing, backup/restore) | ✅ 292/292 | ✅ 292/292 | ✅ 292/292 |
| Migrations from an empty database | ✅ 13 migrations | ✅ baseline | ✅ baseline |
| Demo seed (~100 days of trading through the accounting engine), ledger balanced | ✅ | — | ✅ 61 vouchers, 0 unbalanced |
| cPanel package on Linux (RHEL 9 + Node 22): `check-server`, `migrate.sh`, health, cron | ✅ | — | ✅ |
| Browser: the full user journey (register → trial → expiry restriction → plan → payment → active → invoice → Super Admin) | ✅ 36/36 | — | ✅ 37/37 (Linux package) |
| Browser regression suites (accounting, pickers, payroll, SMS, expiry, write-off, security, mobile) | ✅ all | — | — |

## What was PostgreSQL-specific, and what replaced it

| PostgreSQL feature | Where | MySQL / MariaDB solution |
|---|---|---|
| Scalar lists `String[]` / `Int[]` (7 fields: `Role.permissions`, `Business.expiryWarningDays`, `SmsSettings.events / alertMobiles / expiryAlertDays`, `PayrollSettings.weeklyOffDays`, `PlatformSetting.reminderDays`) | schema, RBAC, settings | `Json` columns with `DEFAULT (json_array(...))`. Reads go through `strList()` / `intList()` (`src/lib/dialect.ts`). The `has` filter is replaced by `listHas()` (`array_contains`). |
| `mode: "insensitive"` (59 filters) | search everywhere | `ci()` / `ciEquals()`. On MySQL the `utf8mb4_unicode_ci` collation is case-insensitive. |
| JSON path filters `path: ["event"]` | tests | `jsonKey()` gives `$.event` on MySQL. |
| Raw SQL with `"Ident"` quoting, `::text` / `::int` casts, `date_trunc`, `regexp_replace(…,'g')` (30 queries, 13 files) | reports, dashboard, lookup, ledgers | `sql\`…\`` is written once in PostgreSQL style and translated for MySQL (backticks, casts dropped, `DATE_FORMAT`). `rawRows()` returns the same shapes: DECIMAL → string, COUNT → number. |
| `INSERT … ON CONFLICT … RETURNING` | login / registration throttle | MySQL path: `INSERT … ON DUPLICATE KEY UPDATE` + `SELECT … FOR UPDATE` in a transaction, with retry on deadlock. Race test: 20 parallel attempts → at most 5 allowed. |
| `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` | SMS queue | `SELECT … FOR UPDATE SKIP LOCKED` → `updateMany` → `findMany` in one transaction |
| `UPDATE … FROM`, `IS DISTINCT FROM`, `gen_random_uuid()` | batch quantities, legacy backup restore | `UPDATE … JOIN`, `NOT (a <=> b)`, `UUID()` |
| `pg_advisory_xact_lock(hashtext(key))` | daily check, payroll | `lockKey()`: a row in the new `AppLock` table locked `FOR UPDATE` (released at commit) |
| Deferred constraint trigger `JournalEntry_voucher_balanced` (PL/pgSQL) | double-entry guarantee | MySQL has no deferred triggers. `assertVouchersBalanced()` re-sums the stored entries inside every posting transaction (`writeEntries`, backup restore); a difference aborts the transaction. |
| 28 CHECK constraints (`~` regex, `cardinality … ALL()`) | integrity | Ported to the MySQL baseline (`REGEXP`, `JSON_LENGTH`, byte-exact lower-case e-mail check). Enforced on MySQL 8.0.16+ and MariaDB 10.2+. |
| READ COMMITTED (PostgreSQL default) | all transactions | Set for MySQL in `src/lib/db.ts` (MySQL's default REPEATABLE READ adds gap locks and deadlocks). |
| Migrations with data back-fills (12) | — | One MySQL baseline (`prisma/mysql/migrations/20261007000000_mysql_baseline`) with the same schema, CHECKs and seed (20 features + permissions, 4 plans, platform settings). |

Nothing was removed. No feature is PostgreSQL-only. The PostgreSQL path behaves as before; its only new
migration adds the empty `AppLock` table.

## Known differences (by design, documented)

1. **Direct SQL writes on MySQL.** On PostgreSQL the database itself refuses an unbalanced voucher, even one inserted by hand. On MySQL the guarantee lives in the application's posting transaction, so a row inserted by hand through phpMyAdmin is not checked. Do not edit ledger tables by hand. The "Data integrity" report (`/reports/integrity`) lists any unbalanced voucher.
2. **Uniqueness under `utf8mb4_unicode_ci`.**
   - Case and trailing spaces are ignored: "Cash" and "cash" count as the same ledger name.
   - Chandrabindu is ignored: চাল = চাঁল.
   - Distinct Bangla words stay distinct (কম ≠ কাম, কি ≠ কী, ক্ষ ≠ কষ).
   - The effect is that near-duplicate names are refused.
3. **Minimum server versions:** MySQL 8.0.16+ or MariaDB 10.6+. This is needed for JSON expression defaults, enforced CHECK and `SKIP LOCKED`. `check-server.cjs` verifies it.

## Maintaining both databases

- Change `prisma/schema.prisma` and create the PostgreSQL migration as usual.
- Then regenerate the MySQL schema: `node scripts/mysql-schema.mjs`. `npm run package:cpanel` refuses to build if it is out of date.
- Before the first production MySQL deployment, the baseline may be regenerated with `npm run db:mysql:schema`. **After that, never edit the baseline.** Add a new folder under `prisma/mysql/migrations/` with `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/mysql/schema.prisma --script`.
- Raw SQL: always `rawRows(db, sql\`…\`)` / `rawExec(db, sql\`…\`)`, in PostgreSQL style. Branch on `isMySql()` only for statement shapes MySQL lacks.
- Tests on MySQL: `TEST_MYSQL_URL=mysql://…/disposable_db npm run test:mysql`.

## Moving existing data from PostgreSQL to MySQL

Production is not live yet, so the recommended path is a fresh MySQL deployment. To carry over a business
from the PostgreSQL installation:
1. On the PostgreSQL installation, open **ব্যাকআপ** (/backup) → **ডাউনলোড করুন** (JSON, version 4; it holds every voucher, ledger, stock movement, batch, payroll record and setting).
2. On the MySQL installation, register and log in, then use **ব্যাকআপ** (/backup) → **রিস্টোর করুন**. This was tested on MySQL and MariaDB by `tests/integration/backup.test.ts`.

The upload limit is 50 MB. Ask the host to allow at least 60 MB request bodies.
