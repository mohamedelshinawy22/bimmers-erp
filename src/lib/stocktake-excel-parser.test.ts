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
      { sourceRowNumber: 4, oemNumber: "51-11-7-111-741", nameAr: "غطاء صدام", brand: "", category: "", actualQuantity: 12 },
      { sourceRowNumber: 5, oemNumber: "51-11-7-111-742", nameAr: "شبكة أمامية", brand: "", category: "", actualQuantity: 3 },
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

  it("never treats serial or item-code columns as product names when a description column exists", () => {
    const parsed = parsePhysicalCountMatrix([
      ["م", "كود الصنف", "اسم الصنف", "الرصيد"],
      [2, "BMW-002", "غطاء مصباح أمامي", 6],
      [3, "BMW-003", "شبكة صدام", 1],
    ]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({ oemNumber: "BMW-002", nameAr: "غطاء مصباح أمامي", actualQuantity: 6 }),
      expect.objectContaining({ oemNumber: "BMW-003", nameAr: "شبكة صدام", actualQuantity: 1 }),
    ]);
  });

  it("carries optional brand and category columns alongside name-only stocktake rows", () => {
    const parsed = parsePhysicalCountMatrix([
      ["اسم الصنف", "الماركة", "التصنيف", "الرصيد"],
      ["فلتر زيت", "عام", "زيوت", 8],
    ]);
    expect(parsed.rows).toEqual([expect.objectContaining({ nameAr: "فلتر زيت", brand: "عام", category: "زيوت", actualQuantity: 8 })]);
  });

  it("recognizes company and manufacturer aliases as the brand context for composite matching", () => {
    const byCompany = parsePhysicalCountMatrix([["OEM", "اسم الصنف", "الشركة", "الرصيد"], ["51757424887", "فانوس أمامي", "STERN", 3]]);
    const byManufacturer = parsePhysicalCountMatrix([["OEM", "اسم الصنف", "Manufacturer", "الرصيد"], ["51757424887", "فانوس أمامي", "AVORTEX", 4]]);
    expect(byCompany.rows).toEqual([expect.objectContaining({ brand: "STERN", actualQuantity: 3 })]);
    expect(byManufacturer.rows).toEqual([expect.objectContaining({ brand: "AVORTEX", actualQuantity: 4 })]);
  });
});
