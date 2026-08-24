import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src/app/(app)");
const page = (path: string) => resolve(root, path, "page.tsx");

describe("sidebar route boundaries", () => {
  it("provides stable alias pages for all requested sidebar-compatible paths", () => {
    for (const route of ["catalog", "returns", "cash", "receipts", "reports", "dead-stock", "audit-log", "barcode"]) expect(existsSync(page(route))).toBe(true);
  });

  it("keeps inventory movement and barcode guards from redirecting users back to the dashboard", () => {
    const inventoryMovement = readFileSync(page("reports/inventory-movement"), "utf8");
    const barcode = readFileSync(page("settings/barcode"), "utf8");
    expect(inventoryMovement).not.toContain('redirect("/")');
    expect(barcode).not.toContain('redirect("/settings")');
  });

  it("keeps the Daily Movement action tenant-bound, serialized, and fallback-safe", () => {
    const action = readFileSync(resolve(process.cwd(), "src/server/actions/reports.actions.ts"), "utf8");
    expect(action).toContain("tenant.prisma.invoice.findMany");
    expect(action).toContain("serializeData(emptyDailyMovementReport(input))");
  });
});
