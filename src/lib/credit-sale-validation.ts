export interface CreditSaleAccountIdentity {
  accountNumber?: string | null;
  category?: string | null;
}

export const WALK_IN_CREDIT_ERROR = "لا يمكن البيع الآجل (على الحساب) للعميل النقدي الافتراضي. يرجى اختيار عميل مسجل أو تغيير طريقة الدفع إلى نقدي/فيزا.";

/** The bootstrap account carries both a stable number and category for legacy tenants. */
export function isWalkInCashAccount(account: CreditSaleAccountIdentity | null | undefined): boolean {
  return account?.accountNumber === "ACC-0001" || account?.category === "WALK_IN_CASH";
}
