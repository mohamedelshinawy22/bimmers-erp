"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission, requireUser } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { money, num } from "@/lib/utils";
import { type TxClient } from "@/lib/prisma";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { assertTreasuryAccess, getUserAccess, hasApplicationPermission } from "@/lib/user-permissions";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const voucherLookupSchema = z.union([
  z.string().trim().min(1, "معرف السند مطلوب."),
  z.object({ id: z.string().trim().min(1).optional(), reference: z.string().trim().min(1).optional(), voucherId: z.string().trim().min(1).optional() }).refine((value) => Boolean(value.id || value.reference || value.voucherId), "معرف السند مطلوب."),
]);
const voucherIdSchema = z.object({ voucherId: z.string().uuid() });
const updateVoucherSchema = z.object({ voucherId: z.string().uuid(), amount: z.coerce.number().finite().positive().max(99_999_999.99), treasuryId: z.string().uuid(), description: z.string().trim().min(2, "بيان السند مطلوب.").max(500), paymentMethod: z.string().trim().max(80).optional().or(z.literal("")), createdAt: z.string().datetime().optional() });
const voidVoucherSchema = z.object({ voucherId: z.string().uuid(), reason: z.string().trim().min(3, "سبب الإلغاء مطلوب.").max(500) });
const restoreVoucherSchema = z.object({ voucherId: z.string().uuid(), reason: z.string().trim().max(500).optional().or(z.literal("")) });

type LockedVoucherTreasury = { id: string; name: string; currentBalance: Prisma.Decimal; isActive: boolean };

async function lockVoucherTreasuries(tx: TxClient, treasuryIds: string[]): Promise<Map<string, LockedVoucherTreasury>> {
  const ids = [...new Set(treasuryIds)].sort();
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; currentBalance: Prisma.Decimal; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "name", "currentBalance", "isActive"
    FROM "Treasury" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE
  `);
  if (rows.length !== ids.length) throw new BusinessRuleError("الخزينة المحددة غير موجودة.");
  return new Map(rows.map((row) => [row.id, { ...row, currentBalance: money(row.currentBalance) }]));
}

async function lockVoucher(tx: TxClient, voucherId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TreasuryTransaction" WHERE "id" = ${voucherId} FOR UPDATE`);
  const voucher = await tx.treasuryTransaction.findUnique({ where: { id: voucherId } });
  if (!voucher) throw new BusinessRuleError("السند غير موجود.");
  if (voucher.transferId) throw new BusinessRuleError("لا يمكن إدارة تحويل خزينة من شاشة السندات. استخدم مسار التحويلات.");
  return voucher;
}

function accountEffect(type: "RECEIPT" | "PAYMENT", amount: Prisma.Decimal) {
  return type === "RECEIPT" ? amount : amount.negated();
}

function treasuryEffect(type: "RECEIPT" | "PAYMENT", amount: Prisma.Decimal) {
  return type === "RECEIPT" ? amount : amount.negated();
}

async function updateInvoiceSettlement(tx: TxClient, voucher: { invoiceId: string | null; type: "RECEIPT" | "PAYMENT" | "TRANSFER"; amount: Prisma.Decimal }, delta: Prisma.Decimal) {
  if (!voucher.invoiceId || delta.eq(0)) return;
  const invoice = await tx.invoice.findUnique({ where: { id: voucher.invoiceId } });
  if (!invoice || invoice.isVoided) throw new BusinessRuleError("الفاتورة المرتبطة بالسند غير متاحة للتسوية.");
  const paidAmount = money(invoice.paidAmount.add(delta));
  if (paidAmount.lt(0) || paidAmount.gt(invoice.grandTotal)) throw new BusinessRuleError("تعديل مبلغ السند يتجاوز حدود تسوية الفاتورة المرتبطة.");
  const remainingAmount = money(invoice.grandTotal.sub(paidAmount));
  await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, remainingAmount, paymentStatus: paidAmount.eq(0) ? "CREDIT" : remainingAmount.eq(0) ? "PAID" : "PARTIAL" } });
}

function extractVoucherIdentifier(raw: z.infer<typeof voucherLookupSchema>): string {
  if (typeof raw === "string") return raw.trim();
  return (raw.id || raw.reference || raw.voucherId || "").trim();
}

