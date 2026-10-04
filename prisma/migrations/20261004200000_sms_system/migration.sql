-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'LOGIN', 'PASSWORD_RESET');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'SMS_BALANCE_LOW';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "groupName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "loginOtpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsSettings" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'platform',
    "apiKeyEnc" TEXT,
    "apiKeyHint" TEXT,
    "senderId" TEXT,
    "lowBalanceThreshold" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "balance" DECIMAL(12,2),
    "balanceCheckedAt" TIMESTAMP(3),
    "events" TEXT[] DEFAULT ARRAY['SALE_INVOICE', 'PAYMENT_RECEIVED', 'SALES_RETURN', 'INVOICE_CANCELLED', 'DUE_REMINDER', 'PURCHASE', 'SUPPLIER_PAYMENT', 'PURCHASE_RETURN', 'LOW_STOCK', 'EXPIRY_WARNING', 'EXPIRED']::TEXT[],
    "alertMobiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiryAlertDays" INTEGER[] DEFAULT ARRAY[90, 60, 30, 15, 7]::INTEGER[],
    "dueReminderEveryDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "SmsTemplate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "event" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "parts" INTEGER NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT,
    "provider" TEXT,
    "requestId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "cost" DECIMAL(10,4),
    "customerId" TEXT,
    "supplierId" TEXT,
    "voucherId" TEXT,
    "voucherNo" TEXT,
    "userId" TEXT,
    "createdById" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsOtp" (
    "id" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "mobile" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsTemplate_businessId_event_key" ON "SmsTemplate"("businessId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_dedupeKey_key" ON "SmsMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "SmsMessage_status_nextAttemptAt_idx" ON "SmsMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SmsMessage_businessId_createdAt_idx" ON "SmsMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_businessId_status_idx" ON "SmsMessage"("businessId", "status");

-- CreateIndex
CREATE INDEX "SmsMessage_provider_requestId_idx" ON "SmsMessage"("provider", "requestId");

-- CreateIndex
CREATE INDEX "SmsMessage_customerId_idx" ON "SmsMessage"("customerId");

-- CreateIndex
CREATE INDEX "SmsOtp_mobile_purpose_createdAt_idx" ON "SmsOtp"("mobile", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_businessId_groupName_idx" ON "Customer"("businessId", "groupName");

-- AddForeignKey
ALTER TABLE "SmsSettings" ADD CONSTRAINT "SmsSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsTemplate" ADD CONSTRAINT "SmsTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── integrity ─────────────
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_parts_positive" CHECK ("parts" >= 1);
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_recipient_format" CHECK ("recipient" ~ '^01[3-9][0-9]{8}$');
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_encoding_valid" CHECK ("encoding" IN ('GSM7', 'UCS2'));
ALTER TABLE "SmsOtp" ADD CONSTRAINT "SmsOtp_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);
ALTER TABLE "SmsSettings" ADD CONSTRAINT "SmsSettings_threshold_nonneg" CHECK ("lowBalanceThreshold" >= 0 AND "dueReminderEveryDays" >= 1);

-- ───────────── SMS permissions for the built-in roles of existing businesses ─────────────
UPDATE "Role" SET "permissions" = "permissions" || ARRAY['sms:view','sms:send','sms:bulk','sms:manage']
  WHERE "name" = 'অ্যাডমিন (Admin)' AND NOT ('sms:view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = "permissions" || ARRAY['sms:view','sms:send','sms:bulk']
  WHERE "name" = 'ম্যানেজার (Manager)' AND NOT ('sms:view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = "permissions" || ARRAY['sms:view']
  WHERE "name" = 'হিসাবরক্ষক (Accountant)' AND NOT ('sms:view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = "permissions" || ARRAY['sms:send']
  WHERE "name" = 'বিক্রয়কর্মী (Salesperson)' AND NOT ('sms:send' = ANY("permissions"));
