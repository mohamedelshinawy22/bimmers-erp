"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission, requireUser } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";
import { getVoucherRegister, normalizeVoucherFilters } from "@/server/services/vouchers.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const filtersSchema = z.object({
  type: z.enum(["ALL", "RECEIPT", "PAYMENT"]).optional(),
  status: z.enum(["ALL", "ACTIVE", "VOIDED"]).optional(),
  treasuryId: z.string().uuid().optional().or(z.literal("")),
  q: z.string().trim().max(160).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const hardDeleteSchema = z.object({ voucherId: z.string().uuid(), reason: z.string().trim().min(5, "اكتب سبب الحذف النهائي بوضوح.").max(500) });

function revalidateVoucherRegister() {
  for (const path of ["/", "/treasury", "/accounts", "/invoices", "/reports/daily-movement", "/vouchers"]) revalidatePath(path);
}

export async function exportVouchersAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string; count: number }>> {
  try {
    await requirePermission("treasury.read");
    const input = filtersSchema.parse(raw);
    const data = await getVoucherRegister({ ...normalizeVoucherFilters(input), limit: 5_000 });
    const records = data.rows.map((row) => ({
      "رقم السند": row.transactionNumber,
      "التاريخ والوقت": formatDateTime(row.createdAt),
      "النوع": row.type === "RECEIPT" ? "سند قبض" : "سند صرف",
      "الحالة": row.status === "ACTIVE" ? "معتمد" : "ملغي",
      "الحساب / الجهة": row.account ? `${row.account.accountNumber} — ${row.account.name}` : "",
      "الخزينة": row.treasury.name,
      "المبلغ": row.amount,
      "طريقة الدفع": row.category ?? "نقدي",
      "البيان": row.description,
      "الفاتورة المرتبطة": row.invoiceNumber ?? "",
      "المسؤول": row.createdByName ?? "",
      "تاريخ الإلغاء": row.voidedAt ? formatDateTime(row.voidedAt) : "",
      "سبب الإلغاء": row.voidReason ?? "",
    }));
    const headers = ["رقم السند", "التاريخ والوقت", "النوع", "الحالة", "الحساب / الجهة", "الخزينة", "المبلغ", "طريقة الدفع", "البيان", "الفاتورة المرتبطة", "المسؤول", "تاريخ الإلغاء", "سبب الإلغاء"];
    const sheet = XLSX.utils.json_to_sheet(records, { header: headers });
    sheet["!cols"] = [18, 22, 14, 12, 28, 22, 16, 16, 44, 18, 22, 22, 40].map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: `A1:M${Math.max(1, records.length + 1)}` };
    XLSX.utils.sheet_add_aoa(sheet, [[""], ["إجمالي المقبوضات", data.summary.receipts], ["إجمالي المدفوعات", data.summary.payments], ["صافي الحركة النقدية", data.summary.netCashflow], ["السندات النشطة", data.summary.activeCount], ["السندات الملغاة", data.summary.voidedCount]], { origin: -1 });
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, sheet, "سجل السندات");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return ok({ fileName: `bimmer_vouchers_${new Date().toISOString().slice(0, 10)}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64"), count: records.length });
  } catch (error) { return toActionError(error, "exportVouchersAction"); }
}

export async function hardDeleteCancelledVoucherAction(raw: unknown): Promise<ActionResult<{ id: string; transactionNumber: string }>> {
  try {
    const user = await requireUser();
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية الحذف النهائي للسندات متاحة لمدير النظام فقط.");
    const input = hardDeleteSchema.parse(raw);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TreasuryTransaction" WHERE "id" = ${input.voucherId} FOR UPDATE`);
      const voucher = await tx.treasuryTransaction.findUnique({ where: { id: input.voucherId } });
      if (!voucher) throw new BusinessRuleError("السند غير موجود.");
      if (voucher.status !== "VOIDED") throw new BusinessRuleError("لا يمكن حذف سند نشط نهائياً. ألغِ السند أولاً لعكس أثره المالي.");
      if (voucher.invoiceId || voucher.transferId || voucher.type === "TRANSFER") throw new BusinessRuleError("لا يمكن حذف سند مرتبط بفاتورة أو تحويل داخلي من سجل السندات.");
      const [checkCount, installmentCount] = await Promise.all([
        tx.accountCheck.count({ where: { settlementTxId: voucher.id } }),
        tx.installment.count({ where: { settlementTxId: voucher.id } }),
      ]);
      if (checkCount || installmentCount) throw new BusinessRuleError("لا يمكن حذف سند مرتبط بتسوية شيك أو قسط. احتفظ به كسجل ملغى للحفاظ على المرجعية.");
      await tx.treasuryTransaction.delete({ where: { id: voucher.id } });
      await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: voucher.id, action: "DELETE", oldData: voucher, newData: { event: "VOIDED_VOUCHER_PURGED", reason: input.reason, financialEffect: "already_reversed_on_void" }, performedBy: user.id });
      return { id: voucher.id, transactionNumber: voucher.transactionNumber };
    }, TX_OPTIONS));
    revalidateVoucherRegister();
    return ok(result);
  } catch (error) { return toActionError(error, "hardDeleteCancelledVoucherAction"); }
}
