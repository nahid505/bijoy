-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'VOID', 'REFUNDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'SUBSCRIPTION_EXPIRING';
ALTER TYPE "NotificationKind" ADD VALUE 'SUBSCRIPTION_EXPIRED';
ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_SUCCESS';
ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationKind" ADD VALUE 'PLAN_CHANGED';
ALTER TYPE "NotificationKind" ADD VALUE 'USER_ADDED';
ALTER TYPE "NotificationKind" ADD VALUE 'FEATURE_CHANGED';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "businessType" TEXT;

-- AlterTable
ALTER TABLE "BusinessFeature" ADD COLUMN     "adminOverride" BOOLEAN,
ADD COLUMN     "overrideAt" TIMESTAMP(3),
ADD COLUMN     "overrideById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "trialPlanCode" TEXT NOT NULL DEFAULT 'PREMIUM',
    "fallbackPlanCode" TEXT NOT NULL DEFAULT 'FREE',
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "reminderDays" INTEGER[] DEFAULT ARRAY[7, 3, 1]::INTEGER[],
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'BL',
    "invoiceSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "descriptionBn" TEXT,
    "descriptionEn" TEXT,
    "priceMonthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceYearly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "userLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("planId","featureKey")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromPlanCode" TEXT,
    "toPlanCode" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorUserId" TEXT,
    "note" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "providerPaymentId" TEXT,
    "providerTrxId" TEXT,
    "manualReference" TEXT,
    "failureReason" TEXT,
    "raw" JSONB,
    "initiatedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethod" TEXT,
    "transactionRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "billTo" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");

