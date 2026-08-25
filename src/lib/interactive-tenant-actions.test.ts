import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("interactive tenant action boundaries", () => {
  it("binds account-statement read actions to the explicit tenant resolver", () => {
    const actions = source("src/server/actions/invoices.read.actions.ts");
    expect(actions).toContain('import { getTenantDbFromSession }');
    expect(actions).toContain("getAccountDetailedLedgerAction");
    expect(actions).toContain("getAccountStatementAction");
    expect(actions).toContain("return tenant.run(async () => {");
  });

  it("uses tenant-scoped voucher lookups and transactions for modal actions", () => {
    const actions = source("src/server/actions/voucher.actions.ts");
    expect(actions).toContain('import { getTenantDbFromSession }');
    expect(actions).toContain("tenant.prisma.treasuryTransaction.findFirst");
    expect(actions).toContain("tenant.prisma.$transaction");
    expect(actions).toContain("toActionError(error, \"getVoucherDetailsAction\")");
  });

  it("normalizes accountless manual vouchers and posts them in the active tenant database", () => {
    const actions = source("src/server/actions/treasury.actions.ts");
    const modal = source("src/app/(app)/vouchers/vouchers-client.tsx");
    expect(actions).toContain("function normalizeOptionalVoucherAccountId");
    expect(actions).toContain('"بدون حساب"');
    expect(actions).toContain("const tenant = await getTenantDbFromSession()");
    expect(actions).toContain("tenant.run(() => withTxRetry");
    expect(actions).toContain("tenant.prisma.$transaction");
    expect(actions).toContain("accountId = invoice?.accountId ?? input.accountId ?? null");
    expect(modal).toContain("<AccountCombobox");
    const selector = source("src/components/common/account-combobox.tsx");
    expect(selector).toContain("بدون حساب (نقدي عام)");
  });

  it("maps users with an explicit tenant client and avoids sensitive password fields", () => {
    const page = source("src/app/(app)/users/page.tsx");
    const mapper = source("src/server/services/audit.service.ts");
    expect(page).toContain("listUsers(tenant.prisma)");
    expect(page).toContain("tenant.prisma.treasury.findMany");
    expect(mapper).toContain('select: {\n      id: true, username: true, fullName: true');
    expect(mapper).not.toContain("passwordHash: true");
  });

  it("reports the all-active tenant user count on login and heartbeat", () => {
    const actions = source("src/server/actions/auth.actions.ts");
    expect(actions).toContain('reportTenantSubUserUsage(tenant.route, await tenant.prisma.user.count({ where: { isActive: true } }))');
    expect(actions).toContain("[tenantDeviceHeartbeatAction] active-user usage report:");
    expect(actions).not.toContain('reportTenantSubUserUsage(tenant.route, await tenant.prisma.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } }))');
  });

  it("deactivates users through the explicit tenant database without hard deletion and returns useful Arabic feedback", () => {
    const actions = source("src/server/actions/auth.actions.ts");
    const client = source("src/app/(app)/users/users-management-client.tsx");
    expect(actions).toContain('const tenant = await getTenantDbFromSession()');
    expect(actions).toContain("tenant.run(() => withTxRetry");
    expect(actions).toContain("tenant.prisma.$transaction");
    expect(actions).toContain("data: { isActive: !target.isActive }");
    expect(actions).toContain("لا يمكنك إيقاف حسابك الخاص.");
    expect(actions).toContain("لا يمكن إيقاف آخر مدير نظام نشط.");
    expect(actions).not.toContain("tenant.prisma.user.delete({ where: { id: userId }");
    expect(client).toContain("إذا كانت لديه سجلات أو فواتير مرتبطة، سيُعطّل الحساب فقط");
    expect(client).toContain('<Alert variant="success">{notice}</Alert>');
  });
});
