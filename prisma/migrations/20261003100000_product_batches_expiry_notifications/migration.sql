-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('EXPIRED', 'EXPIRY_WARNING', 'LOW_STOCK', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "allowExpiredSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expiryWarningDays" INTEGER[] DEFAULT ARRAY[60, 30, 15, 7]::INTEGER[];

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "adjustmentAccountId" TEXT;

-- AlterTable
ALTER TABLE "VoucherItem" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "ProductBatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "mfgDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "productId" TEXT,
    "batchId" TEXT,
    "accountId" TEXT,
    "level" INTEGER,
    "quantity" DECIMAL(14,3),
    "amount" DECIMAL(14,2),
    "dueOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "runOn" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductBatch_businessId_expiryDate_idx" ON "ProductBatch"("businessId", "expiryDate");

-- CreateIndex
CREATE INDEX "ProductBatch_businessId_quantity_idx" ON "ProductBatch"("businessId", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatch_productId_batchNo_key" ON "ProductBatch"("productId", "batchNo");

-- CreateIndex
CREATE INDEX "Notification_businessId_resolvedAt_createdAt_idx" ON "Notification"("businessId", "resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_businessId_kind_idx" ON "Notification"("businessId", "kind");

-- CreateIndex
CREATE INDEX "Notification_batchId_idx" ON "Notification"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_businessId_dedupeKey_key" ON "Notification"("businessId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_businessId_job_runOn_key" ON "JobRun"("businessId", "job", "runOn");

-- CreateIndex
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");

-- CreateIndex
CREATE INDEX "VoucherItem_batchId_idx" ON "VoucherItem"("batchId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_adjustmentAccountId_fkey" FOREIGN KEY ("adjustmentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherItem" ADD CONSTRAINT "VoucherItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────── Backfill: one ProductBatch per (product, batch number) already in stock history ─────────────
INSERT INTO "ProductBatch" ("id", "businessId", "productId", "batchNo", "expiryDate", "supplierId", "purchaseDate", "purchasePrice", "salePrice", "quantity", "updatedAt")
SELECT
  gen_random_uuid()::text,
  g."businessId", g."productId", g."batchNo", g.exp,
  (SELECT s."id" FROM "Supplier" s WHERE s."accountId" = fi."partyAccountId"),
  fi."date", COALESCE(fi."unitCost", 0), p."salePrice", GREATEST(g.qty, 0), CURRENT_TIMESTAMP
FROM (
  SELECT m."businessId", m."productId", m."batchNo",
         MIN(m."expiryDate") AS exp,
         SUM(m."quantityIn") - SUM(m."quantityOut") AS qty
  FROM "StockMovement" m
  WHERE m."batchNo" IS NOT NULL
  GROUP BY 1, 2, 3
) g
JOIN "Product" p ON p."id" = g."productId"
LEFT JOIN LATERAL (
  SELECT m."date", m."unitCost", v."partyAccountId"
  FROM "StockMovement" m LEFT JOIN "Voucher" v ON v."id" = m."voucherId"
  WHERE m."productId" = g."productId" AND m."batchNo" = g."batchNo" AND m."quantityIn" > 0
  ORDER BY m."date", m."createdAt", m."id" LIMIT 1
) fi ON TRUE;

UPDATE "StockMovement" m SET "batchId" = b."id"
FROM "ProductBatch" b WHERE b."productId" = m."productId" AND b."batchNo" = m."batchNo" AND m."batchNo" IS NOT NULL;

UPDATE "VoucherItem" i SET "batchId" = b."id"
FROM "ProductBatch" b WHERE b."productId" = i."productId" AND b."batchNo" = i."batchNo" AND i."batchNo" IS NOT NULL;

-- Expiry write-offs post to their own expense ledger in every existing business.
INSERT INTO "Account" ("id", "businessId", "groupId", "name", "code", "nature", "kind", "systemKey", "isSystem", "updatedAt")
SELECT gen_random_uuid()::text, g."businessId", g."id", 'মেয়াদোত্তীর্ণ পণ্যের ক্ষতি',
       CASE WHEN EXISTS (SELECT 1 FROM "Account" a WHERE a."businessId" = g."businessId" AND a."code" = '5103') THEN NULL ELSE '5103' END,
       'EXPENSE', 'GENERAL', 'EXPIRY_LOSS', true, CURRENT_TIMESTAMP
FROM "AccountGroup" g
WHERE g."systemKey" = 'INDIRECT_EXPENSES'
  AND NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."businessId" = g."businessId" AND a."systemKey" = 'EXPIRY_LOSS');

-- ───────────── Integrity constraints ─────────────
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_quantity_nonneg" CHECK ("quantity" >= 0);
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_prices_nonneg" CHECK ("purchasePrice" >= 0 AND "salePrice" >= 0);
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_mfg_before_expiry" CHECK ("mfgDate" IS NULL OR "expiryDate" IS NULL OR "mfgDate" <= "expiryDate");
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_batchNo_not_blank" CHECK (length(trim("batchNo")) > 0);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_level_nonneg" CHECK ("level" IS NULL OR "level" >= 0);
ALTER TABLE "Business" ADD CONSTRAINT "Business_expiryWarningDays_valid"
  CHECK ("expiryWarningDays" IS NULL OR (cardinality("expiryWarningDays") BETWEEN 1 AND 8 AND 0 < ALL ("expiryWarningDays") AND 3650 >= ALL ("expiryWarningDays")));
