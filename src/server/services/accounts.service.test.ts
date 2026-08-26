import { describe, expect, it } from "vitest";
import { matchesAccountBalanceDirection } from "../../lib/account-balance-direction";

describe("Accounts balance-direction filtering", () => {
  it("uses balance sign independently of customer, supplier, or workshop type", () => {
    expect(matchesAccountBalanceDirection(-200, "DEBIT")).toBe(true);
    expect(matchesAccountBalanceDirection(200, "DEBIT")).toBe(false);
    expect(matchesAccountBalanceDirection(200, "CREDIT")).toBe(true);
    expect(matchesAccountBalanceDirection(-200, "CREDIT")).toBe(false);
    expect(matchesAccountBalanceDirection(0.004, "ZERO")).toBe(true);
    expect(matchesAccountBalanceDirection(0.01, "ZERO")).toBe(false);
  });
});
