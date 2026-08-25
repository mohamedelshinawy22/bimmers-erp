import { describe, expect, it } from "vitest";
import { parseVoucherWorkbook } from "./voucher-excel-parser";

describe("voucher workbook parser", () => {
  it("accepts bilingual headers, Arabic currencies, and a common day-first date", () => {
    const rows = parseVoucherWorkbook([
      ["بافاريا AN"],
      ["نموذج استيراد سندات قبض"],
      ["تاريخ الإنشاء: 25/08/2026"],
      ["#", "التاريخ", "الحركة", "رقم السند", "المبلغ", "الحساب", "الخزينة"],
      [1, "٢٥/٠٨/٢٠٢٦", "قبض", "RCV-1", "١٬٢٥٠٫٥٠ ج.م", "عميل تجريبي", "درج النقدية"],
    ], "RECEIPT");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-08-25", amount: 1250.5, transactionReference: "RCV-1" });
  });
});
