-- Account sub-groups: optional parent group and description. Additive only (nullable columns,
-- index, FK with ON DELETE SET NULL) — existing groups and ledgers are untouched.
-- AlterTable
ALTER TABLE `AccountGroup` ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `parentId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `AccountGroup_parentId_idx` ON `AccountGroup`(`parentId`);

-- AddForeignKey
ALTER TABLE `AccountGroup` ADD CONSTRAINT `AccountGroup_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `AccountGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
