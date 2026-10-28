-- Several business types per business, chosen in settings ("ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা"); registration no longer asks.
ALTER TABLE `Business` ADD COLUMN `businessTypes` JSON NOT NULL DEFAULT (json_array());

-- Existing businesses keep exactly what they had: their single type becomes the list (nothing else changes).
UPDATE `Business` SET `businessTypes` = JSON_ARRAY(`businessType`) WHERE `businessType` IS NOT NULL;
