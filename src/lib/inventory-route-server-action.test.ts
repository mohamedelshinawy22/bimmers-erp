import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Inventory route server-action contract", () => {
  it("exports only async server actions from the stocktake module", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/actions/stocktake-reconciliation.actions.ts"), "utf8");
    const exports = source.match(/^export\s+(?!type\b)(.+)$/gm) ?? [];
    expect(exports).toHaveLength(2);
    expect(exports).toEqual(expect.arrayContaining([
      expect.stringContaining("export async function previewStocktakeReconciliationAction"),
      expect.stringContaining("export async function executeStocktakeReconciliationAction"),
    ]));
    expect(exports.every((line) => line.startsWith("export async function"))).toBe(true);
    expect(source).not.toContain("STOCKTAKE_CONFIRMATION_PHRASE");
  });
});
