-- CreateTable
CREATE TABLE IF NOT EXISTS "PaddyPurchaseItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "paddyPurchaseId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "bagCount" INTEGER NOT NULL DEFAULT 0,
    "juteBagQty" INTEGER NOT NULL DEFAULT 0,
    "plasticBagQty" INTEGER NOT NULL DEFAULT 0,
    "totalBags" INTEGER NOT NULL DEFAULT 0,
    "variety" TEXT,
    "moisturePct" DECIMAL(5,2),
    "batchNo" TEXT,
    "vehicleGrossKg" DECIMAL(14,3),
    "vehicleTareKg" DECIMAL(14,3),
    "grossKg" DECIMAL(14,3) NOT NULL,
    "dhaltaKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "netKg" DECIMAL(14,3) NOT NULL,
    "mon" DECIMAL(14,2) NOT NULL,
    "ratePerMon" DECIMAL(14,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PaddyPurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaddyPurchaseItem_businessId_idx" ON "PaddyPurchaseItem"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaddyPurchaseItem_paddyPurchaseId_idx" ON "PaddyPurchaseItem"("paddyPurchaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaddyPurchaseItem_productId_idx" ON "PaddyPurchaseItem"("productId");

-- AddForeignKey
ALTER TABLE "PaddyPurchaseItem" ADD CONSTRAINT "PaddyPurchaseItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddyPurchaseItem" ADD CONSTRAINT "PaddyPurchaseItem_paddyPurchaseId_fkey" FOREIGN KEY ("paddyPurchaseId") REFERENCES "PaddyPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddyPurchaseItem" ADD CONSTRAINT "PaddyPurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules
ALTER TABLE "PaddyPurchaseItem" ADD CONSTRAINT "PaddyPurchaseItem_values_valid" CHECK ("bagCount" >= 0 AND "grossKg" > 0 AND "dhaltaKg" >= 0 AND "dhaltaKg" < "grossKg" AND "netKg" > 0 AND "mon" >= 0 AND "ratePerMon" >= 0 AND "totalPrice" >= 0);
