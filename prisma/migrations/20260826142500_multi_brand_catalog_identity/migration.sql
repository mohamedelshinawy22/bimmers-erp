-- A manufacturer can carry distinct catalog variants under the same OEM.
-- The product name completes the stable catalog identity within that brand.
DROP INDEX IF EXISTS "PartItem_oemNumber_brandId_key";
DROP INDEX IF EXISTS "PartItem_oemNumber_key";

CREATE UNIQUE INDEX "PartItem_oemNumber_brandId_nameAr_key"
  ON "PartItem"("oemNumber", "brandId", "nameAr");
