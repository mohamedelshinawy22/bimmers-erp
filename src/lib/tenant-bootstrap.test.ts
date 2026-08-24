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
    expect(resolver).not.toContain("DATABASE_URL");
  });
});
