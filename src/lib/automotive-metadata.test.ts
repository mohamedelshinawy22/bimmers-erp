import { describe, expect, it } from "vitest";
import { enrichAutomotiveMetadata, mergeAutomotiveCodes, parseAutomotiveMetadata } from "./automotive-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("automotive metadata parser", () => {
  it("extracts the requested chassis, engine, and brand independent of casing and delimiters", () => {
    expect(parseAutomotiveMetadata("ابره فانوس n13/f30 avortex")).toEqual({ chassis: ["F30"], engines: ["N13"], brand: "AVORTEX" });
  });

  it("merges inferred codes without discarding manually selected fitment or overwriting a specific brand", () => {
    expect(enrichAutomotiveMetadata({ nameAr: "طرمبة N63 F02 BOSCH", brandName: "FEBI", chassisCodes: ["F30"], engineCodes: [] })).toMatchObject({ brandName: "FEBI", chassisCodes: ["F30", "F02"], engineCodes: ["N63"] });
    expect(enrichAutomotiveMetadata({ nameAr: "ابره فانوس N13 F30 AVORTEX", brandName: "عام", chassisCodes: [], engineCodes: [] })).toMatchObject({ brandName: "AVORTEX", chassisCodes: ["F30"], engineCodes: ["N13"] });
    expect(mergeAutomotiveCodes(["f30", "F30"], ["F02"])).toEqual(["F30", "F02"]);
  });

  it("wires create, edit, both import paths, and bulk tagging through the shared parser with confirmation and audit metadata", () => {
    const actions = source("src/server/actions/parts.actions.ts");
    expect(actions).toContain("enrichAutomotiveMetadata");
    expect(actions).toContain("BULK_AUTOMOTIVE_TAG_CONFIRMATION");
    expect(actions).toContain('requirePermission("part.bulkAutoTag")');
    expect(actions).toContain("AUTOMOTIVE_METADATA_BULK_TAG");
    expect(source("src/server/actions/import.actions.ts")).toContain("parseAutomotiveMetadata");
    expect(source("src/server/services/catalog-import-api.service.ts")).toContain("parseAutomotiveMetadata");
    const modal = source("src/app/(app)/inventory/components/add-part-modal.tsx");
    expect(modal).toContain("applyAutomotiveMetadata");
    expect(modal).toContain("استخراج تلقائي ذكي");
    const inventory = source("src/app/(app)/inventory/inventory-client.tsx");
    expect(inventory).toContain("تحديث وسوم السيارات تلقائياً");
    expect(inventory).toContain("bulkAutoTagPartsAction");
  });
});
