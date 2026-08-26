import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Inventory route server-action contract", () => {
  it("exports only async server actions from the stocktake module", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/actions/stocktake-reconciliation.actions.ts"), "utf8");
    const exports = source.match(/^export\s+(?!type\b)(.+)$/gm) ?? [];
    expect(exports).toEqual([
      "export async function previewStocktakeReconciliationAction(raw: unknown): Promise<ActionResult<{ rows: PreviewRow[]; matched: number; unmatched: number; ambiguous: number; invalid: number }>> {",
      "export async function executeStocktakeReconciliationAction(raw: unknown): Promise<ActionResult<{ adjusted: number; unchanged: number; batchDelta: number }>> {",
    ]);
    expect(source).not.toContain("STOCKTAKE_CONFIRMATION_PHRASE");
  });
});
