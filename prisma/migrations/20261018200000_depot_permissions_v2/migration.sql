-- Full depot permission set (13 keys). Roles made with the first set (6 keys) keep every screen they could open:
-- each old key brings the new keys that used to be part of it (DEPOT_PERMISSION_UPGRADE in src/lib/depot.ts).
-- Only adds keys; runs once (it is a migration), so a key an admin removes later stays removed.
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:register_view') WHERE 'depot:view' = ANY("permissions") AND NOT ('depot:register_view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:dealers_manage') WHERE 'depot:delivery_manage' = ANY("permissions") AND NOT ('depot:dealers_manage' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:stock_adjust') WHERE 'depot:stock_in' = ANY("permissions") AND NOT ('depot:stock_adjust' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:company_payment') WHERE 'depot:stock_in' = ANY("permissions") AND NOT ('depot:company_payment' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:company_ledger') WHERE 'depot:stock_in' = ANY("permissions") AND NOT ('depot:company_ledger' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:register_view') WHERE 'depot:reports_view' = ANY("permissions") AND NOT ('depot:register_view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:profit_loss') WHERE 'depot:reports_view' = ANY("permissions") AND NOT ('depot:profit_loss' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:cashbook') WHERE 'depot:reports_view' = ANY("permissions") AND NOT ('depot:cashbook' = ANY("permissions"));
