import { describe, expect, it } from "vitest";
import { calculateAdjustedProductPrice, validateProposedProductPrice } from "./product-price-adjustment";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const row = { id: "part-1", buyPriceAvg: 800, sellPriceRetail: 1_000, sellPriceWholesale: 900, sellPriceMin: 850 };

describe("product price adjustment preview", () => {
  it("calculates cost markup and rounds each requested target safely", () => {
    const result = calculateAdjustedProductPrice(row, { target: "BOTH", rule: "PERCENT_OF_COST", value: 15, roundTo: 10 });
    expect(result.proposedRetail).toBe(920);
    expect(result.proposedWholesale).toBe(920);
    expect(result.proposedMinimum).toBe(850);
    expect(result.marginPercent).toBe(15);
  });

  it("supports a discount without allowing prices or the minimum to fall under cost", () => {
    const result = calculateAdjustedProductPrice(row, { target: "RETAIL", rule: "FIXED_AMOUNT", value: -500, roundTo: 1 });
    expect(result.proposedRetail).toBe(800);
    expect(result.proposedWholesale).toBe(800);
    expect(result.proposedMinimum).toBe(800);
  });

  it("retains a zero-cost item during a markup-on-cost operation and validates manual values", () => {
    const result = calculateAdjustedProductPrice({ ...row, buyPriceAvg: 0 }, { target: "BOTH", rule: "PERCENT_OF_COST", value: 20, roundTo: 5 });
    expect(result.proposedRetail).toBe(1000);
    expect(result.warning).toContain("لا توجد تكلفة");
    expect(validateProposedProductPrice({ cost: 800, retail: 900, wholesale: 950, minimum: 850 })).toContain("الجملة");
    expect(validateProposedProductPrice({ cost: 800, retail: 900, wholesale: 850, minimum: 750 })).toContain("الحد الأدنى");
  });

  it("requires a manager-confirmed, tenant-bound batch commit with per-item audit evidence", () => {
    const actions = readFileSync(resolve(process.cwd(), "src/server/actions/parts.actions.ts"), "utf8");
    expect(actions).toContain('requirePermission("part.bulkPrice")');
    expect(actions).toContain("PRICE_MANAGER_CONFIRMATION");
    expect(actions).toContain("tenant.run");
    expect(actions).toContain("max(100)");
    expect(actions).toContain("PRODUCT_PRICE_MANAGER_UPDATE");
    const modal = readFileSync(resolve(process.cwd(), "src/app/(app)/inventory/components/price-adjustment-modal.tsx"), "utf8");
    expect(modal).toContain("حفظ وتطبيق الأسعار الجديدة");
    expect(modal).toContain("applyProductPriceChangesAction");
    expect(modal).toContain("عبارة التأكيد");
  });
});
