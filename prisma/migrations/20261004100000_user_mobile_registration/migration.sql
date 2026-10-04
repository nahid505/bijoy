-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mobile" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");


-- Every login needs at least one identifier; mobiles are stored in one canonical form.
ALTER TABLE "User" ADD CONSTRAINT "User_has_identifier" CHECK ("email" IS NOT NULL OR "mobile" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_mobile_format" CHECK ("mobile" IS NULL OR "mobile" ~ '^01[3-9][0-9]{8}$');
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
