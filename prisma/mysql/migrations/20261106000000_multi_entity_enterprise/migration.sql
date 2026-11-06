-- Multi-entity enterprise: group roles & memberships, ownership %, inter-company credit limit,
-- per-business columns on voucher items/payments/payslip lines (MySQL equivalent of the
-- PostgreSQL migration of the same name). Idempotent (MariaDB IF NOT EXISTS).

ALTER TABLE `Business` ADD COLUMN IF NOT EXISTS `intercompanyCreditLimit` DECIMAL(14, 2) NULL;
ALTER TABLE `Business` ADD COLUMN IF NOT EXISTS `ownershipPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 100.0;
ALTER TABLE `VoucherPayment` ADD COLUMN IF NOT EXISTS `businessId` VARCHAR(191) NULL;
ALTER TABLE `VoucherItem` ADD COLUMN IF NOT EXISTS `businessId` VARCHAR(191) NULL;
ALTER TABLE `PayslipLine` ADD COLUMN IF NOT EXISTS `businessId` VARCHAR(191) NULL;

CREATE TABLE IF NOT EXISTS `GroupRole` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `permissions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GroupRole_groupId_idx`(`groupId`),
    UNIQUE INDEX `GroupRole_groupId_name_key`(`groupId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `GroupMembership` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GroupMembership_groupId_idx`(`groupId`),
    INDEX `GroupMembership_userId_idx`(`userId`),
    UNIQUE INDEX `GroupMembership_userId_groupId_key`(`userId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `VoucherPayment_businessId_id_idx` ON `VoucherPayment`(`businessId`, `id`);
CREATE INDEX IF NOT EXISTS `VoucherItem_businessId_id_idx` ON `VoucherItem`(`businessId`, `id`);
CREATE INDEX IF NOT EXISTS `PayslipLine_businessId_id_idx` ON `PayslipLine`(`businessId`, `id`);

ALTER TABLE `GroupRole` ADD CONSTRAINT `GroupRole_groupId_fkey` FOREIGN KEY IF NOT EXISTS (`groupId`) REFERENCES `CompanyGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GroupMembership` ADD CONSTRAINT `GroupMembership_userId_fkey` FOREIGN KEY IF NOT EXISTS (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GroupMembership` ADD CONSTRAINT `GroupMembership_groupId_fkey` FOREIGN KEY IF NOT EXISTS (`groupId`) REFERENCES `CompanyGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GroupMembership` ADD CONSTRAINT `GroupMembership_roleId_fkey` FOREIGN KEY IF NOT EXISTS (`roleId`) REFERENCES `GroupRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `VoucherPayment` ADD CONSTRAINT `VoucherPayment_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `VoucherItem` ADD CONSTRAINT `VoucherItem_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayslipLine` ADD CONSTRAINT `PayslipLine_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
