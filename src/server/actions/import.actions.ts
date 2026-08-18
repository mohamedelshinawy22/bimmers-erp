"use server";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { ok, toActionError } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { formatOemNumber, money } from "@/lib/utils";
import { parseSpreadsheetNumber } from "@/lib/inventory-import";
import { recordStockMovement } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const nonNegativeSpreadsheetNumber = z.preprocess(
  (value) => parseSpreadsheetNumber(value),
  z.number().finite().min(0).max(99_999_999),
);
const nonNegativeSpreadsheetQuantity = z.preprocess(
  (value) => parseSpreadsheetNumber(value),
  z.number().finite().int().min(0).max(10_000_000),
);

const importRowSchema = z.object({
  sourceRowNumber: z.coerce.number().int().positive().optional(),
  nameAr: z.string().trim().min(1, "اسم الصنف مطلوب.").max(240),
  // Shared and paired part numbers such as 51117111741/742 are valid catalog identifiers.
  oemNumber: z.string().trim().min(1, "كود OEM مطلوب.").max(120).regex(/^[A-Za-z0-9\s\-/]+$/, "كود OEM يسمح بالحروف والأرقام والمسافات والشرطة والشرطة المائلة فقط."),
  barcode: z.string().trim().max(100).optional().or(z.literal("")),
  brand: z.string().trim().max(120).optional().or(z.literal("")),
  category: z.string().trim().max(160).optional().or(z.literal("")),
  chassis: z.string().trim().max(400).optional().or(z.literal("")),
  engine: z.string().trim().max(400).optional().or(z.literal("")),
  cost: nonNegativeSpreadsheetNumber,
  price: nonNegativeSpreadsheetNumber,
  quantity: nonNegativeSpreadsheetQuantity,
  bin: z.string().trim().max(120).optional().or(z.literal("")),
});
const importSchema = z.object({
  mapping: z.record(z.string(), z.string()),
  skipInvalidRows: z.boolean().default(false),
  rows: z.array(z.unknown()).min(1).max(10_000),
});
type ImportInput = z.input<typeof importSchema>;

type ValidImportRow = z.infer<typeof importRowSchema>;

function key(value: string) { return value.trim().toLocaleLowerCase("ar-EG"); }
function codes(value?: string) { return (value ?? "").split(/[,/|;\n]+/).map((part) => part.trim().toUpperCase()).filter(Boolean).slice(0, 30); }
function invalidRowMessage(error: z.ZodError): string { return error.issues.map((issue) => issue.message).join(" • "); }

