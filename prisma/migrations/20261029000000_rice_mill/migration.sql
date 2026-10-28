-- Auto rice mill: paddy slip details (variety, moisture, weighbridge vehicle weights, labour cost). Columns only;
-- existing slips keep their values (new fields empty, labour 0).
-- AlterTable
ALTER TABLE "PaddyPurchase" ADD COLUMN     "labourCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "moisturePct" DECIMAL(5,2),
ADD COLUMN     "variety" TEXT,
ADD COLUMN     "vehicleGrossKg" DECIMAL(14,3),
ADD COLUMN     "vehicleTareKg" DECIMAL(14,3);

