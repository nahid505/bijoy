-- Depot management (business type DEPOT): delivery challans in two modes (company-paid DO release /
-- depot collection), product commission rate, dealer route. Additive only: new enum values, a new
-- table and two new columns with defaults — existing rows are unchanged.
-- CreateEnum
CREATE TYPE "DepotDeliveryMode" AS ENUM ('COMPANY_PAID', 'DEPOT_COLLECTION');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'DEPOT_OUT';

-- AlterEnum
ALTER TYPE "VoucherType" ADD VALUE 'DEPOT_DELIVERY';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "route" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "depotCommissionRate" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DepotDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "mode" "DepotDeliveryMode" NOT NULL,
    "companyAccountId" TEXT,
    "dealerAccountId" TEXT,
    "doNumber" TEXT,
    "vehicleNo" TEXT,
    "driverName" TEXT,
    "notes" TEXT,
    "commissionTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepotDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepotDelivery_voucherId_key" ON "DepotDelivery"("voucherId");

-- CreateIndex
CREATE INDEX "DepotDelivery_businessId_idx" ON "DepotDelivery"("businessId");

-- CreateIndex
CREATE INDEX "DepotDelivery_companyAccountId_idx" ON "DepotDelivery"("companyAccountId");

-- CreateIndex
CREATE INDEX "DepotDelivery_dealerAccountId_idx" ON "DepotDelivery"("dealerAccountId");

-- AddForeignKey
ALTER TABLE "DepotDelivery" ADD CONSTRAINT "DepotDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepotDelivery" ADD CONSTRAINT "DepotDelivery_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepotDelivery" ADD CONSTRAINT "DepotDelivery_companyAccountId_fkey" FOREIGN KEY ("companyAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepotDelivery" ADD CONSTRAINT "DepotDelivery_dealerAccountId_fkey" FOREIGN KEY ("dealerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- commission is never negative
ALTER TABLE "DepotDelivery" ADD CONSTRAINT "DepotDelivery_commission_valid" CHECK ("commissionTotal" >= 0);
