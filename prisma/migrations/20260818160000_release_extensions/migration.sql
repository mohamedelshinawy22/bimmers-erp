-- BimmerERP release extensions: additive, reviewed PostgreSQL migration.

ALTER TYPE "TreasuryType" ADD VALUE IF NOT EXISTS 'INSTAPAY';
ALTER TYPE "TreasuryType" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "BarcodeCodeType" AS ENUM ('BARCODE', 'OEM_CODE', 'ITEM_CODE');
CREATE TYPE "BarcodePriceType" AS ENUM ('RETAIL', 'WHOLESALE', 'NONE');
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
CREATE INDEX IF NOT EXISTS "Category_parentId_idx" ON "Category"("parentId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Treasury" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Treasury_name_key" ON "Treasury"("name");
CREATE INDEX IF NOT EXISTS "Treasury_isActive_isDefault_idx" ON "Treasury"("isActive", "isDefault");

ALTER TABLE "TreasuryTransaction" ADD COLUMN IF NOT EXISTS "transferId" TEXT;
ALTER TABLE "TreasuryTransaction" ADD COLUMN IF NOT EXISTS "category" TEXT;
CREATE INDEX IF NOT EXISTS "TreasuryTransaction_transferId_idx" ON "TreasuryTransaction"("transferId");

CREATE TABLE "TreasuryTransfer" (
  "id" TEXT NOT NULL,
  "transferNumber" TEXT NOT NULL,
  "fromTreasuryId" TEXT NOT NULL,
  "toTreasuryId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreasuryTransfer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TreasuryTransfer_transferNumber_key" ON "TreasuryTransfer"("transferNumber");
CREATE INDEX "TreasuryTransfer_fromTreasuryId_createdAt_idx" ON "TreasuryTransfer"("fromTreasuryId", "createdAt");
CREATE INDEX "TreasuryTransfer_toTreasuryId_createdAt_idx" ON "TreasuryTransfer"("toTreasuryId", "createdAt");
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_fromTreasuryId_fkey" FOREIGN KEY ("fromTreasuryId") REFERENCES "Treasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_toTreasuryId_fkey" FOREIGN KEY ("toTreasuryId") REFERENCES "Treasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryTransaction" ADD CONSTRAINT "TreasuryTransaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "TreasuryTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BarcodeConfig" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT 'COMPANY',
  "storeNameText" TEXT NOT NULL DEFAULT 'الشافعي لقطع غيار BMW',
  "labelWidthMm" DECIMAL(6,2) NOT NULL DEFAULT 46.0,
  "barcodeHeightMm" DECIMAL(6,2) NOT NULL DEFAULT 10.0,
  "topMarginMm" DECIMAL(6,2) NOT NULL DEFAULT 0.0,
  "leftMarginMm" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
  "fontFamily" TEXT NOT NULL DEFAULT 'Arial',
  "titleFontSize" INTEGER NOT NULL DEFAULT 10,
  "partNameFontSize" INTEGER NOT NULL DEFAULT 9,
  "codeFontSize" INTEGER NOT NULL DEFAULT 10,
  "priceFontSize" INTEGER NOT NULL DEFAULT 10,
  "codeType" "BarcodeCodeType" NOT NULL DEFAULT 'BARCODE',
  "priceType" "BarcodePriceType" NOT NULL DEFAULT 'NONE',
  "showPartName" BOOLEAN NOT NULL DEFAULT true,
  "showCode" BOOLEAN NOT NULL DEFAULT true,
  "showPrice" BOOLEAN NOT NULL DEFAULT false,
  "includeTaxInPrice" BOOLEAN NOT NULL DEFAULT false,
  "twoLinePartName" BOOLEAN NOT NULL DEFAULT false,
  "dualHorizontal" BOOLEAN NOT NULL DEFAULT false,
  "dualVertical" BOOLEAN NOT NULL DEFAULT false,
  "dualGapMm" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
  "targetPrinter" TEXT NOT NULL DEFAULT 'Xprinter XP-370B',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BarcodeConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BarcodeConfig_scopeKey_key" ON "BarcodeConfig"("scopeKey");

CREATE TABLE "ImportJob" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
  "checksum" TEXT NOT NULL,
  "mapping" JSONB NOT NULL,
  "summary" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportJob_createdById_status_idx" ON "ImportJob"("createdById", "status");
CREATE INDEX "ImportJob_checksum_idx" ON "ImportJob"("checksum");
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
