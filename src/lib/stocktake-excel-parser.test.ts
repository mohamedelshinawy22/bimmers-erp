import { describe, expect, it } from "vitest";
import { parsePhysicalCountMatrix } from "./stocktake-excel-parser";

describe("physical stock count Excel parser", () => {
  it("finds a non-leading Arabic header, ignores the serial column, and parses physical quantities", () => {
    const parsed = parsePhysicalCountMatrix([
      ["شركة اختبار"],
      ["تقرير جرد"],
      ["م", "رقم القطعة / OEM", "اسم الصنف", "الكمية الفعلية"],
      [1, "51-11-7-111-741", "غطاء صدام", "١٢"],
      [2, "51-11-7-111-742", "شبكة أمامية", "3"],
      ["الإجمالي", "", "", 15],
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.headerRowIndex).toBe(2);
    expect(parsed.rows).toEqual([
      { sourceRowNumber: 4, oemNumber: "51-11-7-111-741", nameAr: "غطاء صدام", actualQuantity: 12 },
      { sourceRowNumber: 5, oemNumber: "51-11-7-111-742", nameAr: "شبكة أمامية", actualQuantity: 3 },
    ]);
  });

  it("requires a physical quantity header with either OEM or product name in the first five rows", () => {
    expect(parsePhysicalCountMatrix([["م", "كمية"], [1, 3]])).toMatchObject({ rows: [], headerRowIndex: null });
  });

  it("accepts flexible catalog headings such as balance, OEM, barcode, item, and description", () => {
    const byBalance = parsePhysicalCountMatrix([["رقم OEM", "الصنف", "الرصيد"], ["11-22", "صنف رصيد", "7"]]);
    expect(byBalance.rows).toEqual([expect.objectContaining({ oemNumber: "11-22", nameAr: "صنف رصيد", actualQuantity: 7 })]);

    const byBarcode = parsePhysicalCountMatrix([["الباركود", "الوصف", "المخزون"], ["998877", "صنف باركود", 4]]);
    expect(byBarcode.rows).toEqual([expect.objectContaining({ oemNumber: "998877", nameAr: "صنف باركود", actualQuantity: 4 })]);
  });
});
