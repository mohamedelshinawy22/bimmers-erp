import { normalizeSearchTerm } from "./search-utils";

export type CatalogSearchCandidate = {
  id: string;
  nameAr: string;
  nameEn?: string | null;
  oemNumber?: string | null;
  barcode?: string | null;
  brandName?: string | null;
  compatibility?: string | null;
};

export function searchTokens(query: string): string[] {
  return normalizeSearchTerm(query).normalized.split(" ").filter(Boolean);
}

/**
 * Applies the same Arabic normalization to every searchable field and requires
 * every word entered by the cashier to occur somewhere in the catalog item.
 */
export function searchCatalogProducts<T extends CatalogSearchCandidate>(query: string, products: T[], limit = 15): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  return products
    .filter((product) => {
      const target = normalizeSearchTerm([
        product.nameAr,
        product.nameEn ?? "",
        product.oemNumber ?? "",
        product.barcode ?? "",
        product.brandName ?? "",
        product.compatibility ?? "",
      ].join(" ")).normalized;
      return tokens.every((token) => target.includes(token));
    })
    .slice(0, limit);
}
