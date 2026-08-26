import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateStockLedgerTotals, mapStockLedgerFinancials } from "./stock-ledger-financials";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("stock ledger financial attribution", () => {
  it("places a purchase line's cost solely in purchase-cost columns even when its invoice has a retail price", () => {
    const purchase = mapStockLedgerFinancials({
      reason: "PURCHASE",
      quantityDelta: 1,
      movementUnitCost: 2800,
      invoiceUnitCost: 2800,
      invoiceUnitPrice: 7000,
      invoiceTotalSalePrice: 7000,
    });
    expect(purchase.purchaseUnitCost).toBe(2800);
    expect(purchase.totalCost).toBe(2800);
    expect(purchase.unitSalePrice).toBeNull();
    expect(purchase.totalSalePrice).toBeNull();
  });

  it("places a sale line's price solely in sale columns and preserves the requested independent footer totals", () => {
    const purchase = mapStockLedgerFinancials({ reason: "PURCHASE", quantityDelta: 1, movementUnitCost: 2800, invoiceUnitCost: 2800, invoiceUnitPrice: 7000, invoiceTotalSalePrice: 7000 });
    const sale = mapStockLedgerFinancials({ reason: "SALE", quantityDelta: -1, movementUnitCost: 2800, invoiceUnitCost: 2800, invoiceUnitPrice: 4200, invoiceTotalSalePrice: 4200 });
    const stocktake = mapStockLedgerFinancials({ reason: "STOCKTAKE", quantityDelta: 1, movementUnitCost: 2800 });
    expect(sale.purchaseUnitCost).toBeNull();
    expect(sale.totalCost).toBeNull();
    expect(sale.unitSalePrice).toBe(4200);
    expect(sale.totalSalePrice).toBe(4200);
    expect(calculateStockLedgerTotals([purchase, sale, stocktake])).toEqual({ inbound: 2, outbound: 1, cost: 2800, sales: 4200 });
  });

  it("falls back from a zero-valued legacy movement to the invoice item unit price before the product purchase cost", () => {
    const legacyPurchase = mapStockLedgerFinancials({
      reason: "PURCHASE",
      quantityDelta: 1,
      movementUnitCost: 0,
      invoiceUnitCost: 0,
      invoiceUnitPrice: 2800,
      fallbackPurchaseUnitCost: 2400,
    });
    expect(legacyPurchase.purchaseUnitCost).toBe(2800);
    expect(legacyPurchase.totalCost).toBe(2800);
    expect(legacyPurchase.unitSalePrice).toBeNull();
  });

  it("uses the shared mapper in the tenant service and designated financial values in the visible table, CSV, and footer", () => {
    const service = source("src/server/services/parts.service.ts");
    const client = source("src/app/(app)/inventory/part-ledger/[id]/part-ledger-client.tsx");
    expect(service).toContain("mapStockLedgerFinancials({");
    expect(service).toContain("purchaseUnitCost: financials.purchaseUnitCost");
    expect(client).toContain("calculateStockLedgerTotals(filtered)");
    expect(client).toContain("row.purchaseUnitCost !== null");
    expect(client).toContain("row.totalCost !== null");
    expect(client).toContain("String(row.totalCost ?? \"\")");
  });
});
