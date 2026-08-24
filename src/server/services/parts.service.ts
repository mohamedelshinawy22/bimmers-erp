import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { money, num, sanitizeOemForSearch } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";
import { searchPartsSchema, type SearchPartsInput } from "@/lib/validations/parts";

/** Plain-JSON shape safe to hand to client components (no Decimal instances). */
export interface PartRow {
  id: string;
  oemNumber: string;
  partNumberFormatted: string | null;
  nameAr: string;
  nameEn: string | null;
  brandId: string;
  brandName: string;
  isOem: boolean;
  brandPartNumber: string | null;
  barcode: string | null;
  category: string;
  sidePosition: string | null;
  binLocationId: string | null;
  binCode: string | null;
  buyPriceAvg: number;
  sellPriceRetail: number;
  sellPriceWholesale: number;
  sellPriceMin: number;
  stockQuantity: number;
  stockReserved: number;
  minReorderLevel: number;
  isActive: boolean;
  /** Relation IDs — required so the edit form can round-trip the fitment matrix. */
  chassisIds: string[];
  engineIds: string[];
  chassisCodes: string[];
  engineCodes: string[];
  duplicateOemCount: number;
  duplicateNameCount: number;
  duplicateBrands: string[];
}

const partInclude = {
  brand: { select: { name: true, isOem: true } },
  binLocation: { select: { fullCode: true } },
  compatibleChassis: { select: { chassisId: true, chassis: { select: { code: true } } } },
  compatibleEngines: { select: { engineId: true, engine: { select: { code: true } } } },
} satisfies Prisma.PartItemInclude;

type PartWithRelations = Prisma.PartItemGetPayload<{ include: typeof partInclude }>;
type PartsDb = PrismaClient;

type DuplicateMetadata = {
  oemCounts: Map<string, number>;
  nameCounts: Map<string, number>;
  brandsByOem: Map<string, string[]>;
};

async function getDuplicateMetadata(db: PartsDb, parts: Array<{ oemNumber: string; nameAr: string }>): Promise<DuplicateMetadata> {
  const oems = [...new Set(parts.map((part) => part.oemNumber))];
  const names = [...new Set(parts.map((part) => part.nameAr))];
  if (!oems.length) return { oemCounts: new Map(), nameCounts: new Map(), brandsByOem: new Map() };
  const active = { isActive: true, isDeleted: false };
  const [oemGroups, nameGroups, variants] = await Promise.all([
    db.partItem.groupBy({ by: ["oemNumber"], where: { ...active, oemNumber: { in: oems } }, _count: { _all: true } }),
    db.partItem.groupBy({ by: ["nameAr"], where: { ...active, nameAr: { in: names } }, _count: { _all: true } }),
    db.partItem.findMany({ where: { ...active, oemNumber: { in: oems } }, select: { oemNumber: true, brand: { select: { name: true } } }, orderBy: { brand: { name: "asc" } } }),
  ]);
  const brandsByOem = new Map<string, string[]>();
  for (const variant of variants) {
    const brands = brandsByOem.get(variant.oemNumber) ?? [];
    const brandName = variant.brand?.name?.trim() || "بدون علامة تجارية";
    if (!brands.includes(brandName)) brands.push(brandName);
    brandsByOem.set(variant.oemNumber, brands);
  }
  return {
    oemCounts: new Map(oemGroups.map((group) => [group.oemNumber, group._count._all])),
    nameCounts: new Map(nameGroups.map((group) => [group.nameAr, group._count._all])),
    brandsByOem,
  };
}

