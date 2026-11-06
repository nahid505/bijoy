-- Enterprise company groups, sister-concern links and inter-company vouchers.
-- Idempotent (MariaDB IF NOT EXISTS) so it is safe to re-run or to apply on a database
-- where some of these were already added by hand.

CREATE TABLE IF NOT EXISTS `CompanyGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `code` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `logo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompanyGroup_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Business` ADD COLUMN IF NOT EXISTS `groupId` VARCHAR(191) NULL;
ALTER TABLE `Business` ADD COLUMN IF NOT EXISTS `intercompanyCode` TEXT NULL;
ALTER TABLE `Business` ADD COLUMN IF NOT EXISTS `isParent` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `Voucher` ADD COLUMN IF NOT EXISTS `bilateralStatus` ENUM('NONE', 'PENDING', 'ACCEPTED', 'DISPUTED') NOT NULL DEFAULT 'NONE';
ALTER TABLE `Voucher` ADD COLUMN IF NOT EXISTS `disputeReason` TEXT NULL;
ALTER TABLE `Voucher` ADD COLUMN IF NOT EXISTS `intercompanyRefId` VARCHAR(191) NULL;
ALTER TABLE `Voucher` ADD COLUMN IF NOT EXISTS `isIntercompany` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `Customer` ADD COLUMN IF NOT EXISTS `isSisterConcern` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Customer` ADD COLUMN IF NOT EXISTS `linkedBusinessId` VARCHAR(191) NULL;

ALTER TABLE `Supplier` ADD COLUMN IF NOT EXISTS `isSisterConcern` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Supplier` ADD COLUMN IF NOT EXISTS `linkedBusinessId` VARCHAR(191) NULL;

CREATE INDEX IF NOT EXISTS `Business_groupId_idx` ON `Business`(`groupId`);
CREATE INDEX IF NOT EXISTS `Voucher_isIntercompany_bilateralStatus_idx` ON `Voucher`(`isIntercompany`, `bilateralStatus`);
CREATE INDEX IF NOT EXISTS `Voucher_intercompanyRefId_idx` ON `Voucher`(`intercompanyRefId`);
CREATE INDEX IF NOT EXISTS `Customer_businessId_isSisterConcern_idx` ON `Customer`(`businessId`, `isSisterConcern`);
CREATE INDEX IF NOT EXISTS `Customer_linkedBusinessId_idx` ON `Customer`(`linkedBusinessId`);
CREATE INDEX IF NOT EXISTS `Supplier_businessId_isSisterConcern_idx` ON `Supplier`(`businessId`, `isSisterConcern`);
CREATE INDEX IF NOT EXISTS `Supplier_linkedBusinessId_idx` ON `Supplier`(`linkedBusinessId`);

ALTER TABLE `Business` ADD CONSTRAINT IF NOT EXISTS `Business_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `CompanyGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Customer` ADD CONSTRAINT IF NOT EXISTS `Customer_linkedBusinessId_fkey` FOREIGN KEY (`linkedBusinessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Supplier` ADD CONSTRAINT IF NOT EXISTS `Supplier_linkedBusinessId_fkey` FOREIGN KEY (`linkedBusinessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
