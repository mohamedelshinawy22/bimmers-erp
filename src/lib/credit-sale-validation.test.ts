import { describe, expect, it } from "vitest";
import { isWalkInCashAccount, WALK_IN_CREDIT_ERROR } from "./credit-sale-validation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("walk-in on-account sale validation", () => {
  it("identifies both current and legacy walk-in account markers", () => {
    expect(isWalkInCashAccount({ accountNumber: "ACC-0001" })).toBe(true);
    expect(isWalkInCashAccount({ category: "WALK_IN_CASH" })).toBe(true);
    expect(isWalkInCashAccount({ accountNumber: "ACC-0420", category: "RETAIL" })).toBe(false);
  });

  it("keeps the friendly Arabic denial in the locked sale transaction and a tenant-run action boundary", () => {
    const service = source("src/server/services/invoice.service.ts");
    const action = source("src/server/actions/invoice.actions.ts");
    expect(service).toContain("isWalkInCashAccount(account)");
    expect(service).toContain("WALK_IN_CREDIT_ERROR");
    expect(action).toContain("getTenantDbFromSession()");
    expect(action).toContain("tenant.run(() => createSaleInvoice");
    expect(WALK_IN_CREDIT_ERROR).toContain("لا يمكن البيع الآجل");
  });

  it("disables the POS on-account option and renders a customer-selection warning", () => {
    const pos = source("src/app/(app)/pos/pos-terminal.tsx");
    expect(pos).toContain("const onAccountDisabled = option.value === \"ON_ACCOUNT\" && isWalkInCustomer");
    expect(pos).toContain("disabled={onAccountDisabled}");
    expect(pos).toContain("البيع الآجل يتطلب تحديد حساب عميل / ورشة مسجل");
    expect(pos).toContain("setError(result.error)");
  });
});
