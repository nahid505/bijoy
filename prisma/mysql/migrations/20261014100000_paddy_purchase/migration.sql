-- CreateTable
CREATE TABLE `PaddyPurchase` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `bagCount` INTEGER NOT NULL DEFAULT 0,
    `grossKg` DECIMAL(14, 3) NOT NULL,
    `dhaltaKg` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `netKg` DECIMAL(14, 3) NOT NULL,
    `mon` DECIMAL(14, 2) NOT NULL,
    `ratePerMon` DECIMAL(14, 2) NOT NULL,
    `totalPrice` DECIMAL(14, 2) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaddyPurchase_voucherId_key`(`voucherId`),
    INDEX `PaddyPurchase_businessId_idx`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaddyPurchase` ADD CONSTRAINT `PaddyPurchase_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaddyPurchase` ADD CONSTRAINT `PaddyPurchase_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- integrity rules
ALTER TABLE `PaddyPurchase` ADD CONSTRAINT `PaddyPurchase_values_valid` CHECK (`bagCount` >= 0 AND `grossKg` > 0 AND `dhaltaKg` >= 0 AND `dhaltaKg` < `grossKg` AND `netKg` > 0 AND `mon` >= 0 AND `ratePerMon` >= 0 AND `totalPrice` >= 0);
