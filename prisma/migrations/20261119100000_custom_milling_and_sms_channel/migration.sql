-- Incremental migration for Custom Milling & SMS WhatsApp channel (PostgreSQL)

CREATE TABLE IF NOT EXISTS "RiceMillSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "millName" TEXT NOT NULL DEFAULT 'বিজয় অটো রাইস মিল (জয়েন্ট ভেঞ্চার)',
    "millAddress" TEXT NOT NULL DEFAULT 'বীরগঞ্জ, দিনাজপুর',
    "millPhone" TEXT NOT NULL DEFAULT '01763921505',
    "partner1Name" TEXT NOT NULL DEFAULT 'নাহিদ হাসান',
    "partner1SharePct" DOUBLE PRECISION NOT NULL DEFAULT 60.0,
    "partner2Name" TEXT NOT NULL DEFAULT 'পার্টনার (৪০%)',
    "partner2SharePct" DOUBLE PRECISION NOT NULL DEFAULT 40.0,
    "monthlyRent" DOUBLE PRECISION NOT NULL DEFAULT 120000,
    "bagStandardKg" DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    "defaultDhaltaPerBag" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "defaultDryerRate" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "defaultMillingRate" DOUBLE PRECISION NOT NULL DEFAULT 120.0,
    "branRatePerKg" DOUBLE PRECISION NOT NULL DEFAULT 22.0,
    "huskRatePerKg" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "invoiceFooterNote" TEXT NOT NULL DEFAULT 'বিঃদ্রঃ ৭৫ কেজি = ১ স্ট্যান্ডার্ড বস্তা হিসেবে বিল গণনা করা হয়েছে।',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiceMillSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MillParty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isOwnerSelfParty" BOOLEAN NOT NULL DEFAULT false,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillParty_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    CREATE TYPE "MillBatchSyncStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'POSTED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MillExpensePayer" AS ENUM ('MILL_CASH', 'PARTNER_1', 'PARTNER_2');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "MillBatch" (
    "id" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partyId" TEXT NOT NULL,
    "paddyType" TEXT NOT NULL,
    "vehicleNo" TEXT,
    "physicalBags" INTEGER NOT NULL,
    "grossWeightKg" DOUBLE PRECISION NOT NULL,
    "tareWeightKg" DOUBLE PRECISION NOT NULL,
    "dhaltaKg" DOUBLE PRECISION NOT NULL,
    "netWeightKg" DOUBLE PRECISION NOT NULL,
    "standardBags75Kg" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "dryerRatePerBag" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dryerFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millingRatePerBag" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riceOutputBags" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "branKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "huskKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "byProductKeptMill" BOOLEAN NOT NULL DEFAULT true,
    "byProductIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBillAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mainSyncStatus" "MillBatchSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "createdByName" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MillBatch_batchNo_key" ON "MillBatch"("batchNo");
CREATE INDEX IF NOT EXISTS "MillBatch_partyId_idx" ON "MillBatch"("partyId");
CREATE INDEX IF NOT EXISTS "MillBatch_date_idx" ON "MillBatch"("date");
CREATE INDEX IF NOT EXISTS "MillBatch_status_idx" ON "MillBatch"("status");
CREATE INDEX IF NOT EXISTS "MillBatch_mainSyncStatus_idx" ON "MillBatch"("mainSyncStatus");

CREATE TABLE IF NOT EXISTS "MillExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidBy" "MillExpensePayer" NOT NULL DEFAULT 'MILL_CASH',
    "mainSyncStatus" "MillBatchSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "createdByName" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MillExpense_date_idx" ON "MillExpense"("date");
CREATE INDEX IF NOT EXISTS "MillExpense_category_idx" ON "MillExpense"("category");
CREATE INDEX IF NOT EXISTS "MillExpense_paidBy_idx" ON "MillExpense"("paidBy");
CREATE INDEX IF NOT EXISTS "MillExpense_mainSyncStatus_idx" ON "MillExpense"("mainSyncStatus");

CREATE TABLE IF NOT EXISTS "MillVoucher" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "partyId" TEXT,
    "partnerTarget" TEXT,
    "paymentMode" TEXT NOT NULL DEFAULT 'CASH',
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MillVoucher_voucherNo_key" ON "MillVoucher"("voucherNo");
CREATE INDEX IF NOT EXISTS "MillVoucher_partyId_idx" ON "MillVoucher"("partyId");
CREATE INDEX IF NOT EXISTS "MillVoucher_date_idx" ON "MillVoucher"("date");
CREATE INDEX IF NOT EXISTS "MillVoucher_type_idx" ON "MillVoucher"("type");

DO $$ BEGIN
    ALTER TABLE "MillBatch" ADD CONSTRAINT "MillBatch_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "MillParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "MillVoucher" ADD CONSTRAINT "MillVoucher_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "MillParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "SmsMessage" ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'SMS';
ALTER TABLE "SmsSettings" ADD COLUMN IF NOT EXISTS "whatsappUrl" TEXT;
ALTER TABLE "SmsSettings" ADD COLUMN IF NOT EXISTS "whatsappTokenEnc" TEXT;
ALTER TABLE "SmsSettings" ADD COLUMN IF NOT EXISTS "whatsappTokenHint" TEXT;
ALTER TABLE "SmsSettings" ADD COLUMN IF NOT EXISTS "whatsappCountryCode" TEXT DEFAULT '88';
