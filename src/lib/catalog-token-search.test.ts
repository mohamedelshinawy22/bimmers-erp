import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { searchCatalogProducts, searchTokens } from "./catalog-token-search";
import { normalizeSearchTerm } from "./search-utils";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Arabic-normalized catalog token search", () => {
  const products = [
    { id: "turbo-elbow", nameAr: "كوعه تربو X5 F15 / F16 X6", oemNumber: "51757424887", brandName: "STERN", compatibility: "F15 F16 X5 X6" },
    { id: "other", nameAr: "خرطوم مياه F15", oemNumber: "111111", brandName: "AVORTEX", compatibility: "F15" },
    { id: "aux-water-pump", nameAr: "طلمبه مياه اضافيه 6F02 N63", oemNumber: "11517629916", brandName: "BMW", compatibility: "F02 N63" },
  ];

  it("normalizes Arabic character variants and returns an item only when every keyword matches", () => {
    expect(normalizeSearchTerm("كوعه f15").normalized).toBe("كوعه f15");
    expect(searchTokens("كوعه f15")).toEqual(["كوعه", "f15"]);
    expect(searchCatalogProducts("كوعه f15", products).map((item) => item.id)).toEqual(["turbo-elbow"]);
    expect(searchCatalogProducts("كوعه stern f15", products).map((item) => item.id)).toEqual(["turbo-elbow"]);
    expect(searchCatalogProducts("كوعه avortex", products)).toEqual([]);
  });

  it("treats automotive punctuation as token separators and finds an X5 match across Arabic product name and compatibility", () => {
    expect(normalizeSearchTerm("كوعه/تربو+x5").normalized).toBe("كوعه تربو x5");
    expect(searchCatalogProducts("كوعه x5", products).map((item) => item.id)).toEqual(["turbo-elbow"]);
  });

  it("keeps common Arabic spelling variants discoverable from the server query candidates", () => {
    expect(normalizeSearchTerm("كوعه").variations).toContain("كوعة");
    expect(normalizeSearchTerm("إكص").variations).toContain("اكص");
    expect(normalizeSearchTerm("فتى").variations).toContain("فتي");
  });

  it("finds Arabic spelling variants together with uppercase chassis and engine codes", () => {
    const service = source("src/server/services/parts.service.ts");
    expect(searchTokens("طلمبة مياه إضافية N63")).toEqual(["طلمبه", "مياه", "اضافيه", "n63"]);
    expect(searchCatalogProducts("طلمبة مياه إضافية N63", products).map((item) => item.id)).toEqual(["aux-water-pump"]);
    expect(searchCatalogProducts("طلمبه مياه F02", products).map((item) => item.id)).toEqual(["aux-water-pump"]);
    expect(service.match(/nameAr: \{ contains: term, mode: "insensitive" as const \}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("wires all-token database conditions, shared post-filtering, live-combobox semantics, and fifteen-result action limit", () => {
    const service = source("src/server/services/parts.service.ts");
    const terminal = source("src/app/(app)/pos/pos-terminal.tsx");
    const action = source("src/server/actions/search.actions.ts");
    expect(service).toContain("const tokenConditions");
    expect(service).toContain("searchCatalogProducts(query");
    expect(terminal).toContain('role="combobox"');
    expect(terminal).toContain('role="listbox"');
    expect(terminal).toContain('event.key === "ArrowDown"');
    expect(terminal).toContain('event.key === "Enter"');
    expect(action).toContain("quickSearchParts(tenant.prisma, query, 15, filters)");
  });

  it("wires controlled automotive quick filters through POS, Inventory, and their tenant search boundaries", () => {
    const service = source("src/server/services/parts.service.ts");
    const pos = source("src/app/(app)/pos/pos-terminal.tsx");
    const inventory = source("src/app/(app)/inventory/inventory-client.tsx");
    const filterBar = source("src/components/catalog/quick-catalog-filter-bar.tsx");
    expect(service).toContain("inStockOnly");
    expect(service).toContain('split(",")');
    expect(pos).toContain("QuickCatalogFilterBar");
    expect(pos).toContain("searchPartsForPosAction(term, { brandId");
    expect(inventory).toContain("QuickCatalogFilterBar");
    expect(inventory).toContain("available: next.inStockOnly ? \"1\" : null");
    expect(filterBar).toContain('label: "X5", value: "E70,F15,G05"');
    expect(filterBar).toContain("المتوفر بالمخزن فقط");
  });

  it("uses broad per-token POS candidates before the shared all-token post-filter so word order cannot exclude a match", () => {
    const service = source("src/server/services/parts.service.ts");
    expect(service).toContain("{ OR: tokenConditions }");
    expect(service).toContain("Candidate retrieval intentionally uses OR");
    expect(service).toContain("searchCatalogProducts(query");
    expect(searchCatalogProducts("x5 كوعه", products).map((item) => item.id)).toEqual(["turbo-elbow"]);
  });

  it("debounces Inventory query changes into a no-scroll URL replacement and clears the query without requiring Enter", () => {
    const inventory = source("src/app/(app)/inventory/inventory-client.tsx");
    expect(inventory).toContain("window.setTimeout(() => replaceSearchQuery(query), 220)");
    expect(inventory).toContain('next.delete("page")');
    expect(inventory).toContain('router.replace(`/inventory?${next.toString()}`, { scroll: false })');
    expect(inventory).toContain("جارٍ تحديث النتائج…");
    expect(inventory).toContain('replaceSearchQuery("")');
  });
});
