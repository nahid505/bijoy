-- Depot dealer: proprietor / owner name beside the shop / business name (Customer.name). Nullable column only;
-- existing customers and dealers are untouched.
-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `ownerName` TEXT NULL;
