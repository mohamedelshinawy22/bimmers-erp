export type LedgerFinancialReason =
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "SALE"
  | "SALE_RETURN"
  | "OPENING_BALANCE"
  | "MANUAL_ADJUSTMENT"
  | "STOCKTAKE"
  | string;

export type LedgerFinancialRow = {
  reason: LedgerFinancialReason;
  quantityDelta: number;
  purchaseUnitCost: number | null;
  totalCost: number | null;
  unitSalePrice: number | null;
  totalSalePrice: number | null;
};

const purchaseReasons = new Set<LedgerFinancialReason>(["PURCHASE", "PURCHASE_RETURN"]);
const saleReasons = new Set<LedgerFinancialReason>(["SALE", "SALE_RETURN"]);
const costBearingReasons = new Set<LedgerFinancialReason>(["PURCHASE", "PURCHASE_RETURN", "OPENING_BALANCE", "MANUAL_ADJUSTMENT", "STOCKTAKE"]);

function finite(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

/**
 * Assigns financial values to the side of the ledger they economically belong
 * to. A purchase invoice can carry an item sell price, but it must never be
 * shown or summed as a sale movement.
 */
export function mapStockLedgerFinancials(input: {
  reason: LedgerFinancialReason;
  quantityDelta: number;
  movementUnitCost: number | null | undefined;
  invoiceUnitCost?: number | null;
  invoiceUnitPrice?: number | null;
  invoiceTotalSalePrice?: number | null;
  fallbackPurchaseUnitCost?: number | null;
}): LedgerFinancialRow {
  const quantity = Math.abs(Number(input.quantityDelta) || 0);
  const isPurchase = purchaseReasons.has(input.reason);
  const isSale = saleReasons.has(input.reason);
  const movementCost = finite(input.movementUnitCost);
  const invoiceCost = finite(input.invoiceUnitCost);
  const invoiceUnitPrice = finite(input.invoiceUnitPrice);
  const fallbackPurchaseCost = finite(input.fallbackPurchaseUnitCost);
  const invoiceSaleTotal = finite(input.invoiceTotalSalePrice);
  const firstPositive = (...values: Array<number | null>) => values.find((value): value is number => value !== null && value > 0) ?? 0;
  const purchaseUnitCost = costBearingReasons.has(input.reason)
    ? isPurchase
      ? firstPositive(movementCost, invoiceCost, invoiceUnitPrice, fallbackPurchaseCost)
      : firstPositive(movementCost, fallbackPurchaseCost)
    : null;
  const totalCost = purchaseUnitCost === null ? null : purchaseUnitCost * quantity;
  const unitSalePrice = isSale ? invoiceUnitPrice : null;
  const totalSalePrice = unitSalePrice === null ? null : invoiceSaleTotal ?? unitSalePrice * quantity;
  return { reason: input.reason, quantityDelta: input.quantityDelta, purchaseUnitCost, totalCost, unitSalePrice, totalSalePrice };
}

/** Footer totals intentionally include only incoming purchases and outgoing sales. */
export function calculateStockLedgerTotals(rows: LedgerFinancialRow[]) {
  return rows.reduce(
    (sum, row) => ({
      inbound: sum.inbound + Math.max(0, row.quantityDelta),
      outbound: sum.outbound + Math.abs(Math.min(0, row.quantityDelta)),
      cost: sum.cost + (row.reason === "PURCHASE" && row.quantityDelta > 0 ? row.totalCost ?? 0 : 0),
      sales: sum.sales + (row.reason === "SALE" && row.quantityDelta < 0 ? row.totalSalePrice ?? 0 : 0),
    }),
    { inbound: 0, outbound: 0, cost: 0, sales: 0 },
  );
}
