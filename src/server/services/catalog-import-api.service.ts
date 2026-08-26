import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { toActionError } from "@/lib/action-result";
import { parseImportNumber, normalizeImportText } from "@/lib/import-export/parser";
import { formatOemNumber, isSupportedOem, money, sanitizeAndNormalizeOem } from "@/lib/utils";
import { recordStockMovement } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

type Db = PrismaClient;
type ImportRow = { sourceRowNumber?: number; nameAr?: unknown; oemNumber?: unknown; barcode?: unknown; brand?: unknown; category?: unknown; chassis?: unknown; engine?: unknown; cost?: unknown; price?: unknown; quantity?: unknown; bin?: unknown };
type ApiInput = { mapping?: Record<string, string>; skipInvalidRows?: boolean; rows?: unknown };

export type CatalogApiChunkResult = {
  created: number; skipped: number; skippedInvalid: number; barcodeCollisions: number;
  failedRows: Array<{ sourceRowNumber: number; error: string }>;
};

const MAX_ROWS_PER_CHUNK = 10;
const key = (value: string) => value.trim().toLocaleLowerCase("ar-EG");
const codes = (value: string) => value.split(/[,/|;\n]+/).map((item) => item.trim().toUpperCase()).filter(Boolean).slice(0, 30);
const errorText = (error: unknown) => { const result = toActionError(error, "catalog-import-api-row"); return result.success ? "تعذر معالجة الصف." : result.error; };

function normalizedRow(raw: unknown, fallbackRow: number) {
  const row = (raw && typeof raw === "object" ? raw : {}) as ImportRow;
  const sourceRowNumber = Number(row.sourceRowNumber) || fallbackRow;
  const nameAr = normalizeImportText(row.nameAr);
  const oemNumber = sanitizeAndNormalizeOem(normalizeImportText(row.oemNumber));
  if (!nameAr || !oemNumber) return { invalid: { sourceRowNumber, error: !nameAr ? "اسم الصنف مطلوب." : "كود OEM مطلوب." } } as const;
  if (!isSupportedOem(oemNumber)) return { invalid: { sourceRowNumber, error: "كود OEM يحتوي على رموز غير مدعومة." } } as const;
  const number = (value: unknown, integer = false) => {
    const parsed = parseImportNumber(value);
    const safe = parsed === null || !Number.isFinite(parsed) ? 0 : Math.abs(parsed);
    return integer ? Math.trunc(safe) : safe;
  };
  return { row: {
    sourceRowNumber, nameAr, oemNumber: oemNumber.replace(/\s+/g, "").toUpperCase(), barcode: normalizeImportText(row.barcode) || null,
    brand: normalizeImportText(row.brand) || "عام", category: normalizeImportText(row.category) || "بدون تصنيف", chassis: normalizeImportText(row.chassis), engine: normalizeImportText(row.engine), bin: normalizeImportText(row.bin),
    cost: number(row.cost), price: number(row.price), quantity: number(row.quantity, true),
  } } as const;
}

