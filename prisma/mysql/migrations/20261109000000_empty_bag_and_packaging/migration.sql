-- Empty bag tracking & return vouchers, packaging bag inventory & wastage
-- MySQL / MariaDB equivalent of the PostgreSQL bag tracking migrations.

ALTER TABLE `PaddyPurchase` ADD COLUMN IF NOT EXISTS `juteBagQty` INT NOT NULL DEFAULT 0;
ALTER TABLE `PaddyPurchase` ADD COLUMN IF NOT EXISTS `plasticBagQty` INT NOT NULL DEFAULT 0;
ALTER TABLE `PaddyPurchase` ADD COLUMN IF NOT EXISTS `totalBags` INT NOT NULL DEFAULT 0;

ALTER TABLE `VoucherItem` ADD COLUMN IF NOT EXISTS `juteBagQty` INT NOT NULL DEFAULT 0;
ALTER TABLE `VoucherItem` ADD COLUMN IF NOT EXISTS `plasticBagQty` INT NOT NULL DEFAULT 0;
ALTER TABLE `VoucherItem` ADD COLUMN IF NOT EXISTS `totalBags` INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `BagReturnVoucher` (
    `id` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `returnedJuteBags` INT NOT NULL DEFAULT 0,
    `returnedPlasticBags` INT NOT NULL DEFAULT 0,
    `driverName` VARCHAR(191) NULL,
    `vehicleNo` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BagReturnVoucher_businessId_date_idx`(`businessId`, `date`),
    INDEX `BagReturnVoucher_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `BagReturnVoucher_businessId_voucherNo_key`(`businessId`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PackagingBagItem` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `bagType` ENUM('BAG_50KG', 'BAG_25KG', 'BAG_10KG', 'BAG_5KG', 'OTHER') NOT NULL DEFAULT 'BAG_50KG',
    `capacityKg` DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
    `material` VARCHAR(191) NULL,
    `brandName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PackagingBagItem_productId_key`(`productId`),
    INDEX `PackagingBagItem_businessId_idx`(`businessId`),
    INDEX `PackagingBagItem_bagType_idx`(`bagType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PackagingBagWastage` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `bagItemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `quantity` INT NOT NULL,
    `reason` VARCHAR(191) NULL,
    `costRate` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `costAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PackagingBagWastage_businessId_date_idx`(`businessId`, `date`),
    INDEX `PackagingBagWastage_bagItemId_idx`(`bagItemId`),
    INDEX `PackagingBagWastage_warehouseId_idx`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_supplierId_fkey` FOREIGN KEY IF NOT EXISTS (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_createdById_fkey` FOREIGN KEY IF NOT EXISTS (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PackagingBagItem` ADD CONSTRAINT `PackagingBagItem_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PackagingBagItem` ADD CONSTRAINT `PackagingBagItem_productId_fkey` FOREIGN KEY IF NOT EXISTS (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_bagItemId_fkey` FOREIGN KEY IF NOT EXISTS (`bagItemId`) REFERENCES `PackagingBagItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_warehouseId_fkey` FOREIGN KEY IF NOT EXISTS (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_createdById_fkey` FOREIGN KEY IF NOT EXISTS (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