function toRow(p: PartWithRelations, duplicates: DuplicateMetadata = { oemCounts: new Map(), nameCounts: new Map(), brandsByOem: new Map() }): PartRow {
  const brandName = p.brand?.name?.trim() || "بدون علامة تجارية";
  return {
    id: p.id,
    oemNumber: p.oemNumber,
    partNumberFormatted: p.partNumberFormatted,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    brandId: p.brandId,
    brandName,
    isOem: Boolean(p.brand?.isOem),
    brandPartNumber: p.brandPartNumber,
    barcode: p.barcode,
    category: p.category,
    sidePosition: p.sidePosition,
    binLocationId: p.binLocationId,
    binCode: p.binLocation?.fullCode ?? null,
    buyPriceAvg: num(p.buyPriceAvg),
    sellPriceRetail: num(p.sellPriceRetail),
    sellPriceWholesale: num(p.sellPriceWholesale),
    sellPriceMin: num(p.sellPriceMin),
    stockQuantity: p.stockQuantity,
    stockReserved: p.stockReserved,
    minReorderLevel: p.minReorderLevel,
    isActive: p.isActive,
    chassisIds: (p.compatibleChassis ?? []).map((c) => c.chassisId).filter(Boolean),
    engineIds: (p.compatibleEngines ?? []).map((e) => e.engineId).filter(Boolean),
    chassisCodes: (p.compatibleChassis ?? []).map((c) => c.chassis?.code?.trim()).filter((code): code is string => Boolean(code)),
    engineCodes: (p.compatibleEngines ?? []).map((e) => e.engine?.code?.trim()).filter((code): code is string => Boolean(code)),
    duplicateOemCount: duplicates.oemCounts.get(p.oemNumber) ?? 0,
    duplicateNameCount: duplicates.nameCounts.get(p.nameAr) ?? 0,
    duplicateBrands: duplicates.brandsByOem.get(p.oemNumber) ?? [brandName],
  };
}

/**
 * Catalog search. Text matching runs through `contains` (case-insensitive),
 * which PostgreSQL resolves with the pg_trgm GIN indexes declared on
 * PartItem.oemNumber / PartItem.nameAr — sub-millisecond even at 100k+ rows.
 */
