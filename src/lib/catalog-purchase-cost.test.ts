import { describe, expect, it } from "vitest";
import { resolveCatalogPurchaseCost } from "./catalog-purchase-cost";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("catalog purchase-cost synchronization", () => {
  it("retains a stored weighted average before consulting historical purchases", () => {
    expect(resolveCatalogPurchaseCost(650, 800, 800)).toBe(650);
  });

  it("falls back from a legacy zero average to latest purchase cost, then purchase unit price", () => {
    expect(resolveCatalogPurchaseCost(0, 800, 0)).toBe(800);
    expect(resolveCatalogPurchaseCost(0, 0, 800)).toBe(800);
    expect(resolveCatalogPurchaseCost(0, 0, 0)).toBe(0);
  });

  it("uses the latest valid purchase invoice as a read-only catalog fallback", () => {
    const partsService = source("src/server/services/parts.service.ts");
    expect(partsService).toContain('where: { invoice: { type: "PURCHASE", isVoided: false } }');
    expect(partsService).toContain('orderBy: { invoice: { createdAt: "desc" } }');
    expect(partsService).toContain("resolveCatalogPurchaseCost(");
  });

  it("runs purchase create and edit engines inside the authenticated tenant boundary", () => {
    const actions = source("src/server/actions/invoice.actions.ts");
    expect(actions.match(/tenant\.run\(\(\) => createPurchaseInvoice\(/g)?.length).toBe(1);
    expect(actions.match(/tenant\.run\(\(\) => updatePurchaseInvoice\(/g)?.length).toBe(1);
  });
});
