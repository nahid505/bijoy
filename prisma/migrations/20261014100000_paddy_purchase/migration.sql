-- CreateTable
CREATE TABLE "PaddyPurchase" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "bagCount" INTEGER NOT NULL DEFAULT 0,
    "grossKg" DECIMAL(14,3) NOT NULL,
    "dhaltaKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "netKg" DECIMAL(14,3) NOT NULL,
    "mon" DECIMAL(14,2) NOT NULL,
    "ratePerMon" DECIMAL(14,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddyPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaddyPurchase_voucherId_key" ON "PaddyPurchase"("voucherId");

-- CreateIndex
CREATE INDEX "PaddyPurchase_businessId_idx" ON "PaddyPurchase"("businessId");

-- AddForeignKey
ALTER TABLE "PaddyPurchase" ADD CONSTRAINT "PaddyPurchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddyPurchase" ADD CONSTRAINT "PaddyPurchase_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- integrity rules
ALTER TABLE "PaddyPurchase" ADD CONSTRAINT "PaddyPurchase_values_valid" CHECK ("bagCount" >= 0 AND "grossKg" > 0 AND "dhaltaKg" >= 0 AND "dhaltaKg" < "grossKg" AND "netKg" > 0 AND "mon" >= 0 AND "ratePerMon" >= 0 AND "totalPrice" >= 0);
