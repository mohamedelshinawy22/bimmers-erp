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
    const searchActions = source("src/server/actions/search.actions.ts");
    expect(service).toContain("isWalkInCashAccount(account)");
    expect(service).toContain("WALK_IN_CREDIT_ERROR");
    expect(action).toContain("getTenantDbFromSession()");
    expect(action).toContain("tenant.run(() => getUserAccess(user.id))");
    expect(action).toContain("tenant.run(() => createSaleInvoice");
    expect(action).toContain("tenant.run(() => updateSaleInvoice");
    expect(searchActions).toContain("tenant.run(() => searchPosAccounts(query, 30))");
    expect(searchActions).toContain("tenant.run(() => getAccountVehicles(accountId))");
    expect(WALK_IN_CREDIT_ERROR).toContain("لا يمكن البيع الآجل");
  });

  it("permits only manager roles to post a registered-customer credit exception and records override metadata", () => {
    const permissions = source("src/lib/permissions.ts");
    const service = source("src/server/services/invoice.service.ts");
    const action = source("src/server/actions/invoice.actions.ts");
    const pos = source("src/app/(app)/pos/pos-terminal.tsx");
    expect(permissions).toContain('"invoice.overrideCreditLimit": ["SUPER_ADMIN", "MANAGER"]');
    expect(action).toContain('can(user.role, "invoice.overrideCreditLimit")');
    expect(service).toContain("canOverrideCreditLimit?: boolean");
    expect(service).toContain("...(creditOverride ? { creditOverride } : {})");
    expect(pos).toContain("const managerCreditOverride = creditRequiresOverride && canOverrideCreditLimit && !isWalkInCustomer");
    expect(pos).toContain("سيتم إتمام البيع الآجل بصلاحية مدير النظام");
  });

  it("keeps a pure on-account sale independent from treasury posting", () => {
    const service = source("src/server/services/invoice.service.ts");
    expect(service).toContain("treasuryId: paidAmount.gt(0) ? input.treasuryId : null");
    expect(service).toContain("if (paidAmount.gt(0) && input.treasuryId)");
  });

  it("runs all return entry points inside the authenticated tenant boundary", () => {
    const action = source("src/server/actions/invoice.actions.ts");
    const printAction = source("src/server/actions/invoice-print.actions.ts");
    expect(action).toContain("const tenant = await getTenantDbFromSession();");
    expect(action).toContain("tenant.run(() => tenant.prisma.invoice.findUnique");
    expect(action).toContain("tenant.run(() => createInvoiceReturn(input");
    expect(action.match(/tenant\.run\(\(\) => tenant\.prisma\.invoice\.findUnique/g)?.length).toBeGreaterThanOrEqual(3);
    expect(action.match(/tenant\.run\(\(\) => createInvoiceReturn\(input/g)?.length).toBeGreaterThanOrEqual(3);
    expect(printAction).toContain("tenant.run(() => getAccountDetailedLedger(invoice.account.id))");
  });

  it("disables the POS on-account option and renders a customer-selection warning", () => {
    const pos = source("src/app/(app)/pos/pos-terminal.tsx");
    expect(pos).toContain("const onAccountDisabled = option.value === \"ON_ACCOUNT\" && isWalkInCustomer");
    expect(pos).toContain("disabled={onAccountDisabled}");
    expect(pos).toContain("البيع الآجل يتطلب تحديد حساب عميل / ورشة مسجل");
    expect(pos).toContain("setError(result.error)");
  });

  it("uses the session tenant context for invoice editing and settlement while keeping payment-dialog errors recoverable", () => {
    const action = source("src/server/actions/invoice.actions.ts");
    const treasuryActions = source("src/server/actions/treasury.actions.ts");
    const invoices = source("src/app/(app)/invoices/invoices-client.tsx");
    expect(action).toContain("const tenant = await getTenantDbFromSession();");
    expect(action).toContain("tenant.run(() => updateSaleInvoice(input");
    expect(treasuryActions).toContain("const tenant = await getTenantDbFromSession();");
    expect(treasuryActions).toContain("tenant.run(() => withTxRetry(() => prisma.$transaction");
    expect(invoices).toContain("if (pending) return;");
    expect(invoices).toContain("setError(result.error || \"تعذر إتمام السداد حالياً. أعد المحاولة.\")");
  });
});
