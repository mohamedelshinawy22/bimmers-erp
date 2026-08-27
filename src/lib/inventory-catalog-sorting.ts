import type { PartRow } from "@/server/services/parts.service";

export type InventoryCatalogSortField = "oemNumber" | "nameAr" | "brandName" | "buyPriceAvg" | "sellPriceRetail" | "sellPriceWholesale" | "sellPriceMin" | "stockQuantity";
export type InventoryCatalogSortDirection = "asc" | "desc" | null;

export interface InventoryCatalogSort {
  field: InventoryCatalogSortField | null;
  direction: InventoryCatalogSortDirection;
}

const numericFields = new Set<InventoryCatalogSortField>(["buyPriceAvg", "sellPriceRetail", "sellPriceWholesale", "sellPriceMin", "stockQuantity"]);
const arabicNaturalCollator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

/** Advances default → ascending → descending → default for one table column. */
export function toggleInventoryCatalogSort(current: InventoryCatalogSort, field: InventoryCatalogSortField): InventoryCatalogSort {
  if (current.field !== field) return { field, direction: "asc" };
  if (current.direction === "asc") return { field, direction: "desc" };
  return { field: null, direction: null };
}

/** Returns a copied array so sorting never mutates the canonical filtered catalog. */
export function sortInventoryCatalog(rows: PartRow[], sort: InventoryCatalogSort): PartRow[] {
  if (!sort.field || !sort.direction) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const field = sort.field!;
    if (numericFields.has(field)) return (Number(left[field]) - Number(right[field])) * factor;
    return arabicNaturalCollator.compare(String(left[field] ?? "").trim(), String(right[field] ?? "").trim()) * factor;
  });
}