-- CreateIndex
CREATE INDEX "Subscription_status_endDate_idx" ON "Subscription"("status", "endDate");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_businessId_createdAt_idx" ON "SubscriptionEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_businessId_createdAt_idx" ON "PaymentTransaction"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_createdAt_idx" ON "PaymentTransaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerTrxId_key" ON "PaymentTransaction"("provider", "providerTrxId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_transactionId_key" ON "SubscriptionPayment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_invoiceId_key" ON "SubscriptionPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_businessId_paidAt_idx" ON "SubscriptionPayment"("businessId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_businessId_createdAt_idx" ON "Invoice"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_featureKey_fkey" FOREIGN KEY ("featureKey") REFERENCES "Feature"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed: feature catalogue (new core modules), plans, platform settings (generated by scripts/saas-seed-sql.ts)
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('ACCOUNTING', 'হিসাব (অ্যাকাউন্টিং)', 'Accounting', 'ডাবল-এন্ট্রি হিসাব: রিসিপ্ট, পেমেন্ট, জার্নাল, খরচ, চার্ট অব অ্যাকাউন্টস, ক্যাশ ও ব্যাংক বুক।', 'Double-entry books: receipts, payments, journals, expenses, chart of accounts, cash and bank books.', '📒', 'FREE', 'AVAILABLE', true, 0, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('SALES', 'বিক্রয়', 'Sales', 'বিক্রয় ইনভয়েস, বিক্রয় ফেরত, বাকি বিক্রয়, ছাড় ও ভ্যাট — স্টক ও হিসাবে স্বয়ংক্রিয় পোস্টিং।', 'Sales invoices and returns, credit sales, discounts and VAT — posted to stock and books automatically.', '🧾', 'FREE', 'AVAILABLE', true, 10, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('PURCHASE', 'ক্রয়', 'Purchase', 'ক্রয় ভাউচার ও ক্রয় ফেরত, সরবরাহকারীর বাকি, ব্যাচ ও মেয়াদসহ স্টক গ্রহণ।', 'Purchase vouchers and returns, supplier credit, stock receipt with batches and expiry.', '🛒', 'PAID', 'AVAILABLE', true, 20, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('POS', 'পস (POS) বিক্রয়', 'Point of Sale (POS)', 'কাউন্টারে দ্রুত বিক্রয়: বারকোড স্ক্যান, একাধিক মাধ্যমে পরিশোধ, তাৎক্ষণিক রসিদ।', 'Fast counter sales: barcode scanning, split payments, instant receipts.', '🏪', 'PAID', 'AVAILABLE', true, 30, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('CUSTOMER', 'কাস্টমার', 'Customers', 'কাস্টমার তালিকা, লেজার, ক্রেডিট সীমা ও স্টেটমেন্ট।', 'Customer list, ledgers, credit limits and statements.', '🙋', 'FREE', 'AVAILABLE', true, 40, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('SUPPLIER', 'সরবরাহকারী', 'Suppliers', 'সরবরাহকারী তালিকা, লেজার, দেনা ও পরিশোধ।', 'Supplier list, ledgers, payables and payments.', '🚚', 'PAID', 'AVAILABLE', true, 50, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('MULTI_USER', 'মাল্টি ইউজার', 'Multi User', 'একাধিক ব্যবহারকারী, রোল ও অনুমতি। বন্ধ থাকলে শুধু মালিক ব্যবসায় প্রবেশ করতে পারবেন; অন্য ব্যবহারকারীর তথ্য মুছে যাবে না।', 'Several users with roles and permissions. When off, only the owner can open the business; other users are kept, not deleted.', '👥', 'FREE', 'AVAILABLE', true, 60, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('ADVANCED_REPORTING', 'অ্যাডভান্সড রিপোর্টিং', 'Advanced Reporting', 'দৈনিক সারসংক্ষেপ, নগদ প্রবাহ, আয়-ব্যয়, স্টক মূল্যায়ন, বিক্রয়-ক্রয় বিশ্লেষণ ও আদায় রিপোর্ট। মূল হিসাবের রিপোর্ট (লেজার, ট্রায়াল ব্যালেন্স, লাভ-ক্ষতি, ব্যালান্স শীট) সবসময় চালু।', 'Daily summary, cash flow, income & expense, stock valuation, sales/purchase analysis and collection reports. Core books (ledger, trial balance, P&L, balance sheet) stay on.', '📊', 'PAID', 'AVAILABLE', true, 70, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('ADVANCED_INVENTORY', 'অ্যাডভান্সড ইনভেন্টরি', 'Advanced Inventory', 'স্টক জার্নাল (ঘাটতি/উদ্বৃত্ত সমন্বয়), ক্যাটাগরি ও ব্র্যান্ড ব্যবস্থাপনা। সাধারণ পণ্য, ইউনিট ও স্টক সবসময় চালু।', 'Stock journal (shortage / surplus adjustments), categories and brands. Basic products, units and stock stay on.', '📦', 'PAID', 'AVAILABLE', true, 80, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('ADVANCED_CUSTOMER', 'অ্যাডভান্সড কাস্টমার ম্যানেজমেন্ট', 'Advanced Customer Management', 'বাকি ও আদায় ড্যাশবোর্ড, মেয়াদোত্তীর্ণ বকেয়া (এজিং), কাস্টমার বাকি রিপোর্ট ও কাস্টমার রিপোর্ট।', 'Dues & collection dashboard, overdue ageing, customer dues and customer summary reports.', '🤝', 'PAID', 'AVAILABLE', true, 90, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('HRM', 'এইচআরএম (বেতন ও হাজিরা)', 'HRM (Payroll & Attendance)', 'কর্মচারী, বেতন কাঠামো, হাজিরা, ওভারটাইম, মাসিক বেতন, পে-স্লিপ, বেতন পরিশোধ ও অগ্রিম — সরাসরি হিসাবের খাতায় পোস্ট হয়।', 'Employees, salary structures, attendance, overtime, monthly payroll, payslips, salary payments and advances — posted to the books.', '💼', 'PAID', 'AVAILABLE', true, 100, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('DAMAGE_STOCK', 'ড্যামেজ স্টক ইনভেন্টরি', 'Damage Stock Inventory', 'নষ্ট/ক্ষতিগ্রস্ত পণ্য আলাদা স্টকে রাখা, কারণসহ এন্ট্রি, সরবরাহকারীকে ফেরত ও ক্ষতির হিসাব।', 'Keep damaged goods in a separate stock with reasons, return them to suppliers and account for the loss.', '🧯', 'PAID', 'COMING_SOON', false, 110, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('PRODUCT_EXPIRY', 'পণ্যের মেয়াদ ব্যবস্থাপনা', 'Product Expiry Management', 'ব্যাচভিত্তিক মেয়াদ, মেয়াদোত্তীর্ণ ও শীঘ্রই মেয়াদ শেষের সতর্কবার্তা, FEFO, মেয়াদ রিপোর্ট ও মেয়াদোত্তীর্ণ স্টক বাতিল। বন্ধ থাকলেও ব্যাচের তথ্য সংরক্ষিত থাকে।', 'Batch-level expiry, expired / expiring alerts, FEFO, expiry reports and expired-stock write-off. Batch data is kept while off.', '⏳', 'FREE', 'AVAILABLE', true, 120, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('PRODUCTION', 'প্রোডাকশন ম্যানেজমেন্ট', 'Production Management', 'কাঁচামাল থেকে তৈরি পণ্য: রেসিপি (BOM), উৎপাদন এন্ট্রি, কাঁচামাল খরচ ও উৎপাদন ব্যয়।', 'Raw materials to finished goods: recipes (BOM), production entries, material consumption and production cost.', '🏭', 'PAID', 'COMING_SOON', false, 130, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('MEMO_ENTRY', 'মেমো এন্ট্রি', 'Memo Entry', 'দ্রুত কাঁচা মেমো/চালান এন্ট্রি, পরে যাচাই করে বিক্রয় বা ক্রয় ভাউচারে রূপান্তর।', 'Quick rough memo / challan entry, verified and converted to sales or purchase vouchers later.', '📝', 'FREE', 'COMING_SOON', false, 140, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('SERVICE_ORDER', 'সার্ভিস অর্ডার ম্যানেজমেন্ট', 'Service Order Management', 'মেরামত/সার্ভিস অর্ডার গ্রহণ, অবস্থা ট্র্যাকিং, যন্ত্রাংশ ও সার্ভিস চার্জ, ডেলিভারি ও বিল।', 'Repair / service orders: intake, status tracking, parts and service charges, delivery and billing.', '🛠️', 'PAID', 'COMING_SOON', false, 150, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('SALES_PARTNER', 'সেলস পার্টনার / কমিশন এজেন্ট', 'Sales Partner / Commission Agent', 'বিক্রয় প্রতিনিধি ও এজেন্ট, বিক্রয়ভিত্তিক কমিশন হিসাব ও কমিশন পরিশোধ।', 'Sales representatives and agents, commission on sales and commission payments.', '🧾', 'PAID', 'COMING_SOON', false, 160, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('POINT_MANAGEMENT', 'পয়েন্ট ম্যানেজমেন্ট', 'Point Management', 'কাস্টমার লয়্যালটি পয়েন্ট: কেনাকাটায় পয়েন্ট অর্জন ও পরবর্তী বিক্রয়ে ব্যবহার।', 'Customer loyalty points: earn on purchases, redeem on later sales.', '⭐', 'PAID', 'COMING_SOON', false, 170, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Feature" ("key", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "icon", "tier", "status", "defaultEnabled", "sortOrder", "updatedAt") VALUES ('MULTI_WAREHOUSE', 'মাল্টি ওয়্যারহাউস', 'Multi Warehouse', 'একাধিক গুদাম, গুদামভিত্তিক স্টক ও লেনদেন। বন্ধ থাকলে নতুন লেনদেন প্রধান গুদামে হবে; আগের গুদামের স্টক ও তথ্য অপরিবর্তিত থাকবে।', 'Several warehouses with per-warehouse stock and transactions. When off, new entries use the main warehouse; existing stock stays as it is.', '🏬', 'PAID', 'AVAILABLE', true, 180, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "Plan" ("id", "code", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "priceMonthly", "priceYearly", "userLimit", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt") VALUES ('plan_free', 'FREE', 'ফ্রি', 'Free', 'ছোট ব্যবসার জন্য মৌলিক হিসাব, বিক্রয় ও স্টক — একজন ব্যবহারকারী।', 'Basic accounting, sales and stock for one user.', 0, 0, 1, true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_free', 'ACCOUNTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_free', 'SALES') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_free', 'CUSTOMER') ON CONFLICT DO NOTHING;
INSERT INTO "Plan" ("id", "code", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "priceMonthly", "priceYearly", "userLimit", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt") VALUES ('plan_basic', 'BASIC', 'বেসিক', 'Basic', 'হিসাব, বিক্রয়, ক্রয় ও ইনভেন্টরি — ৩ জন ব্যবহারকারী।', 'Accounting, sales, purchase and inventory for 3 users.', 499, 4990, 3, true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'ACCOUNTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'SALES') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'CUSTOMER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'PURCHASE') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'SUPPLIER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_basic', 'MULTI_USER') ON CONFLICT DO NOTHING;
INSERT INTO "Plan" ("id", "code", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "priceMonthly", "priceYearly", "userLimit", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt") VALUES ('plan_business', 'BUSINESS', 'বিজনেস', 'Business', 'পূর্ণ হিসাব, পস, এইচআরএম, পণ্যের মেয়াদ ও অ্যাডভান্সড রিপোর্ট — ১০ জন ব্যবহারকারী।', 'Full accounting, POS, HRM, product expiry and advanced reports for 10 users.', 1499, 14990, 10, true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'ACCOUNTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'SALES') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'CUSTOMER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'PURCHASE') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'SUPPLIER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'MULTI_USER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'POS') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'HRM') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'PRODUCT_EXPIRY') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'ADVANCED_REPORTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_business', 'ADVANCED_INVENTORY') ON CONFLICT DO NOTHING;
INSERT INTO "Plan" ("id", "code", "nameBn", "nameEn", "descriptionBn", "descriptionEn", "priceMonthly", "priceYearly", "userLimit", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt") VALUES ('plan_premium', 'PREMIUM', 'প্রিমিয়াম', 'Premium', 'সব ইআরপি ফিচার, মাল্টি ওয়্যারহাউস ও ভবিষ্যতের সব মডিউল — ২৫ জন ব্যবহারকারী।', 'Every ERP feature, multi-warehouse and all upcoming modules for 25 users.', 2999, 29990, 25, true, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'ACCOUNTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'SALES') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'PURCHASE') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'POS') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'CUSTOMER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'SUPPLIER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'MULTI_USER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'ADVANCED_REPORTING') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'ADVANCED_INVENTORY') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'ADVANCED_CUSTOMER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'HRM') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'DAMAGE_STOCK') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'PRODUCT_EXPIRY') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'PRODUCTION') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'MEMO_ENTRY') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'SERVICE_ORDER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'SALES_PARTNER') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'POINT_MANAGEMENT') ON CONFLICT DO NOTHING;
INSERT INTO "PlanFeature" ("planId", "featureKey") VALUES ('plan_premium', 'MULTI_WAREHOUSE') ON CONFLICT DO NOTHING;
INSERT INTO "PlatformSetting" ("id", "updatedAt") VALUES ('platform', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
-- Backfill: businesses that existed before subscriptions keep every feature they use today:
-- PREMIUM, active for one year from the upgrade (the super admin can change this per company).
INSERT INTO "Subscription" ("id", "businessId", "planId", "status", "billingCycle", "startDate", "endDate", "autoRenew", "createdAt", "updatedAt")
SELECT 'sub_' || b."id", b."id", 'plan_premium', 'ACTIVE', 'YEARLY', date_trunc('day', CURRENT_TIMESTAMP), date_trunc('day', CURRENT_TIMESTAMP) + INTERVAL '365 days', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" b WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."businessId" = b."id");
INSERT INTO "SubscriptionEvent" ("id", "businessId", "subscriptionId", "type", "toPlanCode", "toStatus", "note", "createdAt")
SELECT 'sev_' || s."id", s."businessId", s."id", 'MIGRATED', 'PREMIUM', 'ACTIVE', 'Existing business moved to subscriptions with a one-year Premium grant', CURRENT_TIMESTAMP FROM "Subscription" s
WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionEvent" e WHERE e."subscriptionId" = s."id");
