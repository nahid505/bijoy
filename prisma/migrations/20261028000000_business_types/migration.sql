-- Several business types per business, chosen in settings ("ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা"); registration no longer asks.
ALTER TABLE "Business" ADD COLUMN     "businessTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing businesses keep exactly what they had: their single type becomes the list (nothing else changes).
UPDATE "Business" SET "businessTypes" = ARRAY["businessType"] WHERE "businessType" IS NOT NULL;
