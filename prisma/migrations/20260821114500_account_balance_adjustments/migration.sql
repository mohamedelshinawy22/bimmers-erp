-- Immutable account-balance reconciliation entries. Historical account rows are retained;
-- this table records only authorised manual adjustments and is never used to replay cash flow.
CREATE TABLE "AccountBalanceAdjustment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "previousBalance" DECIMAL(12,2) NOT NULL,
    "targetBalance" DECIMAL(12,2) NOT NULL,
    "delta" DECIMAL(12,2) NOT NULL,
    "targetNature" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUser" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBalanceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountBalanceAdjustment_accountId_createdAt_idx" ON "AccountBalanceAdjustment"("accountId", "createdAt");
CREATE INDEX "AccountBalanceAdjustment_createdAt_idx" ON "AccountBalanceAdjustment"("createdAt");

ALTER TABLE "AccountBalanceAdjustment"
ADD CONSTRAINT "AccountBalanceAdjustment_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
