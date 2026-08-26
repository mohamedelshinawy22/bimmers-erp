"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { money } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { lockPartsForUpdate, recordStockMovement } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { writeAudit } from "@/lib/audit";
import { consolidateStocktakeAdjustments } from "@/lib/stocktake-adjustments";

const CONFIRMATION_PHRASE = "تسوية جرد المخزون";
const sourceRowSchema = z.object({ sourceRowNumber: z.number().int().positive(), oemNumber: z.string().trim().max(200).default(""), nameAr: z.string().trim().max(300).default(""), brand: z.string().trim().max(200).default(""), category: z.string().trim().max(200).default(""), actualQuantity: z.number().finite().nullable() });
const previewSchema = z.object({ rows: z.array(sourceRowSchema).min(1).max(5_000) });
const stocktakeAdjustmentSchema = z.object({ partId: z.string().uuid(), sourceRowNumber: z.number().int().positive(), sourceRowNumbers: z.array(z.number().int().positive()).max(5_000).optional(), actualQuantity: z.number().int().min(0).max(9_999_999) });
const executeSchema = z.object({ adjustments: z.array(stocktakeAdjustmentSchema).min(1).max(5_000), reason: z.string().trim().min(5, "سبب تسوية الجرد مطلوب ويجب أن يتكون من ٥ أحرف على الأقل.").max(500), confirmation: z.string().trim() });
const STOCKTAKE_BATCH_SIZE = 200;

