-- CreateEnum
CREATE TYPE "DepotCommissionType" AS ENUM ('FIXED', 'PERCENT');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "depotCommissionType" "DepotCommissionType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "isDepotProduct" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Product_businessId_isDepotProduct_idx" ON "Product"("businessId", "isDepotProduct");


-- Existing depot businesses: a product becomes a depot product when the depot already uses it (a depot-book stock
-- movement, or a DO commission rate) and the general business never did (no general voucher other than its own
-- opening stock, no recipe). Products used by both stay general. Only flags change; no amount or quantity changes.
UPDATE "Product" p SET "isDepotProduct" = true
FROM "Business" b
WHERE p."businessId" = b."id" AND b."businessType" = 'DEPOT'
  AND (p."depotCommissionRate" > 0 OR EXISTS (SELECT 1 FROM "StockMovement" m JOIN "Voucher" v ON v."id" = m."voucherId" WHERE m."productId" = p."id" AND v."book" = 'DEPOT'))
  AND NOT EXISTS (SELECT 1 FROM "StockMovement" m LEFT JOIN "Voucher" v ON v."id" = m."voucherId" WHERE m."productId" = p."id" AND (v."id" IS NULL OR (v."book" = 'GENERAL' AND v."type" <> 'OPENING')))
  AND NOT EXISTS (SELECT 1 FROM "RecipeLine" r WHERE r."productId" = p."id");

-- Their opening stock moves to the depot book with them (the voucher and its entries are relabelled, amounts kept).
UPDATE "Voucher" v SET "book" = 'DEPOT'
FROM "Product" p
WHERE p."isDepotProduct" = true AND v."businessId" = p."businessId" AND v."sourceKey" = 'opening:product:' || p."id" AND v."book" = 'GENERAL';
UPDATE "JournalEntry" e SET "book" = 'DEPOT'
FROM "Voucher" v
WHERE e."voucherId" = v."id" AND v."book" = 'DEPOT' AND v."sourceKey" LIKE 'opening:product:%' AND e."book" = 'GENERAL';

-- depot:products_manage for roles that receive stock from the company (DEPOT_PERMISSION_UPGRADE) and the default depot role.
UPDATE "Role" SET "permissions" = array_append("permissions", 'depot:products_manage') WHERE ('depot:stock_in' = ANY("permissions") OR "name" = 'ডিপো হিসাবরক্ষক (Depot Accountant)') AND NOT ('depot:products_manage' = ANY("permissions"));
