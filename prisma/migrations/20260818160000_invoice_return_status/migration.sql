-- Track whether a source sales/purchase invoice has been partially or fully returned.
CREATE TYPE "ReturnStatus" AS ENUM ('NONE', 'PARTIALLY_RETURNED', 'FULLY_RETURNED');

ALTER TABLE "Invoice"
  ADD COLUMN "returnStatus" "ReturnStatus" NOT NULL DEFAULT 'NONE';
