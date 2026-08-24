import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeInvoiceImportDate } from "./invoice-excel-parser";

describe("invoice import resilience", () => {
  it("normalizes Excel serial dates and common Arabic report date strings", () => {
    expect(normalizeInvoiceImportDate(45528)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normalizeInvoiceImportDate("2026/08/24")).toBe("2026-08-24");
    expect(normalizeInvoiceImportDate("24-08-2026")).toBe("2026-08-24");
  });

  it("uses tenant-scoped bulk matching, serialized previews, and bounded execution batches", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/actions/invoice-import.actions.ts"), "utf8");
    expect(source).not.toContain('import { prisma } from "@/lib/prisma"');
    expect(source).toContain("const IMPORT_BATCH_SIZE = 25");
    expect(source).toContain("matchLines(tenant.prisma");
    expect(source).toContain("serializeData({ total: input.rows.length");
    expect(source).toContain("for (let batchStart = 0; batchStart < documentGroups.length; batchStart += IMPORT_BATCH_SIZE)");
    expect(source).toContain("partStatus: \"UNLINKED_TEXT_ITEM\"");
  });
});
