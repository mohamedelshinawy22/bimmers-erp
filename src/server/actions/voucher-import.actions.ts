"use server";

import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { money } from "@/lib/utils";
import { nextAccountNumber, nextTransactionNumber } from "@/server/services/numbering.service";
import { lockAccountForUpdate, lockTreasuriesForUpdate } from "@/server/services/inventory.service";
import { resolveOrCreateImportTreasuries } from "@/server/services/treasury-channel-resolver.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { voucherMovementKind } from "@/lib/voucher-excel-parser";

const voucherImportTypes = ["RECEIPT", "PAYMENT"] as const;
type VoucherImportType = (typeof voucherImportTypes)[number];
type VoucherKind = "RECEIPT" | "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT";

const numeric = (value: unknown) => {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const voucherLineSchema = z.object({
  sourceRowNumber: z.coerce.number().int().positive(),
  seq: z.coerce.number().int().positive().optional().default(1),
  date: z.string().trim().optional().nullable().default(null),
  time: z.string().trim().optional().nullable().default(null),
  movementType: z.string().trim().max(120).optional().default(""),
  transactionReference: z.string().trim().min(1).max(180),
  externalReference: z.string().trim().max(180).optional().default(""),
  amount: z.preprocess(numeric, z.number().finite().positive().max(99_999_999)),
  itemCategory: z.string().trim().max(200).optional().default(""),
  accountName: z.string().trim().max(200).optional().default(""),
  treasuryName: z.string().trim().max(160).optional().default(""),
  paymentChannels: z.array(z.object({ name: z.string().trim().min(1).max(160), amount: z.preprocess(numeric, z.number().finite().positive().max(99_999_999)) })).max(30).optional().default([]),
  notes: z.string().trim().max(1000).optional().default(""),
  createdByName: z.string().trim().max(180).optional().default(""),
  defaultType: z.enum(voucherImportTypes),
});

type ValidVoucherLine = z.infer<typeof voucherLineSchema>;

const importSchema = z.object({
  type: z.enum(voucherImportTypes),
  rows: z.array(z.unknown()).min(1).max(10_000),
  autoCreateAccounts: z.boolean().optional().default(false),
  skipInvalidRows: z.boolean().optional().default(true),
});

const templateSchema = z.object({ type: z.enum(voucherImportTypes) });

function normalizeName(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-EG"); }
function channelsFor(line: ValidVoucherLine) {
  if (line.paymentChannels.length) return line.paymentChannels.map((channel) => ({ name: channel.name.trim().replace(/\s+/g, " "), amount: money(channel.amount).abs() })).filter((channel) => channel.name && channel.amount.gt(0));
  return [{ name: line.treasuryName.trim() || "درج النقدية", amount: money(line.amount).abs() }];
}
function isAdvanceCategory(value: string) { return /(سلف|advance)/i.test(value); }
function accountTarget(line: ValidVoucherLine) { return line.accountName.trim() || line.itemCategory.trim(); }
function accountTypeFor(line: ValidVoucherLine, kind: VoucherKind) {
  if (!line.accountName.trim()) return isAdvanceCategory(line.itemCategory) ? "ADVANCE" as const : "EXPENSE" as const;
  return kind === "RECEIPT" ? "CUSTOMER" as const : "SUPPLIER" as const;
}
function transactionDate(line: ValidVoucherLine) {
  if (!line.date) return undefined;
  const raw = line.time ? `${line.date}T${line.time}` : line.date;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function findAccount(line: ValidVoucherLine, kind: VoucherKind) {
  const target = accountTarget(line);
  if (!target || kind === "TRANSFER_IN" || kind === "TRANSFER_OUT") return { account: null, candidates: [], target };
  const candidates = await prisma.account.findMany({ where: { isActive: true, name: { equals: target, mode: "insensitive" } }, select: { id: true, name: true, type: true } });
  return { account: candidates.length === 1 ? candidates[0] : null, candidates, target };
}

async function resolveOrCreateAccount(tx: Prisma.TransactionClient, line: ValidVoucherLine, kind: VoucherKind, autoCreate: boolean, userId: string) {
  const target = accountTarget(line);
  if (!target || kind === "TRANSFER_IN" || kind === "TRANSFER_OUT") return null;
  const candidates = await tx.account.findMany({ where: { isActive: true, name: { equals: target, mode: "insensitive" } }, select: { id: true, name: true, type: true } });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new BusinessRuleError(`الحساب «${target}» له أكثر من تطابق؛ يرجى توحيد الاسم قبل الاستيراد.`);
  const categoryAutoCreate = !line.accountName.trim() && Boolean(line.itemCategory.trim());
  if (!autoCreate && !categoryAutoCreate) throw new BusinessRuleError(`الحساب «${target}» غير مسجل وتم إيقاف الإنشاء التلقائي.`);
  const created = await tx.account.create({ data: { accountNumber: await nextAccountNumber(tx), name: target, type: accountTypeFor(line, kind), currentBalance: new Prisma.Decimal(0), category: line.accountName.trim() ? null : "مستورد من بند سند Excel" } });
  await writeAudit(tx, { tableName: "Account", recordId: created.id, action: "INSERT", newData: { ...created, source: "VOUCHER_EXCEL_IMPORT" }, performedBy: userId });
  return created;
}

function issueFor(line: ValidVoucherLine, type: VoucherImportType, autoCreateAccounts: boolean) {
  const kind = voucherMovementKind(line.movementType, type);
  const channels = channelsFor(line);
  const totalChannels = channels.reduce((sum, channel) => sum.add(channel.amount), new Prisma.Decimal(0));
  if (!totalChannels.eq(money(line.amount).abs())) return "مجموع قنوات السداد يجب أن يساوي مبلغ السند.";
  if ((kind === "TRANSFER_IN" || kind === "TRANSFER_OUT") && channels.every((channel) => normalizeName(channel.name) === normalizeName(line.treasuryName || ""))) return "التحويل الداخلي يحتاج خزينة مصدر وخزينة وجهة مختلفتين.";
  if (!accountTarget(line) || kind === "TRANSFER_IN" || kind === "TRANSFER_OUT" || autoCreateAccounts) return undefined;
  return undefined;
}

function templateWorkbook(type: VoucherImportType) {
  const headers = ["#", "التاريخ", "الوقت", "الحركة", "رقم السند", "المرجع", "المبلغ", "البند", "الحساب", "الخزينة", "درج النقدية", "انستا باي (المحل)", "فودافون كاش (محمد ثروت)", "البنك ABK", "ملاحظات", "إضافة المستخدم"];
  const movement = type === "RECEIPT" ? "قبض" : "صرف";
  const example = [1, "2026-08-21", "10:00", movement, `${type === "RECEIPT" ? "RCV" : "PAY"}-0001`, "", 1000, type === "RECEIPT" ? "تحصيل عميل" : "مصروفات تشغيل", type === "RECEIPT" ? "اسم العميل" : "", "درج النقدية", 1000, 0, 0, 0, "مثال توضيحي فقط — احذفه قبل الاستيراد", "مدير النظام"];
  const worksheet = XLSX.utils.aoa_to_sheet([headers, example]);
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(14, header.length + 4) }));
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, type === "RECEIPT" ? "سندات قبض" : "سندات صرف");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function downloadVoucherImportTemplateAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string }>> {
  try {
    const input = templateSchema.parse(raw);
    await requirePermission("treasury.transact");
    const buffer = templateWorkbook(input.type);
    return ok({ fileName: `نموذج_استيراد_سندات_${input.type === "RECEIPT" ? "قبض" : "صرف"}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64") });
  } catch (error) { return toActionError(error, "downloadVoucherImportTemplateAction"); }
}

export async function previewVoucherImportAction(raw: unknown): Promise<ActionResult<{ total: number; valid: number; invalid: Array<{ row: number; reason: string }>; rows: Array<{ row: number; reference: string; kind: VoucherKind; amount: number; accountName: string; itemCategory: string; channels: Array<{ name: string; amount: number }>; isValid: boolean; reason?: string; accountStatus: "MATCHED" | "AUTO_CREATE" | "EXPENSE_ACCOUNT" | "NONE" }> }>> {
  try {
    const input = importSchema.parse(raw);
    await requirePermission("treasury.transact");
    const rows = [] as Array<{ row: number; reference: string; kind: VoucherKind; amount: number; accountName: string; itemCategory: string; channels: Array<{ name: string; amount: number }>; isValid: boolean; reason?: string; accountStatus: "MATCHED" | "AUTO_CREATE" | "EXPENSE_ACCOUNT" | "NONE" }>;
    for (const rawRow of input.rows) {
      const parsed = voucherLineSchema.safeParse(rawRow);
      if (!parsed.success) { rows.push({ row: Number((rawRow as { sourceRowNumber?: number })?.sourceRowNumber ?? 0), reference: "—", kind: input.type, amount: 0, accountName: "", itemCategory: "", channels: [], isValid: false, reason: parsed.error.issues.map((issue) => issue.message).join(" • "), accountStatus: "NONE" }); continue; }
      const line = parsed.data;
      const kind = voucherMovementKind(line.movementType, input.type);
      const issue = issueFor(line, input.type, input.autoCreateAccounts);
      const accountMatch = await findAccount(line, kind);
      const accountRequired = Boolean(accountMatch.target) && kind !== "TRANSFER_IN" && kind !== "TRANSFER_OUT";
      const categoryAutoCreate = !line.accountName.trim() && Boolean(line.itemCategory.trim());
      const accountIssue = accountRequired && !accountMatch.account && !input.autoCreateAccounts && !categoryAutoCreate ? `الحساب «${accountMatch.target}» غير مسجل وتم إيقاف الإنشاء التلقائي.` : undefined;
      const channelRows = channelsFor(line).map((channel) => ({ name: channel.name, amount: Number(channel.amount) }));
      rows.push({ row: line.sourceRowNumber, reference: line.transactionReference, kind, amount: line.amount, accountName: line.accountName, itemCategory: line.itemCategory, channels: channelRows, isValid: !(issue ?? accountIssue), reason: issue ?? accountIssue, accountStatus: accountMatch.account ? "MATCHED" : line.itemCategory && !line.accountName ? "EXPENSE_ACCOUNT" : input.autoCreateAccounts ? "AUTO_CREATE" : "NONE" });
    }
    return ok({ total: rows.length, valid: rows.filter((row) => row.isValid).length, invalid: rows.filter((row) => !row.isValid).map((row) => ({ row: row.row, reason: row.reason ?? "صف غير صالح" })), rows });
  } catch (error) { return toActionError(error, "previewVoucherImportAction"); }
}

export async function executeVoucherImportAction(raw: unknown): Promise<ActionResult<{ jobId: string; created: number; skipped: number; transfers: number; invalid: Array<{ row: number; reason: string }> }>> {
  try {
    const input = importSchema.parse(raw);
    const user = await requirePermission("treasury.transact");
    const parsed = input.rows.map((rawRow) => ({ rawRow, parsed: voucherLineSchema.safeParse(rawRow) }));
    const invalid = parsed.filter((entry) => !entry.parsed.success).map((entry) => ({ row: Number((entry.rawRow as { sourceRowNumber?: number })?.sourceRowNumber ?? 0), reason: (entry.parsed as { success: false; error: z.ZodError }).error.issues.map((issue) => issue.message).join(" • ") }));
    const lines = parsed.filter((entry): entry is { rawRow: unknown; parsed: { success: true; data: ValidVoucherLine } } => entry.parsed.success).map((entry) => entry.parsed.data);
    for (const line of lines) { const issue = issueFor(line, input.type, input.autoCreateAccounts); if (issue) invalid.push({ row: line.sourceRowNumber, reason: issue }); }
    const invalidRows = new Set(invalid.map((row) => row.row));
    const validLines = lines.filter((line) => !invalidRows.has(line.sourceRowNumber));
    if (invalid.length && !input.skipInvalidRows) throw new BusinessRuleError(`يوجد ${invalid.length} صف غير صالح. صحح الملف أو فعّل التخطي.`);
    if (!validLines.length) throw new BusinessRuleError("لا توجد سندات صالحة للاستيراد.");
    const checksum = createHash("sha256").update(JSON.stringify({ type: input.type, lines: validLines })).digest("hex");
    const prior = await prisma.importJob.findFirst({ where: { type: "VOUCHERS", checksum, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    if (prior) return ok({ jobId: prior.id, created: 0, skipped: validLines.length, transfers: 0, invalid });
    const job = await prisma.importJob.create({ data: { type: "VOUCHERS", status: "PROCESSING", checksum, mapping: { type: input.type, autoCreateAccounts: input.autoCreateAccounts, skipInvalidRows: input.skipInvalidRows }, createdById: user.id } });
    let created = 0; let skipped = invalid.length; let transfers = 0;
    try {
      for (const line of validLines) {
        try {
          const kind = voucherMovementKind(line.movementType, input.type);
          await withTxRetry(() => prisma.$transaction(async (tx) => {
            const channels = channelsFor(line);
            const treasuryByName = await resolveOrCreateImportTreasuries(tx, [...channels.map((channel) => channel.name), line.treasuryName].filter(Boolean), user.id);
            const anchorName = line.treasuryName.trim() || channels[0]?.name || "درج النقدية";
            const anchorId = treasuryByName.get(anchorName)?.id;
            if (!anchorId) throw new BusinessRuleError("تعذر تحديد خزينة السند.");
            if (kind === "TRANSFER_IN" || kind === "TRANSFER_OUT") {
              const opposite = channels.find((channel) => normalizeName(channel.name) !== normalizeName(anchorName));
              if (!opposite) throw new BusinessRuleError("التحويل الداخلي يحتاج قناة تمثل الخزينة المقابلة.");
              const otherId = treasuryByName.get(opposite.name)?.id;
              if (!otherId || otherId === anchorId) throw new BusinessRuleError("خزينة المصدر والوجهة للتحويل يجب أن تكون مختلفتين.");
              const fromId = kind === "TRANSFER_OUT" ? anchorId : otherId;
              const toId = kind === "TRANSFER_OUT" ? otherId : anchorId;
              const locked = await lockTreasuriesForUpdate(tx, [fromId, toId]);
              const from = locked.get(fromId)!; const to = locked.get(toId)!; const amount = money(line.amount);
              if (from.currentBalance.lt(amount)) throw new BusinessRuleError(`السيولة غير كافية في الخزينة ${from.name}.`);
              await tx.treasury.update({ where: { id: fromId }, data: { currentBalance: { decrement: amount } } });
              await tx.treasury.update({ where: { id: toId }, data: { currentBalance: { increment: amount } } });
              const outNumber = await nextTransactionNumber(tx); const inNumber = await nextTransactionNumber(tx);
              const transfer = await tx.treasuryTransfer.create({ data: { transferNumber: `TRF-${outNumber}`, fromTreasuryId: fromId, toTreasuryId: toId, amount, notes: ["استيراد Excel", line.transactionReference, line.notes].filter(Boolean).join(" — "), createdById: user.id, ...(transactionDate(line) ? { createdAt: transactionDate(line) } : {}) } });
              const transactions = await tx.treasuryTransaction.createMany({ data: [{ transactionNumber: outNumber, treasuryId: fromId, transferId: transfer.id, type: "TRANSFER", amount: amount.neg(), description: `تحويل مستورد إلى ${to.name} — ${line.transactionReference}`, createdByUser: user.id }, { transactionNumber: inNumber, treasuryId: toId, transferId: transfer.id, type: "TRANSFER", amount, description: `تحويل مستورد من ${from.name} — ${line.transactionReference}`, createdByUser: user.id }] });
              await writeAudit(tx, { tableName: "TreasuryTransfer", recordId: transfer.id, action: "INSERT", newData: { transfer, importedReference: line.transactionReference, transactionCount: transactions.count }, performedBy: user.id });
              return { transfer: true, transactions: 2 };
            }
            const account = await resolveOrCreateAccount(tx, line, kind, input.autoCreateAccounts, user.id);
            if (account) await lockAccountForUpdate(tx, account.id);
            const treasuryIds = [...new Set(channels.map((channel) => treasuryByName.get(channel.name)?.id).filter((id): id is string => Boolean(id)))];
            const locked = treasuryIds.length ? await lockTreasuriesForUpdate(tx, treasuryIds) : new Map();
            const outbound = kind === "PAYMENT";
            const amountsByTreasury = new Map<string, Prisma.Decimal>();
            for (const channel of channels) { const treasuryId = treasuryByName.get(channel.name)?.id; if (!treasuryId) throw new BusinessRuleError(`تعذر ربط قناة «${channel.name}» بخزينة.`); amountsByTreasury.set(treasuryId, (amountsByTreasury.get(treasuryId) ?? new Prisma.Decimal(0)).add(channel.amount)); }
            if (outbound) for (const [treasuryId, amount] of amountsByTreasury) { const treasury = locked.get(treasuryId); if (!treasury || treasury.currentBalance.lt(amount)) throw new BusinessRuleError(`السيولة غير كافية في الخزينة ${treasury?.name ?? "المختارة"}.`); }
            for (const channel of channels) {
              const treasuryId = treasuryByName.get(channel.name)?.id!;
              await tx.treasury.update({ where: { id: treasuryId }, data: outbound ? { currentBalance: { decrement: channel.amount } } : { currentBalance: { increment: channel.amount } } });
              const transaction = await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId, accountId: account?.id ?? null, type: kind, category: line.itemCategory || "VOUCHER_IMPORT", amount: channel.amount, description: [line.transactionReference, line.externalReference, line.itemCategory, line.notes].filter(Boolean).join(" — ") || (kind === "RECEIPT" ? "سند قبض مستورد" : "سند صرف مستورد"), createdByUser: user.id, ...(transactionDate(line) ? { createdAt: transactionDate(line) } : {}) } });
              await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: transaction.id, action: "INSERT", newData: { ...transaction, source: "VOUCHER_EXCEL_IMPORT", channelName: channel.name }, performedBy: user.id });
            }
            if (account) await tx.account.update({ where: { id: account.id }, data: kind === "RECEIPT" ? { currentBalance: { increment: money(line.amount) } } : { currentBalance: { decrement: money(line.amount) } } });
            return { transfer: false, transactions: channels.length };
          }, TX_OPTIONS));
          created += 1;
          if (kind === "TRANSFER_IN" || kind === "TRANSFER_OUT") transfers += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "تعذر ترحيل السند.";
          invalid.push({ row: line.sourceRowNumber, reason });
          if (!input.skipInvalidRows) throw error;
          skipped += 1;
        }
      }
      const summary = { total: input.rows.length, created, skipped, transfers, invalid: invalid.length };
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", summary } });
      await writeAudit(prisma, { tableName: "ImportJob", recordId: job.id, action: "INSERT", newData: { ...summary, source: "VOUCHER_EXCEL_IMPORT" }, performedBy: user.id });
      ["/vouchers", "/treasury", "/accounts", "/"].forEach((path) => revalidatePath(path));
      return ok({ jobId: job.id, created, skipped, transfers, invalid });
    } catch (error) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", summary: { total: input.rows.length, created, skipped, transfers, invalid: invalid.length } } });
      throw error;
    }
  } catch (error) { return toActionError(error, "executeVoucherImportAction"); }
}
