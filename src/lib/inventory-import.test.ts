import { describe, expect, it } from "vitest";
import { parseSpreadsheetNumber, validateInventoryImportRow } from "./inventory-import";

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
});
