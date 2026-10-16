-- AlterTable
ALTER TABLE `Voucher` MODIFY `type` ENUM('OPENING', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN', 'STOCK_JOURNAL', 'PRODUCTION') NOT NULL;

-- AlterTable
ALTER TABLE `VoucherItem` ADD COLUMN `costShare` DECIMAL(7, 4) NULL;

-- AlterTable
ALTER TABLE `StockMovement` MODIFY `type` ENUM('OPENING', 'PURCHASE', 'SALE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PRODUCTION_IN', 'PRODUCTION_OUT') NOT NULL;

-- CreateTable
CREATE TABLE `Recipe` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` TEXT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Recipe_businessId_idx`(`businessId`),
    UNIQUE INDEX `Recipe_businessId_name_key`(`businessId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeLine` (
    `id` VARCHAR(191) NOT NULL,
    `recipeId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `kind` ENUM('INPUT', 'OUTPUT') NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `costShare` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `lineNo` INTEGER NOT NULL DEFAULT 0,

    INDEX `RecipeLine_recipeId_idx`(`recipeId`),
    INDEX `RecipeLine_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionRun` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `recipeId` VARCHAR(191) NULL,
    `batches` DECIMAL(14, 4) NOT NULL DEFAULT 1,
    `extraCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductionRun_voucherId_key`(`voucherId`),
    INDEX `ProductionRun_businessId_idx`(`businessId`),
    INDEX `ProductionRun_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Recipe` ADD CONSTRAINT `Recipe_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeLine` ADD CONSTRAINT `RecipeLine_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeLine` ADD CONSTRAINT `RecipeLine_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionRun` ADD CONSTRAINT `ProductionRun_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionRun` ADD CONSTRAINT `ProductionRun_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionRun` ADD CONSTRAINT `ProductionRun_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `Recipe`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- integrity rules
ALTER TABLE `RecipeLine` ADD CONSTRAINT `RecipeLine_values_valid` CHECK (`quantity` > 0 AND `costShare` >= 0 AND `costShare` <= 100);
ALTER TABLE `ProductionRun` ADD CONSTRAINT `ProductionRun_values_valid` CHECK (`batches` > 0 AND `extraCost` >= 0);
