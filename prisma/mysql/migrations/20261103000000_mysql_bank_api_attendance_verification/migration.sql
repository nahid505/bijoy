-- The packaged MySQL baseline lacked these columns/tables (bank API, payroll disbursement,
-- attendance verification). Idempotent (MariaDB IF NOT EXISTS) so it is safe on databases
-- where they were already added by hand.
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `isApiEnabled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `apiProvider` ENUM('CUSTOM_BANK_API', 'BEFTN_API', 'NPSB_GATEWAY', 'MFS_PAYOUT') NULL;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `apiEndpointUrl` TEXT NULL;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `apiClientId` TEXT NULL;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `apiClientSecret` TEXT NULL;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `corporateAccountNo` TEXT NULL;
ALTER TABLE `Account` ADD COLUMN IF NOT EXISTS `webhookSecret` TEXT NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `disbursementAccountId` VARCHAR(191) NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `isBankApiEnabled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankApiProvider` ENUM('CUSTOM_BANK_API', 'BEFTN_API', 'NPSB_GATEWAY', 'MFS_PAYOUT') NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankApiEndpointUrl` TEXT NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankApiClientId` TEXT NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankApiClientSecret` TEXT NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankCorporateAccountNo` TEXT NULL;
ALTER TABLE `PayrollSettings` ADD COLUMN IF NOT EXISTS `bankWebhookSecret` TEXT NULL;
ALTER TABLE `Employee` ADD COLUMN IF NOT EXISTS `branchName` TEXT NULL;
ALTER TABLE `Employee` ADD COLUMN IF NOT EXISTS `routingNo` TEXT NULL;
ALTER TABLE `Employee` ADD COLUMN IF NOT EXISTS `routingNumber` TEXT NULL;
ALTER TABLE `Employee` ADD COLUMN IF NOT EXISTS `bankAccountNumber` TEXT NULL;
ALTER TABLE `Employee` ADD COLUMN IF NOT EXISTS `bankAccountName` TEXT NULL;
ALTER TABLE `Attendance` ADD COLUMN IF NOT EXISTS `verificationStatus` ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE `Attendance` ADD COLUMN IF NOT EXISTS `verifiedById` VARCHAR(191) NULL;
ALTER TABLE `Attendance` ADD COLUMN IF NOT EXISTS `verifiedAt` DATETIME(3) NULL;
ALTER TABLE `Attendance` ADD COLUMN IF NOT EXISTS `verificationNote` TEXT NULL;
CREATE TABLE IF NOT EXISTS `BankDisbursementBatch` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `provider` ENUM('CUSTOM_BANK_API', 'BEFTN_API', 'NPSB_GATEWAY', 'MFS_PAYOUT') NOT NULL,
    `totalAmount` DECIMAL(14, 2) NOT NULL,
    `totalEmployees` INTEGER NOT NULL,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'SUCCESS', 'FAILED', 'PARTIAL') NOT NULL DEFAULT 'PENDING',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NULL,
    `initiatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BankDisbursementBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `BankDisbursementBatch_businessId_year_month_idx`(`businessId`, `year`, `month`),
    INDEX `BankDisbursementBatch_idempotencyKey_idx`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `BankTransferLog` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `payslipId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `beneficiaryName` TEXT NOT NULL,
    `bankName` TEXT NULL,
    `branchName` TEXT NULL,
    `accountNumber` TEXT NOT NULL,
    `routingNumber` TEXT NULL,
    `paymentMethod` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `bankTxId` TEXT NULL,
    `utrNumber` TEXT NULL,
    `status` ENUM('PENDING', 'SUCCESS', 'FAILED', 'PARTIAL') NOT NULL DEFAULT 'PENDING',
    `errorMessage` TEXT NULL,
    `responsePayload` JSON NULL,
    `voucherId` VARCHAR(191) NULL,
    `initiatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BankTransferLog_idempotencyKey_key`(`idempotencyKey`),
    INDEX `BankTransferLog_businessId_createdAt_idx`(`businessId`, `createdAt`),
    INDEX `BankTransferLog_businessId_status_idx`(`businessId`, `status`),
    INDEX `BankTransferLog_batchId_idx`(`batchId`),
    INDEX `BankTransferLog_payslipId_idx`(`payslipId`),
    INDEX `BankTransferLog_employeeId_idx`(`employeeId`),
    INDEX `BankTransferLog_idempotencyKey_idx`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `PayrollSettings` ADD CONSTRAINT `PayrollSettings_disbursementAccountId_fkey` FOREIGN KEY IF NOT EXISTS (`disbursementAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_verifiedById_fkey` FOREIGN KEY IF NOT EXISTS (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BankDisbursementBatch` ADD CONSTRAINT `BankDisbursementBatch_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BankDisbursementBatch` ADD CONSTRAINT `BankDisbursementBatch_accountId_fkey` FOREIGN KEY IF NOT EXISTS (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankDisbursementBatch` ADD CONSTRAINT `BankDisbursementBatch_voucherId_fkey` FOREIGN KEY IF NOT EXISTS (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BankDisbursementBatch` ADD CONSTRAINT `BankDisbursementBatch_initiatedById_fkey` FOREIGN KEY IF NOT EXISTS (`initiatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_businessId_fkey` FOREIGN KEY IF NOT EXISTS (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_batchId_fkey` FOREIGN KEY IF NOT EXISTS (`batchId`) REFERENCES `BankDisbursementBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_employeeId_fkey` FOREIGN KEY IF NOT EXISTS (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_payslipId_fkey` FOREIGN KEY IF NOT EXISTS (`payslipId`) REFERENCES `Payslip`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_accountId_fkey` FOREIGN KEY IF NOT EXISTS (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_voucherId_fkey` FOREIGN KEY IF NOT EXISTS (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BankTransferLog` ADD CONSTRAINT `BankTransferLog_initiatedById_fkey` FOREIGN KEY IF NOT EXISTS (`initiatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