export async function executeInventoryImportAction(raw: ImportInput) {
  try {
    const user = await requirePermission("inventory.import");
    const input = importSchema.parse(raw);
    const validation = input.rows.map((row, index) => ({ sourceRowNumber: index + 1, result: importRowSchema.safeParse(row) }));
    const invalidRows = validation
      .filter((entry) => !entry.result.success)
      .map((entry) => ({ sourceRowNumber: entry.sourceRowNumber, reason: invalidRowMessage((entry.result as { success: false; error: z.ZodError }).error) }));

    if (invalidRows.length > 0 && !input.skipInvalidRows) {
      throw new BusinessRuleError(`يوجد ${invalidRows.length} صف غير صالح. صحح الأخطاء أو فعّل خيار تخطي الصفوف غير الصالحة.`);
    }

    const rows = validation
      .filter((entry): entry is { sourceRowNumber: number; result: { success: true; data: ValidImportRow } } => entry.result.success)
      .map(({ sourceRowNumber, result }) => ({
        ...result.data,
        sourceRowNumber: result.data.sourceRowNumber ?? sourceRowNumber,
        oemNumber: result.data.oemNumber.replace(/\s+/g, "").toUpperCase(),
        brand: result.data.brand?.trim() || "عام",
        category: result.data.category?.trim() || "بدون تصنيف",
      }));

    if (rows.length === 0) throw new BusinessRuleError("لا توجد أصناف سليمة قابلة للاستيراد بعد استبعاد الصفوف غير الصالحة.");

    const checksum = createHash("sha256").update(JSON.stringify(rows.map((row) => ({ ...row, barcode: row.barcode || null })))).digest("hex");
    const previous = await prisma.importJob.findFirst({ where: { checksum, type: "INVENTORY", status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (previous) return ok({ jobId: previous.id, duplicate: true, total: input.rows.length, valid: rows.length, skippedInvalid: invalidRows.length, created: 0, skipped: rows.length, summary: previous.summary });

    const job = await prisma.importJob.create({ data: { type: "INVENTORY", status: "PROCESSING", checksum, mapping: input.mapping, createdById: user.id } });
    let created = 0;
    let skipped = 0;

    try {
      for (let start = 0; start < rows.length; start += 100) {
        const chunk = rows.slice(start, start + 100);
        const chunkResult = await withTxRetry(() => prisma.$transaction(async (tx) => {
          let chunkCreated = 0;
          let chunkSkipped = 0;
          for (const row of chunk) {
            const brand = await tx.brand.upsert({ where: { normalizedName: key(row.brand) }, update: {}, create: { name: row.brand, normalizedName: key(row.brand) }, select: { id: true } });
            // A shared OEM is valid across brands. A repeated row for the same
            // OEM + brand is idempotently skipped, preserving opening-stock safety.
            const exists = await tx.partItem.findUnique({ where: { oemNumber_brandId: { oemNumber: row.oemNumber, brandId: brand.id } }, select: { id: true } });
            if (exists) { chunkSkipped += 1; continue; }

            const category = await tx.category.upsert({ where: { normalizedName: key(row.category) }, update: {}, create: { name: row.category, normalizedName: key(row.category) }, select: { id: true } });
            const chassisIds: string[] = [];
            for (const code of codes(row.chassis)) chassisIds.push((await tx.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id);
            const engineIds: string[] = [];
            for (const code of codes(row.engine)) engineIds.push((await tx.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id);

            const buyPrice = money(row.cost);
            const createdPart = await tx.partItem.create({ data: {
              oemNumber: row.oemNumber, partNumberFormatted: formatOemNumber(row.oemNumber), nameAr: row.nameAr, barcode: row.barcode || null,
              brandId: brand.id, category: row.category, categoryId: category.id, buyPriceLast: buyPrice, buyPriceAvg: row.quantity > 0 ? buyPrice : money(0),
              sellPriceRetail: money(row.price), sellPriceWholesale: money(row.price), sellPriceMin: money(row.price), stockQuantity: row.quantity,
              compatibleChassis: { createMany: { data: chassisIds.map((chassisId) => ({ chassisId })) } },
              compatibleEngines: { createMany: { data: engineIds.map((engineId) => ({ engineId })) } },
            } });
            if (row.quantity > 0) await recordStockMovement(tx, { partId: createdPart.id, reason: "OPENING_BALANCE", quantityDelta: row.quantity, balanceAfter: row.quantity, unitCost: buyPrice, performedById: user.id, note: `رصيد افتتاحي عبر استيراد ${job.id}` });
            await writeAudit(tx, { tableName: "PartItem", recordId: createdPart.id, action: "INSERT", newData: { ...createdPart, importJobId: job.id, sourceRowNumber: row.sourceRowNumber }, performedBy: user.id });
            chunkCreated += 1;
          }
          return { chunkCreated, chunkSkipped };
        }, TX_OPTIONS));
        created += chunkResult.chunkCreated;
        skipped += chunkResult.chunkSkipped;
      }

      const summary = { total: input.rows.length, valid: rows.length, skippedInvalid: invalidRows.length, created, skipped, chunkSize: 100 };
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } });
      await writeAudit(prisma, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: user.id });
      revalidatePath("/inventory");
      revalidatePath("/pos");
      return ok({ jobId: job.id, duplicate: false, ...summary });
    } catch (error) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: input.rows.length, valid: rows.length, skippedInvalid: invalidRows.length, created, skipped } } });
      throw error;
    }
  } catch (error) {
    return toActionError(error, "executeInventoryImportAction");
  }
}
