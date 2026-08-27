import { describe, expect, it } from "vitest";
import { filterInventoryCatalog, type InventoryCatalogFilterRow } from "./inventory-catalog-filter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rows: InventoryCatalogFilterRow[] = [
  { id: "1", nameAr: "طلمبه مياه اضافيه", nameEn: null, oemNumber: "F02-N63", barcode: null, brandId: "bmw", brandName: "BMW", category: "تبريد", chassisCodes: ["F02"], engineCodes: ["N63"], stockQuantity: 3, minReorderLevel: 2 },
  { id: "2", nameAr: "رادياتير E90", nameEn: null, oemNumber: "E90-1", barcode: null, brandId: "bmw", brandName: "BMW", category: "تبريد", chassisCodes: ["E90"], engineCodes: [], stockQuantity: 1, minReorderLevel: 2 },
  { id: "3", nameAr: "فلتر زيت", nameEn: null, oemNumber: "OIL-1", barcode: null, brandId: "aftermarket", brandName: "عام", category: "فلاتر", chassisCodes: [], engineCodes: [], stockQuantity: 8, minReorderLevel: 2 },
];

const filters = { query: "", chassis: "", category: "", brandId: "", inStockOnly: false, lowStock: false };
const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("continuous Inventory catalog", () => {
  it("keeps every loaded tenant part visible until a client-side filter is applied", () => {
    expect(filterInventoryCatalog(rows, filters).map((row) => row.id)).toEqual(["1", "2", "3"]);
  });

  it("filters full catalog rows locally with Arabic variants and chassis codes", () => {
    expect(filterInventoryCatalog(rows, { ...filters, query: "طلمبة n63" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterInventoryCatalog(rows, { ...filters, chassis: "E90", lowStock: true }).map((row) => row.id)).toEqual(["2"]);
  });

  it("uses an explicit unpaginated service mode only for the Inventory page", () => {
    const page = source("src/app/(app)/inventory/page.tsx");
    const service = source("src/server/services/parts.service.ts");
    const client = source("src/app/(app)/inventory/inventory-client.tsx");
    expect(page).toContain("unpaginated: true");
    expect(service).toContain("input.unpaginated ? undefined : input.pageSize");
    expect(client).not.toContain("صفحة <span");
    expect(client).not.toContain("التالي");
  });
});
