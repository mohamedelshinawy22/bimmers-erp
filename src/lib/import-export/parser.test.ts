import { describe, expect, it } from "vitest";
import { normalizeImportText, parseImportDate, parseImportNumber, resolveImportColumns, splitImportCodes } from "./parser";

describe("universal import/export parser", () => {
  it("normalizes Arabic numerals, currencies, separators, and sparse placeholders", () => {
    expect(parseImportNumber("١٢٬٣٤٥٫٦٠ ج.م")).toBe(12345.6);
    expect(parseImportNumber("EGP 1,250.75")).toBe(1250.75);
    expect(parseImportNumber("-")).toBeNull();
    expect(normalizeImportText(" — ")).toBe("");
  });

  it("resolves Excel serial, ISO, and day-first date values", () => {
    expect(parseImportDate(45123)?.toISOString().slice(0, 10)).toBe("2023-07-16");
    expect(parseImportDate("2026-08-25")?.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(parseImportDate("25/08/2026")?.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("maps bilingual headers and preserves slashed OEM/fitment code components", () => {
    expect(resolveImportColumns(["اسم الصنف", "OEM / Code", "سعر البيع", "Quantity"])).toMatchObject({ nameAr: 0, oemNumber: 1, price: 2, quantity: 3 });
    expect(splitImportCodes("51117111741/742, E46 | F30")).toEqual(["51117111741", "742", "E46", "F30"]);
  });
});
