-- AlterTable
ALTER TABLE `Product` ADD COLUMN `depotCommissionType` ENUM('FIXED', 'PERCENT') NOT NULL DEFAULT 'FIXED',
    ADD COLUMN `isDepotProduct` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `Product_businessId_isDepotProduct_idx` ON `Product`(`businessId`, `isDepotProduct`);


-- Existing depot businesses: a product becomes a depot product when the depot already uses it (a depot-book stock
-- movement, or a DO commission rate) and the general business never did (no general voucher other than its own
-- opening stock, no recipe). Products used by both stay general. Only flags change; no amount or quantity changes.
UPDATE `Product` p JOIN `Business` b ON b.`id` = p.`businessId`
SET p.`isDepotProduct` = true
WHERE b.`businessType` = 'DEPOT'
  AND (p.`depotCommissionRate` > 0 OR EXISTS (SELECT 1 FROM `StockMovement` m JOIN `Voucher` v ON v.`id` = m.`voucherId` WHERE m.`productId` = p.`id` AND v.`book` = 'DEPOT'))
  AND NOT EXISTS (SELECT 1 FROM `StockMovement` m LEFT JOIN `Voucher` v ON v.`id` = m.`voucherId` WHERE m.`productId` = p.`id` AND (v.`id` IS NULL OR (v.`book` = 'GENERAL' AND v.`type` <> 'OPENING')))
  AND NOT EXISTS (SELECT 1 FROM `RecipeLine` r WHERE r.`productId` = p.`id`);

-- Their opening stock moves to the depot book with them (the voucher and its entries are relabelled, amounts kept).
UPDATE `Voucher` v JOIN `Product` p ON v.`businessId` = p.`businessId` AND v.`sourceKey` = CONCAT('opening:product:', p.`id`)
SET v.`book` = 'DEPOT'
WHERE p.`isDepotProduct` = true AND v.`book` = 'GENERAL';
UPDATE `JournalEntry` e JOIN `Voucher` v ON v.`id` = e.`voucherId`
SET e.`book` = 'DEPOT'
WHERE v.`book` = 'DEPOT' AND v.`sourceKey` LIKE 'opening:product:%' AND e.`book` = 'GENERAL';

-- depot:products_manage for roles that receive stock from the company (DEPOT_PERMISSION_UPGRADE) and the default depot role.
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'depot:products_manage') WHERE (JSON_CONTAINS(`permissions`, '"depot:stock_in"') OR `name` = 'ডিপো হিসাবরক্ষক (Depot Accountant)') AND NOT JSON_CONTAINS(`permissions`, '"depot:products_manage"');