async function importRow(db: Db, userId: string, jobId: string, row: NonNullable<ReturnType<typeof normalizedRow>["row"]>) {
  return withTxRetry(() => db.$transaction(async (tx) => {
    const brand = await tx.brand.upsert({ where: { normalizedName: key(row.brand) }, update: {}, create: { name: row.brand, normalizedName: key(row.brand) }, select: { id: true } });
    const duplicate = await tx.partItem.findUnique({ where: { oemNumber_brandId: { oemNumber: row.oemNumber, brandId: brand.id } }, select: { id: true } });
    if (duplicate) return { created: 0, skipped: 1, barcodeCollision: 0 };
    const category = await tx.category.upsert({ where: { normalizedName: key(row.category) }, update: {}, create: { name: row.category, normalizedName: key(row.category) }, select: { id: true } });
    const chassisIds: string[] = []; for (const code of new Set(codes(row.chassis))) chassisIds.push((await tx.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id);
    const engineIds: string[] = []; for (const code of new Set(codes(row.engine))) engineIds.push((await tx.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id);
    const bin = row.bin ? await tx.warehouseBin.findUnique({ where: { fullCode: row.bin }, select: { id: true } }) : null;
    const occupiedBarcode = row.barcode ? await tx.partItem.findUnique({ where: { barcode: row.barcode }, select: { id: true } }) : null;
    const barcode = occupiedBarcode ? null : row.barcode;
    const buyPrice = money(row.cost);
    const data = {
      oemNumber: row.oemNumber, partNumberFormatted: formatOemNumber(row.oemNumber), nameAr: row.nameAr, barcode, brandId: brand.id, category: row.category, categoryId: category.id, binLocationId: bin?.id ?? null,
      buyPriceLast: buyPrice, buyPriceAvg: row.quantity > 0 ? buyPrice : money(0), sellPriceRetail: money(row.price), sellPriceWholesale: money(row.price), sellPriceMin: money(row.price), stockQuantity: row.quantity,
      compatibleChassis: { createMany: { data: chassisIds.map((chassisId) => ({ chassisId })) } }, compatibleEngines: { createMany: { data: engineIds.map((engineId) => ({ engineId })) } },
    };
    let part;
    try { part = await tx.partItem.create({ data }); }
    catch (error) {
      if (barcode && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") part = await tx.partItem.create({ data: { ...data, barcode: null } });
      else throw error;
    }
    if (row.quantity > 0) await recordStockMovement(tx, { partId: part.id, reason: "OPENING_BALANCE", quantityDelta: row.quantity, balanceAfter: row.quantity, unitCost: buyPrice, performedById: userId, note: `رصيد افتتاحي عبر استيراد ${jobId}` });
    await writeAudit(tx, { tableName: "PartItem", recordId: part.id, action: "INSERT", newData: { ...part, importJobId: jobId, sourceRowNumber: row.sourceRowNumber }, performedBy: userId });
    return { created: 1, skipped: 0, barcodeCollision: row.barcode && !barcode ? 1 : 0 };
  }, TX_OPTIONS));
}

/** Direct API implementation: every source row has an independent short transaction. */
export async function importCatalogApiChunk(db: Db, userId: string, raw: ApiInput): Promise<CatalogApiChunkResult> {
  const entries = Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_ROWS_PER_CHUNK) : [];
  if (!entries.length) return { created: 0, skipped: 0, skippedInvalid: 0, barcodeCollisions: 0, failedRows: [] };
  const normalized = entries.map((row, index) => normalizedRow(row, index + 1));
  const failedRows: Array<{ sourceRowNumber: number; error: string }> = normalized.flatMap((entry) => entry.invalid ? [entry.invalid] : []);
  const rows = normalized.flatMap((entry) => entry.row ? [entry.row] : []);
  const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const job = await db.importJob.create({ data: { type: "INVENTORY", status: "PROCESSING", checksum, mapping: raw.mapping ?? {}, createdById: userId }, select: { id: true } });
  let created = 0; let skipped = 0; let barcodeCollisions = 0;
  for (const row of rows) {
    try { const result = await importRow(db, userId, job.id, row); created += result.created; skipped += result.skipped; barcodeCollisions += result.barcodeCollision; }
    catch (error) { failedRows.push({ sourceRowNumber: row.sourceRowNumber, error: errorText(error) }); }
  }
  const summary = { total: entries.length, created, skipped, skippedInvalid: failedRows.length, barcodeCollisions, chunkSize: MAX_ROWS_PER_CHUNK };
  await db.importJob.update({ where: { id: job.id }, data: { status: failedRows.length ? "FAILED" : "COMPLETED", summary } });
  await writeAudit(db, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: userId });
  return { created, skipped, skippedInvalid: failedRows.length, barcodeCollisions, failedRows };
}