type PreviewRow = { sourceRowNumber: number; oemNumber: string; nameAr: string; brand: string; category: string; actualQuantity: number | null; status: "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "INVALID"; message: string; partId: string | null; matchedBy: "OEM" | "NAME" | null; bookQuantity: number | null; delta: number | null; partName: string | null; partOemNumber: string | null };
const normalizeOem = (value: string) => normalizeSearchTerm(value).numericNormalized;
const normalizeName = (value: string) => normalizeSearchTerm(value).normalized;

function requireStocktakeAdministrator(role: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") throw new BusinessRuleError("تسوية الجرد من Excel متاحة لمدير النظام أو المدير فقط.");
}

export async function previewStocktakeReconciliationAction(raw: unknown): Promise<ActionResult<{ rows: PreviewRow[]; matched: number; unmatched: number; ambiguous: number; invalid: number }>> {
  try {
    const user = await requirePermission("stock.adjust");
    requireStocktakeAdministrator(user.role);
    const input = previewSchema.parse(raw);
    const tenant = await getTenantDbFromSession();
    const rows = await tenant.run(async () => {
      const parts = await tenant.prisma.partItem.findMany({ where: { isActive: true, isDeleted: false }, select: { id: true, oemNumber: true, nameAr: true, stockQuantity: true, category: true, brand: { select: { name: true } } } });
      const oemMap = new Map<string, typeof parts>(); const nameMap = new Map<string, typeof parts>();
      for (const part of parts) {
        const oemKey = normalizeOem(part.oemNumber); const nameKey = normalizeName(part.nameAr);
        if (oemKey) oemMap.set(oemKey, [...(oemMap.get(oemKey) ?? []), part]);
        if (nameKey) nameMap.set(nameKey, [...(nameMap.get(nameKey) ?? []), part]);
      }
      return input.rows.map((row): PreviewRow => {
        if (!Number.isInteger(row.actualQuantity) || (row.actualQuantity ?? -1) < 0) return { ...row, status: "INVALID", message: "الكمية الفعلية يجب أن تكون عدداً صحيحاً صفرياً أو موجباً.", partId: null, matchedBy: null, bookQuantity: null, delta: null, partName: null, partOemNumber: null };
        const oemMatches = row.oemNumber ? (oemMap.get(normalizeOem(row.oemNumber)) ?? []) : [];
        const nameMatches = row.nameAr ? (nameMap.get(normalizeName(row.nameAr)) ?? []) : [];
        let matches = oemMatches.length ? oemMatches : nameMatches;
        const matchedBy = oemMatches.length ? "OEM" as const : nameMatches.length ? "NAME" as const : null;
        if (matches.length === 0) return { ...row, status: "UNMATCHED", message: "لم يُعثر على صنف مطابق برقم OEM أو الاسم.", partId: null, matchedBy: null, bookQuantity: null, delta: null, partName: null, partOemNumber: null };
        let resolution = "";
        if (!oemMatches.length && matches.length > 1) {
          if (row.brand) {
            const brandMatches = matches.filter((part) => normalizeName(part.brand.name) === normalizeName(row.brand));
            if (brandMatches.length === 1) { matches = brandMatches; resolution = " بعد تمييز العلامة"; }
          }
          if (matches.length > 1 && row.category) {
            const categoryMatches = matches.filter((part) => normalizeName(part.category) === normalizeName(row.category));
            if (categoryMatches.length === 1) { matches = categoryMatches; resolution = " بعد تمييز التصنيف"; }
          }
          if (matches.length > 1) {
            const generalMatches = matches.filter((part) => normalizeName(part.brand.name) === normalizeName("عام"));
            if (generalMatches.length === 1) { matches = generalMatches; resolution = " بعد اختيار الصنف العام النشط"; }
          }
        }
        if (matches.length > 1) return { ...row, status: "AMBIGUOUS", message: "وجد أكثر من صنف مطابق؛ استخدم رقم OEM أدق أو أضف العلامة أو التصنيف للملف.", partId: null, matchedBy: null, bookQuantity: null, delta: null, partName: null, partOemNumber: null };
        const part = matches[0]!;
        const actualQuantity = row.actualQuantity as number;
        return { ...row, status: "MATCHED", message: `مطابق${resolution}`, partId: part.id, matchedBy, bookQuantity: part.stockQuantity, delta: actualQuantity - part.stockQuantity, partName: part.nameAr, partOemNumber: part.oemNumber };
      });
    });
    const counts = rows.reduce((result, row) => ({ ...result, matched: result.matched + Number(row.status === "MATCHED"), unmatched: result.unmatched + Number(row.status === "UNMATCHED"), ambiguous: result.ambiguous + Number(row.status === "AMBIGUOUS"), invalid: result.invalid + Number(row.status === "INVALID") }), { matched: 0, unmatched: 0, ambiguous: 0, invalid: 0 });
    return ok({ rows, ...counts });
  } catch (error) { return toActionError(error, "previewStocktakeReconciliationAction"); }
}

export async function executeStocktakeReconciliationAction(raw: unknown): Promise<ActionResult<{ adjusted: number; unchanged: number; batchDelta: number; batches: number }>> {
  try {
    const user = await requirePermission("stock.adjust");
    requireStocktakeAdministrator(user.role);
    const input = executeSchema.parse(raw);
    if (input.confirmation !== CONFIRMATION_PHRASE) throw new BusinessRuleError(`اكتب عبارة التأكيد التالية كاملة: ${CONFIRMATION_PHRASE}`);
    const adjustments = consolidateStocktakeAdjustments(input.adjustments);
    if (adjustments.length > 1_000) throw new BusinessRuleError("يتجاوز عدد الأصناف الفريدة المطلوب تسويتها الحد الآمن وهو 1000 صنف. قسّم الملف إلى دفعات أصغر.");
    const tenant = await getTenantDbFromSession();
    let adjusted = 0; let unchanged = 0; let batchDelta = 0; let completedBatches = 0;
    const batches = Array.from({ length: Math.ceil(adjustments.length / STOCKTAKE_BATCH_SIZE) }, (_, index) => adjustments.slice(index * STOCKTAKE_BATCH_SIZE, (index + 1) * STOCKTAKE_BATCH_SIZE));
    for (const batch of batches) {
      try {
        const batchResult = await tenant.run(() => withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
          const locked = await lockPartsForUpdate(tx, batch.map((row) => row.partId));
          let batchAdjusted = 0; let batchUnchanged = 0; let batchNetDelta = 0;
          for (const row of batch) {
            const part = locked.get(row.partId)!;
            if (!part.isActive) throw new BusinessRuleError(`الصنف «${part.nameAr}» لم يعد نشطاً؛ أعد معاينة ملف الجرد.`);
            if (row.actualQuantity < part.stockReserved) throw new BusinessRuleError(`لا يمكن اعتماد ${row.actualQuantity} للصنف «${part.nameAr}» لأن ${part.stockReserved} وحدة محجوزة حالياً.`);
            const delta = row.actualQuantity - part.stockQuantity;
            if (delta === 0) { batchUnchanged += 1; continue; }
            await tx.partItem.update({ where: { id: part.id }, data: { stockQuantity: row.actualQuantity } });
            const sourceRows = row.sourceRowNumbers.join("، ");
            await recordStockMovement(tx, { partId: part.id, reason: "STOCKTAKE", quantityDelta: delta, balanceAfter: row.actualQuantity, unitCost: money(part.buyPriceAvg), performedById: user.id, note: `جرد فعلي عبر Excel — الصفوف ${sourceRows}: ${input.reason}` });
            await writeAudit(tx, { tableName: "PartItem", recordId: part.id, action: "UPDATE", oldData: { stockQuantity: part.stockQuantity }, newData: { stockQuantity: row.actualQuantity, event: "EXCEL_STOCKTAKE_RECONCILIATION", sourceRowNumber: row.sourceRowNumber, sourceRowNumbers: row.sourceRowNumbers, delta, reason: input.reason }, performedBy: user.id });
            batchAdjusted += 1; batchNetDelta += delta;
          }
          return { batchAdjusted, batchUnchanged, batchNetDelta };
        }, TX_OPTIONS)));
        adjusted += batchResult.batchAdjusted; unchanged += batchResult.batchUnchanged; batchDelta += batchResult.batchNetDelta; completedBatches += 1;
      } catch (error) {
        throw new BusinessRuleError(`تعذر تنفيذ الدفعة ${completedBatches + 1} من ${batches.length}. تم اعتماد ${adjusted} تعديل سابق بأمان؛ أعد رفع الملف نفسه لاستكمال الصفوف المتبقية دون تكرار الفروقات المعتمدة.`);
      }
    }
    const result = { adjusted, unchanged, batchDelta, batches: completedBatches };
    for (const path of ["/inventory", "/catalog", "/reports/inventory-movement", "/dead-stock"]) revalidatePath(path);
    return ok(result);
  } catch (error) { return toActionError(error, "executeStocktakeReconciliationAction"); }
}
