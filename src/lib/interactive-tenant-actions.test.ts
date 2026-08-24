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
});
