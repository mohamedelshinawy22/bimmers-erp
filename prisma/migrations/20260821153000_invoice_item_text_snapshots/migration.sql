-- Preserve legacy and catalog-linked invoice history while allowing imported text-only lines.
ALTER TABLE "InvoiceItem"
  ADD COLUMN "partNameSnapshot" TEXT,
  ADD COLUMN "oemNumberSnapshot" TEXT;

ALTER TABLE "InvoiceItem"
  ALTER COLUMN "partId" DROP NOT NULL;

ALTER TABLE "InvoiceItem"
  DROP CONSTRAINT IF EXISTS "InvoiceItem_partId_fkey";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "PartItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill immutable labels for established catalog-linked items.
UPDATE "InvoiceItem" AS item
SET
  "partNameSnapshot" = COALESCE(item."partNameSnapshot", part."nameAr"),
  "oemNumberSnapshot" = COALESCE(item."oemNumberSnapshot", part."oemNumber")
FROM "PartItem" AS part
WHERE item."partId" = part."id";
