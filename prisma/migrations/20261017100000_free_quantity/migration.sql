-- Free / scheme quantity on voucher lines: moves stock together with the quantity but is never billed.
-- Additive only: one new column with default 0 — existing lines are unchanged.
-- AlterTable
ALTER TABLE "VoucherItem" ADD COLUMN     "freeQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- never negative
ALTER TABLE "VoucherItem" ADD CONSTRAINT "VoucherItem_free_quantity_valid" CHECK ("freeQuantity" >= 0);
