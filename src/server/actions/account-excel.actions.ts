"use server";

import { createHash } from "node:crypto";
import { type AccountType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { money, num } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";
import { prisma } from "@/lib/prisma";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { parseSpreadsheetNumber } from "@/lib/inventory-import";
import { nextAccountNumber } from "@/server/services/numbering.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { getCompanyProfile } from "@/server/services/settings.service";
import { buildTenantWorkbook, tenantFileToken } from "@/lib/import-export/workbook";

const accountTypes = ["CUSTOMER", "WORKSHOP_BMW", "SUPPLIER", "EXPENSE"] as const;
const balanceFilterSchema = z.enum(["ALL", "DEBIT", "CREDIT", "ZERO"]);
const exportSchema = z.object({ query: z.string().trim().max(120).optional(), type: z.enum(["ALL", ...accountTypes]).default("ALL"), balanceFilter: balanceFilterSchema.default("ALL"), format: z.enum(["XLSX", "CSV"]).default("XLSX") });
const accountPrefix: Record<(typeof accountTypes)[number], string> = { CUSTOMER: "ACC", WORKSHOP_BMW: "WRK", SUPPLIER: "SUP", EXPENSE: "EXP" };
const typeLabel: Record<(typeof accountTypes)[number], string> = { CUSTOMER: "عميل", WORKSHOP_BMW: "ورشة BMW", SUPPLIER: "مورد", EXPENSE: "مصروف" };
const parseNumber = (value: unknown) => parseSpreadsheetNumber(value);
const normalizeType = (value: unknown) => {
  const token = String(value ?? "").trim().toUpperCase();
  if (["CUSTOMER", "عميل", "عملاء"].includes(token)) return "CUSTOMER";
  if (["WORKSHOP_BMW", "WORKSHOP", "ورشة", "ورش", "ورشة BMW"].includes(token)) return "WORKSHOP_BMW";
  if (["SUPPLIER", "مورد", "موردون"].includes(token)) return "SUPPLIER";
  if (["EXPENSE", "مصروف", "مصروفات"].includes(token)) return "EXPENSE";
  return token;
};

const importRowSchema = z.object({
  sourceRowNumber: z.coerce.number().int().positive().optional(),
  accountNumber: z.string().trim().max(80).optional().or(z.literal("")),
  name: z.string().trim().min(2, "اسم الحساب مطلوب.").max(180),
  type: z.preprocess(normalizeType, z.enum(accountTypes, { error: "نوع الحساب غير صالح." })),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("البريد الإلكتروني غير صالح.").optional().or(z.literal("")),
  taxNumber: z.string().trim().max(80).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  creditLimit: z.preprocess(parseNumber, z.number().finite().min(0).max(99_999_999.99)),
  defaultPriceTier: z.preprocess((value) => String(value ?? "").trim().toUpperCase() === "WHOLESALE" || ["جملة", "الجملة"].includes(String(value ?? "").trim()) ? "WHOLESALE" : "RETAIL", z.enum(["RETAIL", "WHOLESALE"])),
  openingBalance: z.preprocess(parseNumber, z.number().finite().min(-99_999_999.99).max(99_999_999.99)),
  isActive: z.preprocess((value) => !["0", "false", "inactive", "غير نشط", "معطل"].includes(String(value ?? "").trim().toLocaleLowerCase("ar-EG")), z.boolean()),
});
const importSchema = z.object({ rows: z.array(z.unknown()).min(1).max(5_000), duplicateMode: z.enum(["SKIP", "UPDATE"]).default("SKIP"), skipInvalidRows: z.boolean().default(true) });
type ImportRow = z.infer<typeof importRowSchema>;

function accountWhere(input: z.infer<typeof exportSchema>): Prisma.AccountWhereInput {
  const and: Prisma.AccountWhereInput[] = [];
  if (input.query) {
    const { variations } = normalizeSearchTerm(input.query);
    and.push({ OR: variations.flatMap((term) => [{ name: { contains: term } }, { accountNumber: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }, { taxNumber: { contains: term } }]) });
  }
  if (input.type !== "ALL") and.push({ type: input.type });
  if (input.balanceFilter === "DEBIT") and.push({ currentBalance: { lt: 0 } });
  if (input.balanceFilter === "CREDIT") and.push({ currentBalance: { gt: 0 } });
  if (input.balanceFilter === "ZERO") and.push({ currentBalance: { equals: 0 } });
  return and.length ? { AND: and } : {};
}

export async function exportAccountsToExcelAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string; count: number }>> {
  try {
    await requirePermission("account.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const input = exportSchema.parse(raw);
    const [accounts, company] = await Promise.all([tenant.prisma.account.findMany({ where: accountWhere(input), orderBy: [{ currentBalance: "asc" }, { name: "asc" }], select: { accountNumber: true, name: true, type: true, phone: true, taxNumber: true, currentBalance: true, creditLimit: true, defaultPriceTier: true, address: true, category: true, isActive: true } }), getCompanyProfile(tenant.prisma)]);
    const records = accounts.map((account) => {
      const balance = num(account.currentBalance);
      return {
        "كود الحساب": account.accountNumber,
        "اسم الحساب": account.name,
        "نوع الحساب": typeLabel[account.type as (typeof accountTypes)[number]] ?? account.type,
        "رقم الهاتف": account.phone ?? "",
        "الرقم الضريبي / السجل": account.taxNumber ?? "",
        "حالة الرصيد": balance < 0 ? "مدين — لنا" : balance > 0 ? "دائن — علينا" : "متزن",
        "الرصيد الدفتري الحالي": balance,
        "حد الائتمان": num(account.creditLimit),
        "شريحة التسعير": account.defaultPriceTier === "WHOLESALE" ? "جملة" : "قطاعي",
        "الحالة": account.isActive ? "نشط" : "غير نشط",
        "العنوان والتصنيف": [account.address, account.category].filter(Boolean).join(" — "),
      };
    });
    const headers = ["كود الحساب", "اسم الحساب", "نوع الحساب", "رقم الهاتف", "الرقم الضريبي / السجل", "حالة الرصيد", "الرصيد الدفتري الحالي", "حد الائتمان", "شريحة التسعير", "الحالة", "العنوان والتصنيف"];
    const debit = records.filter((row) => Number(row["الرصيد الدفتري الحالي"]) < 0).reduce((sum, row) => sum + Math.abs(Number(row["الرصيد الدفتري الحالي"])), 0);
    const credit = records.filter((row) => Number(row["الرصيد الدفتري الحالي"]) > 0).reduce((sum, row) => sum + Number(row["الرصيد الدفتري الحالي"]), 0);
    const date = new Date().toISOString().slice(0, 10);
    const exportFile = buildTenantWorkbook({ tenantName: company.name, reportTitle: "تقرير أرصدة الحسابات", sheetName: "الحسابات", headers, records, widths: [16, 32, 16, 18, 20, 16, 20, 18, 15, 13, 42], footerRows: [[""], ["إجمالي المدين — لنا", "", "", "", "", "", debit], ["إجمالي الدائن — علينا", "", "", "", "", "", credit], ["صافي المركز المالي", "", "", "", "", "", credit - debit]], format: input.format });
    return ok({ fileName: `${tenantFileToken(company.name)}_accounts_${date}.${exportFile.extension}`, mimeType: exportFile.mimeType, base64: exportFile.base64, count: records.length });
    });
  } catch (error) { return toActionError(error, "exportAccountsToExcelAction"); }
}

