-- Incremental migration for Custom Milling & SMS WhatsApp channel (MySQL 8.0.16+ / MariaDB 10.6+)

CREATE TABLE IF NOT EXISTS `RiceMillSettings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `millName` VARCHAR(191) NOT NULL DEFAULT 'বিজয় অটো রাইস মিল (জয়েন্ট ভেঞ্চার)',
    `millAddress` VARCHAR(191) NOT NULL DEFAULT 'বীরগঞ্জ, দিনাজপুর',
    `millPhone` VARCHAR(191) NOT NULL DEFAULT '01763921505',
    `partner1Name` VARCHAR(191) NOT NULL DEFAULT 'নাহিদ হাসান',
    `partner1SharePct` DOUBLE NOT NULL DEFAULT 60.0,
    `partner2Name` VARCHAR(191) NOT NULL DEFAULT 'পার্টনার (৪০%)',
    `partner2SharePct` DOUBLE NOT NULL DEFAULT 40.0,
    `monthlyRent` DOUBLE NOT NULL DEFAULT 120000,
    `bagStandardKg` DOUBLE NOT NULL DEFAULT 75.0,
    `defaultDhaltaPerBag` DOUBLE NOT NULL DEFAULT 1.5,
    `defaultDryerRate` DOUBLE NOT NULL DEFAULT 50.0,
    `defaultMillingRate` DOUBLE NOT NULL DEFAULT 120.0,
    `branRatePerKg` DOUBLE NOT NULL DEFAULT 22.0,
    `huskRatePerKg` DOUBLE NOT NULL DEFAULT 8.0,
    `invoiceFooterNote` VARCHAR(191) NOT NULL DEFAULT 'বিঃদ্রঃ ৭৫ কেজি = ১ স্ট্যান্ডার্ড বস্তা হিসেবে বিল গণনা করা হয়েছে।',
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MillParty` (
    `id` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `phone` TEXT NULL,
    `address` TEXT NULL,
    `isOwnerSelfParty` BOOLEAN NOT NULL DEFAULT false,
    `openingBalance` DOUBLE NOT NULL DEFAULT 0,
    `currentDue` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MillBatch` (
    `id` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `partyId` VARCHAR(191) NOT NULL,
    `paddyType` TEXT NOT NULL,
    `vehicleNo` TEXT NULL,
    `physicalBags` INTEGER NOT NULL,
    `grossWeightKg` DOUBLE NOT NULL,
    `tareWeightKg` DOUBLE NOT NULL,
    `dhaltaKg` DOUBLE NOT NULL,
    `netWeightKg` DOUBLE NOT NULL,
    `standardBags75Kg` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `dryerRatePerBag` DOUBLE NOT NULL DEFAULT 0,
    `dryerFee` DOUBLE NOT NULL DEFAULT 0,
    `millingRatePerBag` DOUBLE NOT NULL DEFAULT 0,
    `millingFee` DOUBLE NOT NULL DEFAULT 0,
    `riceOutputBags` DOUBLE NOT NULL DEFAULT 0,
    `branKg` DOUBLE NOT NULL DEFAULT 0,
    `huskKg` DOUBLE NOT NULL DEFAULT 0,
    `byProductKeptMill` BOOLEAN NOT NULL DEFAULT true,
    `byProductIncome` DOUBLE NOT NULL DEFAULT 0,
    `totalBillAmount` DOUBLE NOT NULL DEFAULT 0,
    `mainSyncStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'POSTED', 'REJECTED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `createdByName` TEXT NOT NULL,
    `createdByUserId` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MillBatch_batchNo_key`(`batchNo`),
    INDEX `MillBatch_partyId_idx`(`partyId`),
    INDEX `MillBatch_date_idx`(`date`),
    INDEX `MillBatch_status_idx`(`status`),
    INDEX `MillBatch_mainSyncStatus_idx`(`mainSyncStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MillExpense` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `category` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paidBy` ENUM('MILL_CASH', 'PARTNER_1', 'PARTNER_2') NOT NULL DEFAULT 'MILL_CASH',
    `mainSyncStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'POSTED', 'REJECTED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `createdByName` TEXT NOT NULL,
    `createdByUserId` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MillExpense_date_idx`(`date`),
    INDEX `MillExpense_category_idx`(`category`),
    INDEX `MillExpense_paidBy_idx`(`paidBy`),
    INDEX `MillExpense_mainSyncStatus_idx`(`mainSyncStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MillVoucher` (
    `id` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NULL,
    `partnerTarget` TEXT NULL,
    `paymentMode` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `amount` DOUBLE NOT NULL,
    `note` TEXT NULL,
    `createdByName` TEXT NOT NULL,
    `createdByUserId` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MillVoucher_voucherNo_key`(`voucherNo`),
    INDEX `MillVoucher_partyId_idx`(`partyId`),
    INDEX `MillVoucher_date_idx`(`date`),
    INDEX `MillVoucher_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Safe column additions for SMS Message and SMS Settings
SET @dbname = DATABASE();

SET @col_sms = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'SmsMessage' AND COLUMN_NAME = 'channel' AND TABLE_SCHEMA = @dbname);
SET @sql_sms = IF(@col_sms = 0, 'ALTER TABLE `SmsMessage` ADD COLUMN `channel` VARCHAR(191) NULL DEFAULT \'SMS\';', 'SELECT 1;');
PREPARE stmt_sms FROM @sql_sms;
EXECUTE stmt_sms;
DEALLOCATE PREPARE stmt_sms;

SET @col_w1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'SmsSettings' AND COLUMN_NAME = 'whatsappUrl' AND TABLE_SCHEMA = @dbname);
SET @sql_w1 = IF(@col_w1 = 0, 'ALTER TABLE `SmsSettings` ADD COLUMN `whatsappUrl` TEXT NULL;', 'SELECT 1;');
PREPARE stmt_w1 FROM @sql_w1;
EXECUTE stmt_w1;
DEALLOCATE PREPARE stmt_w1;

SET @col_w2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'SmsSettings' AND COLUMN_NAME = 'whatsappTokenEnc' AND TABLE_SCHEMA = @dbname);
SET @sql_w2 = IF(@col_w2 = 0, 'ALTER TABLE `SmsSettings` ADD COLUMN `whatsappTokenEnc` TEXT NULL;', 'SELECT 1;');
PREPARE stmt_w2 FROM @sql_w2;
EXECUTE stmt_w2;
DEALLOCATE PREPARE stmt_w2;

