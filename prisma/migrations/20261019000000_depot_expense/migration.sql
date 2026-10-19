-- Depot expenses (depot:expense_manage). Roles that pay the company from the depot cash get the new key
-- (DEPOT_PERMISSION_UPGRADE in src/lib/depot.ts). Only adds a key; runs once, so a key removed later stays removed.
-- The "ডিপো ক্যাশ" ledger itself is created by the app (ensureDepotCash) — no data is changed here.
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:expense_manage') WHERE 'depot:company_payment' = ANY("permissions") AND NOT ('depot:expense_manage' = ANY("permissions"));
