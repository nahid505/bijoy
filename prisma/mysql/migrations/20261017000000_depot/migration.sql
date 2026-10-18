-- Depot management (business type DEPOT): delivery challans in two modes (company-paid DO release /
-- depot collection), product commission rate, dealer route. Additive only: new enum values, a new
-- table and two new columns with defaults — existing rows are unchanged.
-- AlterTable
ALTER TABLE `Voucher` MODIFY `type` ENUM('OPENING', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN', 'STOCK_JOURNAL', 'PRODUCTION', 'DEPOT_DELIVERY') NOT NULL;

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `route` TEXT NULL;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `depotCommissionRate` DECIMAL(14, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `StockMovement` MODIFY `type` ENUM('OPENING', 'PURCHASE', 'SALE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'DEPOT_OUT') NOT NULL;

-- CreateTable
CREATE TABLE `DepotDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `mode` ENUM('COMPANY_PAID', 'DEPOT_COLLECTION') NOT NULL,
    `companyAccountId` VARCHAR(191) NULL,
    `dealerAccountId` VARCHAR(191) NULL,
    `doNumber` TEXT NULL,
    `vehicleNo` TEXT NULL,
    `driverName` TEXT NULL,
    `notes` TEXT NULL,
    `commissionTotal` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DepotDelivery_voucherId_key`(`voucherId`),
    INDEX `DepotDelivery_businessId_idx`(`businessId`),
    INDEX `DepotDelivery_companyAccountId_idx`(`companyAccountId`),
    INDEX `DepotDelivery_dealerAccountId_idx`(`dealerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DepotDelivery` ADD CONSTRAINT `DepotDelivery_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepotDelivery` ADD CONSTRAINT `DepotDelivery_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepotDelivery` ADD CONSTRAINT `DepotDelivery_companyAccountId_fkey` FOREIGN KEY (`companyAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepotDelivery` ADD CONSTRAINT `DepotDelivery_dealerAccountId_fkey` FOREIGN KEY (`dealerAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- commission is never negative
ALTER TABLE `DepotDelivery` ADD CONSTRAINT `DepotDelivery_commission_valid` CHECK (`commissionTotal` >= 0);
