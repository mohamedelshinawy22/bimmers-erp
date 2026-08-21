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

const documentTypes = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"] as const;
const numberValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
  accountName: z.string().trim().min(1, "اسم الحساب مطلوب.").max(200),
  accountPhone: z.string().trim().max(40).optional().or(z.literal("")),
  originalInvoiceNumber: z.string().trim().max(120).optional().or(z.literal("")),
  treasuryName: z.string().trim().max(160).optional().or(z.literal("")),
  paymentMethod: z.preprocess(normalizePayment, z.enum(["CASH", "VISA", "SPLIT", "ON_ACCOUNT"])),
  oemNumber: z.string().trim().min(1, "رقم الصنف/OEM مطلوب.").max(120),
  quantity: z.preprocess(numberValue, z.number().int().positive("كمية الصنف يجب أن تكون أكبر من صفر.").max(100_000)),
  unitPrice: z.preprocess(numberValue, z.number().finite().min(0).max(99_999_999)),
  lineDiscount: z.preprocess(numberValue, z.number().finite().min(0).max(99_999_999)).default(0),
  paidAmount: z.preprocess(numberValue, z.number().finite().min(0).max(99_999_999)).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
const importSchema = z.object({ rows: z.array(z.unknown()).min(1).max(10_000), skipInvalidRows: z.boolean().default(true) });
type ValidLine = z.infer<typeof rawLineSchema>;

function headersForTemplate() {
  return ["رقم الفاتورة", "نوع الفاتورة", "الحساب", "رقم الهاتف", "الفاتورة المرتجعة", "طريقة السداد", "الخزينة", "رقم الصنف (OEM)", "كمية", "السعر", "خصم السطر", "المدفوع", "ملاحظات"];
}

