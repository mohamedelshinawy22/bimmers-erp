import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("tenant baseline bootstrap", () => {
  it("uses only actual ERP master models and idempotent seed operations", () => {
    const bootstrap = source("src/server/db/bootstrap-tenant.ts");
    expect(bootstrap).toContain("export async function bootstrapTenantDatabase");
    expect(bootstrap).toContain("db.treasury.upsert");
    expect(bootstrap).toContain("db.warehouseBin.upsert");
    expect(bootstrap).toContain("db.account.upsert");
    expect(bootstrap).toContain("db.barcodeConfig.upsert");
    expect(bootstrap).toContain("db.category.createMany");
    expect(bootstrap).toContain("db.bmwChassis.createMany");
    expect(bootstrap).toContain("db.bmwEngine.createMany");
    expect(bootstrap).toContain("db.documentCounter.createMany");
    expect(bootstrap).toContain("db.partItem.updateMany({ where: { categoryId: null }");
    expect(bootstrap).not.toContain("db.branch");
    expect(bootstrap).not.toContain("sequenceCounter");
  });

  it("boots only the resolved tenant database and retains strict route isolation", () => {
    const resolver = source("src/server/db/get-tenant-db.ts");
    expect(resolver).toContain("await ensureTenantBaseline(context)");
    expect(resolver).toContain("bootstrapTenantDatabase(context.prisma)");
    expect(resolver).toContain("bootstrapByTenant");
    expect(resolver).toContain('fullCode: "MAIN-A0-00-A-00"');
    expect(resolver).toContain('accountNumber: "ACC-0001", isActive: true');
    expect(resolver).toContain("context.prisma.systemSetting.count()");
    expect(resolver).toContain("context.prisma.documentCounter.count()");
    expect(resolver).not.toContain("DATABASE_URL");
  });

  it("keeps fresh operational pages tenant-scoped and allows intentional zero-data rendering", () => {
    const posPage = source("src/app/(app)/pos/page.tsx");
    const voucherPage = source("src/app/(app)/vouchers/page.tsx");
    const invoicePage = source("src/app/(app)/invoices/page.tsx");
    const dashboard = source("src/server/services/dashboard.service.ts");
    const catalog = source("src/app/(app)/inventory/inventory-client.tsx");
    expect(posPage).toContain("getPosAccounts(tenant.prisma)");
    expect(posPage).toContain("tenant.prisma.treasury.findMany");
    expect(voucherPage).toContain("getVoucherRegister(tenant.prisma");
    expect(voucherPage).toContain("getVoucherAccounts(tenant.prisma)");
    expect(invoicePage).toContain("listInvoices(tenant.prisma");
    expect(invoicePage).toContain("tenant.prisma.treasury.findMany");
    expect(dashboard).toContain("getDashboardMetrics(db: DashboardDb)");
    expect(dashboard).not.toContain('cached("dashboard:metrics"');
    expect(catalog).toContain("لا توجد أصناف في الكتالوج بعد");
    expect(catalog).toContain("استيراد بضاعة من إكسيل");
  });
});