function revalidateVoucherConsumers() {
  for (const path of ["/", "/treasury", "/accounts", "/invoices", "/reports/daily-movement"]) revalidatePath(path);
}

export async function getVoucherDetailsAction(raw: unknown): Promise<ActionResult<{ voucher: { id: string; transactionNumber: string; type: "RECEIPT" | "PAYMENT"; amount: number; description: string; paymentMethod: string | null; createdAt: string; status: string; voidedAt: string | null; voidedByUser: string | null; voidReason: string | null; account: { id: string; name: string; accountNumber: string } | null; treasury: { id: string; name: string; currentBalance: number }; invoiceNumber: string | null; createdByName: string | null }; treasuries: Array<{ id: string; name: string; currentBalance: number }>; canManage: boolean; canRestore: boolean; timeline: Array<{ id: string; action: string; event: string | null; performedBy: string; timestamp: string }> }>> {
  try {
    const user = await requirePermission("treasury.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const identifier = extractVoucherIdentifier(voucherLookupSchema.parse(raw));
    const access = await getUserAccess(user.id);
    const voucher = await tenant.prisma.treasuryTransaction.findFirst({ where: { OR: [{ id: identifier }, { transactionNumber: identifier }] }, include: { account: { select: { id: true, name: true, accountNumber: true } }, treasury: { select: { id: true, name: true, currentBalance: true } }, invoice: { select: { invoiceNumber: true } } } });
    if (!voucher || voucher.type === "TRANSFER") throw new BusinessRuleError("سند القبض أو الصرف غير موجود.");
    assertTreasuryAccess(access, voucher.treasuryId);
    const [createdBy, treasuries, auditTrail] = await Promise.all([
      tenant.prisma.user.findUnique({ where: { id: voucher.createdByUser }, select: { fullName: true } }),
      tenant.prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currentBalance: true } }),
      tenant.prisma.systemAuditTrail.findMany({ where: { tableName: "TreasuryTransaction", recordId: voucher.id }, orderBy: { timestamp: "desc" }, take: 25, select: { id: true, action: true, newData: true, performedBy: true, timestamp: true } }),
    ]);
    return ok({ voucher: { id: voucher.id, transactionNumber: voucher.transactionNumber, type: voucher.type as "RECEIPT" | "PAYMENT", amount: num(voucher.amount), description: voucher.description, paymentMethod: voucher.category, createdAt: voucher.createdAt.toISOString(), status: voucher.status, voidedAt: voucher.voidedAt?.toISOString() ?? null, voidedByUser: voucher.voidedByUser, voidReason: voucher.voidReason, account: voucher.account, treasury: { id: voucher.treasury.id, name: voucher.treasury.name, currentBalance: num(voucher.treasury.currentBalance) }, invoiceNumber: voucher.invoice?.invoiceNumber ?? null, createdByName: createdBy?.fullName ?? null }, treasuries: treasuries.filter((treasury) => access.role === "SUPER_ADMIN" || access.allowedTreasuryIds.length === 0 || access.allowedTreasuryIds.includes(treasury.id)).map((treasury) => ({ id: treasury.id, name: treasury.name, currentBalance: num(treasury.currentBalance) })), canManage: hasApplicationPermission(access, "treasury.manage"), canRestore: user.role === "SUPER_ADMIN", timeline: auditTrail.map((entry) => ({ id: entry.id, action: entry.action, event: entry.newData && typeof entry.newData === "object" && !Array.isArray(entry.newData) && "event" in entry.newData ? String((entry.newData as Record<string, unknown>).event ?? "") || null : null, performedBy: entry.performedBy, timestamp: entry.timestamp.toISOString() })) });
    });
  } catch (error) { return toActionError(error, "getVoucherDetailsAction"); }
}

