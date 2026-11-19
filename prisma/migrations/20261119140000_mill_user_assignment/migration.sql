-- AlterTable RiceMillSettings to add accountantUserId and partnerUserId
ALTER TABLE "RiceMillSettings" ADD COLUMN IF NOT EXISTS "accountantUserId" TEXT;
ALTER TABLE "RiceMillSettings" ADD COLUMN IF NOT EXISTS "partnerUserId" TEXT;
