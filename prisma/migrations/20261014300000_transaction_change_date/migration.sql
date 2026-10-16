-- New permission "transaction:change_date" (back-dated / future-dated entries). Without it, new
-- entries are dated today and edits keep their date. Data only, additive and idempotent: every
-- existing role that can create or edit entries gets the permission, so no current user is locked
-- out of a date they could use before; admins can then remove it from a role. "*" roles already
-- have it. No schema change.
UPDATE "Role"
SET "permissions" = array_append("permissions", 'transaction:change_date')
WHERE NOT ('*' = ANY ("permissions"))
  AND NOT ('transaction:change_date' = ANY ("permissions"))
  AND "permissions" && ARRAY['sales:create', 'sales:edit', 'purchases:create', 'purchases:edit', 'vouchers:create', 'vouchers:edit', 'stock:adjust', 'production:manage', 'payroll:pay']::TEXT[];
