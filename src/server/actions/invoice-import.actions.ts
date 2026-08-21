"use server";

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission, can } from "@/lib/auth";
import { getUserAccess, hasPermission, canUseTreasury } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/errors";
import { formatOemNumber } from "@/lib/utils";
import { createInvoiceReturn, createPurchaseInvoice, createSaleInvoice } from "@/server/services/invoice.service";
import { nextAccountNumber, nextInvoiceNumber, nextTransactionNumber } from "@/server/services/numbering.service";
import { lockAccountForUpdate, lockPartsForUpdate, lockTreasuriesForUpdate } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const invoiceImportTypes = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"] as const;
type InvoiceImportType = (typeof invoiceImportTypes)[number];
const documentTypes = invoiceImportTypes;
const typeLabel: Record<InvoiceImportType, string> = { SALE: "فواتير البيع", PURCHASE: "فواتير الشراء", SALE_RETURN: "مرتجعات البيع", PURCHASE_RETURN: "مرتجعات الشراء" };
const permissionForType = (type: InvoiceImportType) => type === "SALE" || type === "SALE_RETURN" ? "invoice.sale" : "invoice.purchase";
const numberValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const moneyValue = (value: unknown) => Math.abs(numberValue(value));
const normalizeKey = (value: string) => value.replace(/[\s\-_/.]/g, "").toLocaleLowerCase("ar-EG");
const normalizeType = (value: unknown) => {
  const token = String(value ?? "SALE").trim().toUpperCase();
  if (["SALE", "بيع", "فاتورة بيع", "مبيعات"].includes(token)) return "SALE";
  if (["PURCHASE", "شراء", "فاتورة شراء", "مشتريات"].includes(token)) return "PURCHASE";
  if (["SALE_RETURN", "مرتجع بيع", "مرتجع مبيعات"].includes(token)) return "SALE_RETURN";
  if (["PURCHASE_RETURN", "مرتجع شراء", "مرتجع مشتريات"].includes(token)) return "PURCHASE_RETURN";
  return token;
};
const normalizePayment = (value: unknown) => {
  const token = String(value ?? "").trim().toUpperCase();
  if (["آجل", "ON_ACCOUNT", "CREDIT"].includes(token)) return "ON_ACCOUNT" as const;
  if (["VISA", "بطاقة", "شبكة"].includes(token)) return "VISA" as const;
  if (["SPLIT", "مختلط"].includes(token)) return "SPLIT" as const;
  return "CASH" as const;
};

