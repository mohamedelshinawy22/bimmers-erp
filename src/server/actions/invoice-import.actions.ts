"use server";

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { AccountType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission, can } from "@/lib/auth";
import { getUserAccess, hasPermission, canUseTreasury } from "@/lib/user-permissions";
import { writeAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/errors";
import { formatOemNumber } from "@/lib/utils";
import { serializeData } from "@/lib/serialize";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { createInvoiceReturn, createPurchaseInvoice, createSaleInvoice } from "@/server/services/invoice.service";
import { nextAccountNumber, nextInvoiceNumber, nextTransactionNumber } from "@/server/services/numbering.service";
import { lockAccountForUpdate, lockPartsForUpdate, lockTreasuriesForUpdate } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { resolveOrCreateImportTreasuries } from "@/server/services/treasury-channel-resolver.service";

const invoiceImportTypes = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"] as const;
type InvoiceImportType = (typeof invoiceImportTypes)[number];
type TenantPrisma = import("@prisma/client").PrismaClient;
const IMPORT_BATCH_SIZE = 25;
const documentTypes = invoiceImportTypes;
const typeLabel: Record<InvoiceImportType, string> = { SALE: "فواتير البيع", PURCHASE: "فواتير الشراء", SALE_RETURN: "مرتجعات البيع", PURCHASE_RETURN: "مرتجعات الشراء" };
const permissionForType = (type: InvoiceImportType) => type === "SALE" || type === "SALE_RETURN" ? "invoice.sale" : "invoice.purchase";
const numberValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const moneyValue = (value: unknown) => Math.abs(numberValue(value));
const quantityValue = (value: unknown) => Math.max(1, Math.trunc(numberValue(value)) || 1);
const importedDateValue = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const localized = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return localized ? `${localized[3]}-${localized[2]!.padStart(2, "0")}-${localized[1]!.padStart(2, "0")}` : raw;
};
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
  date: z.preprocess(importedDateValue, z.string().trim().max(32).optional().or(z.literal("")).default("")),
  accountPhone: z.string().trim().max(40).optional().or(z.literal("")),
  originalInvoiceNumber: z.string().trim().max(120).optional().or(z.literal("")),
  treasuryName: z.string().trim().max(160).optional().or(z.literal("")),
  paymentChannels: z.array(z.object({ name: z.string().trim().min(1).max(160), amount: z.preprocess(moneyValue, z.number().finite().min(0).max(99_999_999)) })).max(30).optional().default([]),
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
  quantity: z.preprocess(quantityValue, z.number().int().min(1).max(100_000)).default(1),
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

