-- AlterTable
ALTER TABLE `Voucher` ADD COLUMN `destination` TEXT NULL,
    ADD COLUMN `driverMobile` TEXT NULL,
    ADD COLUMN `driverName` TEXT NULL,
    ADD COLUMN `transportFare` DECIMAL(14, 2) NULL,
    ADD COLUMN `vehicleNo` TEXT NULL;

-- AlterTable
ALTER TABLE `VoucherItem` ADD COLUMN `juteBagQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `plasticBagQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totalBags` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `bagCapacityKg` DECIMAL(10, 2) NULL,
    ADD COLUMN `packagingBagId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PaddyPurchase` ADD COLUMN `juteBagQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `plasticBagQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totalBags` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `UserAccountGroup` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserAccountGroup_businessId_userId_idx`(`businessId`, `userId`),
    UNIQUE INDEX `UserAccountGroup_userId_groupId_key`(`userId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserPaymentAccount` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserPaymentAccount_businessId_userId_idx`(`businessId`, `userId`),
    UNIQUE INDEX `UserPaymentAccount_userId_accountId_key`(`userId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BagReturnVoucher` (
    `id` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `returnedJuteBags` INTEGER NOT NULL DEFAULT 0,
    `returnedPlasticBags` INTEGER NOT NULL DEFAULT 0,
    `driverName` TEXT NULL,
    `vehicleNo` TEXT NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BagReturnVoucher_businessId_date_idx`(`businessId`, `date`),
    INDEX `BagReturnVoucher_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `BagReturnVoucher_businessId_voucherNo_key`(`businessId`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackagingBagItem` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `bagType` ENUM('BAG_50KG', 'BAG_25KG', 'BAG_10KG', 'BAG_5KG', 'OTHER') NOT NULL DEFAULT 'BAG_50KG',
    `capacityKg` DECIMAL(10, 2) NOT NULL DEFAULT 50,
    `material` TEXT NULL,
    `brandName` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PackagingBagItem_productId_key`(`productId`),
    INDEX `PackagingBagItem_businessId_idx`(`businessId`),
    INDEX `PackagingBagItem_bagType_idx`(`bagType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackagingBagWastage` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `bagItemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `quantity` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `costRate` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `costAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PackagingBagWastage_businessId_date_idx`(`businessId`, `date`),
    INDEX `PackagingBagWastage_bagItemId_idx`(`bagItemId`),
    INDEX `PackagingBagWastage_warehouseId_idx`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyVehicle` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `vehicleNo` VARCHAR(191) NOT NULL,
    `model` TEXT NULL,
    `driverName` TEXT NULL,
    `driverMobile` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompanyVehicle_businessId_idx`(`businessId`),
    UNIQUE INDEX `CompanyVehicle_businessId_vehicleNo_key`(`businessId`, `vehicleNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverTrip` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `vehicleNo` VARCHAR(191) NOT NULL,
    `driverName` VARCHAR(191) NOT NULL,
    `driverMobile` TEXT NULL,
    `destination` TEXT NULL,
    `goodsSummary` TEXT NULL,
    `totalQuantity` DECIMAL(14, 3) NULL,
    `tripFare` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `vehicleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DriverTrip_voucherId_key`(`voucherId`),
    INDEX `DriverTrip_businessId_driverName_idx`(`businessId`, `driverName`),
    INDEX `DriverTrip_businessId_date_idx`(`businessId`, `date`),
    INDEX `DriverTrip_businessId_paymentStatus_idx`(`businessId`, `paymentStatus`),
    INDEX `DriverTrip_businessId_vehicleNo_idx`(`businessId`, `vehicleNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverTripPayment` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `voucherId` VARCHAR(191) NULL,
    `driverName` VARCHAR(191) NOT NULL,
    `driverMobile` TEXT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `cashAccountId` VARCHAR(191) NOT NULL,
    `reference` TEXT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DriverTripPayment_businessId_driverName_idx`(`businessId`, `driverName`),
    INDEX `DriverTripPayment_businessId_date_idx`(`businessId`, `date`),
    INDEX `DriverTripPayment_tripId_idx`(`tripId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserAccountGroup` ADD CONSTRAINT `UserAccountGroup_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAccountGroup` ADD CONSTRAINT `UserAccountGroup_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAccountGroup` ADD CONSTRAINT `UserAccountGroup_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `AccountGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserPaymentAccount` ADD CONSTRAINT `UserPaymentAccount_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserPaymentAccount` ADD CONSTRAINT `UserPaymentAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserPaymentAccount` ADD CONSTRAINT `UserPaymentAccount_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_packagingBagId_fkey` FOREIGN KEY (`packagingBagId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BagReturnVoucher` ADD CONSTRAINT `BagReturnVoucher_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagItem` ADD CONSTRAINT `PackagingBagItem_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagItem` ADD CONSTRAINT `PackagingBagItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_bagItemId_fkey` FOREIGN KEY (`bagItemId`) REFERENCES `PackagingBagItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagingBagWastage` ADD CONSTRAINT `PackagingBagWastage_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyVehicle` ADD CONSTRAINT `CompanyVehicle_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTrip` ADD CONSTRAINT `DriverTrip_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTrip` ADD CONSTRAINT `DriverTrip_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTrip` ADD CONSTRAINT `DriverTrip_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `CompanyVehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTripPayment` ADD CONSTRAINT `DriverTripPayment_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTripPayment` ADD CONSTRAINT `DriverTripPayment_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `DriverTrip`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTripPayment` ADD CONSTRAINT `DriverTripPayment_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTripPayment` ADD CONSTRAINT `DriverTripPayment_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverTripPayment` ADD CONSTRAINT `DriverTripPayment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