const rawLineSchema = z.object({
  sourceRowNumber: z.coerce.number().int().positive().optional(),
  documentNumber: z.string().trim().min(1, "رقم الفاتورة في ملف الاستيراد مطلوب.").max(120),
  type: z.preprocess(normalizeType, z.enum(documentTypes, { error: "نوع المستند غير صالح." })),
  accountName: z.string().trim().max(200).optional().or(z.literal("")).default(""),
  accountPhone: z.string().trim().max(40).optional().or(z.literal("")),
  originalInvoiceNumber: z.string().trim().max(120).optional().or(z.literal("")),
  treasuryName: z.string().trim().max(160).optional().or(z.literal("")),
  cashDrawer: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  instapay: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  vodafoneCash: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  bankAbk: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  creditAmount: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  dueAmount: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  warehouse: z.string().trim().max(160).optional().or(z.literal("")),
  paymentMethod: z.preprocess(normalizePayment, z.enum(["CASH", "VISA", "SPLIT", "ON_ACCOUNT"])),
  oemNumber: z.string().trim().max(120).optional().or(z.literal("")),
  partName: z.string().trim().max(240).optional().or(z.literal("")),
  quantity: z.preprocess(numberValue, z.number().int().min(0).max(100_000)).default(0),
  unitPrice: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  grandTotal: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  lineDiscount: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  paidAmount: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
const importSchema = z.object({ type: z.enum(documentTypes), mode: z.enum(["SUMMARY", "DETAILED"]), rows: z.array(z.unknown()).min(1).max(10_000), skipInvalidRows: z.boolean().default(true), autoCreateAccounts: z.boolean().default(false) });
const templateSchema = z.object({ type: z.enum(documentTypes), format: z.enum(["SUMMARY", "DETAILED"]).default("DETAILED") });
type ValidLine = z.infer<typeof rawLineSchema>;

function headersForTemplate(mode: "SUMMARY" | "DETAILED") {
  return mode === "SUMMARY"
    ? ["رقم الفاتورة", "التاريخ", "الحساب", "رقم الهاتف", "طريقة السداد", "النهائى", "مسدد نقدا", "الآجل", "الخزينة", "الفاتورة المرتجعة", "ملاحظات"]
    : ["م", "التاريخ", "الوقت", "رقم الفاتورة", "الحساب", "رقم الهاتف", "طريقة السداد", "النهائى", "مسدد نقدا", "الآجل", "الخزينة", "الفاتورة المرتجعة", "ملاحظات"];
}

function styleHeader(sheet: XLSX.WorkSheet, row: number, columns: number) {
  for (let col = 0; col < columns; col += 1) {
    const cell = XLSX.utils.encode_cell({ r: row, c: col });
    if (!sheet[cell]) continue;
    sheet[cell].s = { fill: { fgColor: { rgb: "1F4E78" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
  }
}

function importTemplateWorkbook(type: InvoiceImportType, format: "SUMMARY" | "DETAILED") {
  const isReturn = type === "SALE_RETURN" || type === "PURCHASE_RETURN";
  const party = type === "PURCHASE" || type === "PURCHASE_RETURN" ? "المورد" : "العميل";
  const returnSource = isReturn ? "INV-أصلية-0001" : "";
  const summaryHeaders = headersForTemplate("SUMMARY");
  const summaryExample = ["EXT-0001", "2026-08-21", party, "", type === "PURCHASE" ? "آجل" : "نقدي", 1200, type === "PURCHASE" ? 0 : 1200, type === "PURCHASE" ? 1200 : 0, type === "PURCHASE" ? "" : "الخزينة الرئيسية", returnSource, `استيراد مالي إجمالي ${typeLabel[type]}`];
  const detailHeaders = headersForTemplate("DETAILED");
  const itemHeaders = ["", "رقم الصنف/OEM", "اسم الصنف", "كمية", "السعر", "خصم", "النهائى"];
  const detailedRows = [
    detailHeaders,
    [1, "2026-08-21", "10:00", "EXT-0001", party, "", type === "PURCHASE" ? "آجل" : "نقدي", 1200, type === "PURCHASE" ? 0 : 1200, type === "PURCHASE" ? 1200 : 0, type === "PURCHASE" ? "" : "الخزينة الرئيسية", returnSource, `استيراد تفصيلي ${typeLabel[type]}`],
    itemHeaders,
    ["", "17118484638", "اسم الصنف", 1, 1200, 0, 1200],
    ["", "", "", 1, "", 0, 1200],
    [],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(format === "SUMMARY" ? [summaryHeaders, summaryExample] : detailedRows);
  sheet["!cols"] = (format === "SUMMARY" ? [18, 16, 28, 18, 16, 14, 14, 14, 22, 20, 36] : [7, 22, 28, 18, 28, 18, 16, 14, 14, 14, 22, 20, 36]).map((wch) => ({ wch }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  sheet["!autofilter"] = { ref: format === "SUMMARY" ? "A1:K2" : "A1:M2" };
  styleHeader(sheet, 0, format === "SUMMARY" ? summaryHeaders.length : detailHeaders.length);
  if (format === "DETAILED") styleHeader(sheet, 2, itemHeaders.length);
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, sheet, format === "SUMMARY" ? "استيراد إجمالي" : "استيراد تفصيلي");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

function inputRows(raw: unknown[]) {
  return raw.map((row, index) => ({ sourceRowNumber: index + 2, ...row as Record<string, unknown> }));
}

async function createMissingAccountForImport(line: ValidLine, type: InvoiceImportType, userId: string) {
  const accountType = type === "PURCHASE" || type === "PURCHASE_RETURN" ? "SUPPLIER" as const : "CUSTOMER" as const;
  const prefix = accountType === "SUPPLIER" ? "SUP" : "ACC";
  return withTxRetry(() => prisma.$transaction(async (tx) => {
    const existing = await tx.account.findFirst({ where: { OR: [{ name: { equals: line.accountName } }, ...(line.accountPhone ? [{ phone: line.accountPhone }] : [])] }, select: { id: true, name: true, type: true } });
    if (existing) return existing;
    const account = await tx.account.create({ data: { accountNumber: await nextAccountNumber(tx, prefix), name: line.accountName, type: accountType, phone: line.accountPhone || null, currentBalance: 0, isActive: true, status: "ACTIVE" }, select: { id: true, name: true, type: true } });
    await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "INSERT", newData: { importedFromInvoiceExcel: true, type, name: account.name }, performedBy: userId });
    return account;
  }, TX_OPTIONS));
}

function financialAmount(line: ValidLine) {
  const gross = new Prisma.Decimal(line.grandTotal || Math.max(0, line.quantity * line.unitPrice - line.lineDiscount));
  return gross.abs().toDecimalPlaces(2);
}

function isWalkInCashAccount(value: string | undefined) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("ar-EG");
  return !normalized || ["نقدي", "كاش", "عميل نقدي", "عميل نقدى"].includes(normalized);
}

async function getOrCreateWalkInCashAccount(userId: string) {
  return withTxRetry(() => prisma.$transaction(async (tx) => {
    const existing = await tx.account.findFirst({ where: { type: "CUSTOMER", OR: [{ accountNumber: "ACC-0001" }, { name: { in: ["عميل نقدي افتراضي", "عميل نقدي"] } }] }, select: { id: true, name: true, type: true } });
    if (existing) return existing;
    const account = await tx.account.create({ data: { accountNumber: await nextAccountNumber(tx, "ACC"), name: "عميل نقدي افتراضي", type: "CUSTOMER", currentBalance: 0, isActive: true, status: "ACTIVE", category: "WALK_IN_CASH" }, select: { id: true, name: true, type: true } });
    await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "INSERT", newData: { createdForInvoiceImport: true, role: "walkInCash" }, performedBy: userId });
    return account;
  }, TX_OPTIONS));
}

function importedPaymentChannels(line: ValidLine) {
  const channels = [
    { treasuryType: "CASH_DRAWER" as const, amount: new Prisma.Decimal(line.cashDrawer).abs(), label: "درج النقدية" },
    { treasuryType: "INSTAPAY" as const, amount: new Prisma.Decimal(line.instapay).abs(), label: "إنستا باي" },
    { treasuryType: "WALLET" as const, amount: new Prisma.Decimal(line.vodafoneCash).abs(), label: "فودافون كاش" },
    { treasuryType: "BANK_ACCOUNT" as const, amount: new Prisma.Decimal(line.bankAbk).abs(), label: "البنك ABK" },
  ].filter((channel) => channel.amount.gt(0));
  if (channels.length) return channels;
  const paidAmount = new Prisma.Decimal(line.paidAmount).abs();
  return paidAmount.gt(0) ? [{ treasuryType: "CASH_DRAWER" as const, amount: paidAmount, label: "السداد النقدي" }] : [];
}

async function postDetailedImportedInvoice(args: { type: InvoiceImportType; lines: Array<{ line: ValidLine; part: { id: string; oemNumber: string; nameAr: string } | null }>; accountId: string; userId: string; jobId: string }) {
  const first = args.lines[0]?.line;
  if (!first) throw new BusinessRuleError("الفاتورة لا تحتوي على بنود قابلة للترحيل.");
  const grandTotal = financialAmount(first);
  if (grandTotal.lte(0)) throw new BusinessRuleError("الإجمالي النهائي للفاتورة مطلوب.");
  const channels = importedPaymentChannels(first);
  const paidAmount = channels.reduce((total, channel) => total.add(channel.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const statedCredit = Prisma.Decimal.max(new Prisma.Decimal(first.creditAmount).abs(), new Prisma.Decimal(first.dueAmount).abs());
  const remainingAmount = statedCredit.gt(0) ? statedCredit.toDecimalPlaces(2) : Prisma.Decimal.max(new Prisma.Decimal(0), grandTotal.sub(paidAmount)).toDecimalPlaces(2);
  const outbound = args.type === "PURCHASE" || args.type === "SALE_RETURN";
  const stockReason = args.type === "SALE" ? "SALE" : args.type === "PURCHASE" ? "PURCHASE" : args.type === "SALE_RETURN" ? "SALE_RETURN" : "PURCHASE_RETURN";
  const balanceAfter = (before: Prisma.Decimal) => args.type === "SALE" || args.type === "PURCHASE_RETURN" ? before.sub(remainingAmount) : before.add(remainingAmount);
  const linkedPartIds = [...new Set(args.lines.flatMap(({ part }) => part ? [part.id] : []))];

  return withTxRetry(() => prisma.$transaction(async (tx) => {
    const account = await lockAccountForUpdate(tx, args.accountId);
    const parts = await lockPartsForUpdate(tx, linkedPartIds);
    const treasuryRows = channels.length ? await tx.treasury.findMany({ where: { isActive: true, type: { in: [...new Set(channels.map((channel) => channel.treasuryType))] } }, select: { id: true, name: true, type: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }) : [];
    const treasuryIdByType = new Map<string, string>();
    for (const channel of channels) {
      const candidates = treasuryRows.filter((treasury) => treasury.type === channel.treasuryType);
      const selected = candidates.find((treasury) => treasury.isDefault) ?? candidates[0];
      if (!selected) throw new BusinessRuleError(`لا توجد خزينة نشطة مهيأة لقناة ${channel.label}.`);
      treasuryIdByType.set(channel.treasuryType, selected.id);
    }
    if (treasuryIdByType.size) await lockTreasuriesForUpdate(tx, [...treasuryIdByType.values()]);
    const baseType = args.type === "SALE_RETURN" ? "SALE" : args.type === "PURCHASE_RETURN" ? "PURCHASE" : null;
    const original = baseType && first.originalInvoiceNumber ? await tx.invoice.findFirst({ where: { invoiceNumber: first.originalInvoiceNumber, type: baseType, isVoided: false }, select: { id: true, accountId: true } }) : null;
    const invoiceNumber = await nextInvoiceNumber(tx, args.type);
    const invoice = await tx.invoice.create({ data: {
      invoiceNumber, type: args.type, accountId: account.id, treasuryId: channels.length === 1 ? treasuryIdByType.get(channels[0]!.treasuryType) ?? null : null, userId: args.userId,
      subtotal: grandTotal, discountAmount: 0, taxAmount: 0, grandTotal, paidAmount, remainingAmount,
      paymentStatus: remainingAmount.eq(0) ? "PAID" : paidAmount.gt(0) ? "PARTIAL" : "CREDIT",
      paymentMethod: remainingAmount.gt(0) && paidAmount.eq(0) ? "ON_ACCOUNT" : channels.length > 1 ? "SPLIT" : "CASH",
      returnOfId: original?.accountId === account.id ? original.id : null,
      accountBalanceBefore: account.currentBalance, accountBalanceAfter: balanceAfter(account.currentBalance),
      notes: [`استيراد تفصيلي ${args.jobId}`, `مرجع الملف: ${first.documentNumber}`, first.notes, args.lines.some(({ part }) => !part) ? "يتضمن أصنافاً نصية غير مرتبطة بالمخزن" : ""].filter(Boolean).join(" — "),
    } });
    const runningStock = new Map<string, number>();
    for (const { line, part } of args.lines) {
      const linked = part ? parts.get(part.id) : null;
      const quantity = line.quantity;
      const delta = args.type === "SALE" || args.type === "PURCHASE_RETURN" ? -quantity : quantity;
      const previous = linked ? runningStock.get(linked.id) ?? linked.stockQuantity : 0;
      const next = previous + delta;
      if (linked) runningStock.set(linked.id, next);
      await tx.invoiceItem.create({ data: {
        invoiceId: invoice.id, partId: linked?.id ?? null, partNameSnapshot: line.partName || linked?.nameAr || "صنف غير محدد", oemNumberSnapshot: line.oemNumber || linked?.oemNumber || null,
        quantity, unitPrice: new Prisma.Decimal(line.unitPrice).abs(), unitCostSnapshot: linked?.buyPriceAvg ?? new Prisma.Decimal(0), totalPrice: new Prisma.Decimal(Math.abs(line.quantity * line.unitPrice - line.lineDiscount)), lineDiscount: new Prisma.Decimal(line.lineDiscount).abs(), binLocationSnapshot: linked?.binFullCode ?? null,
      } });
      if (linked) {
        await tx.partItem.update({ where: { id: linked.id }, data: { stockQuantity: next } });
        await tx.stockMovement.create({ data: { partId: linked.id, invoiceId: invoice.id, reason: stockReason, quantityDelta: delta, balanceAfter: next, unitCost: linked.buyPriceAvg, performedById: args.userId, note: `استيراد Excel تفصيلي - ${invoiceNumber}` } });
      }
    }
    for (const channel of channels) {
      const treasuryId = treasuryIdByType.get(channel.treasuryType)!;
      await tx.treasury.update({ where: { id: treasuryId }, data: outbound ? { currentBalance: { decrement: channel.amount } } : { currentBalance: { increment: channel.amount } } });
      await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId, accountId: account.id, invoiceId: invoice.id, type: outbound ? "PAYMENT" : "RECEIPT", amount: channel.amount, category: "IMPORT_DETAILED", description: `${outbound ? "صرف" : "تحصيل"} استيراد ${channel.label} - ${invoiceNumber}`, createdByUser: args.userId } });
    }
    if (remainingAmount.gt(0)) await tx.account.update({ where: { id: account.id }, data: args.type === "SALE" || args.type === "PURCHASE_RETURN" ? { currentBalance: { decrement: remainingAmount } } : { currentBalance: { increment: remainingAmount } } });
    await writeAudit(tx, { tableName: "Invoice", recordId: invoice.id, action: "INSERT", newData: { ...invoice, importMode: "DETAILED", linkedItemCount: args.lines.filter(({ part }) => Boolean(part)).length, unlinkedTextItemCount: args.lines.filter(({ part }) => !part).length, stockEffect: "CATALOG_LINKED_ONLY" }, performedBy: args.userId });
    return { invoiceId: invoice.id, invoiceNumber };
  }, TX_OPTIONS));
}

async function postSummaryFinancialInvoice(args: { type: InvoiceImportType; line: ValidLine; accountId: string; treasuryId?: string; userId: string; jobId: string }) {
  const grandTotal = financialAmount(args.line);
  if (grandTotal.lte(0)) throw new BusinessRuleError("الإجمالي النهائي مطلوب في الاستيراد المالي ولا يجوز أن يساوي صفراً.");
  const paidAmount = Prisma.Decimal.min(new Prisma.Decimal(args.line.paidAmount).abs(), grandTotal).toDecimalPlaces(2);
  const remainingAmount = grandTotal.sub(paidAmount).toDecimalPlaces(2);
  const outbound = args.type === "PURCHASE" || args.type === "SALE_RETURN";
  const baseType = args.type === "SALE_RETURN" ? "SALE" : args.type === "PURCHASE_RETURN" ? "PURCHASE" : null;
  return withTxRetry(() => prisma.$transaction(async (tx) => {
    const account = await lockAccountForUpdate(tx, args.accountId);
    const original = baseType && args.line.originalInvoiceNumber
      ? await tx.invoice.findFirst({ where: { invoiceNumber: args.line.originalInvoiceNumber, type: baseType, isVoided: false }, select: { id: true, accountId: true } })
      : null;
    if (baseType && (!original || original.accountId !== account.id)) throw new BusinessRuleError("يجب ربط المرتجع المالي بفاتورة أصلية نشطة للحساب نفسه.");
    let treasury = null;
    if (paidAmount.gt(0)) {
      if (!args.treasuryId) throw new BusinessRuleError("حدد خزينة نشطة للمبلغ المسدد في الاستيراد المالي.");
      treasury = (await lockTreasuriesForUpdate(tx, [args.treasuryId])).get(args.treasuryId) ?? null;
      if (!treasury?.isActive) throw new BusinessRuleError("الخزينة المحددة غير نشطة.");
      if (outbound && treasury.currentBalance.lt(paidAmount)) throw new BusinessRuleError(`السيولة غير كافية في الخزينة ${treasury.name}.`);
    }
    const invoiceNumber = await nextInvoiceNumber(tx, args.type);
    const paymentStatus = remainingAmount.eq(0) ? "PAID" : paidAmount.gt(0) ? "PARTIAL" : "CREDIT";
    const invoice = await tx.invoice.create({ data: {
      invoiceNumber, type: args.type, accountId: account.id, treasuryId: treasury?.id ?? null, userId: args.userId,
      subtotal: grandTotal, discountAmount: 0, taxAmount: 0, grandTotal, paidAmount, remainingAmount, paymentStatus,
      paymentMethod: remainingAmount.gt(0) && paidAmount.eq(0) ? "ON_ACCOUNT" : "CASH", returnOfId: original?.id ?? null,
      accountBalanceBefore: account.currentBalance, accountBalanceAfter: args.type === "SALE" ? account.currentBalance.sub(remainingAmount) : args.type === "PURCHASE" ? account.currentBalance.add(remainingAmount) : args.type === "SALE_RETURN" ? account.currentBalance.add(remainingAmount) : account.currentBalance.sub(remainingAmount),
      notes: [`استيراد مالي إجمالي ${args.jobId}`, `مرجع الملف: ${args.line.documentNumber}`, args.line.notes, "دون بنود أصناف أو حركة مخزنية"].filter(Boolean).join(" — "),
    } });
    if (paidAmount.gt(0) && treasury) {
      await tx.treasury.update({ where: { id: treasury.id }, data: outbound ? { currentBalance: { decrement: paidAmount } } : { currentBalance: { increment: paidAmount } } });
      await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId: treasury.id, accountId: account.id, invoiceId: invoice.id, type: outbound ? "PAYMENT" : "RECEIPT", amount: paidAmount, category: "IMPORT_SUMMARY", description: `${outbound ? "صرف" : "تحصيل"} استيراد إجمالي ${invoiceNumber}`, createdByUser: args.userId } });
    }
    if (remainingAmount.gt(0)) {
      await tx.account.update({ where: { id: account.id }, data: args.type === "SALE" || args.type === "PURCHASE_RETURN" ? { currentBalance: { decrement: remainingAmount } } : { currentBalance: { increment: remainingAmount } } });
    }
    await writeAudit(tx, { tableName: "Invoice", recordId: invoice.id, action: "INSERT", newData: { ...invoice, importMode: "SUMMARY", itemCount: 0, stockEffect: "NONE" }, performedBy: args.userId });
    return { invoiceId: invoice.id, invoiceNumber };
  }, TX_OPTIONS));
}

