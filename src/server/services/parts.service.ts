import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/utils";
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
}

const partInclude = {
  brand: { select: { name: true, isOem: true } },
  binLocation: { select: { fullCode: true } },
  compatibleChassis: { select: { chassisId: true, chassis: { select: { code: true } } } },
  compatibleEngines: { select: { engineId: true, engine: { select: { code: true } } } },
} satisfies Prisma.PartItemInclude;

type PartWithRelations = Prisma.PartItemGetPayload<{ include: typeof partInclude }>;

function toRow(p: PartWithRelations): PartRow {
  return {
    id: p.id,
    oemNumber: p.oemNumber,
    partNumberFormatted: p.partNumberFormatted,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    brandId: p.brandId,
    brandName: p.brand.name,
    isOem: p.brand.isOem,
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
    chassisIds: p.compatibleChassis.map((c) => c.chassisId),
    engineIds: p.compatibleEngines.map((e) => e.engineId),
    chassisCodes: p.compatibleChassis.map((c) => c.chassis.code),
    engineCodes: p.compatibleEngines.map((e) => e.engine.code),
  };
}

/**
 * Catalog search. Text matching runs through `contains` (case-insensitive),
 * which PostgreSQL resolves with the pg_trgm GIN indexes declared on
 * PartItem.oemNumber / PartItem.nameAr — sub-millisecond even at 100k+ rows.
 */
export async function searchParts(
  raw: Partial<SearchPartsInput>,
): Promise<{ rows: PartRow[]; total: number; page: number; pageSize: number }> {
  const input = searchPartsSchema.parse(raw);
  const where: Prisma.PartItemWhereInput = {};
  const and: Prisma.PartItemWhereInput[] = [];

  if (input.query) {
    const q = input.query.trim();
    const numeric = q.replace(/[\s\-.]/g, "");
    and.push({
      OR: [
        { oemNumber: { contains: numeric, mode: "insensitive" } },
        { nameAr: { contains: q } },
        { nameEn: { contains: q, mode: "insensitive" } },
        { brandPartNumber: { contains: q, mode: "insensitive" } },
        { barcode: { equals: numeric } },
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
    // it is pushed down as a raw filter rather than materialising a large
    // `IN (...)` id list that then has to be planned twice.
    and.push({ id: { in: await lowStockPartIds(input.pageSize * input.page + input.pageSize) } });
  }
  if (and.length) where.AND = and;

  const [rows, total] = await Promise.all([
    prisma.partItem.findMany({
      where,
      include: partInclude,
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.partItem.count({ where }),
  ]);

  return { rows: rows.map(toRow), total, page: input.page, pageSize: input.pageSize };
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
}

export async function quickSearchParts(query: string, limit = 12): Promise<PosPartRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const numeric = q.replace(/[\s\-.]/g, "");

  const rows = await prisma.partItem.findMany({
    where: {
      isActive: true,
      OR: [
        { barcode: { equals: numeric } },
        { oemNumber: { contains: numeric, mode: "insensitive" } },
        { nameAr: { contains: q } },
        { nameEn: { contains: q, mode: "insensitive" } },
        { brandPartNumber: { contains: q, mode: "insensitive" } },
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

  return rows.map((p) => ({
    id: p.id,
    oemNumber: p.oemNumber,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    brandName: p.brand.name,
    isOem: p.brand.isOem,
    brandPartNumber: p.brandPartNumber,
    category: p.category,
    sidePosition: p.sidePosition,
    binCode: p.binLocation?.fullCode ?? null,
    sellPriceRetail: num(p.sellPriceRetail),
    sellPriceWholesale: num(p.sellPriceWholesale),
    sellPriceMin: num(p.sellPriceMin),
    stockQuantity: p.stockQuantity,
    stockReserved: p.stockReserved,
    minReorderLevel: p.minReorderLevel,
  }));
}

export async function getPartById(id: string): Promise<PartRow | null> {
  const part = await prisma.partItem.findUnique({ where: { id }, include: partInclude });
  return part ? toRow(part) : null;
}

/** Ids of parts at or below their reorder level, worst deficit first. */
async function lowStockPartIds(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "PartItem"
      WHERE "isActive" = true AND "stockQuantity" <= "minReorderLevel"
      ORDER BY ("stockQuantity" - "minReorderLevel") ASC
      LIMIT ${limit}
    `,
  );
  return rows.map((r) => r.id);
}

export async function getLowStockParts(limit = 50): Promise<PartRow[]> {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "PartItem"
      WHERE "stockQuantity" <= "minReorderLevel" AND "isActive" = true
      ORDER BY ("stockQuantity" - "minReorderLevel") ASC
      LIMIT ${limit}
    `,
  );
  if (ids.length === 0) return [];
  const rows = await prisma.partItem.findMany({
    where: { id: { in: ids.map((i) => i.id) } },
    include: partInclude,
  });
  const order = new Map(ids.map((r, i) => [r.id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(toRow);
}

export async function getPartFormOptions() {
  const [brands, chassis, engines, bins] = await Promise.all([
    prisma.brand.findMany({ orderBy: [{ isOem: "desc" }, { name: "asc" }], select: { id: true, name: true, isOem: true } }),
    prisma.bmwChassis.findMany({
      orderBy: [{ series: "asc" }, { code: "asc" }],
      select: { id: true, code: true, series: true },
    }),
    prisma.bmwEngine.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, displacement: true, fuelType: true },
    }),
    prisma.warehouseBin.findMany({ orderBy: { fullCode: "asc" }, select: { id: true, fullCode: true } }),
  ]);
  return { brands, chassis, engines, bins };
}

/** Stock ledger for one part — the audit view that proves the balance. */
export async function getStockLedger(partId: string, limit = 100) {
  const moves = await prisma.stockMovement.findMany({
    where: { partId },
    // seq, not createdAt: concurrent commits share a timestamp.
    orderBy: { seq: "desc" },
    take: limit,
    include: {
      performedBy: { select: { fullName: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });
  return moves.map((m) => ({
    id: m.id,
    seq: m.seq.toString(),
    reason: m.reason,
    quantityDelta: m.quantityDelta,
    balanceAfter: m.balanceAfter,
    unitCost: num(m.unitCost),
    performedBy: m.performedBy.fullName,
    invoiceNumber: m.invoice?.invoiceNumber ?? null,
    note: m.note,
    createdAt: m.createdAt.toISOString(),
  }));
}
