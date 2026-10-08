-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'TRIAL_STARTED';
ALTER TYPE "NotificationKind" ADD VALUE 'SUBSCRIPTION_ACTIVATED';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "amount" DECIMAL(14,2),
ADD COLUMN     "paymentStatus" "PaymentStatus";


-- Seed: INVENTORY feature (basic products / units / stock — always available until now, so every
-- existing plan includes it; nothing changes for existing companies)
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('INVENTORY', 'ইনভেন্টরি (পণ্য ও স্টক)', 'Inventory', 'পণ্য তালিকা, ইউনিট, স্টক অবস্থা ও গুদামভিত্তিক মজুদ। বিক্রয়/ক্রয় ভাউচারে পণ্য বাছাই সবসময় চালু থাকে।', 'Product list, units, stock levels and per-warehouse quantities. Picking products in sales / purchase vouchers always works.', '🏷', 'FREE', 'AVAILABLE', true, 30, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "FeaturePermission" ("id", "featureKey", "action", "permission", "owned") VALUES ('fp_inventory_view_inventory_view', 'INVENTORY', 'VIEW', 'inventory:view', true) ON CONFLICT DO NOTHING;
INSERT INTO "FeaturePermission" ("id", "featureKey", "action", "permission", "owned") VALUES ('fp_inventory_create_inventory_manage', 'INVENTORY', 'CREATE', 'inventory:manage', true) ON CONFLICT DO NOTHING;
INSERT INTO "FeaturePermission" ("id", "featureKey", "action", "permission", "owned") VALUES ('fp_inventory_edit_inventory_manage', 'INVENTORY', 'EDIT', 'inventory:manage', true) ON CONFLICT DO NOTHING;
INSERT INTO "FeaturePermission" ("id", "featureKey", "action", "permission", "owned") VALUES ('fp_inventory_delete_inventory_manage', 'INVENTORY', 'DELETE', 'inventory:manage', true) ON CONFLICT DO NOTHING;
INSERT INTO "FeaturePermission" ("id", "featureKey", "action", "permission", "owned") VALUES ('fp_inventory_print_inventory_view', 'INVENTORY', 'PRINT', 'inventory:view', true) ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") SELECT "id", 'INVENTORY' FROM "Plan" ON CONFLICT DO NOTHING;

-- Backfill: amount / payment status of subscriptions bought with a successful payment
UPDATE "Subscription" s SET "amount" = t."amount", "paymentStatus" = 'SUCCESS' FROM (SELECT DISTINCT ON ("businessId") "businessId", "amount" FROM "PaymentTransaction" WHERE "status" = 'SUCCESS' ORDER BY "businessId", "completedAt" DESC NULLS LAST) t WHERE t."businessId" = s."businessId";