export async function searchParts(
  db: PartsDb,
  raw: Partial<SearchPartsInput>,
): Promise<{ rows: PartRow[]; total: number; page: number; pageSize: number }> {
  const input = searchPartsSchema.parse(raw);
  const where: Prisma.PartItemWhereInput = { isDeleted: false };
  const and: Prisma.PartItemWhereInput[] = [];

  if (input.query) {
    const q = input.query.trim();
    const oemKey = sanitizeOemForSearch(q);
    // PostgreSQL comparison key removes visual separators in stored legacy OEMs too,
    // so 17 11-8 484 638, 17118484638, and 17/118/484638 resolve identically.
    const separatorInsensitiveIds = oemKey.length >= 2
      ? await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "PartItem" WHERE regexp_replace("oemNumber", '[[:space:]_./-]', '', 'g') ILIKE ${`%${oemKey}%`} LIMIT 10000`)
      : [];
    and.push({
      OR: [
        { oemNumber: { contains: oemKey, mode: "insensitive" } },
        ...(separatorInsensitiveIds.length ? [{ id: { in: separatorInsensitiveIds.map((row) => row.id) } }] : []),
        { nameAr: { contains: q } },
        { nameEn: { contains: q, mode: "insensitive" } },
        { brandPartNumber: { contains: q, mode: "insensitive" } },
        { barcode: { equals: oemKey } },
      ],
    });
  }
  if (input.chassisCode) {
    and.push({ compatibleChassis: { some: { chassis: { code: input.chassisCode.toUpperCase() } } } });
  }
  if (input.engineCode) {
    and.push({ compatibleEngines: { some: { engine: { code: input.engineCode.toUpperCase() } } } });
  }
  if (input.category) and.push({ category: input.category });
  if (input.brandId) and.push({ brandId: input.brandId });
  if (input.lowStockOnly) {
    // Column-to-column comparison; Prisma's query builder cannot express it, so
    // it is pushed down as a raw filter. Printing deliberately expands this
    // prefilter to the same guarded upper bound as the final unpaginated query.
    and.push({ id: { in: await lowStockPartIds(db, input.isForPrint ? 10_000 : input.pageSize * input.page + input.pageSize) } });
  }
  if (and.length) where.AND = and;

  const [rows, total] = await Promise.all([
    db.partItem.findMany({
      where,
      include: partInclude,
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }],
      skip: input.isForPrint ? undefined : (input.page - 1) * input.pageSize,
      take: input.isForPrint ? 10_000 : input.pageSize,
    }),
    db.partItem.count({ where }),
  ]);

  const duplicates = await getDuplicateMetadata(db, rows);
  return { rows: rows.map((row) => toRow(row, duplicates)), total, page: input.page, pageSize: input.isForPrint ? rows.length : input.pageSize };
}

/**
 * POS keystroke lookup.
 *
 * Uses a narrow `select` instead of the full `partInclude`: the terminal renders
 * only name/OEM/brand/bin/price/stock, and pulling the fitment matrix meant ~6
 * extra relation queries per keystroke (Prisma resolves each relation level as
 * its own query) plus shipping cost data the UI never shows.
 */
export interface PosPartRow {
  id: string;
  oemNumber: string;
  nameAr: string;
  nameEn: string | null;
  brandName: string;
  isOem: boolean;
  brandPartNumber: string | null;
  category: string;
  sidePosition: string | null;
  binCode: string | null;
  sellPriceRetail: number;
  sellPriceWholesale: number;
  sellPriceMin: number;
  stockQuantity: number;
  stockReserved: number;
  minReorderLevel: number;
  duplicateOemCount: number;
  duplicateNameCount: number;
  duplicateBrands: string[];
}

function toPosRow(p: { id: string; oemNumber: string; nameAr: string; nameEn: string | null; brandPartNumber: string | null; category: string; sidePosition: string | null; sellPriceRetail: Prisma.Decimal; sellPriceWholesale: Prisma.Decimal; sellPriceMin: Prisma.Decimal; stockQuantity: number; stockReserved: number; minReorderLevel: number; brand: { name: string; isOem: boolean }; binLocation: { fullCode: string } | null }, duplicates: DuplicateMetadata): PosPartRow {
  return { id: p.id, oemNumber: p.oemNumber, nameAr: p.nameAr, nameEn: p.nameEn, brandName: p.brand.name, isOem: p.brand.isOem, brandPartNumber: p.brandPartNumber, category: p.category, sidePosition: p.sidePosition, binCode: p.binLocation?.fullCode ?? null, sellPriceRetail: num(p.sellPriceRetail), sellPriceWholesale: num(p.sellPriceWholesale), sellPriceMin: num(p.sellPriceMin), stockQuantity: p.stockQuantity, stockReserved: p.stockReserved, minReorderLevel: p.minReorderLevel, duplicateOemCount: duplicates.oemCounts.get(p.oemNumber) ?? 0, duplicateNameCount: duplicates.nameCounts.get(p.nameAr) ?? 0, duplicateBrands: duplicates.brandsByOem.get(p.oemNumber) ?? [p.brand.name] };
}

export async function quickSearchParts(db: PartsDb, query: string, limit = 12): Promise<PosPartRow[]> {
  const { normalized, numericNormalized, variations } = normalizeSearchTerm(query);
  const oemKey = sanitizeOemForSearch(query);
  if (normalized.length < 2) return [];
  const separatorInsensitiveIds = oemKey.length >= 2
    ? await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "PartItem" WHERE regexp_replace("oemNumber", '[[:space:]_./-]', '', 'g') ILIKE ${`%${oemKey}%`} LIMIT ${Math.max(limit * 8, 96)}`)
    : [];

  const rows = await db.partItem.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      OR: [
        { barcode: { equals: numericNormalized } },
        { oemNumber: { contains: oemKey || numericNormalized, mode: "insensitive" } },
        ...(separatorInsensitiveIds.length ? [{ id: { in: separatorInsensitiveIds.map((row) => row.id) } }] : []),
        ...variations.flatMap((term) => [
          { nameAr: { contains: term } },
          { nameEn: { contains: term, mode: "insensitive" as const } },
          { brandPartNumber: { contains: term, mode: "insensitive" as const } },
          { brand: { name: { contains: term, mode: "insensitive" as const } } },
          { compatibleChassis: { some: { chassis: { code: { contains: term, mode: "insensitive" as const } } } } },
          { compatibleEngines: { some: { engine: { code: { contains: term, mode: "insensitive" as const } } } } },
        ]),
      ],
    },
    select: {
      id: true,
      oemNumber: true,
      nameAr: true,
      nameEn: true,
      brandPartNumber: true,
      category: true,
      sidePosition: true,
      sellPriceRetail: true,
      sellPriceWholesale: true,
      sellPriceMin: true,
      stockQuantity: true,
      stockReserved: true,
      minReorderLevel: true,
      brand: { select: { name: true, isOem: true } },
      binLocation: { select: { fullCode: true } },
    },
    orderBy: [{ stockQuantity: "desc" }, { nameAr: "asc" }],
    take: limit,
  });

  const duplicates = await getDuplicateMetadata(db, rows);
  return rows.map((row) => toPosRow(row, duplicates));
}

