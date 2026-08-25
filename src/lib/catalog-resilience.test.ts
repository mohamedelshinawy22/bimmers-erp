import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Catalog resilience boundaries", () => {
  it("requires an explicit tenant client for Catalog reads and maps sparse relations safely", () => {
    const service = source("src/server/services/parts.service.ts");
    const page = source("src/app/(app)/inventory/page.tsx");
    expect(service).not.toContain('from "@/lib/prisma"');
    expect(service).toContain("export async function searchParts(\n  db: PartsDb,");
    expect(service).toContain("export async function getPartFormOptions(db: PartsDb)");
    expect(service).toContain("c.chassis?.code?.trim()");
    expect(service).toContain("e.engine?.code?.trim()");
    expect(service).toContain('const nameAr = p.nameAr?.trim() || "صنف بدون اسم"');
    expect(page).toContain("searchParts(tenant.prisma");
    expect(page).toContain("getPartFormOptions(tenant.prisma)");
    expect(page).toContain("getPartCategories(tenant.prisma)");
    expect(page).toContain("Unable to load tenant-scoped Catalog");
    expect(page).toContain("const tenant = await getTenantDbFromSession()");
    expect(page).toContain("return <CatalogRecovery />");
    expect(source("src/app/(app)/inventory/error.tsx")).toContain("export default function InventoryError");
    expect(page).toContain("rows={serializeData(rows)}");
    expect(page).toContain("company={serializeData(company)}");
  });

  it("coerces sparse spreadsheet cells, links the normalized category, and only assigns an existing bin", () => {
    const action = source("src/server/actions/import.actions.ts");
    const modal = source("src/components/inventory/excel-import-modal.tsx");
    expect(action).toContain("const spreadsheetText");
    expect(action).toContain("categoryId: category.id");
    expect(action).toContain("const bin = binCode ? await tx.warehouseBin.findUnique");
    expect(action).toContain("binLocationId: bin?.id ?? null");
    expect(action).toContain("for (const code of new Set(codes(row.chassis)))");
    expect(action).toContain("for (const code of new Set(codes(row.engine)))");
    expect(action).toContain("rows: z.array(z.unknown()).min(1).max(20)");
    expect(modal).toContain("const INVENTORY_IMPORT_CHUNK_SIZE = 20");
    expect(modal).toContain("for (let start = 0; start < submissionRows.length; start += INVENTORY_IMPORT_CHUNK_SIZE)");
    expect(modal).toContain("جارٍ ترحيل الأصناف");
  });

  it("keeps BMW fitment selection discoverable with filtered master-code results and generation presets", () => {
    const matrix = source("src/app/(app)/inventory/components/fitment-matrix.tsx");
    expect(matrix).toContain("const BMW_PRESETS");
    expect(matrix).toContain('{ label: "E46"');
    expect(matrix).toContain('{ label: "G20"');
    expect(matrix).toContain("const applyPreset");
    expect(matrix).toContain("chassis.filter((item) => !chassisInput");
    expect(matrix).toContain("engines.filter((item) => !engineInput");
    expect(matrix).toContain("slice(0, 40)");
  });

  it("creates manual products through the active tenant while resolving master records before the short atomic write", () => {
    const actions = source("src/server/actions/parts.actions.ts");
    expect(actions).toContain("const tenant = await getTenantDbFromSession()");
    expect(actions).toContain("const PRODUCT_CREATE_TX_OPTIONS");
    expect(actions).toContain("const masters = await tenant.run(async () =>");
    expect(actions).toContain("tenant.prisma.brand.upsert");
    expect(actions).toContain("tenant.prisma.category.upsert");
    expect(actions).toContain("binLocationId: input.binLocationId ?? null");
    expect(actions).toContain("tenant.prisma.$transaction");
    expect(actions).toContain("export async function updatePartAction");
    expect(actions).toContain("await tenant.run(() => tenant.prisma.$transaction(async (tx) => {");
  });
});
