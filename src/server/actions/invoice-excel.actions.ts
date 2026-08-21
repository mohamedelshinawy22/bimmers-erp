"use server";

import * as XLSX from "xlsx";
import { type InvoiceType, type PaymentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatOemNumber, num } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";

const invoiceTypes = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"] as const;
const paymentStatuses = ["PAID", "PARTIAL", "CREDIT"] as const;
const exportSchema = z.object({
  type: z.enum(["ALL", ...invoiceTypes]).default("ALL"),
  status: z.enum(["ALL", ...paymentStatuses, "VOIDED"]).default("ALL"),
  query: z.string().trim().max(160).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(["SUMMARY", "DETAILED"]),
});

type ExportInput = z.infer<typeof exportSchema>;

const typeLabels: Record<(typeof invoiceTypes)[number], string> = {
  SALE: "فاتورة بيع",
  PURCHASE: "فاتورة شراء",
  SALE_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات",
};

const summaryHeaders = [
  "م", "التاريخ", "الوقت", "رقم الفاتورة", "الفاتورة المرتجعة", "الحساب", "النوع", "طريقة السداد", "كمية", "خصم", "النهائى",
  "درج النقدية", "انستا باي (المحل)", "فودافون كاش (محمد ثروت)", "البنك ABK", "مسدد نقدا", "الآجل", "المستحق", "المخزن", "مندوب البيع", "إضافة المستخدم", "وقت الإضافة", "تعديل المستخدم", "وقت التعديل",
];

function dateStart(value?: string) { return value ? new Date(`${value}T00:00:00.000`) : undefined; }
function dateEnd(value?: string) { return value ? new Date(`${value}T23:59:59.999`) : undefined; }
function formatDate(value: Date) { return value.toLocaleDateString("en-CA"); }
function formatTime(value: Date) { return value.toLocaleTimeString("en-GB", { hour12: false }); }

function whereFrom(input: ExportInput): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (input.type !== "ALL") and.push({ type: input.type });
  if (input.status === "VOIDED") and.push({ isVoided: true });
  else {
    and.push({ isVoided: false });
    if (input.status !== "ALL") and.push({ paymentStatus: input.status });
  }
  if (input.query) {
    const { variations } = normalizeSearchTerm(input.query);
    and.push({ OR: variations.flatMap((term) => [
      { invoiceNumber: { contains: term, mode: "insensitive" } },
      { account: { name: { contains: term } } },
      { notes: { contains: term } },
      { returnOf: { invoiceNumber: { contains: term, mode: "insensitive" } } },
    ]) });
  }
  const from = dateStart(input.from);
  const to = dateEnd(input.to);
  if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  return { AND: and };
}

function isReturn(type: string) { return type === "SALE_RETURN" || type === "PURCHASE_RETURN"; }

function paymentChannels(transactions: Array<{ amount: unknown; type: string; status: string; treasury: { name: string; type: string } }>) {
  const result = { cashDrawer: 0, instapay: 0, vodafone: 0, bank: 0, paid: 0 };
  for (const tx of transactions) {
    if (tx.status !== "ACTIVE") continue;
    const amount = num(tx.amount as Parameters<typeof num>[0]);
    if (tx.type !== "RECEIPT" && tx.type !== "PAYMENT") continue;
    result.paid += amount;
    const name = tx.treasury.name.toLocaleLowerCase("ar-EG");
    if (tx.treasury.type === "INSTAPAY" || name.includes("انستا")) result.instapay += amount;
    else if (tx.treasury.type === "WALLET" || name.includes("فودافون")) result.vodafone += amount;
    else if (tx.treasury.type === "BANK_ACCOUNT" || name.includes("abk") || name.includes("بنك")) result.bank += amount;
    else result.cashDrawer += amount;
  }
  return result;
}

function applySheetStyle(sheet: XLSX.WorkSheet, rowCount: number, detail = false) {
  sheet["!cols"] = [6, 14, 11, 16, 16, 28, 16, 14, 9, 12, 14, 14, 15, 18, 14, 14, 14, 14, 17, 17, 17, 19, 17, 19].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:X${Math.max(1, rowCount)}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  for (let col = 0; col < summaryHeaders.length; col += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!sheet[address]) sheet[address] = { t: "s", v: summaryHeaders[col] };
    sheet[address].s = { fill: { fgColor: { rgb: "1F4E78" } }, font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 9 }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: { top: { style: "thin", color: { rgb: "9FBAD0" } }, bottom: { style: "thin", color: { rgb: "9FBAD0" } }, left: { style: "thin", color: { rgb: "9FBAD0" } }, right: { style: "thin", color: { rgb: "9FBAD0" } } } };
  }
  sheet["!rows"] = [{ hpt: 28 }];
  if (detail) sheet["!cols"][2] = { wch: 34 };
}