function importTemplateWorkbook() {
  const headers = headersForTemplate();
  const examples = [
    ["EXT-0001", "فاتورة بيع", "عميل نقدي", "", "", "نقدي", "الخزينة الرئيسية", "17118484638", 1, 1200, 0, 1200, "استيراد تجريبي — احذف هذا الصف قبل الرفع"],
    ["EXT-0002", "فاتورة شراء", "المورد", "", "", "آجل", "", "51459125626/622", 2, 800, 0, 0, ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  sheet["!cols"] = [18, 18, 28, 18, 18, 15, 22, 22, 10, 14, 14, 14, 36].map((wch) => ({ wch }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  sheet["!autofilter"] = { ref: "A1:M3" };
  for (let col = 0; col < headers.length; col += 1) {
    const cell = XLSX.utils.encode_cell({ r: 0, c: col });
    sheet[cell].s = { fill: { fgColor: { rgb: "1F4E78" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
  }
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, sheet, "استيراد الفواتير");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

function inputRows(raw: unknown[]) {
  return raw.map((row, index) => ({ sourceRowNumber: index + 2, ...row as Record<string, unknown> }));
}

async function matchLine(line: ValidLine) {
  const oem = normalizeKey(line.oemNumber);
  const [accounts, parts, treasuries] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true, OR: [{ name: { equals: line.accountName } }, ...(line.accountPhone ? [{ phone: line.accountPhone }] : [])] }, select: { id: true, name: true, type: true } }),
    prisma.$queryRaw<Array<{ id: string; oemNumber: string; nameAr: string }>>(Prisma.sql`SELECT id, "oemNumber", "nameAr" FROM "PartItem" WHERE lower(regexp_replace("oemNumber", '[[:space:]_./-]', '', 'g')) = ${oem} LIMIT 5`),
    line.treasuryName ? prisma.treasury.findMany({ where: { isActive: true, name: { equals: line.treasuryName } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return { account: accounts.length === 1 ? accounts[0] : null, accountCandidates: accounts, part: parts.length === 1 ? parts[0] : null, partCandidates: parts, treasury: treasuries.length === 1 ? treasuries[0] : null, treasuryCandidates: treasuries };
}

export async function downloadInvoiceImportTemplateAction(): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  try {
    await requirePermission("invoice.sale");
    const buffer = importTemplateWorkbook();
    return ok({ fileName: "نموذج_استيراد_الفواتير.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64") });
  } catch (error) { return toActionError(error, "downloadInvoiceImportTemplateAction"); }
}

export async function previewInvoiceImportAction(raw: unknown): Promise<ActionResult<{ total: number; valid: number; invalid: Array<{ row: number; reason: string }>; rows: Array<{ row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; reason?: string }> }>> {
  try {
    await requirePermission("invoice.sale");
    const input = importSchema.parse(raw);
    const parsed = inputRows(input.rows).map((row) => ({ row: Number(row.sourceRowNumber), result: rawLineSchema.safeParse(row) }));
    const invalid = parsed.filter((entry) => !entry.result.success).map((entry) => ({ row: entry.row, reason: (entry.result as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ") }));
    const preview = [];
    for (const entry of parsed) {
      if (!entry.result.success) continue;
      const line = entry.result.data;
      const match = await matchLine(line);
      const needsTreasury = line.paymentMethod !== "ON_ACCOUNT" && line.paidAmount > 0;
      const reason = !match.account ? "تعذر مطابقة الحساب بشكل فريد." : !match.part ? "تعذر مطابقة الصنف برقم OEM بشكل فريد." : needsTreasury && !match.treasury ? "تعذر مطابقة الخزينة النشطة." : undefined;
      preview.push({ row: entry.row, documentNumber: line.documentNumber, type: line.type, accountName: line.accountName, oemNumber: formatOemNumber(line.oemNumber), accountMatched: Boolean(match.account), partMatched: Boolean(match.part), treasuryMatched: !needsTreasury || Boolean(match.treasury), reason });
    }
    const matchedInvalid = preview.filter((row) => row.reason).map((row) => ({ row: row.row, reason: row.reason! }));
    return ok({ total: input.rows.length, valid: input.rows.length - invalid.length - matchedInvalid.length, invalid: [...invalid, ...matchedInvalid], rows: preview });
  } catch (error) { return toActionError(error, "previewInvoiceImportAction"); }
}

export async function executeInvoiceImportAction(raw: unknown): Promise<ActionResult<{ jobId: string; total: number; created: number; skipped: number; invalid: Array<{ row: number; reason: string }> }>> {
  try {
    const user = await requirePermission("invoice.sale");
    const input = importSchema.parse(raw);
    const parsed = inputRows(input.rows).map((row) => ({ row: Number(row.sourceRowNumber), result: rawLineSchema.safeParse(row) }));
    const invalid = parsed.filter((entry) => !entry.result.success).map((entry) => ({ row: entry.row, reason: (entry.result as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ") }));
    const lines = parsed.filter((entry): entry is { row: number; result: { success: true; data: ValidLine } } => entry.result.success).map((entry) => ({ ...entry.result.data, sourceRowNumber: entry.row }));
    if (invalid.length && !input.skipInvalidRows) throw new BusinessRuleError(`يوجد ${invalid.length} صف غير صالح. صحح البيانات أو فعّل التخطي.`);
    if (!lines.length) throw new BusinessRuleError("لا توجد صفوف صالحة لاستيراد الفواتير.");
    const checksum = createHash("sha256").update(JSON.stringify(lines)).digest("hex");
    const previous = await prisma.importJob.findFirst({ where: { type: "INVOICES", checksum, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (previous) return ok({ jobId: previous.id, total: input.rows.length, created: 0, skipped: lines.length, invalid });
    const job = await prisma.importJob.create({ data: { type: "INVOICES", status: "PROCESSING", checksum, mapping: { headers: headersForTemplate(), skipInvalidRows: input.skipInvalidRows }, createdById: user.id } });
    let created = 0;
    let skipped = 0;
    try {
      const grouped = new Map<string, typeof lines>();
      for (const line of lines) grouped.set(`${line.type}:${line.documentNumber}`, [...(grouped.get(`${line.type}:${line.documentNumber}`) ?? []), line]);
      const access = await getUserAccess(user.id);
      for (const group of grouped.values()) {
        const first = group.at(0);
        if (!first) { skipped += 1; continue; }
        const paired = await Promise.all(group.map(async (line) => ({ line, match: await matchLine(line) })));
        const issue = paired.find(({ line, match }) => !match.account || !match.part || ((line.paymentMethod !== "ON_ACCOUNT" && line.paidAmount > 0) && !match.treasury));
        if (issue) { skipped += 1; continue; }
        const firstMatch = paired.at(0)?.match;
        if (!firstMatch?.account) { skipped += 1; continue; }
        const account = firstMatch.account;
        const treasuryId = firstMatch.treasury?.id;
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
