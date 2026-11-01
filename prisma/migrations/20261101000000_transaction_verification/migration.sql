-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "verifiedById" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verificationNote" TEXT;

-- CreateIndex
CREATE INDEX "Voucher_businessId_verificationStatus_idx" ON "Voucher"("businessId", "verificationStatus");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
