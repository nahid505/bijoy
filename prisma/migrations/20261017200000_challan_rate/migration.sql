-- Depot challan rate: the rate printed on the dealer copy of a delivery challan (the product's purchase
-- price at delivery). Additive: one nullable column; existing DO-release lines are filled from their
-- product's current purchase price so old challans print a rate too. No other data changes.
-- AlterTable
ALTER TABLE "VoucherItem" ADD COLUMN     "challanRate" DECIMAL(14,2);

-- backfill existing DO-release lines
UPDATE "VoucherItem" vi
SET "challanRate" = p."purchasePrice"
FROM "Voucher" v, "Product" p
WHERE vi."voucherId" = v."id" AND v."type" = 'DEPOT_DELIVERY' AND p."id" = vi."productId" AND vi."challanRate" IS NULL;
