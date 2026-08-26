export type AccountBalanceDirectionFilter = "ALL" | "DEBIT" | "CREDIT" | "ZERO";

/** Balance direction is financial, not an account-type classification. */
export function matchesAccountBalanceDirection(value: number, filter: AccountBalanceDirectionFilter) {
  if (filter === "DEBIT") return value < 0;
  if (filter === "CREDIT") return value > 0;
  if (filter === "ZERO") return Math.abs(value) < 0.005;
  return true;
}