export async function downloadAccountsImportTemplateAction(): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  try {
    await requirePermission("account.write");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const company = await getCompanyProfile(tenant.prisma);
      const topHeader = ["رقم الحساب", "اسم الحساب", "الرصيد الحالى", "", "شيكات وأقساط", "", "طبيعة الحساب", "التصنيف", "كود الحساب", "بيانات الاتصال", "", "نسبة الخصم", "سعر البيع", "تاريخ المراجعة", "آخر بيع", "", "آخر قبض", ""];
      const subHeader = ["", "", "عليه - مدين", "له - دائن", "عليه - مدين", "له - دائن", "", "", "", "موبايل", "عنوان", "", "", "", "التاريخ", "الإجمالى", "التاريخ", "القيمة"];
      const emptyRows = Array.from({ length: 100 }, () => Array.from({ length: 18 }, () => ""));
      const totalRowNumber = emptyRows.length + 5;
      const totals = ["", "الإجمالى", { f: `SUM(C5:C${totalRowNumber - 1})` }, { f: `SUM(D5:D${totalRowNumber - 1})` }, { f: `SUM(E5:E${totalRowNumber - 1})` }, { f: `SUM(F5:F${totalRowNumber - 1})` }, "", "", "", "", "", "", "", "", "", { f: `SUM(P5:P${totalRowNumber - 1})` }, "", { f: `SUM(R5:R${totalRowNumber - 1})` }];
      const sheet = XLSX.utils.aoa_to_sheet([[company.name], ["نموذج استيراد الحسابات"], topHeader, subHeader, ...emptyRows, totals]);
      sheet["!merges"] = ["A3:A4", "B3:B4", "C3:D3", "E3:F3", "G3:G4", "H3:H4", "I3:I4", "J3:K3", "L3:L4", "M3:M4", "N3:N4", "O3:P3", "Q3:R3"].map((range) => XLSX.utils.decode_range(range));
      sheet["!cols"] = [14, 32, 16, 16, 16, 16, 16, 18, 16, 18, 32, 14, 14, 16, 16, 16, 16, 16].map((wch) => ({ wch }));
      sheet["!rows"] = [{ hpt: 22 }, { hpt: 22 }, { hpt: 28 }, { hpt: 24 }];
      sheet["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
      sheet["!autofilter"] = { ref: `A4:R${totalRowNumber - 1}` };
      for (let col = 0; col < 18; col += 1) for (const row of [2, 3]) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        if (!sheet[address]) sheet[address] = { t: "s", v: "" };
        sheet[address].s = { fill: { fgColor: { rgb: row === 2 ? "1F4E78" : "D9EAF7" } }, font: { bold: true, color: { rgb: row === 2 ? "FFFFFF" : "1F1F1F" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: { top: { style: "thin", color: { rgb: "9FBAD0" } }, bottom: { style: "thin", color: { rgb: "9FBAD0" } }, left: { style: "thin", color: { rgb: "9FBAD0" } }, right: { style: "thin", color: { rgb: "9FBAD0" } } } };
      }
      for (const column of [2, 3, 4, 5, 11, 12, 15, 17]) for (let row = 4; row <= totalRowNumber - 1; row += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        if (!sheet[address]) sheet[address] = { t: "n", v: 0 };
        sheet[address].z = "#,##0.00";
      }
      const totalAddress = XLSX.utils.encode_cell({ r: totalRowNumber - 1, c: 1 });
      sheet[totalAddress].s = { fill: { fgColor: { rgb: "E2F0D9" } }, font: { bold: true }, alignment: { horizontal: "center" } };
      const workbook = XLSX.utils.book_new(); workbook.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(workbook, sheet, "نموذج الحسابات");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
      return ok({ fileName: `${tenantFileToken(company.name)}_نموذج_الحسابات_القياسي.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64") });
    });
  } catch (error) { return toActionError(error, "downloadAccountsImportTemplateAction"); }
}

export async function importAccountsAction(raw: unknown): Promise<ActionResult<{ jobId: string; total: number; valid: number; invalid: Array<{ row: number; reason: string }>; created: number; updated: number; skipped: number }>> {
  try {
    const user = await requirePermission("account.write");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const input = importSchema.parse(raw);
    const parsed = input.rows.map((row, index) => ({ row: index + 1, result: importRowSchema.safeParse(row) }));
    const invalid = parsed.filter((entry) => !entry.result.success).map((entry) => ({ row: entry.row, reason: (entry.result as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ") }));
    if (invalid.length && !input.skipInvalidRows) throw new BusinessRuleError(`يوجد ${invalid.length} صف غير صالح. صحّح البيانات أو فعّل تخطي الصفوف غير الصالحة.`);
    const rows = parsed.filter((entry): entry is { row: number; result: { success: true; data: ImportRow } } => entry.result.success).map((entry) => ({ ...entry.result.data, sourceRowNumber: entry.result.data.sourceRowNumber ?? entry.row, accountNumber: entry.result.data.accountNumber?.trim() || "", phone: entry.result.data.phone?.trim() || "", email: entry.result.data.email?.trim() || "", taxNumber: entry.result.data.taxNumber?.trim() || "", address: entry.result.data.address?.trim() || "", category: entry.result.data.category?.trim() || "" }));
    if (!rows.length) throw new BusinessRuleError("لا توجد حسابات سليمة قابلة للاستيراد.");
    const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const previous = await tenant.prisma.importJob.findFirst({ where: { type: "ACCOUNTS", checksum, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (previous) return ok({ jobId: previous.id, total: input.rows.length, valid: rows.length, invalid, created: 0, updated: 0, skipped: rows.length });
    const job = await tenant.prisma.importJob.create({ data: { type: "ACCOUNTS", status: "PROCESSING", checksum, mapping: { duplicateMode: input.duplicateMode }, createdById: user.id } });
    let created = 0; let updated = 0; let skipped = 0;
    try {
      for (let start = 0; start < rows.length; start += 100) {
        const chunk = rows.slice(start, start + 100);
        const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
          let chunkCreated = 0; let chunkUpdated = 0; let chunkSkipped = 0;
          for (const row of chunk) {
            const duplicate = await tx.account.findFirst({ where: { OR: [...(row.accountNumber ? [{ accountNumber: row.accountNumber }] : []), ...(row.phone ? [{ phone: row.phone }] : [])] }, select: { id: true, currentBalance: true } });
            if (duplicate) {
              if (input.duplicateMode === "SKIP") { chunkSkipped += 1; continue; }
              const changed = await tx.account.update({ where: { id: duplicate.id }, data: { name: row.name, type: row.type, phone: row.phone || null, email: row.email || null, taxNumber: row.taxNumber || null, address: row.address || null, category: row.category || null, creditLimit: money(row.creditLimit), defaultPriceTier: row.defaultPriceTier, isActive: row.isActive, status: row.isActive ? "ACTIVE" : "INACTIVE" } });
              await writeAudit(tx, { tableName: "Account", recordId: changed.id, action: "UPDATE", oldData: { importJobId: job.id, currentBalance: duplicate.currentBalance }, newData: { ...changed, importJobId: job.id, sourceRowNumber: row.sourceRowNumber, openingBalanceIgnored: row.openingBalance }, performedBy: user.id });
              chunkUpdated += 1; continue;
            }
            const account = await tx.account.create({ data: { accountNumber: row.accountNumber || await nextAccountNumber(tx, accountPrefix[row.type]), name: row.name, type: row.type, phone: row.phone || null, email: row.email || null, taxNumber: row.taxNumber || null, address: row.address || null, category: row.category || null, creditLimit: money(row.creditLimit), currentBalance: money(row.openingBalance), defaultPriceTier: row.defaultPriceTier, isActive: row.isActive, status: row.isActive ? "ACTIVE" : "INACTIVE" } });
            await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "INSERT", newData: { ...account, importJobId: job.id, sourceRowNumber: row.sourceRowNumber, openingBalance: row.openingBalance, openingLedger: "inferred_from_current_balance" }, performedBy: user.id });
            chunkCreated += 1;
          }
          return { chunkCreated, chunkUpdated, chunkSkipped };
        }, TX_OPTIONS));
        created += result.chunkCreated; updated += result.chunkUpdated; skipped += result.chunkSkipped;
      }
      const summary = { total: input.rows.length, valid: rows.length, invalid: invalid.length, created, updated, skipped, duplicateMode: input.duplicateMode, chunkSize: 100 };
      await tenant.prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } });
      await writeAudit(tenant.prisma, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: summary, performedBy: user.id });
      revalidatePath("/accounts"); revalidatePath("/pos");
      return ok({ jobId: job.id, total: input.rows.length, valid: rows.length, invalid, created, updated, skipped });
    } catch (error) {
      await tenant.prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: input.rows.length, valid: rows.length, invalid: invalid.length, created, updated, skipped } } });
      throw error;
    }
    });
  } catch (error) { return toActionError(error, "importAccountsAction"); }
}

export async function previewAccountsImportAction(raw: unknown): Promise<ActionResult<{ duplicateRows: number[] }>> {
  try {
    await requirePermission("account.write");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const input = z.object({ rows: z.array(z.object({ sourceRowNumber: z.coerce.number().int().positive(), accountNumber: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional() })).max(5_000) }).parse(raw);
    const numbers = [...new Set(input.rows.map((row) => row.accountNumber?.trim()).filter((value): value is string => Boolean(value)))];
    const phones = [...new Set(input.rows.map((row) => row.phone?.trim()).filter((value): value is string => Boolean(value)))];
    if (!numbers.length && !phones.length) return ok({ duplicateRows: [] });
    const existing = await tenant.prisma.account.findMany({ where: { OR: [...(numbers.length ? [{ accountNumber: { in: numbers } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] }, select: { accountNumber: true, phone: true } });
    const existingNumbers = new Set(existing.map((account) => account.accountNumber));
    const existingPhones = new Set(existing.flatMap((account) => account.phone ? [account.phone] : []));
    return ok({ duplicateRows: input.rows.filter((row) => (row.accountNumber && existingNumbers.has(row.accountNumber.trim())) || (row.phone && existingPhones.has(row.phone.trim()))).map((row) => row.sourceRowNumber) });
    });
  } catch (error) { return toActionError(error, "previewAccountsImportAction"); }
}
