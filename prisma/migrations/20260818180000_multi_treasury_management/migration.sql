-- Multi-treasury management: retain an optional operational note for each cash, bank, wallet, or branch treasury.
ALTER TABLE "Treasury" ADD COLUMN IF NOT EXISTS "notes" TEXT;
