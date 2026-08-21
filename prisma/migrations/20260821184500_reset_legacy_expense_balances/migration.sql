-- Operational expense accounts classify P&L activity and must not retain receivable/payable balances.
-- Preserve a reconciliation record for each legacy non-zero balance before resetting it.
INSERT INTO "AccountBalanceAdjustment" (
  "id", "accountId", "previousBalance", "targetBalance", "delta", "targetNature",
  "reason", "createdByUser", "createdByName", "createdAt"
)
SELECT
  uuid_generate_v4(),
  "id",
  "currentBalance",
  0,
  (0 - "currentBalance"),
  'ZERO',
  'تصحيح ترحيل: حساب مصروف تشغيلي لا يدخل ضمن المدينيات أو المستحقات.',
  'SYSTEM_MIGRATION',
  'System Migration',
  NOW()
FROM "Account"
WHERE "type" = 'EXPENSE'
  AND "currentBalance" <> 0;

UPDATE "Account"
SET "currentBalance" = 0
WHERE "type" = 'EXPENSE'
  AND "currentBalance" <> 0;
