-- CreateEnum
CREATE TYPE "Book" AS ENUM ('GENERAL', 'DEPOT');

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "book" "Book" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "book" "Book" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isDepotDealer" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "JournalEntry_businessId_book_date_idx" ON "JournalEntry"("businessId", "book", "date");


-- ── Backfill: move existing depot data into the DEPOT book (data is only re-labelled, never changed) ──
-- dealers = customers that received depot challans
UPDATE "Customer" SET "isDepotDealer" = true
WHERE "accountId" IN (SELECT "dealerAccountId" FROM "DepotDelivery" WHERE "dealerAccountId" IS NOT NULL);

-- depot challans (DO releases and market sales)
UPDATE "Voucher" SET "book" = 'DEPOT' WHERE "id" IN (SELECT "voucherId" FROM "DepotDelivery");

-- depot businesses: stock in from / returns and payments to the depot companies; receipts, payments, journals,
-- openings and returns that post to a dealer or to a depot commission account
UPDATE "Voucher" v SET "book" = 'DEPOT'
FROM "Business" b
WHERE b."id" = v."businessId" AND b."businessType" = 'DEPOT' AND v."book" = 'GENERAL' AND (
  (v."type" IN ('PURCHASE', 'PURCHASE_RETURN', 'PAYMENT')
    AND v."partyAccountId" IN (SELECT "companyAccountId" FROM "DepotDelivery" WHERE "companyAccountId" IS NOT NULL))
  OR (v."type" IN ('RECEIPT', 'PAYMENT', 'JOURNAL', 'OPENING', 'SALES_RETURN') AND EXISTS (
    SELECT 1 FROM "JournalEntry" je
    JOIN "Account" a ON a."id" = je."accountId"
    LEFT JOIN "Customer" c ON c."accountId" = a."id"
    WHERE je."voucherId" = v."id" AND (c."isDepotDealer" = true OR a."systemKey" LIKE 'DEPOT!_%' ESCAPE '!')))
);

-- entries follow their voucher
UPDATE "JournalEntry" je SET "book" = v."book" FROM "Voucher" v WHERE v."id" = je."voucherId" AND je."book" <> v."book";