export async function getPosPartsByIds(db: PartsDb, ids: string[]): Promise<PosPartRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.partItem.findMany({
    where: { id: { in: unique }, isDeleted: false },
    select: { id: true, oemNumber: true, nameAr: true, nameEn: true, brandPartNumber: true, category: true, sidePosition: true, sellPriceRetail: true, sellPriceWholesale: true, sellPriceMin: true, stockQuantity: true, stockReserved: true, minReorderLevel: true, brand: { select: { name: true, isOem: true } }, binLocation: { select: { fullCode: true } } },
  });
  const [duplicates] = await Promise.all([getDuplicateMetadata(db, rows)]);
  const order = new Map(unique.map((id, index) => [id, index]));
  return rows.map((row) => toPosRow(row, duplicates)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function getPartById(db: PartsDb, id: string): Promise<PartRow | null> {
  const part = await db.partItem.findUnique({ where: { id }, include: partInclude });
  if (!part) return null;
  const duplicates = await getDuplicateMetadata(db, [part]);
  return toRow(part, duplicates);
}

/** Ids of parts at or below their reorder level, worst deficit first. */
async function lowStockPartIds(db: PartsDb, limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "PartItem"
      WHERE "isActive" = true AND "isDeleted" = false AND "stockQuantity" <= "minReorderLevel"
      ORDER BY ("stockQuantity" - "minReorderLevel") ASC
      LIMIT ${limit}
    `,
  );
  return rows.map((r) => r.id);
}

export async function getLowStockParts(db: PartsDb, limit = 50): Promise<PartRow[]> {
  const ids = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "PartItem"
      WHERE "stockQuantity" <= "minReorderLevel" AND "isActive" = true
      ORDER BY ("stockQuantity" - "minReorderLevel") ASC
      LIMIT ${limit}
    `,
  );
  if (ids.length === 0) return [];
  const rows = await db.partItem.findMany({
    where: { id: { in: ids.map((i) => i.id) } },
    include: partInclude,
  });
  const order = new Map(ids.map((r, i) => [r.id, i]));
  const duplicates = await getDuplicateMetadata(db, rows);
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((row) => toRow(row, duplicates));
}

export async function getPartFormOptions(db: PartsDb) {
  const [brands, chassis, engines, bins] = await Promise.all([
    db.brand.findMany({ orderBy: [{ isOem: "desc" }, { name: "asc" }], select: { id: true, name: true, isOem: true } }),
    db.bmwChassis.findMany({
      orderBy: [{ series: "asc" }, { code: "asc" }],
      select: { id: true, code: true, series: true },
    }),
    db.bmwEngine.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, displacement: true, fuelType: true },
    }),
    db.warehouseBin.findMany({ orderBy: { fullCode: "asc" }, select: { id: true, fullCode: true } }),
  ]);
  return { brands, chassis, engines, bins };
}

/** Stock ledger for one part — the audit view that proves the balance. */
export async function getStockLedger(db: PartsDb, partId: string, limit = 100) {
  const moves = await db.stockMovement.findMany({
    where: { partId },
    // seq, not createdAt: concurrent commits share a timestamp.
    orderBy: { seq: "desc" },
    take: limit,
    include: {
      performedBy: { select: { fullName: true } },
      part: { select: { binLocation: { select: { fullCode: true } } } },
      invoice: { select: { id: true, invoiceNumber: true, type: true, isVoided: true, account: { select: { name: true } }, items: { where: { partId }, select: { unitPrice: true, unitCostSnapshot: true, totalPrice: true, quantity: true, binLocationSnapshot: true } } } },
    },
  });
  return moves.map((m) => ({
    id: m.id,
    seq: m.seq.toString(),
    reason: m.reason,
    quantityDelta: m.quantityDelta,
    balanceAfter: m.balanceAfter,
    unitCost: num(m.unitCost),
    unitSalePrice: m.invoice?.items[0] ? num(m.invoice.items[0].unitPrice) : null,
    totalSalePrice: m.invoice?.items[0] ? num(m.invoice.items[0].totalPrice) : null,
    invoiceUnitCost: m.invoice?.items[0] ? num(m.invoice.items[0].unitCostSnapshot) : null,
    invoiceTotalCost: m.invoice?.items[0] ? num(m.invoice.items[0].unitCostSnapshot) * m.invoice.items[0].quantity : null,
    binCode: m.invoice?.items[0]?.binLocationSnapshot ?? m.part.binLocation?.fullCode ?? null,
    performedBy: m.performedBy.fullName,
    invoiceId: m.invoice?.id ?? null,
    invoiceNumber: m.invoice?.invoiceNumber ?? null,
    invoiceType: m.invoice?.type ?? null,
    invoiceIsVoided: m.invoice?.isVoided ?? false,
    partyName: m.invoice?.account.name ?? null,
    note: m.note,
    createdAt: m.createdAt.toISOString(),
  }));
}