export async function updateVoucherAction(raw: unknown): Promise<ActionResult<{ id: string; transactionNumber: string }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const input = updateVoucherSchema.parse(raw);
    const access = await getUserAccess(user.id);
    assertTreasuryAccess(access, input.treasuryId);
    const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const voucher = await lockVoucher(tx, input.voucherId);
      assertTreasuryAccess(access, voucher.treasuryId);
      if (voucher.status !== "ACTIVE") throw new BusinessRuleError("لا يمكن تعديل سند ملغى.");
      if (voucher.type === "TRANSFER") throw new BusinessRuleError("لا يمكن تعديل تحويل خزينة من شاشة السندات.");
      const amount = money(input.amount);
      const treasuryIds = [voucher.treasuryId, input.treasuryId];
      const treasuries = await lockVoucherTreasuries(tx, treasuryIds);
      if (voucher.accountId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${voucher.accountId} FOR UPDATE`);
      const account = voucher.accountId ? await tx.account.findUnique({ where: { id: voucher.accountId } }) : null;
      if (voucher.accountId && !account) throw new BusinessRuleError("الحساب المرتبط بالسند غير موجود.");
      const oldAmount = money(voucher.amount);
      const treasuryDeltas = new Map<string, Prisma.Decimal>();
      const applyDelta = (id: string, value: Prisma.Decimal) => treasuryDeltas.set(id, money((treasuryDeltas.get(id) ?? money(0)).add(value)));
      applyDelta(voucher.treasuryId, treasuryEffect(voucher.type as "RECEIPT" | "PAYMENT", oldAmount).negated());
      applyDelta(input.treasuryId, treasuryEffect(voucher.type as "RECEIPT" | "PAYMENT", amount));
      for (const [treasuryId, delta] of treasuryDeltas) {
        const treasury = treasuries.get(treasuryId)!;
        const nextBalance = money(treasury.currentBalance.add(delta));
        if (nextBalance.lt(0)) throw new BusinessRuleError(`لا يمكن تعديل السند: سيصبح رصيد خزينة "${treasury.name}" سالباً.`);
        await tx.treasury.update({ where: { id: treasuryId }, data: { currentBalance: nextBalance } });
      }
      const accountDelta = money(accountEffect(voucher.type as "RECEIPT" | "PAYMENT", amount).sub(accountEffect(voucher.type as "RECEIPT" | "PAYMENT", oldAmount)));
      if (account && account.type !== "EXPENSE") await tx.account.update({ where: { id: account.id }, data: { currentBalance: money(account.currentBalance.add(accountDelta)) } });
      await updateInvoiceSettlement(tx, voucher, amount.sub(oldAmount));
      const updated = await tx.treasuryTransaction.update({ where: { id: voucher.id }, data: { treasuryId: input.treasuryId, amount, description: input.description, category: input.paymentMethod || null, ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}) } });
      await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: updated.id, action: "UPDATE", oldData: voucher, newData: { ...updated, operation: "VOUCHER_UPDATED", amountDelta: num(amount.sub(oldAmount)) }, performedBy: user.id });
      return { id: updated.id, transactionNumber: updated.transactionNumber };
    }, TX_OPTIONS));
    revalidateVoucherConsumers();
    return ok(result);
    });
  } catch (error) { return toActionError(error, "updateVoucherAction"); }
}

export async function restoreCancelledVoucherAction(raw: unknown): Promise<ActionResult<{ id: string; transactionNumber: string }>> {
  try {
    const user = await requireUser();
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية استعادة السندات الملغاة متاحة لمدير النظام فقط.");
    const input = restoreVoucherSchema.parse(raw);
    const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const voucher = await lockVoucher(tx, input.voucherId);
      if (voucher.status !== "VOIDED") throw new BusinessRuleError("هذا السند نشط بالفعل ولا يحتاج إلى استعادة.");
      if (voucher.type === "TRANSFER") throw new BusinessRuleError("لا يمكن استعادة تحويل خزينة من شاشة السندات.");
      const treasuries = await lockVoucherTreasuries(tx, [voucher.treasuryId]);
      const treasury = treasuries.get(voucher.treasuryId)!;
      if (voucher.accountId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${voucher.accountId} FOR UPDATE`);
      const account = voucher.accountId ? await tx.account.findUnique({ where: { id: voucher.accountId } }) : null;
      if (voucher.accountId && !account) throw new BusinessRuleError("الحساب المرتبط بالسند غير موجود؛ لا يمكن إعادة مزامنة الرصيد.");
      const amount = money(voucher.amount);
      const treasuryNext = money(treasury.currentBalance.add(treasuryEffect(voucher.type as "RECEIPT" | "PAYMENT", amount)));
      if (treasuryNext.lt(0)) throw new BusinessRuleError(`لا يمكن استعادة السند: رصيد خزينة "${treasury.name}" لا يكفي لإعادة تفعيل سند الصرف بمبلغ ${num(amount)}.`);
      await tx.treasury.update({ where: { id: treasury.id }, data: { currentBalance: treasuryNext } });
      if (account && account.type !== "EXPENSE") await tx.account.update({ where: { id: account.id }, data: { currentBalance: money(account.currentBalance.add(accountEffect(voucher.type as "RECEIPT" | "PAYMENT", amount))) } });
      await updateInvoiceSettlement(tx, voucher, amount);
      const restored = await tx.treasuryTransaction.update({ where: { id: voucher.id }, data: { status: "ACTIVE", voidedAt: null, voidedByUser: null, voidReason: null } });
      await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: restored.id, action: "UPDATE", oldData: voucher, newData: { ...restored, event: "VOUCHER_RESTORED", reason: input.reason || "استعادة السند بواسطة مدير النظام", restoredTreasuryBalance: true, restoredAccountBalance: Boolean(account && account.type !== "EXPENSE") }, performedBy: user.id });
      return { id: restored.id, transactionNumber: restored.transactionNumber };
    }, TX_OPTIONS));
    revalidateVoucherConsumers();
    return ok(result);
    });
  } catch (error) { return toActionError(error, "restoreCancelledVoucherAction"); }
}

