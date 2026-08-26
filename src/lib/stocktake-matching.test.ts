import { describe, expect, it } from "vitest";
import { matchStocktakeProduct, type StocktakeMatchCandidate } from "./stocktake-matching";

const catalog: StocktakeMatchCandidate[] = [
  { id: "stern-front", oemNumber: "51757424887", nameAr: "فانوس أمامي", brandName: "STERN", category: "إضاءة" },
  { id: "avortex-front", oemNumber: "51757424887", nameAr: "فانوس أمامي", brandName: "AVORTEX", category: "إضاءة" },
  { id: "frey-rear", oemNumber: "51757424887", nameAr: "فانوس خلفي", brandName: "frey", category: "إضاءة" },
  { id: "bjorati-name", oemNumber: "63117202573", nameAr: "كشاف ضباب", brandName: "بجوراتي", category: "إضاءة" },
];

describe("multi-tier stocktake matching", () => {
  it("prefers exact OEM plus brand over shared OEM variants", () => {
    expect(matchStocktakeProduct({ oemNumber: "51757424887", nameAr: "فانوس أمامي", brand: "AVORTEX" }, catalog)).toMatchObject({ part: { id: "avortex-front" }, matchedBy: "OEM_BRAND", ambiguous: false });
  });

  it("uses OEM plus normalized name before refusing an ambiguous OEM-only row", () => {
    expect(matchStocktakeProduct({ oemNumber: "51757424887", nameAr: "فانوس خلفي", brand: "" }, catalog)).toMatchObject({ part: { id: "frey-rear" }, matchedBy: "OEM_NAME", ambiguous: false });
    expect(matchStocktakeProduct({ oemNumber: "51757424887", nameAr: "", brand: "" }, catalog)).toEqual({ part: null, matchedBy: null, ambiguous: true });
  });

  it("uses name plus brand before the unique-name fallback", () => {
    expect(matchStocktakeProduct({ oemNumber: "", nameAr: "كشاف ضباب", brand: "بجوراتي" }, catalog)).toMatchObject({ part: { id: "bjorati-name" }, matchedBy: "NAME_BRAND", ambiguous: false });
    expect(matchStocktakeProduct({ oemNumber: "", nameAr: "كشاف ضباب", brand: "" }, catalog)).toMatchObject({ part: { id: "bjorati-name" }, matchedBy: "NAME", ambiguous: false });
  });

  it("retains safe name-plus-category matching when a workbook omits brand", () => {
    const variants = [...catalog,
      { id: "brake-name", oemNumber: "34116859066", nameAr: "كشاف ضباب", brandName: "MTOUR", category: "فرامل" },
    ];
    expect(matchStocktakeProduct({ oemNumber: "", nameAr: "كشاف ضباب", brand: "", category: "إضاءة" }, variants)).toMatchObject({ part: { id: "bjorati-name" }, matchedBy: "NAME_CATEGORY", ambiguous: false });
  });
});
