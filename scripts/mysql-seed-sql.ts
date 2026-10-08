// Prints the MySQL part of the baseline migration that Prisma cannot generate:
//   • CHECK constraints (the PostgreSQL migrations' integrity rules, in MySQL 8.0.16+ / MariaDB syntax)
//   • seed: feature catalogue + module permissions, subscription plans, platform settings
//   npx tsx scripts/mysql-seed-sql.ts >> prisma/mysql/migrations/<baseline>/migration.sql
//
// PostgreSQL's deferred "voucher is balanced" trigger has no MySQL equivalent (no deferred triggers);
// it is enforced in the posting transaction instead (assertVouchersBalanced in services/accounting.ts).
import { FEATURES, type FeatureDef } from "../src/lib/features";
import { PLANS } from "./plan-seed-data";

const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const out: string[] = [];

out.push("", "-- ── integrity rules (CHECK constraints, ported from the PostgreSQL migrations) ──");
const checks: [string, string, string][] = [
  ["JournalEntry", "JournalEntry_amounts_nonnegative", "`debit` >= 0 AND `credit` >= 0"],
  ["JournalEntry", "JournalEntry_single_side", "(`debit` > 0) <> (`credit` > 0)"],
  ["Voucher", "Voucher_amounts_nonnegative", "`amount` >= 0 AND `paidAmount` >= 0 AND `subtotal` >= 0 AND `discount` >= 0 AND `vatAmount` >= 0"],
  ["VoucherPayment", "VoucherPayment_amount_positive", "`amount` > 0"],
  ["VoucherItem", "VoucherItem_quantity_positive", "`quantity` > 0 AND `baseQuantity` > 0"],
  ["VoucherItem", "VoucherItem_amounts_nonnegative", "`rate` >= 0 AND `discount` >= 0 AND `amount` >= 0"],
  ["StockMovement", "StockMovement_quantities_nonnegative", "`quantityIn` >= 0 AND `quantityOut` >= 0"],
  ["StockMovement", "StockMovement_single_direction", "(`quantityIn` > 0) <> (`quantityOut` > 0)"],
  ["Customer", "Customer_credit_terms_nonnegative", "`creditLimit` >= 0 AND `creditDays` >= 0"],
  ["Supplier", "Supplier_credit_days_nonnegative", "`creditDays` >= 0"],
  ["Unit", "Unit_factor_positive", "`factor` > 0"],
  ["ProductBatch", "ProductBatch_quantity_nonneg", "`quantity` >= 0"],
  ["ProductBatch", "ProductBatch_prices_nonneg", "`purchasePrice` >= 0 AND `salePrice` >= 0"],
  ["ProductBatch", "ProductBatch_mfg_before_expiry", "`mfgDate` IS NULL OR `expiryDate` IS NULL OR `mfgDate` <= `expiryDate`"],
  ["ProductBatch", "ProductBatch_batchNo_not_blank", "CHAR_LENGTH(TRIM(`batchNo`)) > 0"],
  ["Notification", "Notification_level_nonneg", "`level` IS NULL OR `level` >= 0"],
  ["Business", "Business_expiry_warning_days_valid", "JSON_LENGTH(`expiryWarningDays`) BETWEEN 1 AND 8"],
  ["AuthThrottle", "AuthThrottle_attempts_nonneg", "`attempts` >= 0"],
  ["Session", "Session_expiry_after_creation", "`expiresAt` > `createdAt`"],
  ["User", "User_has_identifier", "`email` IS NOT NULL OR `mobile` IS NOT NULL"],
  ["User", "User_mobile_format", "`mobile` IS NULL OR `mobile` REGEXP '^01[3-9][0-9]{8}$'"],
  // the column collation is case-insensitive: compare the bytes
  ["User", "User_email_lowercase", "`email` IS NULL OR CAST(`email` AS BINARY) = CAST(LOWER(`email`) AS BINARY)"],
  ["SmsMessage", "SmsMessage_parts_positive", "`parts` >= 1"],
  ["SmsMessage", "SmsMessage_attempts_valid", "`attempts` >= 0 AND `maxAttempts` >= 1"],
  ["SmsMessage", "SmsMessage_recipient_format", "`recipient` REGEXP '^01[3-9][0-9]{8}$'"],
  ["SmsMessage", "SmsMessage_encoding_valid", "`encoding` IN ('GSM7', 'UCS2')"],
  ["SmsOtp", "SmsOtp_attempts_valid", "`attempts` >= 0 AND `maxAttempts` >= 1"],
  ["SmsSettings", "SmsSettings_threshold_nonneg", "`lowBalanceThreshold` >= 0 AND `dueReminderEveryDays` >= 1"],
];
for (const [table, name, expr] of checks) out.push(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expr});`);

out.push("", "-- ── seed: feature catalogue and module permissions (kept in sync at runtime by ensureFeatureCatalog) ──");
(FEATURES as readonly FeatureDef[]).forEach((f, i) => {
  out.push(
    `INSERT IGNORE INTO \`Feature\` (\`key\`, \`nameBn\`, \`nameEn\`, \`descriptionBn\`, \`descriptionEn\`, \`icon\`, \`tier\`, \`status\`, \`defaultEnabled\`, \`sortOrder\`, \`updatedAt\`) VALUES (${[
      q(f.key), q(f.nameBn), q(f.nameEn), q(f.descriptionBn), q(f.descriptionEn), q(f.icon), `'${f.tier}'`, `'${f.status}'`, f.defaultEnabled ? "1" : "0", String(i * 10), "CURRENT_TIMESTAMP(3)",
    ].join(", ")});`,
  );
  for (const [action, perms] of Object.entries(f.permissions)) {
    for (const p of perms ?? []) {
      const id = `fp_${f.key}_${action}_${p}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      out.push(`INSERT IGNORE INTO \`FeaturePermission\` (\`id\`, \`featureKey\`, \`action\`, \`permission\`, \`owned\`) VALUES (${q(id)}, ${q(f.key)}, ${q(action)}, ${q(p)}, ${(f.owns as readonly string[]).includes(p) ? "1" : "0"});`);
    }
  }
});

out.push("", "-- ── seed: subscription plans (initial values; edited later in the Super Admin panel) ──");
PLANS.forEach((p, i) => {
  out.push(
    `INSERT IGNORE INTO \`Plan\` (\`id\`, \`code\`, \`nameBn\`, \`nameEn\`, \`descriptionBn\`, \`descriptionEn\`, \`priceMonthly\`, \`priceYearly\`, \`userLimit\`, \`isActive\`, \`isPublic\`, \`sortOrder\`, \`createdAt\`, \`updatedAt\`) VALUES (${[
      q(p.id), q(p.code), q(p.nameBn), q(p.nameEn), q(p.descBn), q(p.descEn), p.monthly, p.yearly, p.users, 1, 1, i * 10, "CURRENT_TIMESTAMP(3)", "CURRENT_TIMESTAMP(3)",
    ].join(", ")});`,
  );
  for (const f of p.features) out.push(`INSERT IGNORE INTO \`PlanFeature\` (\`planId\`, \`featureKey\`) VALUES (${q(p.id)}, ${q(f)});`);
});
out.push("", "-- ── seed: platform settings (trial 14 days on PREMIUM, fallback FREE, grace 3 days, reminders 7/3/1) ──");
out.push("INSERT IGNORE INTO `PlatformSetting` (`id`, `updatedAt`) VALUES ('platform', CURRENT_TIMESTAMP(3));");
console.log(out.join("\n"));
