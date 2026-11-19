-- AlterTable RiceMillSettings to add accountantUserId and partnerUserId
ALTER TABLE `RiceMillSettings` ADD COLUMN IF NOT EXISTS `accountantUserId` TEXT NULL;
ALTER TABLE `RiceMillSettings` ADD COLUMN IF NOT EXISTS `partnerUserId` TEXT NULL;