function modeValidationIssue(line: ValidLine, mode: "SUMMARY" | "DETAILED") {
  if (mode === "SUMMARY") return financialAmount(line).gt(0) ? undefined : "الإجمالي النهائي مطلوب في الاستيراد المالي ولا يجوز أن يساوي صفراً.";
  if (!line.oemNumber?.trim() && !line.partName?.trim()) return "رقم الصنف/OEM أو اسم الصنف مطلوب في الاستيراد التفصيلي.";
  if (line.quantity <= 0) return "كمية الصنف يجب أن تكون أكبر من صفر في الاستيراد التفصيلي.";
  return undefined;
}

async function matchLine(line: ValidLine, type: InvoiceImportType, mode: "SUMMARY" | "DETAILED") {
  const oem = normalizeKey(line.oemNumber ?? "");
  const cashFallback = isWalkInCashAccount(line.accountName);
  const accountTypes = type === "PURCHASE" || type === "PURCHASE_RETURN" ? ["SUPPLIER"] as const : ["CUSTOMER", "WORKSHOP_BMW"] as const;
  const [accounts, parts, treasuries] = await Promise.all([
    cashFallback
      ? prisma.account.findMany({ where: { isActive: true, type: "CUSTOMER", OR: [{ accountNumber: "ACC-0001" }, { name: { in: ["عميل نقدي افتراضي", "عميل نقدي"] } }] }, select: { id: true, name: true, type: true } })
      : prisma.account.findMany({ where: { isActive: true, type: { in: [...accountTypes] }, OR: [{ name: { equals: line.accountName } }, ...(line.accountPhone ? [{ phone: line.accountPhone }] : [])] }, select: { id: true, name: true, type: true } }),
    mode === "DETAILED" && (oem || line.partName?.trim())
      ? prisma.$queryRaw<Array<{ id: string; oemNumber: string; nameAr: string }>>(Prisma.sql`SELECT id, "oemNumber", "nameAr" FROM "PartItem" WHERE (${oem ? Prisma.sql`lower(regexp_replace("oemNumber", '[[:space:]_./-]', '', 'g')) = ${oem}` : Prisma.sql`FALSE`}) OR (${line.partName?.trim() ? Prisma.sql`"nameAr" = ${line.partName.trim()}` : Prisma.sql`FALSE`}) LIMIT 5`)
      : Promise.resolve([]),
    line.treasuryName ? prisma.treasury.findMany({ where: { isActive: true, name: { equals: line.treasuryName } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return { account: accounts.length === 1 ? accounts[0] : null, accountCandidates: accounts, cashFallback, part: parts.length === 1 ? parts[0] : null, partCandidates: parts, treasury: treasuries.length === 1 ? treasuries[0] : null, treasuryCandidates: treasuries };
}

export async function downloadInvoiceImportTemplateAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  try {
    const input = templateSchema.parse(raw);
    await requirePermission(permissionForType(input.type));
    const buffer = importTemplateWorkbook(input.type, input.format);
    return ok({ fileName: `نموذج_استيراد_${typeLabel[input.type]}_${input.format === "SUMMARY" ? "ملخص" : "تفصيلي"}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64") });
  } catch (error) { return toActionError(error, "downloadInvoiceImportTemplateAction"); }
}

export async function previewInvoiceImportAction(raw: unknown): Promise<ActionResult<{ total: number; valid: number; invalid: Array<{ row: number; reason: string }>; rows: Array<{ row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; partName: string; grandTotal: number; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; accountStatus: "CASH_FALLBACK" | "MATCHED" | "AUTO_CREATE" | "NOT_FOUND"; partStatus: "NOT_APPLICABLE" | "MATCHED_CATALOG" | "UNLINKED_TEXT_ITEM"; isValid: boolean; reason?: string; suggestedFix?: string; errorCode?: "ACCOUNT_NOT_FOUND" | "INVALID_QUANTITY" | "INVALID_AMOUNT" | "TREASURY_NOT_FOUND" | "TYPE_MISMATCH" | "FORMAT_INVALID" }> }>> {
  try {
    const input = importSchema.parse(raw);
    await requirePermission(permissionForType(input.type));
    const parsed = inputRows(input.rows).map((row) => ({ row: Number(row.sourceRowNumber), raw: row, result: rawLineSchema.safeParse(row) }));
    type PreviewRow = { row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; partName: string; grandTotal: number; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; accountStatus: "CASH_FALLBACK" | "MATCHED" | "AUTO_CREATE" | "NOT_FOUND"; partStatus: "NOT_APPLICABLE" | "MATCHED_CATALOG" | "UNLINKED_TEXT_ITEM"; isValid: boolean; reason?: string; suggestedFix?: string; errorCode?: "ACCOUNT_NOT_FOUND" | "INVALID_QUANTITY" | "INVALID_AMOUNT" | "TREASURY_NOT_FOUND" | "TYPE_MISMATCH" | "FORMAT_INVALID" };
    const preview: PreviewRow[] = [];
    const rawString = (row: Record<string, unknown>, key: string) => String(row[key] ?? "").trim();
    const resolutionFor = (reason: string) => {
      if (reason.includes("الحساب")) return { errorCode: "ACCOUNT_NOT_FOUND" as const, suggestedFix: "فعّل إنشاء الحسابات غير الموجودة تلقائياً ليُنشأ الحساب بالنوع الصحيح." };
      if (reason.includes("كمية")) return { errorCode: "INVALID_QUANTITY" as const, suggestedFix: "تأكد من إدخال كمية عددية صحيحة أكبر من صفر في ملف Excel." };
      if (reason.includes("الإجمالي") || reason.includes("سعر") || reason.includes("مبلغ")) return { errorCode: "INVALID_AMOUNT" as const, suggestedFix: "راجع السعر والإجمالي والمدفوع وتأكد من أنها قيم رقمية صحيحة." };
      if (reason.includes("خزينة")) return { errorCode: "TREASURY_NOT_FOUND" as const, suggestedFix: "حدد خزينة نشطة مطابقة، أو راجع اسم الخزينة في الملف." };
      if (reason.includes("نوع الصف")) return { errorCode: "TYPE_MISMATCH" as const, suggestedFix: `استخدم معالج ${typeLabel[input.type]} أو صحح نوع المستند في الصف.` };
      return { errorCode: "FORMAT_INVALID" as const, suggestedFix: "راجع الحقول المطلوبة وتنسيق الصف في ملف Excel." };
    };
    for (const entry of parsed) {
      if (!entry.result.success) {
        const reason = (entry.result as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ");
        preview.push({ row: entry.row, documentNumber: rawString(entry.raw, "documentNumber"), type: rawString(entry.raw, "type"), accountName: rawString(entry.raw, "accountName"), oemNumber: formatOemNumber(rawString(entry.raw, "oemNumber")), partName: rawString(entry.raw, "partName"), grandTotal: 0, accountMatched: false, partMatched: false, treasuryMatched: false, accountStatus: "NOT_FOUND", partStatus: "NOT_APPLICABLE", isValid: false, reason, ...resolutionFor(reason) });
        continue;
      }
      const line = entry.result.data;
      if (line.type !== input.type) {
        const reason = `نوع الصف لا يطابق معالج ${typeLabel[input.type]}.`;
        preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName, oemNumber: formatOemNumber(line.oemNumber), partName: line.partName || "", grandTotal: Number(financialAmount(line)), accountMatched: false, partMatched: false, treasuryMatched: false, accountStatus: "NOT_FOUND", partStatus: "NOT_APPLICABLE", isValid: false, reason, ...resolutionFor(reason) });
        continue;
      }
      const match = await matchLine(line, input.type, input.mode);
      const needsTreasury = line.paidAmount > 0;
      const modeIssue = modeValidationIssue(line, input.mode);
      const accountMissing = !match.account && !match.cashFallback && !input.autoCreateAccounts;
      const reason = modeIssue ?? (accountMissing ? `الحساب (${line.accountName}) غير مسجل في المنظومة وتم إيقاف الإنشاء التلقائي.` : input.mode === "SUMMARY" && needsTreasury && !match.treasury ? "تعذر مطابقة الخزينة النشطة." : undefined);
      preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName || "عميل نقدي افتراضي", oemNumber: formatOemNumber(line.oemNumber), partName: line.partName || "", grandTotal: Number(financialAmount(line)), accountMatched: Boolean(match.account) || match.cashFallback || input.autoCreateAccounts, partMatched: input.mode === "SUMMARY" || Boolean(match.part), treasuryMatched: input.mode === "DETAILED" || !needsTreasury || Boolean(match.treasury), isValid: !reason, reason, ...(reason ? resolutionFor(reason) : {}), accountStatus: match.cashFallback ? "CASH_FALLBACK" : match.account ? "MATCHED" : input.autoCreateAccounts ? "AUTO_CREATE" : "NOT_FOUND", partStatus: input.mode === "SUMMARY" ? "NOT_APPLICABLE" : match.part ? "MATCHED_CATALOG" : "UNLINKED_TEXT_ITEM" });
    }
    const invalid = preview.filter((row) => !row.isValid).map((row) => ({ row: row.row, reason: row.reason ?? "صف غير صالح." }));
    return ok({ total: input.rows.length, valid: preview.filter((row) => row.isValid).length, invalid, rows: preview });
  } catch (error) { return toActionError(error, "previewInvoiceImportAction"); }
}

export async function executeInvoiceImportAction(raw: unknown): Promise<ActionResult<{ jobId: string; total: number; created: number; skipped: number; invalid: Array<{ row: number; reason: string }> }>> {
  try {
    const input = importSchema.parse(raw);
    const user = await requirePermission(permissionForType(input.type));
    const parsed = inputRows(input.rows).map((row) => ({ row: Number(row.sourceRowNumber), result: rawLineSchema.safeParse(row) }));
    const invalid = parsed.filter((entry) => !entry.result.success).map((entry) => ({ row: entry.row, reason: (entry.result as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ") }));
    const typeInvalid = parsed.filter((entry) => entry.result.success && entry.result.data.type !== input.type).map((entry) => ({ row: entry.row, reason: `نوع الصف لا يطابق معالج ${typeLabel[input.type]}.` }));
    const modeInvalid = parsed.filter((entry): entry is { row: number; result: { success: true; data: ValidLine } } => entry.result.success && entry.result.data.type === input.type).map((entry) => ({ row: entry.row, reason: modeValidationIssue(entry.result.data, input.mode) })).filter((entry): entry is { row: number; reason: string } => Boolean(entry.reason));
    invalid.push(...typeInvalid, ...modeInvalid);
    const invalidRows = new Set(invalid.map((entry) => entry.row));
    const lines = parsed.filter((entry): entry is { row: number; result: { success: true; data: ValidLine } } => entry.result.success && entry.result.data.type === input.type && !invalidRows.has(entry.row)).map((entry) => ({ ...entry.result.data, sourceRowNumber: entry.row }));
    if (invalid.length && !input.skipInvalidRows) throw new BusinessRuleError(`يوجد ${invalid.length} صف غير صالح. صحح البيانات أو فعّل التخطي.`);
    if (!lines.length) throw new BusinessRuleError("لا توجد صفوف صالحة لاستيراد الفواتير.");
    const checksum = createHash("sha256").update(JSON.stringify({ type: input.type, mode: input.mode, lines })).digest("hex");
    const previous = await prisma.importJob.findFirst({ where: { type: "INVOICES", checksum, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (previous) return ok({ jobId: previous.id, total: input.rows.length, created: 0, skipped: lines.length, invalid });
    const job = await prisma.importJob.create({ data: { type: "INVOICES", status: "PROCESSING", checksum, mapping: { type: input.type, mode: input.mode, headers: headersForTemplate(input.mode), skipInvalidRows: input.skipInvalidRows, autoCreateAccounts: input.autoCreateAccounts }, createdById: user.id } });
    let created = 0;
    let skipped = 0;
    try {
      const grouped = new Map<string, typeof lines>();
      for (const line of lines) grouped.set(`${line.type}:${line.documentNumber}`, [...(grouped.get(`${line.type}:${line.documentNumber}`) ?? []), line]);
      const access = await getUserAccess(user.id);
      for (const group of grouped.values()) {
        const first = group.at(0);
        if (!first) { skipped += 1; continue; }
        const paired = await Promise.all(group.map(async (line) => {
          const match = await matchLine(line, input.type, input.mode);
          if (!match.account && match.cashFallback) {
            const account = await getOrCreateWalkInCashAccount(user.id);
            return { line, match: { ...match, account } };
          }
          if (!match.account && input.autoCreateAccounts) {
            const account = await createMissingAccountForImport(line, input.type, user.id);
            return { line, match: { ...match, account } };
          }
          return { line, match };
        }));
        if (input.mode === "SUMMARY" && group.length !== 1) {
          const reason = "الاستيراد المالي الإجمالي يتطلب صفاً واحداً فقط لكل رقم فاتورة.";
          invalid.push(...group.map((line) => ({ row: line.sourceRowNumber, reason })));
          if (!input.skipInvalidRows) throw new BusinessRuleError(`${reason} المرجع: ${first.documentNumber}`);
          skipped += group.length;
          continue;
        }
        const issue = paired.find(({ line, match }) => !match.account || (input.mode === "SUMMARY" && line.paidAmount > 0 && !match.treasury));
        if (issue) {
          const reason = !issue.match.account ? "تعذر مطابقة الحساب بشكل فريد." : "تعذر مطابقة الخزينة النشطة.";
          invalid.push({ row: issue.line.sourceRowNumber, reason });
          if (!input.skipInvalidRows) throw new BusinessRuleError(`الصف ${issue.line.sourceRowNumber}: ${reason}`);
          skipped += group.length;
          continue;
        }
        const firstMatch = paired.at(0)?.match;
        if (!firstMatch?.account) { skipped += 1; continue; }
        const account = firstMatch.account;
        const treasuryId = firstMatch.treasury?.id;
        if (input.mode === "SUMMARY") {
          await postSummaryFinancialInvoice({ type: first.type, line: first, accountId: account.id, treasuryId: firstMatch.treasury?.id, userId: user.id, jobId: job.id });
          created += 1;
          continue;
        }
        if (input.mode === "DETAILED") {
          await postDetailedImportedInvoice({ type: first.type, lines: paired.map(({ line, match }) => ({ line, part: match.part ?? null })), accountId: account.id, userId: user.id, jobId: job.id });
          created += 1;
          continue;
        }
        const items = paired.map(({ line, match }) => ({ partId: match.part!.id, quantity: line.quantity, unitPrice: line.unitPrice, lineDiscount: line.lineDiscount }));
        const paidAmount = first.paidAmount;
        const notes = [`استيراد Excel ${job.id}`, `مرجع الملف: ${first.documentNumber}`, first.notes].filter(Boolean).join(" — ");
        if (first.type === "SALE") {
          await createSaleInvoice({ accountId: account.id, treasuryId, vehicleId: undefined, paymentMethod: first.paymentMethod, discountAmount: 0, taxAmount: 0, paidAmount, payFull: false, notes, items, allowBelowMinPrice: false, allowDiscountOverride: false }, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice") && hasPermission(access, "canSellBelowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount"), canAddDiscount: hasPermission(access, "canAddDiscount"), maxDiscountPercent: Number(access.permissions?.maxDiscountPercent ?? 100), maxDiscountValue: Number(access.permissions?.maxDiscountValue ?? 99_999_999), canUseTreasury: (id) => canUseTreasury(access, id) });
        } else if (first.type === "PURCHASE") {
          await createPurchaseInvoice({ accountId: account.id, treasuryId, vehicleId: undefined, paymentMethod: first.paymentMethod === "SPLIT" ? "CASH" : first.paymentMethod, discountAmount: 0, taxAmount: 0, paidAmount, payFull: false, notes, items }, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
        } else {
          const originalNumber = first.originalInvoiceNumber;
          const original = originalNumber ? await prisma.invoice.findFirst({ where: { invoiceNumber: originalNumber, type: first.type === "SALE_RETURN" ? "SALE" : "PURCHASE", isVoided: false }, select: { id: true, items: { select: { id: true, partId: true } } } }) : null;
          if (!original) { skipped += 1; continue; }
          const returnItems = items.map((item) => ({ invoiceItemId: original.items.find((originalItem) => originalItem.partId === item.partId)?.id, quantity: item.quantity })).filter((item): item is { invoiceItemId: string; quantity: number } => Boolean(item.invoiceItemId));
          if (returnItems.length !== items.length) { skipped += 1; continue; }
          await createInvoiceReturn({ originalInvoiceId: original.id, treasuryId, paidAmount, notes, items: returnItems }, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
        }
        created += 1;
      }
      const summary = { total: input.rows.length, valid: lines.length, invalid: invalid.length, created, skipped, documents: grouped.size };
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } });
      await writeAudit(prisma, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: user.id });
      ["/", "/invoices", "/sales/returns", "/purchases/returns", "/inventory", "/pos", "/treasury", "/accounts"].forEach((path) => revalidatePath(path));
      return ok({ jobId: job.id, total: input.rows.length, created, skipped, invalid });
    } catch (error) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: input.rows.length, created, skipped, invalid: invalid.length } } });
      throw error;
    }
  } catch (error) { return toActionError(error, "executeInvoiceImportAction"); }
}
