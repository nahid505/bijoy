-- Depot challan rate: the rate printed on the dealer copy of a delivery challan (the product's purchase
-- price at delivery). Additive: one nullable column; existing DO-release lines are filled from their
-- product's current purchase price so old challans print a rate too. No other data changes.
-- AlterTable
ALTER TABLE `VoucherItem` ADD COLUMN `challanRate` DECIMAL(14, 2) NULL;

-- backfill existing DO-release lines
UPDATE `VoucherItem` vi
JOIN `Voucher` v ON v.`id` = vi.`voucherId`
JOIN `Product` p ON p.`id` = vi.`productId`
SET vi.`challanRate` = p.`purchasePrice`
WHERE v.`type` = 'DEPOT_DELIVERY' AND vi.`challanRate` IS NULL;