export async function voidVoucherAction(raw: unknown): Promise<ActionResult<{ id: string; transactionNumber: string }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const input = voidVoucherSchema.parse(raw);
    const access = await getUserAccess(user.id);
    const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const voucher = await lockVoucher(tx, input.voucherId);
      assertTreasuryAccess(access, voucher.treasuryId);
      if (voucher.status !== "ACTIVE") throw new BusinessRuleError("هذا السند ملغى بالفعل.");
      if (voucher.type === "TRANSFER") throw new BusinessRuleError("لا يمكن إلغاء تحويل خزينة من شاشة السندات.");
      const treasuries = await lockVoucherTreasuries(tx, [voucher.treasuryId]);
      const treasury = treasuries.get(voucher.treasuryId)!;
      if (voucher.accountId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${voucher.accountId} FOR UPDATE`);
      const account = voucher.accountId ? await tx.account.findUnique({ where: { id: voucher.accountId } }) : null;
      if (voucher.accountId && !account) throw new BusinessRuleError("الحساب المرتبط بالسند غير موجود.");
      const amount = money(voucher.amount);
      const treasuryNext = money(treasury.currentBalance.sub(treasuryEffect(voucher.type as "RECEIPT" | "PAYMENT", amount)));
      if (treasuryNext.lt(0)) throw new BusinessRuleError(`لا يمكن إلغاء السند: سيصبح رصيد خزينة "${treasury.name}" سالباً.`);
      await tx.treasury.update({ where: { id: treasury.id }, data: { currentBalance: treasuryNext } });
      if (account && account.type !== "EXPENSE") await tx.account.update({ where: { id: account.id }, data: { currentBalance: money(account.currentBalance.sub(accountEffect(voucher.type as "RECEIPT" | "PAYMENT", amount))) } });
      await updateInvoiceSettlement(tx, voucher, amount.negated());
      const voided = await tx.treasuryTransaction.update({ where: { id: voucher.id }, data: { status: "VOIDED", voidedAt: new Date(), voidedByUser: user.id, voidReason: input.reason } });
      await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: voided.id, action: "VOID", oldData: voucher, newData: { ...voided, event: "VOUCHER_CANCELLED", reversedTreasuryBalance: true, reversedAccountBalance: Boolean(account && account.type !== "EXPENSE") }, performedBy: user.id });
      return { id: voided.id, transactionNumber: voided.transactionNumber };
    }, TX_OPTIONS));
    revalidateVoucherConsumers();
    return ok(result);
    });
  } catch (error) { return toActionError(error, "voidVoucherAction"); }
}
