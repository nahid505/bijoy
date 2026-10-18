-- Full depot permission set (13 keys). Roles made with the first set (6 keys) keep every screen they could open:
-- each old key brings the new keys that used to be part of it (DEPOT_PERMISSION_UPGRADE in src/lib/depot.ts).
-- Only adds keys; runs once (it is a migration), so a key an admin removes later stays removed.
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:register_view') WHERE JSON_CONTAINS(`permissions`, '"depot:view"') AND NOT JSON_CONTAINS(`permissions`, '"depot:register_view"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:dealers_manage') WHERE JSON_CONTAINS(`permissions`, '"depot:delivery_manage"') AND NOT JSON_CONTAINS(`permissions`, '"depot:dealers_manage"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:stock_adjust') WHERE JSON_CONTAINS(`permissions`, '"depot:stock_in"') AND NOT JSON_CONTAINS(`permissions`, '"depot:stock_adjust"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:company_payment') WHERE JSON_CONTAINS(`permissions`, '"depot:stock_in"') AND NOT JSON_CONTAINS(`permissions`, '"depot:company_payment"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:company_ledger') WHERE JSON_CONTAINS(`permissions`, '"depot:stock_in"') AND NOT JSON_CONTAINS(`permissions`, '"depot:company_ledger"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:register_view') WHERE JSON_CONTAINS(`permissions`, '"depot:reports_view"') AND NOT JSON_CONTAINS(`permissions`, '"depot:register_view"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:profit_loss') WHERE JSON_CONTAINS(`permissions`, '"depot:reports_view"') AND NOT JSON_CONTAINS(`permissions`, '"depot:profit_loss"');
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:cashbook') WHERE JSON_CONTAINS(`permissions`, '"depot:reports_view"') AND NOT JSON_CONTAINS(`permissions`, '"depot:cashbook"');
