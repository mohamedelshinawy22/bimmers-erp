import { searchCatalogProducts } from "./catalog-token-search";

export type InventoryCatalogFilterRow = {
  id: string;
  nameAr: string;
  nameEn: string | null;
  oemNumber: string;
  barcode: string | null;
  brandId: string;
  brandName: string;
  category: string;
  chassisCodes: string[];
  engineCodes: string[];
  stockQuantity: number;
  minReorderLevel: number;
};

export type InventoryCatalogFilters = {
  query: string;
  chassis: string;
  category: string;
  brandId: string;
  inStockOnly: boolean;
  lowStock: boolean;
};

/**
 * Inventory receives the full tenant catalog once, then applies the same Arabic
 * token matching and filter semantics in memory without more round trips.
 */
export function filterInventoryCatalog<T extends InventoryCatalogFilterRow>(
  rows: T[],
  filters: InventoryCatalogFilters,
): T[] {
  const chassisCodes = filters.chassis.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
  const filtered = rows.filter((row) => {
    if (filters.category && row.category !== filters.category) return false;
    if (filters.brandId && row.brandId !== filters.brandId) return false;
    if (filters.inStockOnly && row.stockQuantity <= 0) return false;
    if (filters.lowStock && row.stockQuantity > row.minReorderLevel) return false;
    if (chassisCodes.length && !chassisCodes.some((code) => row.chassisCodes.includes(code))) return false;
    return true;
  });
  if (!filters.query.trim()) return filtered;

  const matchedIds = new Set(searchCatalogProducts(
    filters.query,
    filtered.map((row) => ({
      ...row,
      compatibility: [...row.chassisCodes, ...row.engineCodes].join(" "),
    })),
    filtered.length,
  ).map((row) => row.id));
  return filtered.filter((row) => matchedIds.has(row.id));
}
