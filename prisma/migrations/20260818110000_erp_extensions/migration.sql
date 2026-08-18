-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "HeldSaleStatus" AS ENUM ('HELD', 'RESUMED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CheckDirection" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountType" ADD VALUE 'EMPLOYEE';
ALTER TYPE "AccountType" ADD VALUE 'ADVANCE';
ALTER TYPE "AccountType" ADD VALUE 'PARTNER';
ALTER TYPE "AccountType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "normalizedName" TEXT;
UPDATE "Brand" SET "normalizedName" = lower(trim("name"));
ALTER TABLE "Brand" ALTER COLUMN "normalizedName" SET NOT NULL;

-- AlterTable
ALTER TABLE "PartItem" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "category" TEXT,
ADD COLUMN     "lastPaymentAmount" DECIMAL(12,2),
ADD COLUMN     "lastPaymentDate" TIMESTAMP(3),
ADD COLUMN     "lastSaleAmount" DECIMAL(12,2),
ADD COLUMN     "lastSaleDate" TIMESTAMP(3),
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "accountBalanceAfter" DECIMAL(12,2),
ADD COLUMN     "accountBalanceBefore" DECIMAL(12,2),
ADD COLUMN     "verificationToken" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "lineDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0.0;

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Backfill category master data from existing legacy display categories before linking parts.
INSERT INTO "Category" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT uuid_generate_v4()::text, min(trim("category")), lower(trim("category")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PartItem"
WHERE trim("category") <> ''
GROUP BY lower(trim("category"));

UPDATE "PartItem" AS p
SET "categoryId" = c."id"
FROM "Category" AS c
WHERE lower(trim(p."category")) = c."normalizedName";

-- CreateTable
CREATE TABLE "HeldSale" (
    "id" TEXT NOT NULL,
    "holdNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "treasuryId" TEXT,
    "invoiceId" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "notes" TEXT,
    "status" "HeldSaleStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeldSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldSaleItem" (
    "id" TEXT NOT NULL,
    "heldSaleId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,

    CONSTRAINT "HeldSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCheck" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "CheckDirection" NOT NULL,
    "checkNumber" TEXT NOT NULL,
    "bankName" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "settlementTxId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "settlementTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_normalizedName_key" ON "Category"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "HeldSale_holdNumber_key" ON "HeldSale"("holdNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HeldSale_invoiceId_key" ON "HeldSale"("invoiceId");

-- CreateIndex
CREATE INDEX "HeldSale_userId_status_idx" ON "HeldSale"("userId", "status");

-- CreateIndex
CREATE INDEX "HeldSale_accountId_status_idx" ON "HeldSale"("accountId", "status");

-- CreateIndex
CREATE INDEX "HeldSaleItem_heldSaleId_idx" ON "HeldSaleItem"("heldSaleId");

-- CreateIndex
CREATE INDEX "HeldSaleItem_partId_idx" ON "HeldSaleItem"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCheck_settlementTxId_key" ON "AccountCheck"("settlementTxId");

-- CreateIndex
CREATE INDEX "AccountCheck_accountId_dueDate_idx" ON "AccountCheck"("accountId", "dueDate");

-- CreateIndex
CREATE INDEX "AccountCheck_status_dueDate_idx" ON "AccountCheck"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCheck_accountId_direction_checkNumber_key" ON "AccountCheck"("accountId", "direction", "checkNumber");

-- CreateIndex
CREATE INDEX "InstallmentPlan_accountId_status_idx" ON "InstallmentPlan"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_settlementTxId_key" ON "Installment"("settlementTxId");

-- CreateIndex
CREATE INDEX "Installment_planId_dueDate_idx" ON "Installment"("planId", "dueDate");

-- CreateIndex
CREATE INDEX "Installment_status_dueDate_idx" ON "Installment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_normalizedName_key" ON "Brand"("normalizedName");

-- CreateIndex
CREATE INDEX "PartItem_categoryId_idx" ON "PartItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_verificationToken_key" ON "Invoice"("verificationToken");

-- AddForeignKey
ALTER TABLE "PartItem" ADD CONSTRAINT "PartItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "Treasury"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSaleItem" ADD CONSTRAINT "HeldSaleItem_heldSaleId_fkey" FOREIGN KEY ("heldSaleId") REFERENCES "HeldSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSaleItem" ADD CONSTRAINT "HeldSaleItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "PartItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCheck" ADD CONSTRAINT "AccountCheck_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

