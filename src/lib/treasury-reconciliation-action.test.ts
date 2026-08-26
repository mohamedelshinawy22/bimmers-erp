import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Treasury reconciliation resilience", () => {
  it("uses the active tenant transaction client and records deficit or surplus with an absolute positive amount", () => {
    const actions = source("src/server/actions/treasury.actions.ts");
    const reconcile = actions.slice(actions.indexOf("export async function reconcileTreasuryBalanceAction"), actions.indexOf("/**\n * Receipt"));
    expect(reconcile).toContain("const tenant = await getTenantDbFromSession()");
    expect(reconcile).toContain("tenant.run(() => withTxRetry(() => tenant.prisma.$transaction");
    expect(reconcile).not.toContain("withTxRetry(() => prisma.$transaction");
    expect(reconcile).toContain("const delta = money(targetBalance.sub(previousBalance))");
    expect(reconcile).toContain("amount: delta.abs()");
    expect(reconcile).toContain('type: delta.gt(0) ? "RECEIPT" : "PAYMENT"');
    expect(reconcile).toContain("await nextTransactionNumber(tx)");
    expect(reconcile).toContain("if (!delta.eq(0) && input.reason.length < 5)");
    expect(reconcile).toContain("return toActionError(error, \"reconcileTreasuryBalanceAction\")");
  });

  it("parses a numeric actual balance and presents action errors inline before submitting a deficit", () => {
    const modal = source("src/app/(app)/treasury/treasury-client.tsx");
    expect(modal).toContain('Number(String(targetBalance || "0").replace(/,/g, "").trim())');
    expect(modal).toContain("reason.trim().length < 5");
    expect(modal).toContain("if (!result.success) { setError(result.error); return; }");
  });
});
