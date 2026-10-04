-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "lockDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "trackBatch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchNo" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "voucherItemId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "returnOfId" TEXT;

-- AlterTable
ALTER TABLE "VoucherItem" ADD COLUMN     "batchNo" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VoucherPayment" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VoucherPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoucherPayment_voucherId_idx" ON "VoucherPayment"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherPayment_accountId_idx" ON "VoucherPayment"("accountId");

-- CreateIndex
CREATE INDEX "StockMovement_voucherItemId_idx" ON "StockMovement"("voucherItemId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_productId_batchNo_idx" ON "StockMovement"("businessId", "productId", "batchNo");

-- CreateIndex
CREATE INDEX "Voucher_returnOfId_idx" ON "Voucher"("returnOfId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherPayment" ADD CONSTRAINT "VoucherPayment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherPayment" ADD CONSTRAINT "VoucherPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_voucherItemId_fkey" FOREIGN KEY ("voucherItemId") REFERENCES "VoucherItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Data backfill (no data loss)
-- ============================================================================

-- Existing trade vouchers: their single cash/bank settlement becomes a VoucherPayment row.
INSERT INTO "VoucherPayment" ("id", "voucherId", "accountId", "amount", "lineNo")
SELECT 'vp_' || v."id", v."id", v."cashAccountId",
       CASE WHEN v."partyAccountId" IS NULL THEN v."amount" ELSE v."paidAmount" END, 0
FROM "Voucher" v
WHERE v."type" IN ('SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN')
  AND v."cashAccountId" IS NOT NULL
  AND (v."partyAccountId" IS NULL OR v."paidAmount" > 0);

-- Link every stock movement to the voucher line that produced it.
WITH m AS (
  SELECT "id", "voucherId", "productId", row_number() OVER (PARTITION BY "voucherId", "productId" ORDER BY "id") AS rn
  FROM "StockMovement" WHERE "voucherId" IS NOT NULL
), i AS (
  SELECT "id", "voucherId", "productId", row_number() OVER (PARTITION BY "voucherId", "productId" ORDER BY "lineNo", "id") AS rn
  FROM "VoucherItem"
)
UPDATE "StockMovement" s SET "voucherItemId" = i."id"
FROM m JOIN i ON i."voucherId" = m."voucherId" AND i."productId" = m."productId" AND i.rn = m.rn
WHERE s."id" = m."id";

-- ============================================================================
-- Integrity constraints
-- ============================================================================

ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_amounts_nonnegative" CHECK ("debit" >= 0 AND "credit" >= 0),
  ADD CONSTRAINT "JournalEntry_single_side" CHECK (("debit" > 0) <> ("credit" > 0));

ALTER TABLE "Voucher"
  ADD CONSTRAINT "Voucher_amounts_nonnegative" CHECK ("amount" >= 0 AND "paidAmount" >= 0 AND "subtotal" >= 0 AND "discount" >= 0 AND "vatAmount" >= 0);

ALTER TABLE "VoucherPayment" ADD CONSTRAINT "VoucherPayment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "VoucherItem"
  ADD CONSTRAINT "VoucherItem_quantity_positive" CHECK ("quantity" > 0 AND "baseQuantity" > 0),
  ADD CONSTRAINT "VoucherItem_amounts_nonnegative" CHECK ("rate" >= 0 AND "discount" >= 0 AND "amount" >= 0);

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_quantities_nonnegative" CHECK ("quantityIn" >= 0 AND "quantityOut" >= 0),
  ADD CONSTRAINT "StockMovement_single_direction" CHECK (("quantityIn" > 0) <> ("quantityOut" > 0));

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_credit_terms_nonnegative" CHECK ("creditLimit" >= 0 AND "creditDays" >= 0);
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_credit_days_nonnegative" CHECK ("creditDays" >= 0);
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_factor_positive" CHECK ("factor" > 0);

-- ============================================================================
-- THE accounting rule, enforced by the database itself:
-- at COMMIT, every voucher's journal entries must satisfy Σ debit = Σ credit.
-- (Deferred, so a voucher can be rewritten line by line inside one transaction.)
-- ============================================================================

CREATE OR REPLACE FUNCTION bl_check_voucher_balance() RETURNS trigger AS $$
DECLARE
  vid TEXT := COALESCE(NEW."voucherId", OLD."voucherId");
  total_debit NUMERIC;
  total_credit NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Voucher" WHERE "id" = vid) THEN
    RETURN NULL; -- voucher deleted in the same transaction
  END IF;
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0) INTO total_debit, total_credit
  FROM "JournalEntry" WHERE "voucherId" = vid;
  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'Unbalanced voucher %: debit % <> credit %', vid, total_debit, total_credit
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalEntry_voucher_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bl_check_voucher_balance();
