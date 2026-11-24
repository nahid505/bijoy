-- CreateTable StockTransfer
CREATE TABLE IF NOT EXISTS `StockTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `transferNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `fromWarehouseId` VARCHAR(191) NOT NULL,
    `toWarehouseId` VARCHAR(191) NOT NULL,
    `vehicleNo` TEXT NULL,
    `driverName` TEXT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransfer_businessId_transferNo_key`(`businessId`, `transferNo`),
    INDEX `StockTransfer_businessId_date_idx`(`businessId`, `date`),
    INDEX `StockTransfer_fromWarehouseId_idx`(`fromWarehouseId`),
    INDEX `StockTransfer_toWarehouseId_idx`(`toWarehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable StockTransferItem
CREATE TABLE IF NOT EXISTS `StockTransferItem` (
    `id` VARCHAR(191) NOT NULL,
    `transferId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL DEFAULT 0.0000,
    `batchNo` TEXT NULL,
    `lineNo` INTEGER NOT NULL DEFAULT 0,

    INDEX `StockTransferItem_transferId_idx`(`transferId`),
    INDEX `StockTransferItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable StockMovement enum type
ALTER TABLE `StockMovement`
    MODIFY `type` ENUM('OPENING', 'PURCHASE', 'SALE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'DEPOT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT') NOT NULL;

-- AlterTable StockMovement add columns
ALTER TABLE `StockMovement`
    ADD COLUMN IF NOT EXISTS `transferId` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `transferItemId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS `StockMovement_transferId_idx` ON `StockMovement`(`transferId`);
CREATE INDEX IF NOT EXISTS `StockMovement_transferItemId_idx` ON `StockMovement`(`transferItemId`);
