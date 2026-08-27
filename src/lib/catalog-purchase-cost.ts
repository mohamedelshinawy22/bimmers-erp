/**
 * Preserves the stored weighted average whenever it exists. Historical invoice
 * values are read-only fallbacks for legacy parts that predate cost syncing.
 */
export function resolveCatalogPurchaseCost(
  storedAverageCost: number,
  latestPurchaseUnitCost: number | null | undefined,
  latestPurchaseUnitPrice: number | null | undefined,
): number {
  if (storedAverageCost > 0) return storedAverageCost;
  if ((latestPurchaseUnitCost ?? 0) > 0) return Number(latestPurchaseUnitCost);
  if ((latestPurchaseUnitPrice ?? 0) > 0) return Number(latestPurchaseUnitPrice);
  return 0;
}
