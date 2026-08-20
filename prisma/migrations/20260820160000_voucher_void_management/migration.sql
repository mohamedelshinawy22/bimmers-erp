ALTER TABLE "TreasuryTransaction"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidedByUser" TEXT,
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "TreasuryTransaction_status_createdAt_idx"
  ON "TreasuryTransaction"("status", "createdAt");