export async function exportInvoicesToExcelAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string; count: number }>> {
  try {
    await requirePermission("invoice.read");
    const input = exportSchema.parse(raw);
    const invoices = await prisma.invoice.findMany({
      where: whereFrom(input),
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true, invoiceNumber: true, type: true, subtotal: true, discountAmount: true, grandTotal: true, paidAmount: true, remainingAmount: true, paymentStatus: true, paymentMethod: true, createdAt: true, updatedAt: true,
        account: { select: { name: true } }, user: { select: { fullName: true } }, treasury: { select: { name: true } }, returnOf: { select: { invoiceNumber: true } },
        items: { select: { quantity: true, unitPrice: true, lineDiscount: true, totalPrice: true, part: { select: { oemNumber: true, nameAr: true, stockQuantity: true } } } },
        transactions: { select: { amount: true, type: true, status: true, treasury: { select: { name: true, type: true } } } },
      },
    });

    const rows: unknown[][] = [summaryHeaders];
    for (const [index, invoice] of invoices.entries()) {
      const multiplier = isReturn(invoice.type) ? -1 : 1;
      const channels = paymentChannels(invoice.transactions);
      const quantity = invoice.items.reduce((sum, item) => sum + item.quantity, 0);
      const grandTotal = num(invoice.grandTotal) * multiplier;
      const paid = num(invoice.paidAmount) * multiplier;
      const remaining = num(invoice.remainingAmount) * multiplier;
      const master = [
        index + 1, formatDate(invoice.createdAt), formatTime(invoice.createdAt), invoice.invoiceNumber, invoice.returnOf?.invoiceNumber ?? "", invoice.account.name,
        typeLabels[invoice.type as (typeof invoiceTypes)[number]], invoice.paymentMethod === "ON_ACCOUNT" ? "آجل" : invoice.paymentMethod === "SPLIT" ? "مختلط" : "نقدي", quantity, num(invoice.discountAmount), grandTotal,
        channels.cashDrawer * multiplier, channels.instapay * multiplier, channels.vodafone * multiplier, channels.bank * multiplier, paid, Math.max(0, num(invoice.grandTotal) - num(invoice.paidAmount)) * multiplier, remaining,
        invoice.treasury?.name ?? "المخزن الرئيسي", "—", invoice.user.fullName, invoice.createdAt.toLocaleString("ar-EG"), "—", invoice.updatedAt.toLocaleString("ar-EG"),
      ];
      rows.push(master);
      if (input.mode === "DETAILED") {
        const detailHeader = ["", "رقم الصنف (OEM)", "اسم الصنف", "وحدة", "المتاح", "كمية", "السعر", "الخصم", "النهائى"];
        rows.push(detailHeader);
        for (const item of invoice.items) rows.push(["", formatOemNumber(item.part.oemNumber), item.part.nameAr, "قطعة", item.part.stockQuantity, item.quantity, num(item.unitPrice), num(item.lineDiscount), num(item.totalPrice) * multiplier]);
        rows.push(["", "", "إجمالي الفاتورة", "", "", quantity, "", num(invoice.discountAmount), grandTotal]);
        rows.push([]);
      }
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    applySheetStyle(sheet, rows.length, input.mode === "DETAILED");
    if (input.mode === "DETAILED") {
      for (let row = 1; row < rows.length; row += 1) {
        const first = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v;
        const second = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v;
        if (first === "" && second === "رقم الصنف (OEM)") {
          for (let col = 0; col < 9; col += 1) {
            const address = XLSX.utils.encode_cell({ r: row, c: col });
            if (!sheet[address]) sheet[address] = { t: "s", v: "" };
            sheet[address].s = { fill: { fgColor: { rgb: "D9EAF7" } }, font: { bold: true, color: { rgb: "1F1F1F" }, name: "Segoe UI", sz: 8 }, alignment: { horizontal: "center", vertical: "center" } };
          }
        }
      }
    }
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, sheet, input.mode === "SUMMARY" ? "تقرير إجمالي" : "تقرير تفصيلي");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
    const stamp = new Date().toISOString().slice(0, 10);
    return ok({ fileName: `bimmer_invoice_${input.mode === "SUMMARY" ? "summary" : "detailed"}_${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64"), count: invoices.length });
  } catch (error) {
    return toActionError(error, "exportInvoicesToExcelAction");
  }
}