SET @col_w3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'SmsSettings' AND COLUMN_NAME = 'whatsappTokenHint' AND TABLE_SCHEMA = @dbname);
SET @sql_w3 = IF(@col_w3 = 0, 'ALTER TABLE `SmsSettings` ADD COLUMN `whatsappTokenHint` TEXT NULL;', 'SELECT 1;');
PREPARE stmt_w3 FROM @sql_w3;
EXECUTE stmt_w3;
DEALLOCATE PREPARE stmt_w3;

SET @col_w4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'SmsSettings' AND COLUMN_NAME = 'whatsappCountryCode' AND TABLE_SCHEMA = @dbname);
SET @sql_w4 = IF(@col_w4 = 0, 'ALTER TABLE `SmsSettings` ADD COLUMN `whatsappCountryCode` VARCHAR(191) NULL DEFAULT \'88\';', 'SELECT 1;');
PREPARE stmt_w4 FROM @sql_w4;
EXECUTE stmt_w4;
DEALLOCATE PREPARE stmt_w4;

-- Safe foreign keys
SET @fk_b = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'MillBatch_partyId_fkey' AND TABLE_NAME = 'MillBatch' AND TABLE_SCHEMA = @dbname);
SET @sql_b = IF(@fk_b = 0, 'ALTER TABLE `MillBatch` ADD CONSTRAINT `MillBatch_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `MillParty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;', 'SELECT 1;');
PREPARE stmt_b FROM @sql_b;
EXECUTE stmt_b;
DEALLOCATE PREPARE stmt_b;

SET @fk_v = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'MillVoucher_partyId_fkey' AND TABLE_NAME = 'MillVoucher' AND TABLE_SCHEMA = @dbname);
SET @sql_v = IF(@fk_v = 0, 'ALTER TABLE `MillVoucher` ADD CONSTRAINT `MillVoucher_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `MillParty`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;', 'SELECT 1;');
PREPARE stmt_v FROM @sql_v;
EXECUTE stmt_v;
DEALLOCATE PREPARE stmt_v;
