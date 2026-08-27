import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Purchase Invoice account selection", () => {
  it("allows all active ledger account types for purchases while sales remain customer-facing", () => {
    const guard = source("src/server/services/inventory.service.ts");
    expect(guard).toContain('const SALE_ACCOUNT_TYPES: readonly AccountType[] = ["CUSTOMER", "WORKSHOP_BMW"]');
    expect(guard).toContain('if (document === "SALE" && !SALE_ACCOUNT_TYPES.includes(account.type))');
    expect(guard).not.toContain('PURCHASE: ["SUPPLIER"]');
  });

  it("loads and searches active purchase accounts without a supplier-only database condition", () => {
    const loader = source("src/server/services/invoices.service.ts");
    const search = source("src/server/services/accounts.service.ts");
    expect(loader).toContain("where: { isActive: true }");
    expect(loader).toContain("type: true");
    expect(search).toContain("export async function searchPurchaseAccounts");
    expect(search).not.toContain("type: \"SUPPLIER\",");
  });

  it("keeps the existing signed payable posting for an unpaid purchase regardless of account type", () => {
    const service = source("src/server/services/invoice.service.ts");
    expect(service).toContain('assertAccountTypeFor("PURCHASE", supplier);');
    expect(service).toContain('data: { currentBalance: { increment: remainingAmount } }');
  });

  it("renders account-type badges and signed balance context in the purchase selector", () => {
    const selector = source("src/components/purchases/supplier-combobox.tsx");
    const modal = source("src/app/(app)/inventory/components/purchase-invoice-modal.tsx");
    expect(selector).toContain("searchPurchaseAccountsAction");
    expect(selector).toContain("label: \"عميل\"");
    expect(selector).toContain("label: \"ورشة\"");
    expect(selector).toContain("label: \"حساب عام\"");
    expect(selector).toContain("label: \"عليه\"");
    expect(modal).toContain('label="الحساب / المورد"');
  });
});
