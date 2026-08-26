import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasSameCatalogIdentity, normalizeCatalogName } from "./catalog-identity";

describe("multi-brand catalog identity", () => {
  it("treats OEM, brand scope, and normalized name as the import duplicate boundary", () => {
    expect(normalizeCatalogName("  فانوس   أمامي ")).toBe(normalizeCatalogName("فانوس امامي"));
    expect(hasSameCatalogIdentity({ oemNumber: "51757424887", nameAr: "فانوس أمامي" }, { oemNumber: "51757424887", nameAr: "فانوس امامي" })).toBe(true);
    expect(hasSameCatalogIdentity({ oemNumber: "51757424887", nameAr: "فانوس أمامي" }, { oemNumber: "51757424887", nameAr: "فانوس خلفي" })).toBe(false);
  });

  it("replaces the older OEM-brand unique constraint with the OEM-brand-name composite index across imports and product actions", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260826142500_multi_brand_catalog_identity/migration.sql"), "utf8");
    const chunkImport = readFileSync(resolve(process.cwd(), "src/server/services/catalog-import-api.service.ts"), "utf8");
    const legacyImport = readFileSync(resolve(process.cwd(), "src/server/actions/import.actions.ts"), "utf8");
    const partActions = readFileSync(resolve(process.cwd(), "src/server/actions/parts.actions.ts"), "utf8");
    expect(schema).toContain('@@unique([oemNumber, brandId, nameAr], map: "PartItem_oemNumber_brandId_nameAr_key")');
    expect(migration).toContain('DROP INDEX IF EXISTS "PartItem_oemNumber_brandId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "PartItem_oemNumber_brandId_nameAr_key"');
    for (const source of [chunkImport, legacyImport, partActions]) expect(source).toContain("hasSameCatalogIdentity");
    for (const source of [chunkImport, legacyImport]) expect(source).toContain("ensureCatalogCompositeIdentity");
  });
});
