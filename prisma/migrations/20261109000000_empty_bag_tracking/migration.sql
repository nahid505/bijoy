-- AlterTable PaddyPurchase
ALTER TABLE "PaddyPurchase" ADD COLUMN IF NOT EXISTS "juteBagQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaddyPurchase" ADD COLUMN IF NOT EXISTS "plasticBagQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaddyPurchase" ADD COLUMN IF NOT EXISTS "totalBags" INTEGER NOT NULL DEFAULT 0;

-- AlterTable VoucherItem
ALTER TABLE "VoucherItem" ADD COLUMN IF NOT EXISTS "juteBagQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VoucherItem" ADD COLUMN IF NOT EXISTS "plasticBagQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VoucherItem" ADD COLUMN IF NOT EXISTS "totalBags" INTEGER NOT NULL DEFAULT 0;

-- CreateTable BagReturnVoucher
CREATE TABLE IF NOT EXISTS "BagReturnVoucher" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "returnedJuteBags" INTEGER NOT NULL DEFAULT 0,
    "returnedPlasticBags" INTEGER NOT NULL DEFAULT 0,
    "driverName" TEXT,
    "vehicleNo" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BagReturnVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BagReturnVoucher_businessId_voucherNo_key" ON "BagReturnVoucher"("businessId", "voucherNo");
CREATE INDEX IF NOT EXISTS "BagReturnVoucher_businessId_date_idx" ON "BagReturnVoucher"("businessId", "date");
CREATE INDEX IF NOT EXISTS "BagReturnVoucher_supplierId_idx" ON "BagReturnVoucher"("supplierId");

-- AddForeignKey
ALTER TABLE "BagReturnVoucher" ADD CONSTRAINT "BagReturnVoucher_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BagReturnVoucher" ADD CONSTRAINT "BagReturnVoucher_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BagReturnVoucher" ADD CONSTRAINT "BagReturnVoucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
