import type { PrismaClient } from "@prisma/client";

const upgradeRuns = new WeakMap<PrismaClient, Promise<void>>();

/**
 * Existing isolated tenant databases may still have the older `(OEM, brand)`
 * unique index. Upgrade it lazily only when a catalog write is requested, so
 * old and newly provisioned tenants share the same safe variant identity.
 */
export function ensureCatalogCompositeIdentity(db: PrismaClient): Promise<void> {
  const existing = upgradeRuns.get(db);
  if (existing) return existing;
  const run = (async () => {
    await db.$executeRawUnsafe('DROP INDEX IF EXISTS "PartItem_oemNumber_brandId_key"');
    await db.$executeRawUnsafe('DROP INDEX IF EXISTS "PartItem_oemNumber_key"');
    await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "PartItem_oemNumber_brandId_nameAr_key" ON "PartItem"("oemNumber", "brandId", "nameAr")');
  })();
  upgradeRuns.set(db, run);
  return run.catch((error) => {
    upgradeRuns.delete(db);
    throw error;
  });
}
