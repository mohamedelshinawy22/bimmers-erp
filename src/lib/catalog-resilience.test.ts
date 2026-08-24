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
    expect(page).toContain("searchParts(tenant.prisma");
    expect(page).toContain("getPartFormOptions(tenant.prisma)");
    expect(page).toContain("getPartCategories(tenant.prisma)");
  });

  it("coerces sparse spreadsheet cells, links the normalized category, and only assigns an existing bin", () => {
    const action = source("src/server/actions/import.actions.ts");
    expect(action).toContain("const spreadsheetText");
    expect(action).toContain("categoryId: category.id");
    expect(action).toContain("const bin = binCode ? await tx.warehouseBin.findUnique");
    expect(action).toContain("binLocationId: bin?.id ?? null");
    expect(action).toContain("for (const code of new Set(codes(row.chassis)))");
    expect(action).toContain("for (const code of new Set(codes(row.engine)))");
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
});
