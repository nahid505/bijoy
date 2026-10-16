-- CreateEnum
CREATE TYPE "ProductionLineKind" AS ENUM ('INPUT', 'OUTPUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_OUT';

-- AlterEnum
ALTER TYPE "VoucherType" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "VoucherItem" ADD COLUMN     "costShare" DECIMAL(7,4);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "ProductionLineKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "costShare" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "lineNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "recipeId" TEXT,
    "batches" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "extraCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recipe_businessId_idx" ON "Recipe"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_businessId_name_key" ON "Recipe"("businessId", "name");

-- CreateIndex
CREATE INDEX "RecipeLine_recipeId_idx" ON "RecipeLine"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeLine_productId_idx" ON "RecipeLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_voucherId_key" ON "ProductionRun"("voucherId");

-- CreateIndex
CREATE INDEX "ProductionRun_businessId_idx" ON "ProductionRun"("businessId");

-- CreateIndex
CREATE INDEX "ProductionRun_recipeId_idx" ON "ProductionRun"("recipeId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- integrity rules
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_values_valid" CHECK ("quantity" > 0 AND "costShare" >= 0 AND "costShare" <= 100);
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_values_valid" CHECK ("batches" > 0 AND "extraCost" >= 0);
