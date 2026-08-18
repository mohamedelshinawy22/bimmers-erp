-- Preserve immutable voided invoice history while allowing an archived part to disappear from active catalog/POS queries.
ALTER TABLE "PartItem"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "PartItem_isDeleted_isActive_stockQuantity_idx"
  ON "PartItem"("isDeleted", "isActive", "stockQuantity");

CREATE INDEX "PartItem_isDeleted_isActive_nameAr_idx"
  ON "PartItem"("isDeleted", "isActive" DESC, "nameAr");
