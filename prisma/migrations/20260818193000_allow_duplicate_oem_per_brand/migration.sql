-- OEM numbers can legitimately identify multiple brand variants (for example BMW Genuine, Febi, and Meyle).
-- Retain a duplicate guard only for the same OEM within the same brand.
DROP INDEX IF EXISTS "PartItem_oemNumber_key";

CREATE UNIQUE INDEX "PartItem_oemNumber_brandId_key" ON "PartItem"("oemNumber", "brandId");
CREATE INDEX "PartItem_oemNumber_btree_idx" ON "PartItem"("oemNumber");
