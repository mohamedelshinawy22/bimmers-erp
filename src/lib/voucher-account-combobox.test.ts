import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("voucher account combobox contract", () => {
  it("loads active tenant accounts with primitive current balances for manual vouchers", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/services/vouchers.service.ts"), "utf8");
    expect(source).toContain("where: { isActive: true }");
    expect(source).toContain("currentBalance: true");
    expect(source).toContain("currentBalance: num(row.currentBalance)");
    expect(source).not.toContain("getVoucherAccounts(prisma");
  });

  it("retains accountless cash posting and provides searchable inline creation in the voucher modal", () => {
    const selector = readFileSync(resolve(process.cwd(), "src/components/common/account-combobox.tsx"), "utf8");
    const modal = readFileSync(resolve(process.cwd(), "src/app/(app)/vouchers/vouchers-client.tsx"), "utf8");
    const treasuryAction = readFileSync(resolve(process.cwd(), "src/server/actions/treasury.actions.ts"), "utf8");
    expect(selector).toContain("بدون حساب (نقدي عام)");
    expect(selector).toContain("createAccountAction");
    expect(selector).toContain("voucherType === \"RECEIPT\" ? \"CUSTOMER\" : \"SUPPLIER\"");
    expect(selector).toContain("currentBalance");
    expect(modal).toContain("<AccountCombobox");
    expect(modal).toContain("accountId: accountId || undefined");
    expect(treasuryAction).toContain("normalizeOptionalVoucherAccountId");
  });

  it("accepts blank voucher notes and derives a meaningful description inside the tenant transaction", () => {
    const schema = readFileSync(resolve(process.cwd(), "src/lib/validations/invoice.ts"), "utf8");
    const modal = readFileSync(resolve(process.cwd(), "src/app/(app)/vouchers/vouchers-client.tsx"), "utf8");
    const treasuryAction = readFileSync(resolve(process.cwd(), "src/server/actions/treasury.actions.ts"), "utf8");
    expect(schema).toContain("description: optionalText(500)");
    expect(modal).toContain("البيان والملاحظات (اختياري)");
    expect(modal).not.toContain("description.trim().length < 3");
    expect(treasuryAction).toContain('input.description?.trim() || `${input.type === "RECEIPT" ? "سند قبض" : "سند صرف"} - ${account?.name ?? "نقدي عام"}`');
  });
});
