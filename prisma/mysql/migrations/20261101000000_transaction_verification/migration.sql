-- AlterTable
ALTER TABLE `Voucher` ADD COLUMN `verificationStatus` ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN `verifiedById` VARCHAR(191) NULL,
ADD COLUMN `verifiedAt` DATETIME(3) NULL,
ADD COLUMN `verificationNote` TEXT NULL;

-- CreateIndex
CREATE INDEX `Voucher_businessId_verificationStatus_idx` ON `Voucher`(`businessId`, `verificationStatus`);

-- AddForeignKey
ALTER TABLE `Voucher` ADD CONSTRAINT `Voucher_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