async function createMissingAccountForImport(db: TenantPrisma, line: ValidLine, type: InvoiceImportType, userId: string) {
  const accountType = type === "PURCHASE" || type === "PURCHASE_RETURN" ? "SUPPLIER" as const : "CUSTOMER" as const;
  const prefix = accountType === "SUPPLIER" ? "SUP" : "ACC";
  return withTxRetry(() => db.$transaction(async (tx) => {
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

async function getOrCreateWalkInCashAccount(db: TenantPrisma, userId: string) {
  return withTxRetry(() => db.$transaction(async (tx) => {
    const existing = await tx.account.findFirst({ where: { type: "CUSTOMER", OR: [{ accountNumber: "ACC-0001" }, { name: { in: ["عميل نقدي افتراضي", "عميل نقدي"] } }] }, select: { id: true, name: true, type: true } });
    if (existing) return existing;
    const account = await tx.account.create({ data: { accountNumber: await nextAccountNumber(tx, "ACC"), name: "عميل نقدي افتراضي", type: "CUSTOMER", currentBalance: 0, isActive: true, status: "ACTIVE", category: "WALK_IN_CASH" }, select: { id: true, name: true, type: true } });
    await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "INSERT", newData: { createdForInvoiceImport: true, role: "walkInCash" }, performedBy: userId });
    return account;
  }, TX_OPTIONS));
}

function importedPaymentChannels(line: ValidLine) {
  const discovered = line.paymentChannels.map((channel) => ({ label: channel.name.trim().replace(/\s+/g, " "), amount: new Prisma.Decimal(channel.amount).abs() })).filter((channel) => channel.label && channel.amount.gt(0));
  if (discovered.length) return discovered;
  const channels = [
    { amount: new Prisma.Decimal(line.cashDrawer).abs(), label: "درج النقدية" },
    { amount: new Prisma.Decimal(line.instapay).abs(), label: "انستا باي (المحل)" },
    { amount: new Prisma.Decimal(line.vodafoneCash).abs(), label: "فودافون كاش (محمد ثروت)" },
    { amount: new Prisma.Decimal(line.bankAbk).abs(), label: "البنك ABK" },
  ].filter((channel) => channel.amount.gt(0));
  if (channels.length) return channels;
  const paidAmount = new Prisma.Decimal(line.paidAmount).abs();
  return paidAmount.gt(0) ? [{ amount: paidAmount, label: line.treasuryName?.trim() || "درج النقدية" }] : [];
}

async function postDetailedImportedInvoice(db: TenantPrisma, args: { type: InvoiceImportType; lines: Array<{ line: ValidLine; part: { id: string; oemNumber: string; nameAr: string } | null }>; accountId: string; userId: string; jobId: string }) {
  const first = args.lines[0]?.line;
  if (!first) throw new BusinessRuleError("الفاتورة لا تحتوي على بنود قابلة للترحيل.");
  const grandTotal = financialAmount(first);
  if (grandTotal.lte(0)) throw new BusinessRuleError("الإجمالي النهائي للفاتورة مطلوب.");
  const channels = importedPaymentChannels(first);
  const paidAmount = channels.reduce((total, channel) => total.add(channel.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (paidAmount.gt(grandTotal)) throw new BusinessRuleError("إجمالي قنوات السداد لا يجوز أن يتجاوز إجمالي الفاتورة.");
  const statedCredit = Prisma.Decimal.max(new Prisma.Decimal(first.creditAmount).abs(), new Prisma.Decimal(first.dueAmount).abs());
  const remainingAmount = statedCredit.gt(0) ? statedCredit.toDecimalPlaces(2) : Prisma.Decimal.max(new Prisma.Decimal(0), grandTotal.sub(paidAmount)).toDecimalPlaces(2);
  const outbound = args.type === "PURCHASE" || args.type === "SALE_RETURN";
  const stockReason = args.type === "SALE" ? "SALE" : args.type === "PURCHASE" ? "PURCHASE" : args.type === "SALE_RETURN" ? "SALE_RETURN" : "PURCHASE_RETURN";
  const balanceAfter = (before: Prisma.Decimal) => args.type === "SALE" || args.type === "PURCHASE_RETURN" ? before.sub(remainingAmount) : before.add(remainingAmount);
  const linkedPartIds = [...new Set(args.lines.flatMap(({ part }) => part ? [part.id] : []))];

  return withTxRetry(() => db.$transaction(async (tx) => {
    const account = await lockAccountForUpdate(tx, args.accountId);
    const parts = await lockPartsForUpdate(tx, linkedPartIds);
    const treasuryByChannel = await resolveOrCreateImportTreasuries(tx, channels.map((channel) => channel.label), args.userId);
    const treasuryIds = [...new Set(channels.map((channel) => treasuryByChannel.get(channel.label)?.id).filter((id): id is string => Boolean(id)))];
    if (treasuryIds.length) await lockTreasuriesForUpdate(tx, treasuryIds);
    const baseType = args.type === "SALE_RETURN" ? "SALE" : args.type === "PURCHASE_RETURN" ? "PURCHASE" : null;
    const original = baseType && first.originalInvoiceNumber ? await tx.invoice.findFirst({ where: { invoiceNumber: first.originalInvoiceNumber, type: baseType, isVoided: false }, select: { id: true, accountId: true } }) : null;
    const invoiceNumber = await nextInvoiceNumber(tx, args.type);
    const invoice = await tx.invoice.create({ data: {
      invoiceNumber, type: args.type, accountId: account.id, treasuryId: channels.length === 1 ? treasuryByChannel.get(channels[0]!.label)?.id ?? null : null, userId: args.userId,
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
      const treasuryId = treasuryByChannel.get(channel.label)?.id;
      if (!treasuryId) throw new BusinessRuleError(`تعذر ربط قناة السداد «${channel.label}» بخزينة.`);
      await tx.treasury.update({ where: { id: treasuryId }, data: outbound ? { currentBalance: { decrement: channel.amount } } : { currentBalance: { increment: channel.amount } } });
      await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId, accountId: account.id, invoiceId: invoice.id, type: outbound ? "PAYMENT" : "RECEIPT", amount: channel.amount, category: "IMPORT_DETAILED", description: `${outbound ? "صرف" : "تحصيل"} استيراد ${channel.label} - ${invoiceNumber}`, createdByUser: args.userId } });
    }
    if (remainingAmount.gt(0)) await tx.account.update({ where: { id: account.id }, data: args.type === "SALE" || args.type === "PURCHASE_RETURN" ? { currentBalance: { decrement: remainingAmount } } : { currentBalance: { increment: remainingAmount } } });
    await writeAudit(tx, { tableName: "Invoice", recordId: invoice.id, action: "INSERT", newData: { ...invoice, importMode: "DETAILED", linkedItemCount: args.lines.filter(({ part }) => Boolean(part)).length, unlinkedTextItemCount: args.lines.filter(({ part }) => !part).length, stockEffect: "CATALOG_LINKED_ONLY" }, performedBy: args.userId });
    return { invoiceId: invoice.id, invoiceNumber };
  }, TX_OPTIONS));
}

async function postSummaryFinancialInvoice(db: TenantPrisma, args: { type: InvoiceImportType; line: ValidLine; accountId: string; userId: string; jobId: string }) {
  const grandTotal = financialAmount(args.line);
  if (grandTotal.lte(0)) throw new BusinessRuleError("الإجمالي النهائي مطلوب في الاستيراد المالي ولا يجوز أن يساوي صفراً.");
  const channels = importedPaymentChannels(args.line);
  const paidAmount = channels.reduce((total, channel) => total.add(channel.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (paidAmount.gt(grandTotal)) throw new BusinessRuleError("إجمالي قنوات السداد لا يجوز أن يتجاوز إجمالي الفاتورة.");
  const statedCredit = Prisma.Decimal.max(new Prisma.Decimal(args.line.creditAmount).abs(), new Prisma.Decimal(args.line.dueAmount).abs());
  const remainingAmount = statedCredit.gt(0) ? statedCredit.toDecimalPlaces(2) : grandTotal.sub(paidAmount).toDecimalPlaces(2);
  const outbound = args.type === "PURCHASE" || args.type === "SALE_RETURN";
  const baseType = args.type === "SALE_RETURN" ? "SALE" : args.type === "PURCHASE_RETURN" ? "PURCHASE" : null;
  return withTxRetry(() => db.$transaction(async (tx) => {
    const account = await lockAccountForUpdate(tx, args.accountId);
    const treasuryByChannel = await resolveOrCreateImportTreasuries(tx, channels.map((channel) => channel.label), args.userId);
    const treasuryIds = [...new Set(channels.map((channel) => treasuryByChannel.get(channel.label)?.id).filter((id): id is string => Boolean(id)))];
    const lockedTreasuries = treasuryIds.length ? await lockTreasuriesForUpdate(tx, treasuryIds) : new Map();
    const amountsByTreasury = new Map<string, Prisma.Decimal>();
    for (const channel of channels) {
      const treasuryId = treasuryByChannel.get(channel.label)?.id;
      if (!treasuryId) throw new BusinessRuleError(`تعذر ربط قناة السداد «${channel.label}» بخزينة.`);
      amountsByTreasury.set(treasuryId, (amountsByTreasury.get(treasuryId) ?? new Prisma.Decimal(0)).add(channel.amount));
    }
    if (outbound) for (const [treasuryId, amount] of amountsByTreasury) {
      const treasury = lockedTreasuries.get(treasuryId);
      if (!treasury || !treasury.isActive || treasury.currentBalance.lt(amount)) throw new BusinessRuleError(`السيولة غير كافية في الخزينة ${treasury?.name ?? "المختارة"}.`);
    }
    const original = baseType && args.line.originalInvoiceNumber
      ? await tx.invoice.findFirst({ where: { invoiceNumber: args.line.originalInvoiceNumber, type: baseType, isVoided: false }, select: { id: true, accountId: true } })
      : null;
    if (baseType && (!original || original.accountId !== account.id)) throw new BusinessRuleError("يجب ربط المرتجع المالي بفاتورة أصلية نشطة للحساب نفسه.");
    const invoiceNumber = await nextInvoiceNumber(tx, args.type);
    const paymentStatus = remainingAmount.eq(0) ? "PAID" : paidAmount.gt(0) ? "PARTIAL" : "CREDIT";
    const invoice = await tx.invoice.create({ data: {
      invoiceNumber, type: args.type, accountId: account.id, treasuryId: channels.length === 1 ? treasuryByChannel.get(channels[0]!.label)?.id ?? null : null, userId: args.userId,
      subtotal: grandTotal, discountAmount: 0, taxAmount: 0, grandTotal, paidAmount, remainingAmount, paymentStatus,
      paymentMethod: remainingAmount.gt(0) && paidAmount.eq(0) ? "ON_ACCOUNT" : channels.length > 1 ? "SPLIT" : "CASH", returnOfId: original?.id ?? null,
      accountBalanceBefore: account.currentBalance, accountBalanceAfter: args.type === "SALE" ? account.currentBalance.sub(remainingAmount) : args.type === "PURCHASE" ? account.currentBalance.add(remainingAmount) : args.type === "SALE_RETURN" ? account.currentBalance.add(remainingAmount) : account.currentBalance.sub(remainingAmount),
      notes: [`استيراد مالي إجمالي ${args.jobId}`, `مرجع الملف: ${args.line.documentNumber}`, args.line.notes, "دون بنود أصناف أو حركة مخزنية"].filter(Boolean).join(" — "),
    } });
    for (const channel of channels) {
      const treasuryId = treasuryByChannel.get(channel.label)?.id;
      if (!treasuryId) throw new BusinessRuleError(`تعذر ربط قناة السداد «${channel.label}» بخزينة.`);
      await tx.treasury.update({ where: { id: treasuryId }, data: outbound ? { currentBalance: { decrement: channel.amount } } : { currentBalance: { increment: channel.amount } } });
      await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId, accountId: account.id, invoiceId: invoice.id, type: outbound ? "PAYMENT" : "RECEIPT", amount: channel.amount, category: "IMPORT_SUMMARY", description: `${outbound ? "صرف" : "تحصيل"} استيراد إجمالي ${channel.label} - ${invoiceNumber}`, createdByUser: args.userId } });
    }
    if (remainingAmount.gt(0)) await tx.account.update({ where: { id: account.id }, data: args.type === "SALE" || args.type === "PURCHASE_RETURN" ? { currentBalance: { decrement: remainingAmount } } : { currentBalance: { increment: remainingAmount } } });
    await writeAudit(tx, { tableName: "Invoice", recordId: invoice.id, action: "INSERT", newData: { ...invoice, importMode: "SUMMARY", itemCount: 0, stockEffect: "NONE", paymentChannels: channels.map((channel) => ({ name: channel.label, amount: channel.amount.toString() })) }, performedBy: args.userId });
    return { invoiceId: invoice.id, invoiceNumber };
  }, TX_OPTIONS));
}

function modeValidationIssue(line: ValidLine, mode: "SUMMARY" | "DETAILED") {
  if (mode === "SUMMARY") return financialAmount(line).gt(0) ? undefined : "الإجمالي النهائي مطلوب في الاستيراد المالي ولا يجوز أن يساوي صفراً.";
  if (!line.oemNumber?.trim() && !line.partName?.trim()) return "رقم الصنف/OEM أو اسم الصنف مطلوب في الاستيراد التفصيلي.";
  if (line.quantity <= 0) return "كمية الصنف يجب أن تكون أكبر من صفر في الاستيراد التفصيلي.";
  return undefined;
}

type ImportMatch = {
  account: { id: string; name: string; type: string } | null;
  accountCandidates: Array<{ id: string; name: string; type: string }>;
  cashFallback: boolean;
  part: { id: string; oemNumber: string; nameAr: string } | null;
  partCandidates: Array<{ id: string; oemNumber: string; nameAr: string }>;
  treasury: { id: string; name: string } | null;
  treasuryCandidates: Array<{ id: string; name: string }>;
};

async function matchLines(db: TenantPrisma, lines: ValidLine[], type: InvoiceImportType, mode: "SUMMARY" | "DETAILED"): Promise<ImportMatch[]> {
  const accountTypes: AccountType[] = type === "PURCHASE" || type === "PURCHASE_RETURN" ? [AccountType.SUPPLIER] : [AccountType.CUSTOMER, AccountType.WORKSHOP_BMW];
  const accountTypeSet = new Set<string>(accountTypes);
  const accountNames = [...new Set(lines.map((line) => (line.accountName ?? "").trim()).filter(Boolean))];
  const accountPhones = [...new Set(lines.map((line) => (line.accountPhone ?? "").trim()).filter(Boolean))];
  const treasuryNames = [...new Set(lines.map((line) => (line.treasuryName ?? "").trim()).filter(Boolean))];
  const [accounts, parts, treasuries] = await Promise.all([
    db.account.findMany({
      where: { isActive: true, OR: [
        { type: { in: [...accountTypes] }, name: { in: accountNames } },
        ...(accountPhones.length ? [{ type: { in: [...accountTypes] }, phone: { in: accountPhones } }] : []),
        { type: AccountType.CUSTOMER, accountNumber: "ACC-0001" },
        { type: AccountType.CUSTOMER, name: { in: ["عميل نقدي افتراضي", "عميل نقدي"] } },
      ] },
      select: { id: true, name: true, type: true, phone: true },
    }),
    mode === "DETAILED"
      ? db.partItem.findMany({ where: { isActive: true, isDeleted: false }, take: 5_000, select: { id: true, oemNumber: true, nameAr: true, barcode: true, partNumberFormatted: true } })
      : Promise.resolve([]),
    treasuryNames.length ? db.treasury.findMany({ where: { isActive: true, name: { in: treasuryNames } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return lines.map((line) => {
    const cashFallback = isWalkInCashAccount(line.accountName);
    const accountCandidates = cashFallback
      ? accounts.filter((account) => account.type === "CUSTOMER" && (account.name === "عميل نقدي افتراضي" || account.name === "عميل نقدي"))
      : accounts.filter((account) => accountTypeSet.has(account.type) && (normalizeKey(account.name) === normalizeKey(line.accountName ?? "") || Boolean(line.accountPhone) && account.phone === line.accountPhone));
    const normalizedCode = normalizeKey(line.oemNumber ?? "");
    const normalizedName = normalizeKey(line.partName ?? "");
    const partCandidates = parts.filter((part) => (
      Boolean(normalizedCode) && [part.barcode, part.partNumberFormatted, part.oemNumber].some((value) => normalizeKey(value ?? "") === normalizedCode)
    ) || (
      Boolean(normalizedName) && normalizeKey(part.nameAr) === normalizedName
    )).map(({ id, oemNumber, nameAr }) => ({ id, oemNumber, nameAr }));
    const treasuryCandidates = line.treasuryName ? treasuries.filter((treasury) => treasury.name === line.treasuryName) : [];
    return { account: accountCandidates.length === 1 ? accountCandidates[0] ?? null : null, accountCandidates, cashFallback, part: partCandidates.length === 1 ? partCandidates[0] ?? null : null, partCandidates, treasury: treasuryCandidates.length === 1 ? treasuryCandidates[0] ?? null : null, treasuryCandidates };
  });
}

export async function downloadInvoiceImportTemplateAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  try {
    const input = templateSchema.parse(raw);
    await requirePermission(permissionForType(input.type));
    const buffer = importTemplateWorkbook(input.type, input.format);
    return ok({ fileName: `نموذج_استيراد_${typeLabel[input.type]}_${input.format === "SUMMARY" ? "ملخص" : "تفصيلي"}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64") });
  } catch (error) { return toActionError(error, "downloadInvoiceImportTemplateAction"); }
}

export async function previewInvoiceImportAction(raw: unknown): Promise<ActionResult<{ total: number; totalInvoices: number; valid: number; invalid: Array<{ row: number; reason: string }>; summary: { matchedCount: number; unmatchedCount: number; newCustomersCount: number }; rows: Array<{ row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; partName: string; grandTotal: number; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; paymentChannels: Array<{ name: string; amount: number }>; accountStatus: "CASH_FALLBACK" | "MATCHED" | "AUTO_CREATE" | "NOT_FOUND"; partStatus: "NOT_APPLICABLE" | "MATCHED_CATALOG" | "UNLINKED_TEXT_ITEM"; isValid: boolean; reason?: string; suggestedFix?: string; errorCode?: "ACCOUNT_NOT_FOUND" | "INVALID_QUANTITY" | "INVALID_AMOUNT" | "TREASURY_NOT_FOUND" | "TYPE_MISMATCH" | "FORMAT_INVALID" }> }>> {
  try {
    const input = importSchema.parse(raw);
    await requirePermission(permissionForType(input.type));
    const tenant = await getTenantDbFromSession();
    const parsed = inputRows(input.rows).map((row) => ({ row: Number(row.sourceRowNumber), raw: row, result: rawLineSchema.safeParse(row) }));
    const matchable = parsed.reduce<Array<{ row: number; line: ValidLine }>>((items, entry) => {
      if (entry.result.success && entry.result.data.type === input.type) items.push({ row: entry.row, line: entry.result.data });
      return items;
    }, []);
    const matched = await tenant.run(() => matchLines(tenant.prisma, matchable.map((entry) => entry.line), input.type, input.mode));
    const matchByRow = new Map(matchable.map((entry, index) => [entry.row, matched[index]! ]));
    type PreviewRow = { row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; partName: string; grandTotal: number; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; paymentChannels: Array<{ name: string; amount: number }>; accountStatus: "CASH_FALLBACK" | "MATCHED" | "AUTO_CREATE" | "NOT_FOUND"; partStatus: "NOT_APPLICABLE" | "MATCHED_CATALOG" | "UNLINKED_TEXT_ITEM"; isValid: boolean; reason?: string; suggestedFix?: string; errorCode?: "ACCOUNT_NOT_FOUND" | "INVALID_QUANTITY" | "INVALID_AMOUNT" | "TREASURY_NOT_FOUND" | "TYPE_MISMATCH" | "FORMAT_INVALID" };
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
        preview.push({ row: entry.row, documentNumber: rawString(entry.raw, "documentNumber"), type: rawString(entry.raw, "type"), accountName: rawString(entry.raw, "accountName"), oemNumber: formatOemNumber(rawString(entry.raw, "oemNumber")), partName: rawString(entry.raw, "partName"), grandTotal: 0, accountMatched: false, partMatched: false, treasuryMatched: false, paymentChannels: [], accountStatus: "NOT_FOUND", partStatus: "NOT_APPLICABLE", isValid: false, reason, ...resolutionFor(reason) });
        continue;
      }
      const line = entry.result.data;
      if (line.type !== input.type) {
        const reason = `نوع الصف لا يطابق معالج ${typeLabel[input.type]}.`;
        preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName, oemNumber: formatOemNumber(line.oemNumber), partName: line.partName || "", grandTotal: Number(financialAmount(line)), accountMatched: false, partMatched: false, treasuryMatched: false, paymentChannels: [], accountStatus: "NOT_FOUND", partStatus: "NOT_APPLICABLE", isValid: false, reason, ...resolutionFor(reason) });
        continue;
      }
      const match = matchByRow.get(entry.row);
      if (!match) {
        const reason = "تعذر تجهيز مطابقة الصف بصورة آمنة.";
        preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName, oemNumber: formatOemNumber(line.oemNumber), partName: line.partName || "", grandTotal: Number(financialAmount(line)), accountMatched: false, partMatched: false, treasuryMatched: false, paymentChannels: [], accountStatus: "NOT_FOUND", partStatus: "UNLINKED_TEXT_ITEM", isValid: false, reason, ...resolutionFor(reason) });
        continue;
      }
      const modeIssue = modeValidationIssue(line, input.mode);
      const accountMissing = !match.account && !match.cashFallback && !input.autoCreateAccounts;
      const channelTotal = importedPaymentChannels(line).reduce((total, channel) => total.add(channel.amount), new Prisma.Decimal(0));
      const paymentIssue = channelTotal.gt(financialAmount(line)) ? "إجمالي قنوات السداد لا يجوز أن يتجاوز إجمالي الفاتورة." : undefined;
      const reason = modeIssue ?? paymentIssue ?? (accountMissing ? `الحساب (${line.accountName}) غير مسجل في المنظومة وتم إيقاف الإنشاء التلقائي.` : undefined);
      preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName || "عميل نقدي افتراضي", oemNumber: formatOemNumber(line.oemNumber), partName: line.partName || "", grandTotal: Number(financialAmount(line)), accountMatched: Boolean(match.account) || match.cashFallback || input.autoCreateAccounts, partMatched: input.mode === "SUMMARY" || Boolean(match.part), treasuryMatched: !line.treasuryName || Boolean(match.treasury), paymentChannels: importedPaymentChannels(line).map((channel) => ({ name: channel.label, amount: Number(channel.amount) })), isValid: !reason, reason, ...(reason ? resolutionFor(reason) : {}), accountStatus: match.cashFallback ? "CASH_FALLBACK" : match.account ? "MATCHED" : input.autoCreateAccounts ? "AUTO_CREATE" : "NOT_FOUND", partStatus: input.mode === "SUMMARY" ? "NOT_APPLICABLE" : match.part ? "MATCHED_CATALOG" : "UNLINKED_TEXT_ITEM" });
    }
    const invalid = preview.filter((row) => !row.isValid).map((row) => ({ row: row.row, reason: row.reason ?? "صف غير صالح." }));
    const valid = preview.filter((row) => row.isValid).length;
    const unmatchedCount = preview.filter((row) => row.partStatus === "UNLINKED_TEXT_ITEM" || row.accountStatus === "NOT_FOUND").length;
    const newCustomersCount = preview.filter((row) => row.accountStatus === "AUTO_CREATE").length;
    return ok(serializeData({ total: input.rows.length, totalInvoices: input.rows.length, valid, invalid, summary: { matchedCount: valid - unmatchedCount, unmatchedCount, newCustomersCount }, rows: preview }));
  } catch (error) { return toActionError(error, "previewInvoiceImportAction"); }
}

export async function executeInvoiceImportAction(raw: unknown): Promise<ActionResult<{ jobId: string; total: number; created: number; skipped: number; invalid: Array<{ row: number; reason: string }> }>> {
  try {
    const input = importSchema.parse(raw);
    const user = await requirePermission(permissionForType(input.type));
    const tenant = await getTenantDbFromSession();
    const db = tenant.prisma;
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
    const previous = await tenant.run(() => db.importJob.findFirst({ where: { type: "INVOICES", checksum, status: "COMPLETED" }, orderBy: { createdAt: "desc" } }));
    if (previous) return ok({ jobId: previous.id, total: input.rows.length, created: 0, skipped: lines.length, invalid });
    const job = await tenant.run(() => db.importJob.create({ data: { type: "INVOICES", status: "PROCESSING", checksum, mapping: { type: input.type, mode: input.mode, headers: headersForTemplate(input.mode), skipInvalidRows: input.skipInvalidRows, autoCreateAccounts: input.autoCreateAccounts }, createdById: user.id } }));
    let created = 0;
    let skipped = 0;
    try {
      const grouped = new Map<string, typeof lines>();
      for (const line of lines) grouped.set(`${line.type}:${line.documentNumber}`, [...(grouped.get(`${line.type}:${line.documentNumber}`) ?? []), line]);
      const access = await tenant.run(() => getUserAccess(user.id));
      const documentGroups = [...grouped.values()];
      for (let batchStart = 0; batchStart < documentGroups.length; batchStart += IMPORT_BATCH_SIZE) {
        const batch = documentGroups.slice(batchStart, batchStart + IMPORT_BATCH_SIZE);
        for (const group of batch) {
        const first = group.at(0);
        if (!first) { skipped += 1; continue; }
        const groupMatches = await tenant.run(() => matchLines(db, group, input.type, input.mode));
        const paired = [] as Array<{ line: ValidLine; match: ImportMatch }>;
        for (const [index, line] of group.entries()) {
          const match = groupMatches[index]!;
          if (!match.account && match.cashFallback) {
            const account = await tenant.run(() => getOrCreateWalkInCashAccount(db, user.id));
            paired.push({ line, match: { ...match, account } });
            continue;
          }
          if (!match.account && input.autoCreateAccounts) {
            const account = await tenant.run(() => createMissingAccountForImport(db, line, input.type, user.id));
            paired.push({ line, match: { ...match, account } });
            continue;
          }
          paired.push({ line, match });
        }
        if (input.mode === "SUMMARY" && group.length !== 1) {
          const reason = "الاستيراد المالي الإجمالي يتطلب صفاً واحداً فقط لكل رقم فاتورة.";
          invalid.push(...group.map((line) => ({ row: line.sourceRowNumber, reason })));
          if (!input.skipInvalidRows) throw new BusinessRuleError(`${reason} المرجع: ${first.documentNumber}`);
          skipped += group.length;
          continue;
        }
        const issue = paired.find(({ match }) => !match.account);
        if (issue) {
          const reason = "تعذر مطابقة الحساب بشكل فريد.";
          invalid.push({ row: issue.line.sourceRowNumber ?? 0, reason });
          if (!input.skipInvalidRows) throw new BusinessRuleError(`الصف ${issue.line.sourceRowNumber}: ${reason}`);
          skipped += group.length;
          continue;
        }
        const firstMatch = paired.at(0)?.match;
        if (!firstMatch?.account) { skipped += 1; continue; }
        const account = firstMatch.account;
        const treasuryId = firstMatch.treasury?.id;
        if (input.mode === "SUMMARY") {
          await tenant.run(() => postSummaryFinancialInvoice(db, { type: first.type, line: first, accountId: account.id, userId: user.id, jobId: job.id }));
          created += 1;
          continue;
        }
        if (input.mode === "DETAILED") {
          await tenant.run(() => postDetailedImportedInvoice(db, { type: first.type, lines: paired.map(({ line, match }) => ({ line, part: match.part ?? null })), accountId: account.id, userId: user.id, jobId: job.id }));
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
          const original = originalNumber ? await tenant.run(() => db.invoice.findFirst({ where: { invoiceNumber: originalNumber, type: first.type === "SALE_RETURN" ? "SALE" : "PURCHASE", isVoided: false }, select: { id: true, items: { select: { id: true, partId: true } } } })) : null;
          if (!original) { skipped += 1; continue; }
          const returnItems = items.map((item) => ({ invoiceItemId: original.items.find((originalItem) => originalItem.partId === item.partId)?.id, quantity: item.quantity })).filter((item): item is { invoiceItemId: string; quantity: number } => Boolean(item.invoiceItemId));
          if (returnItems.length !== items.length) { skipped += 1; continue; }
          await createInvoiceReturn({ originalInvoiceId: original.id, treasuryId, paidAmount, notes, items: returnItems }, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
        }
        created += 1;
      }
      }
      const summary = { total: input.rows.length, valid: lines.length, invalid: invalid.length, created, skipped, documents: grouped.size };
      await tenant.run(() => db.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } }));
      await tenant.run(() => writeAudit(db, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: user.id }));
      ["/", "/invoices", "/sales/returns", "/purchases/returns", "/inventory", "/pos", "/treasury", "/accounts"].forEach((path) => revalidatePath(path));
      return ok({ jobId: job.id, total: input.rows.length, created, skipped, invalid });
    } catch (error) {
      await tenant.run(() => db.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: input.rows.length, created, skipped, invalid: invalid.length } } }));
      throw error;
    }
  } catch (error) { return toActionError(error, "executeInvoiceImportAction"); }
}
