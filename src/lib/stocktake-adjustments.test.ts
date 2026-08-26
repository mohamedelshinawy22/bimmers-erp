import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidateStocktakeAdjustments } from "./stocktake-adjustments";

describe("stocktake duplicate-row consolidation", () => {
  it("sums physical counts for duplicate product rows while preserving all source lines", () => {
    expect(consolidateStocktakeAdjustments([
      { partId: "1f52ac6f-098c-4609-85d2-025f797a7089", sourceRowNumber: 132, actualQuantity: 3 },
      { partId: "1f52ac6f-098c-4609-85d2-025f797a7089", sourceRowNumber: 231, actualQuantity: 7 },
      { partId: "13ca11b6-d0c3-4cda-b176-9b642501317b", sourceRowNumber: 235, actualQuantity: 2 },
    ])).toEqual([
      { partId: "1f52ac6f-098c-4609-85d2-025f797a7089", sourceRowNumber: 132, sourceRowNumbers: [132, 231], actualQuantity: 10 },
      { partId: "13ca11b6-d0c3-4cda-b176-9b642501317b", sourceRowNumber: 235, sourceRowNumbers: [235], actualQuantity: 2 },
    ]);
  });

  it("consolidates before the tenant transaction and records every contributing row in the stocktake audit trail", () => {
    const action = readFileSync(resolve(process.cwd(), "src/server/actions/stocktake-reconciliation.actions.ts"), "utf8");
    const modal = readFileSync(resolve(process.cwd(), "src/components/inventory/stocktake-reconciliation-modal.tsx"), "utf8");
    expect(action).toContain("const adjustments = consolidateStocktakeAdjustments(input.adjustments)");
    expect(action).not.toContain("يتكرر صنف واحد في دفعة الجرد");
    expect(action).toContain("sourceRowNumbers: row.sourceRowNumbers");
    expect(action).toContain("الصفوف ${sourceRows}");
    expect(modal).toContain("consolidateStocktakeAdjustments(matchedAdjustments)");
    expect(modal).toContain("sourceRowNumbers: row.sourceRowNumbers");
    expect(modal).toContain("تم تجميع {formatInt(aggregatedDuplicateRows)} صف مكرر");
  });
});
