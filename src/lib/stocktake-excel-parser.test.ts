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
    expect(parsePhysicalCountMatrix([["اسم الصنف", "كمية"], ["صنف", 3]])).toMatchObject({ rows: [], headerRowIndex: null });
  });
});
