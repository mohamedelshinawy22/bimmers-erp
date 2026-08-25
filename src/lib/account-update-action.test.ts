import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("account update resilience", () => {
  it("normalizes display values and updates only through the active tenant client", () => {
    const actions = source("src/server/actions/accounts.actions.ts");
    const update = actions.slice(actions.indexOf("export async function updateAccountAction"), actions.indexOf("export async function createQuickPosAccountAction"));
    expect(actions).toContain("const ACCOUNT_TYPE_ALIASES");
    expect(actions).toContain("const PRICE_TIER_ALIASES");
    expect(actions).toContain("const BALANCE_NATURE_ALIASES");
    expect(actions).toContain("const blankOptionalText");
    expect(actions).toContain("const safeNonNegativeNumber");
    expect(update).toContain("normalizeAccountUpdate(raw)");
    expect(update).toContain("const tenant = await getTenantDbFromSession()");
    expect(update).toContain("tenant.run(() => withTxRetry(() => tenant.prisma.$transaction");
    expect(update).not.toContain("withTxRetry(() => prisma.$transaction");
    expect(update).toContain("return toActionError(error, \"updateAccountAction\")");
  });

  it("cleans empty optional fields and presents a modal-safe action error", () => {
    const modal = source("src/app/(app)/accounts/accounts-client.tsx");
    expect(modal).toContain("phone: form.phone.trim() || null");
    expect(modal).toContain("email: form.email.trim() || null");
    expect(modal).toContain("category: null");
    expect(modal).toContain("setError(res.error)");
    expect(modal).toContain('setError("تعذر حفظ تعديلات الحساب. أعد المحاولة.")');
  });

  it("keeps compatible blank and Arabic adjustment inputs valid before Zod parsing", () => {
    const actions = source("src/server/actions/accounts.actions.ts");
    expect(actions).toContain('"ورش": "WHOLESALE"');
    expect(actions).toContain('"مدين": "DEBIT"');
    expect(actions).toContain('"دائن": "CREDIT"');
    expect(actions).toContain('value === null || value === undefined ? ""');
    expect(actions).toContain("balanceAmount: safeNonNegativeNumber(candidate.balanceAmount)");
    expect(actions).toContain("balanceNature: BALANCE_NATURE_ALIASES[balanceNatureKey]");
  });
});
