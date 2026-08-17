-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CUSTOMER', 'WORKSHOP_BMW', 'SUPPLIER', 'EXPENSE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN', 'PRICE_QUOTATION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'PARTIAL', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'VISA', 'SPLIT', 'ON_ACCOUNT');

-- CreateEnum
CREATE TYPE "TreasuryType" AS ENUM ('CASH_DRAWER', 'BANK_ACCOUNT', 'POS_TERMINAL', 'WALLET');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockMoveReason" AS ENUM ('PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'MANUAL_ADJUSTMENT', 'OPENING_BALANCE', 'STOCKTAKE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originCountry" TEXT,
    "isOem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BmwChassis" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "productionStartYear" INTEGER NOT NULL,
    "productionEndYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BmwChassis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BmwEngine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displacement" TEXT,
    "fuelType" TEXT NOT NULL DEFAULT 'Petrol',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BmwEngine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseBin" (
    "id" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL DEFAULT 'المستودع الرئيسي',
    "aisle" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "boxBin" TEXT NOT NULL,
    "fullCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseBin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartItem" (
    "id" TEXT NOT NULL,
    "oemNumber" TEXT NOT NULL,
    "partNumberFormatted" TEXT,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "brandId" TEXT NOT NULL,
    "brandPartNumber" TEXT,
    "barcode" TEXT,
    "category" TEXT NOT NULL,
    "sidePosition" TEXT,
    "binLocationId" TEXT,
    "buyPriceLast" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "buyPriceAvg" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "sellPriceRetail" DECIMAL(12,2) NOT NULL,
    "sellPriceWholesale" DECIMAL(12,2) NOT NULL,
    "sellPriceMin" DECIMAL(12,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "stockReserved" INTEGER NOT NULL DEFAULT 0,
    "minReorderLevel" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartChassis" (
    "partId" TEXT NOT NULL,
    "chassisId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PartChassis_pkey" PRIMARY KEY ("partId","chassisId")
);

-- CreateTable
CREATE TABLE "PartEngine" (
    "partId" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,

    CONSTRAINT "PartEngine_pkey" PRIMARY KEY ("partId","engineId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL DEFAULT 'CUSTOMER',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "currentBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "defaultPriceTier" TEXT NOT NULL DEFAULT 'RETAIL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerVehicle" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "chassisId" TEXT,
    "engineId" TEXT,
    "modelYear" INTEGER,
    "plateNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Treasury" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TreasuryType" NOT NULL DEFAULT 'CASH_DRAWER',
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Treasury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryShift" (
    "id" TEXT NOT NULL,
    "shiftNumber" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "bookOpeningBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
    "closingBalance" DECIMAL(14,2),
    "countedCash" DECIMAL(14,2),
    "varianceAmount" DECIMAL(14,2),
    "varianceTxId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "TreasuryShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'SALE',
    "accountId" TEXT NOT NULL,
    "treasuryId" TEXT,
    "vehicleId" TEXT,
    "userId" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "remainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitCostSnapshot" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "binLocationSnapshot" TEXT,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "partId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "reason" "StockMoveReason" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "performedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryTransaction" (
    "id" TEXT NOT NULL,
    "transactionNumber" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "accountId" TEXT,
    "invoiceId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "createdByUser" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAuditTrail" (
    "id" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "performedBy" TEXT NOT NULL,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditTrail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "scope" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'GENERAL',
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BmwChassis_code_key" ON "BmwChassis"("code");

-- CreateIndex
CREATE INDEX "BmwChassis_series_idx" ON "BmwChassis"("series");

-- CreateIndex
CREATE UNIQUE INDEX "BmwEngine_code_key" ON "BmwEngine"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBin_fullCode_key" ON "WarehouseBin"("fullCode");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBin_warehouseName_aisle_rack_shelf_boxBin_key" ON "WarehouseBin"("warehouseName", "aisle", "rack", "shelf", "boxBin");

-- CreateIndex
CREATE UNIQUE INDEX "PartItem_oemNumber_key" ON "PartItem"("oemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PartItem_barcode_key" ON "PartItem"("barcode");

-- CreateIndex
CREATE INDEX "PartItem_nameAr_btree_idx" ON "PartItem"("nameAr");

-- CreateIndex
CREATE INDEX "PartItem_category_idx" ON "PartItem"("category");

-- CreateIndex
CREATE INDEX "PartItem_brandId_idx" ON "PartItem"("brandId");

-- CreateIndex
CREATE INDEX "PartItem_binLocationId_idx" ON "PartItem"("binLocationId");

-- CreateIndex
CREATE INDEX "PartItem_isActive_stockQuantity_idx" ON "PartItem"("isActive", "stockQuantity");

-- CreateIndex
CREATE INDEX "PartItem_isActive_nameAr_idx" ON "PartItem"("isActive" DESC, "nameAr");

-- CreateIndex
CREATE INDEX "PartItem_oemNumber_trgm_idx" ON "PartItem" USING GIN ("oemNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PartItem_nameAr_trgm_idx" ON "PartItem" USING GIN ("nameAr" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PartChassis_chassisId_idx" ON "PartChassis"("chassisId");

-- CreateIndex
CREATE INDEX "PartEngine_engineId_idx" ON "PartEngine"("engineId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountNumber_key" ON "Account"("accountNumber");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX "Account_name_trgm_idx" ON "Account" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "CustomerVehicle_accountId_idx" ON "CustomerVehicle"("accountId");

-- CreateIndex
CREATE INDEX "CustomerVehicle_vin_idx" ON "CustomerVehicle"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryShift_shiftNumber_key" ON "TreasuryShift"("shiftNumber");

-- CreateIndex
CREATE INDEX "TreasuryShift_treasuryId_closedAt_idx" ON "TreasuryShift"("treasuryId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- CreateIndex
CREATE INDEX "Invoice_accountId_paymentStatus_idx" ON "Invoice"("accountId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Invoice_type_createdAt_idx" ON "Invoice"("type", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_partId_idx" ON "InvoiceItem"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_seq_key" ON "StockMovement"("seq");

-- CreateIndex
CREATE INDEX "StockMovement_partId_seq_idx" ON "StockMovement"("partId", "seq");

-- CreateIndex
CREATE INDEX "StockMovement_partId_createdAt_idx" ON "StockMovement"("partId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryTransaction_transactionNumber_key" ON "TreasuryTransaction"("transactionNumber");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_treasuryId_createdAt_idx" ON "TreasuryTransaction"("treasuryId", "createdAt");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_accountId_createdAt_idx" ON "TreasuryTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_invoiceId_idx" ON "TreasuryTransaction"("invoiceId");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_createdAt_idx" ON "TreasuryTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_type_createdAt_idx" ON "TreasuryTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SystemAuditTrail_tableName_recordId_idx" ON "SystemAuditTrail"("tableName", "recordId");

-- CreateIndex
CREATE INDEX "SystemAuditTrail_timestamp_idx" ON "SystemAuditTrail"("timestamp");

-- AddForeignKey
ALTER TABLE "PartItem" ADD CONSTRAINT "PartItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartItem" ADD CONSTRAINT "PartItem_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartChassis" ADD CONSTRAINT "PartChassis_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PartItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartChassis" ADD CONSTRAINT "PartChassis_chassisId_fkey" FOREIGN KEY ("chassisId") REFERENCES "BmwChassis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartEngine" ADD CONSTRAINT "PartEngine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PartItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartEngine" ADD CONSTRAINT "PartEngine_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "BmwEngine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_chassisId_fkey" FOREIGN KEY ("chassisId") REFERENCES "BmwChassis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "BmwEngine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryShift" ADD CONSTRAINT "TreasuryShift_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "Treasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryShift" ADD CONSTRAINT "TreasuryShift_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "Treasury"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CustomerVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PartItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PartItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransaction" ADD CONSTRAINT "TreasuryTransaction_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "Treasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransaction" ADD CONSTRAINT "TreasuryTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransaction" ADD CONSTRAINT "TreasuryTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

