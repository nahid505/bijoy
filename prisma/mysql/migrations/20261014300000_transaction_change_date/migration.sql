-- New permission "transaction:change_date" (back-dated / future-dated entries). Without it, new
-- entries are dated today and edits keep their date. Data only, additive and idempotent: every
-- existing role that can create or edit entries gets the permission, so no current user is locked
-- out of a date they could use before; admins can then remove it from a role. "*" roles already
-- have it. No schema change. (MySQL 8 and MariaDB 10.5+: JSON_CONTAINS / JSON_ARRAY_APPEND.)
UPDATE `Role`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'transaction:change_date')
WHERE JSON_CONTAINS(`permissions`, '"*"') = 0
  AND JSON_CONTAINS(`permissions`, '"transaction:change_date"') = 0
  AND (
    JSON_CONTAINS(`permissions`, '"sales:create"') = 1 OR JSON_CONTAINS(`permissions`, '"sales:edit"') = 1
    OR JSON_CONTAINS(`permissions`, '"purchases:create"') = 1 OR JSON_CONTAINS(`permissions`, '"purchases:edit"') = 1
    OR JSON_CONTAINS(`permissions`, '"vouchers:create"') = 1 OR JSON_CONTAINS(`permissions`, '"vouchers:edit"') = 1
    OR JSON_CONTAINS(`permissions`, '"stock:adjust"') = 1 OR JSON_CONTAINS(`permissions`, '"production:manage"') = 1
    OR JSON_CONTAINS(`permissions`, '"payroll:pay"') = 1
  );
