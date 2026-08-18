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
import { recordStockMovement } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const importRowSchema = z.object({
  nameAr: z.string().trim().min(2).max(240), oemNumber: z.string().trim().min(3).max(80), barcode: z.string().trim().max(100).optional().or(z.literal("")),
  brand: z.string().trim().max(120).optional().or(z.literal("")), category: z.string().trim().max(160).optional().or(z.literal("")),
  chassis: z.string().trim().max(400).optional().or(z.literal("")), engine: z.string().trim().max(400).optional().or(z.literal("")),
  cost: z.coerce.number().min(0).max(99_999_999), price: z.coerce.number().min(0).max(99_999_999), quantity: z.coerce.number().int().min(0).max(10_000_000), bin: z.string().trim().max(120).optional().or(z.literal("")),
});
const importSchema = z.object({ mapping: z.record(z.string(), z.string()), rows: z.array(importRowSchema).min(1).max(10_000) });
type ImportInput = z.infer<typeof importSchema>;

function key(value: string) { return value.trim().toLocaleLowerCase("ar-EG"); }
function codes(value?: string) { return (value ?? "").split(/[,/|;\n]+/).map((part) => part.trim().toUpperCase()).filter(Boolean).slice(0, 30); }

export async function executeInventoryImportAction(raw: ImportInput) {
  try {
    const user = await requirePermission("inventory.import");
    const input = importSchema.parse(raw);
    const rows = input.rows.map((row) => ({ ...row, oemNumber: row.oemNumber.replace(/\s+/g, "").toUpperCase() }));
    const seen = new Set<string>();
    for (const row of rows) { if (seen.has(row.oemNumber)) throw new BusinessRuleError(`رقم OEM ${row.oemNumber} مكرر داخل ملف الاستيراد.`); seen.add(row.oemNumber); }
    const checksum = createHash("sha256").update(JSON.stringify(rows.map((row) => ({ ...row, barcode: row.barcode || null })))).digest("hex");
    const previous = await prisma.importJob.findFirst({ where: { checksum, type: "INVENTORY", status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (previous) return ok({ jobId: previous.id, duplicate: true, created: 0, skipped: rows.length, summary: previous.summary });
    const job = await prisma.importJob.create({ data: { type: "INVENTORY", status: "PROCESSING", checksum, mapping: input.mapping, createdById: user.id } });
    let created = 0; let skipped = 0;
    try {
      for (let start = 0; start < rows.length; start += 100) {
        const chunk = rows.slice(start, start + 100);
        const chunkResult = await withTxRetry(() => prisma.$transaction(async (tx) => {
          let chunkCreated = 0; let chunkSkipped = 0;
          for (const row of chunk) {
            const exists = await tx.partItem.findUnique({ where: { oemNumber: row.oemNumber }, select: { id: true } });
            if (exists) { chunkSkipped += 1; continue; }
            const brandName = row.brand || "غير محدد"; const categoryName = row.category || "غير مصنف";
            const brand = await tx.brand.upsert({ where: { normalizedName: key(brandName) }, update: {}, create: { name: brandName, normalizedName: key(brandName) }, select: { id: true } });
            const category = await tx.category.upsert({ where: { normalizedName: key(categoryName) }, update: {}, create: { name: categoryName, normalizedName: key(categoryName) }, select: { id: true } });
            const chassisIds: string[] = []; for (const code of codes(row.chassis)) chassisIds.push((await tx.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id);
            const engineIds: string[] = []; for (const code of codes(row.engine)) engineIds.push((await tx.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id);
            const buyPrice = money(row.cost);
            const createdPart = await tx.partItem.create({ data: { oemNumber: row.oemNumber, partNumberFormatted: formatOemNumber(row.oemNumber), nameAr: row.nameAr, barcode: row.barcode || null, brandId: brand.id, category: categoryName, categoryId: category.id, buyPriceLast: buyPrice, buyPriceAvg: row.quantity > 0 ? buyPrice : money(0), sellPriceRetail: money(row.price), sellPriceWholesale: money(row.price), sellPriceMin: money(row.price), stockQuantity: row.quantity, compatibleChassis: { createMany: { data: chassisIds.map((chassisId) => ({ chassisId })) } }, compatibleEngines: { createMany: { data: engineIds.map((engineId) => ({ engineId })) } } } });
            if (row.quantity > 0) await recordStockMovement(tx, { partId: createdPart.id, reason: "OPENING_BALANCE", quantityDelta: row.quantity, balanceAfter: row.quantity, unitCost: buyPrice, performedById: user.id, note: `رصيد افتتاحي عبر استيراد ${job.id}` });
            await writeAudit(tx, { tableName: "PartItem", recordId: createdPart.id, action: "INSERT", newData: { ...createdPart, importJobId: job.id }, performedBy: user.id });
            chunkCreated += 1;
          }
          return { chunkCreated, chunkSkipped };
        }, TX_OPTIONS));
        created += chunkResult.chunkCreated; skipped += chunkResult.chunkSkipped;
      }
      const summary = { total: rows.length, created, skipped, chunkSize: 100 };
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } });
      await writeAudit(prisma, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: user.id });
      revalidatePath("/inventory"); revalidatePath("/pos");
      return ok({ jobId: job.id, duplicate: false, ...summary });
    } catch (error) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: rows.length, created, skipped } } });
      throw error;
    }
  } catch (error) { return toActionError(error, "executeInventoryImportAction"); }
}
