import { describe, expect, it } from "vitest";
import { parseSpreadsheetNumber, validateInventoryImportRow } from "./inventory-import";
import { isSupportedOem, sanitizeAndNormalizeOem } from "./utils";
import { oemNumber } from "./validations/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("inventory spreadsheet parsing", () => {
  it("normalizes Arabic digits, Arabic separators, and currency labels", () => {
    expect(parseSpreadsheetNumber("١٬٢٥٠٫٥٠ ج.م")).toBe(1250.5);
    expect(parseSpreadsheetNumber("۲,۵۰۰.۰۰")).toBe(2500);
    expect(parseSpreadsheetNumber("1,250.50")).toBe(1250.5);
  });

  it("rejects blank and malformed values instead of importing zero", () => {
    expect(parseSpreadsheetNumber("")).toBeNull();
    expect(parseSpreadsheetNumber("غير متاح")).toBeNull();
  });

  it("accepts a BMW OEM/chassis-ready row and validates safe financial quantities", () => {
    expect(validateInventoryImportRow({
      nameAr: "فانوس أمامي BMW F30",
      oemNumber: "51117111741/742",
      barcode: "BMW-F30-001",
      chassis: "F30,G20",
      cost: "١٬٢٠٠٫٥٠",
      price: "1,750.00",
      quantity: "5",
    })).toEqual([]);
    expect(validateInventoryImportRow({ nameAr: "", oemNumber: "", cost: "-1", price: "x", quantity: "1.5" }).map((issue) => issue.field)).toEqual(["nameAr", "oemNumber", "cost", "price", "quantity"]);
  });

  it("normalizes Excel float-style OEM values without changing meaningful decimal-bearing part codes", () => {
    expect(sanitizeAndNormalizeOem("14733.00")).toBe("14733");
    expect(sanitizeAndNormalizeOem("١٤٧٣٣٫٠٠")).toBe("14733");
    expect(sanitizeAndNormalizeOem("13.0460-7238.2")).toBe("13.0460-7238.2");
    expect(sanitizeAndNormalizeOem(" 51117111741/742\u200B ")).toBe("51117111741/742");
    expect(oemNumber.parse("14733.00")).toBe("14733");
  });

  it("accepts common automotive OEM punctuation and rejects unsupported symbols before dispatch", () => {
    for (const oem of ["13.0460-7238.2", "51117111741/742", "A_B+C#1:2,3 (LH)", "14733.00"]) {
      expect(isSupportedOem(sanitizeAndNormalizeOem(oem))).toBe(true);
      expect(validateInventoryImportRow({ nameAr: "قطعة اختبار", oemNumber: oem, cost: 0, price: 0, quantity: 0 })).toEqual([]);
    }
    expect(isSupportedOem("ABC@123")).toBe(false);
    expect(validateInventoryImportRow({ nameAr: "قطعة اختبار", oemNumber: "ABC@123", cost: 0, price: 0, quantity: 0 })).toContainEqual({ field: "oemNumber", message: "كود OEM يحتوي على رموز غير مدعومة." });
  });

  it("exposes every invalid-row reason and CSV report from the confirmation step", () => {
    const modal = readFileSync(resolve(process.cwd(), "src/components/inventory/excel-import-modal.tsx"), "utf8");
    expect(modal).toContain("<details");
    expect(modal).toContain("عرض تفاصيل {excludedReportRows.length} صف مستبعد");
    expect(modal).toContain("رقم الصف في الإكسيل");
    expect(modal).toContain("كود OEM / الصنف");
    expect(modal).toContain("سبب الاستبعاد");
    expect(modal).toContain("تحميل تقرير الصفوف غير الصالحة CSV");
    expect(modal).toContain("inventory-import-invalid-rows.csv");
    expect(modal).toContain("issues.map((issue) => issue.message).join");
  });

  it("consolidates client validation failures with server batch exclusions in one post-execution report", () => {
    const modal = readFileSync(resolve(process.cwd(), "src/components/inventory/excel-import-modal.tsx"), "utf8");
    const service = readFileSync(resolve(process.cwd(), "src/server/services/catalog-import-api.service.ts"), "utf8");
    expect(service).toContain("failedRows: Array<{ sourceRowNumber: number; error: string }>");
    expect(service).toContain("failedRows.push({ sourceRowNumber: row.sourceRowNumber, error: errorText(error) })");
    expect(modal).toContain("failedRows?: Array<{ sourceRowNumber: number; error: string }>");
    expect(modal).toContain("[serverExcludedRows, setServerExcludedRows]");
    expect(modal).toContain("const excludedReportRows");
    expect(modal).toContain("for (const failed of result.data.failedRows ?? [])");
    expect(modal).toContain("setServerExcludedRows(serverFailures)");
    expect(modal).toContain("new Set([...invalidRows.map");
    expect(modal).toContain("eligibleChecks = skipInvalidRows");
  });
});
