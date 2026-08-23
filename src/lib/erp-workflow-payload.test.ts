import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { barcodePayloadValue } from "./barcode-payload";

describe("ERP export and barcode payloads", () => {
  it("serializes a tenant-safe Arabic BMW catalog worksheet", () => {
    const headers = ["رقم OEM", "اسم الصنف", "موديلات الشاسيه المتوافقة", "سعر التكلفة", "سعر البيع"];
    const sheet = XLSX.utils.json_to_sheet([{
      "رقم OEM": "51117111741/742",
      "اسم الصنف": "فانوس أمامي BMW",
      "موديلات الشاسيه المتوافقة": "E46، F30، G30",
      "سعر التكلفة": 1200.5,
      "سعر البيع": 1750,
    }], { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "المخزون");
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(output, { type: "buffer" });
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(restored.Sheets["المخزون"]!);
    expect(records).toEqual([expect.objectContaining({ "رقم OEM": "51117111741/742", "موديلات الشاسيه المتوافقة": "E46، F30، G30", "سعر البيع": 1750 })]);
  });

  it("keeps OEM strings printable through Code128 and creates valid EAN-13 payloads", () => {
    expect(barcodePayloadValue("BMW-F30-51117111741", "CODE128")).toBe("BMW-F30-51117111741");
    expect(barcodePayloadValue("51-117-111-741", "EAN13")).toBe("511171117410");
    expect(barcodePayloadValue("", "CODE128")).toBe("000000000000");
  });
});
