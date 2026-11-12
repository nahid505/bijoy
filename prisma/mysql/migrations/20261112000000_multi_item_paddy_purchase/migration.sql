-- Multi-variety paddy purchase items (MySQL 8.0.16+ / MariaDB 10.6+ equivalent of the PostgreSQL migration).

CREATE TABLE IF NOT EXISTS `PaddyPurchaseItem` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `paddyPurchaseId` VARCHAR(191) NOT NULL,
    `lineNo` INT NOT NULL DEFAULT 0,
    `productId` VARCHAR(191) NOT NULL,
    `bagCount` INT NOT NULL DEFAULT 0,
    `juteBagQty` INT NOT NULL DEFAULT 0,
    `plasticBagQty` INT NOT NULL DEFAULT 0,
    `totalBags` INT NOT NULL DEFAULT 0,
    `variety` TEXT NULL,
    `moisturePct` DECIMAL(5, 2) NULL,
    `batchNo` TEXT NULL,
    `vehicleGrossKg` DECIMAL(14, 3) NULL,
    `vehicleTareKg` DECIMAL(14, 3) NULL,
    `grossKg` DECIMAL(14, 3) NOT NULL,
    `dhaltaKg` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `netKg` DECIMAL(14, 3) NOT NULL,
    `mon` DECIMAL(14, 2) NOT NULL,
    `ratePerMon` DECIMAL(14, 2) NOT NULL,
    `totalPrice` DECIMAL(14, 2) NOT NULL,

    INDEX `PaddyPurchaseItem_businessId_idx`(`businessId`),
    INDEX `PaddyPurchaseItem_paddyPurchaseId_idx`(`paddyPurchaseId`),
    INDEX `PaddyPurchaseItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PaddyPurchaseItem_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `PaddyPurchaseItem_paddyPurchaseId_fkey` FOREIGN KEY (`paddyPurchaseId`) REFERENCES `PaddyPurchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `PaddyPurchaseItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `PaddyPurchaseItem_values_valid` CHECK (`bagCount` >= 0 AND `grossKg` > 0 AND `dhaltaKg` >= 0 AND `dhaltaKg` < `grossKg` AND `netKg` > 0 AND `mon` >= 0 AND `ratePerMon` >= 0 AND `totalPrice` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
