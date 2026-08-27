import { describe, expect, it } from "vitest";
import { sortInventoryCatalog, toggleInventoryCatalogSort } from "./inventory-catalog-sorting";
import type { PartRow } from "@/server/services/parts.service";

const rows: PartRow[] = [
  { id: "1", oemNumber: "10-A", partNumberFormatted: null, nameAr: "مضخة مياه", nameEn: null, brandId: "b", brandName: "AVORTEX", isOem: false, brandPartNumber: null, barcode: null, category: "تبريد", sidePosition: null, binLocationId: null, binCode: null, buyPriceAvg: 800, sellPriceRetail: 1000, sellPriceWholesale: 900, sellPriceMin: 850, stockQuantity: 2, stockReserved: 0, minReorderLevel: 1, isActive: true, chassisIds: [], engineIds: [], chassisCodes: [], engineCodes: [], duplicateOemCount: 1, duplicateNameCount: 1, duplicateBrands: [] },
  { id: "2", oemNumber: "2-A", partNumberFormatted: null, nameAr: "ابره فانوس", nameEn: null, brandId: "a", brandName: "BOSCH", isOem: false, brandPartNumber: null, barcode: null, category: "كهرباء", sidePosition: null, binLocationId: null, binCode: null, buyPriceAvg: 300, sellPriceRetail: 600, sellPriceWholesale: 500, sellPriceMin: 400, stockQuantity: 12, stockReserved: 0, minReorderLevel: 1, isActive: true, chassisIds: [], engineIds: [], chassisCodes: [], engineCodes: [], duplicateOemCount: 1, duplicateNameCount: 1, duplicateBrands: [] },
];

describe("Inventory catalog sorting", () => {
  it("cycles default, ascending, descending, then default without mutating input rows", () => {
    const ascending = toggleInventoryCatalogSort({ field: null, direction: null }, "buyPriceAvg");
    expect(ascending).toEqual({ field: "buyPriceAvg", direction: "asc" });
    expect(sortInventoryCatalog(rows, ascending).map((row) => row.id)).toEqual(["2", "1"]);
    expect(toggleInventoryCatalogSort(ascending, "buyPriceAvg")).toEqual({ field: "buyPriceAvg", direction: "desc" });
    expect(toggleInventoryCatalogSort({ field: "buyPriceAvg", direction: "desc" }, "buyPriceAvg")).toEqual({ field: null, direction: null });
    expect(rows.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("compares Arabic names and OEM values naturally and prices numerically", () => {
    expect(sortInventoryCatalog(rows, { field: "nameAr", direction: "asc" }).map((row) => row.nameAr)).toEqual(["ابره فانوس", "مضخة مياه"]);
    expect(sortInventoryCatalog(rows, { field: "oemNumber", direction: "asc" }).map((row) => row.oemNumber)).toEqual(["2-A", "10-A"]);
    expect(sortInventoryCatalog(rows, { field: "stockQuantity", direction: "desc" }).map((row) => row.id)).toEqual(["2", "1"]);
  });
});
