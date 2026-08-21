"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/redis";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { formatMoney, money } from "@/lib/utils";
import {
  closeShiftSchema,
  openShiftSchema,
  treasuryTransactionSchema,
  treasuryTransferSchema,
  type TreasuryTransactionInput,
  type TreasuryTransferInput,
  settleInvoiceSchema,
  type SettleInvoiceInput,
} from "@/lib/validations/invoice";
import { nextShiftNumber, nextTransactionNumber } from "@/server/services/numbering.service";
import { lockAccountForUpdate, lockAccountsForUpdate, lockTreasuriesForUpdate } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { createTreasurySchema, treasuryReportSchema, treasurySchema, type CreateTreasuryInput, type TreasuryInput, type TreasuryReportInput } from "@/lib/validations/treasury";





const deleteManualTreasuryTransactionsSchema = z.object({ transactionIds: z.array(z.string().uuid()).min(1).max(100) });

/** Reverses and permanently removes manual vouchers only; invoice/transfer entries remain immutable in their source workflows. */
export async function deleteManualTreasuryTransactionsAction(raw: { transactionIds: string[] }): Promise<ActionResult<{ deleted: number }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const input = deleteManualTreasuryTransactionsSchema.parse(raw);
    const ids = [...new Set(input.transactionIds)];
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const transactions = await tx.treasuryTransaction.findMany({ where: { id: { in: ids } } });
      if (transactions.length !== ids.length) throw new BusinessRuleError("إحدى الحركات المحددة لم تعد موجودة.");
      if (transactions.some((transaction) => transaction.invoiceId || transaction.type === "TRANSFER")) throw new BusinessRuleError("لا يمكن حذف حركة مرتبطة بفاتورة أو تحويل داخلي. استخدم إلغاء الفاتورة أو التحويل من مساره الأصلي.");
      const accountIds = transactions.map((transaction) => transaction.accountId).filter((id): id is string => Boolean(id));
      if (accountIds.length) await lockAccountsForUpdate(tx, accountIds);
      const treasuries = await lockTreasuriesForUpdate(tx, transactions.map((transaction) => transaction.treasuryId));
      for (const transaction of transactions) {
        const treasury = treasuries.get(transaction.treasuryId)!;
        if (transaction.type === "RECEIPT" && treasury.currentBalance.lt(transaction.amount)) throw new BusinessRuleError(`لا يمكن حذف السند ${transaction.transactionNumber}: سيولة خزينة "${treasury.name}" لا تكفي لعكس القبض.`);
        await tx.treasury.update({ where: { id: transaction.treasuryId }, data: transaction.type === "RECEIPT" ? { currentBalance: { decrement: transaction.amount } } : { currentBalance: { increment: transaction.amount } } });
        if (transaction.accountId) await tx.account.update({ where: { id: transaction.accountId }, data: transaction.type === "RECEIPT" ? { currentBalance: { decrement: transaction.amount } } : { currentBalance: { increment: transaction.amount } } });
        await tx.treasuryTransaction.delete({ where: { id: transaction.id } });
        await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: transaction.id, action: "DELETE", oldData: transaction, newData: { reversed: true, source: "MANUAL_VOUCHER" }, performedBy: user.id });
      }
      return { deleted: transactions.length };
    }, TX_OPTIONS));
    await invalidateCache("dashboard");
    for (const path of ["/", "/treasury", "/accounts"]) revalidatePath(path);
    return ok(result);
  } catch (error) { return toActionError(error, "deleteManualTreasuryTransactionsAction"); }
}

/**
 * Receipt (سند قبض) / Payment (سند صرف).
 * Account and treasury rows are both locked before either balance moves, so a
 * simultaneous invoice and receipt on the same account can never interleave.
 */
export async function createTreasuryTransactionAction(
  raw: TreasuryTransactionInput,
): Promise<ActionResult<{ transactionNumber: string; treasuryBalance: number }>> {
  try {
    const user = await requirePermission("treasury.transact");
    const input = treasuryTransactionSchema.parse(raw);
    const amount = money(input.amount);

    const result = await withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const invoice = input.invoiceId ? await tx.invoice.findUnique({ where: { id: input.invoiceId } }) : null;
        if (input.invoiceId && !invoice) throw new BusinessRuleError("الفاتورة المرتبطة غير موجودة.");
        if (invoice?.isVoided) throw new BusinessRuleError("لا يمكن ربط سند بفاتورة ملغاة.");
        if (invoice && ((invoice.type === "SALE" && input.type !== "RECEIPT") || (invoice.type === "PURCHASE" && input.type !== "PAYMENT"))) {
          throw new BusinessRuleError("نوع السند لا يتوافق مع نوع الفاتورة المرتبطة.");
        }
        if (invoice && amount.gt(invoice.remainingAmount)) throw new BusinessRuleError(`مبلغ السند أكبر من المتبقي على الفاتورة (${formatMoney(invoice.remainingAmount)}).`);
        const accountId = invoice?.accountId ?? input.accountId ?? null;
        if (invoice && input.accountId && input.accountId !== invoice.accountId) throw new BusinessRuleError("الحساب المحدد لا يطابق حساب الفاتورة المرتبطة.");

        // Account first, treasury second — see GLOBAL LOCK ORDER above.
        if (accountId) await lockAccountForUpdate(tx, accountId);
        const treasuries = await lockTreasuriesForUpdate(tx, [input.treasuryId]);
        const treasury = treasuries.get(input.treasuryId)!;
        if (!treasury.isActive) throw new BusinessRuleError("لا يمكن إنشاء سند على خزينة معطلة.");
        if (input.type === "PAYMENT" && treasury.currentBalance.lt(amount)) {
          throw new BusinessRuleError(`السيولة غير كافية في "${treasury.name}". الرصيد الحالي: ${formatMoney(treasury.currentBalance)}`);
        }

        const updatedTreasury = await tx.treasury.update({
          where: { id: input.treasuryId },
          data: input.type === "RECEIPT" ? { currentBalance: { increment: amount } } : { currentBalance: { decrement: amount } },
          select: { currentBalance: true },
        });
        if (accountId) {
          await tx.account.update({
            where: { id: accountId },
            data: input.type === "RECEIPT" ? { currentBalance: { increment: amount } } : { currentBalance: { decrement: amount } },
          });
        }
        if (invoice) {
          const remainingAmount = money(invoice.remainingAmount.sub(amount));
          await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: { increment: amount }, remainingAmount, paymentStatus: remainingAmount.eq(0) ? "PAID" : "PARTIAL", treasuryId: invoice.treasuryId ?? input.treasuryId } });
        }

        const transaction = await tx.treasuryTransaction.create({
          data: {
            transactionNumber: await nextTransactionNumber(tx), treasuryId: input.treasuryId, accountId, invoiceId: invoice?.id,
            type: input.type, category: input.category ?? "CASH", amount, description: input.description, createdByUser: user.id,
            ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
          },
        });
        await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: transaction.id, action: "INSERT", newData: { ...transaction, event: "VOUCHER_CREATED", invoiceSettlement: Boolean(invoice) }, performedBy: user.id });
        return { transactionNumber: transaction.transactionNumber, treasuryBalance: Number(updatedTreasury.currentBalance) };
      }, TX_OPTIONS),
    );
    await invalidateCache("dashboard");
    for (const path of ["/", "/treasury", "/accounts", "/invoices", "/vouchers"]) revalidatePath(path);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createTreasuryTransactionAction");
  }
}

export async function settleInvoiceAction(raw: SettleInvoiceInput): Promise<ActionResult<{ transactionNumber: string; remainingAmount: number }>> {
  try {
    const user = await requirePermission("treasury.transact");
    const input = settleInvoiceSchema.parse(raw);
    const amount = money(input.amount);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const initial = await tx.invoice.findUnique({ where: { id: input.invoiceId }, select: { accountId: true } });
      if (!initial) throw new BusinessRuleError("الفاتورة غير موجودة.");
      await lockAccountForUpdate(tx, initial.accountId);
      const treasuries = await lockTreasuriesForUpdate(tx, [input.treasuryId]);
      const treasury = treasuries.get(input.treasuryId)!;
      const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
      if (!invoice || invoice.isVoided) throw new BusinessRuleError("لا يمكن سداد فاتورة ملغاة أو غير موجودة.");
      if (invoice.type !== "SALE" && invoice.type !== "PURCHASE") throw new BusinessRuleError("السداد متاح لفواتير البيع والشراء فقط.");
      if (invoice.remainingAmount.lte(0)) throw new BusinessRuleError("هذه الفاتورة مسددة بالكامل.");
      if (amount.gt(invoice.remainingAmount)) throw new BusinessRuleError(`المبلغ أكبر من المتبقي على الفاتورة (${formatMoney(invoice.remainingAmount)}).`);
      const type = invoice.type === "SALE" ? "RECEIPT" : "PAYMENT";
      if (type === "PAYMENT" && treasury.currentBalance.lt(amount)) throw new BusinessRuleError(`السيولة غير كافية في "${treasury.name}". الرصيد الحالي: ${formatMoney(treasury.currentBalance)}`);
      const remainingAmount = money(invoice.remainingAmount.sub(amount));
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount: { increment: amount }, remainingAmount, paymentStatus: remainingAmount.eq(0) ? "PAID" : "PARTIAL", treasuryId: invoice.treasuryId ?? input.treasuryId },
      });
      await tx.treasury.update({ where: { id: input.treasuryId }, data: type === "RECEIPT" ? { currentBalance: { increment: amount } } : { currentBalance: { decrement: amount } } });
      await tx.account.update({ where: { id: invoice.accountId }, data: type === "RECEIPT" ? { currentBalance: { increment: amount } } : { currentBalance: { decrement: amount } } });
      const transaction = await tx.treasuryTransaction.create({ data: { transactionNumber: await nextTransactionNumber(tx), treasuryId: input.treasuryId, accountId: invoice.accountId, invoiceId: invoice.id, type, amount, description: input.description || `${type === "RECEIPT" ? "تحصيل" : "سداد"} فاتورة ${invoice.invoiceNumber}`, createdByUser: user.id } });
      await writeAudit(tx, { tableName: "Invoice", recordId: invoice.id, action: "UPDATE", oldData: invoice, newData: updatedInvoice, performedBy: user.id });
      await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: transaction.id, action: "INSERT", newData: transaction, performedBy: user.id });
      return { transactionNumber: transaction.transactionNumber, remainingAmount: Number(remainingAmount) };
    }, TX_OPTIONS));
    await invalidateCache("dashboard");
    for (const path of ["/", "/invoices", "/treasury", "/accounts"]) revalidatePath(path);
    return ok(result);
  } catch (error) { return toActionError(error, "settleInvoiceAction"); }
}

const TREASURY_REVALIDATION_PATHS = ["/", "/treasury", "/pos", "/invoices", "/sales/returns", "/purchases/returns", "/accounts"] as const;

function revalidateTreasuryConsumers() {
  for (const path of TREASURY_REVALIDATION_PATHS) revalidatePath(path);
}

export async function createTreasuryAction(raw: CreateTreasuryInput): Promise<ActionResult<{ id: string; name: string; openingTransactionNumber: string | null }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const input = createTreasurySchema.parse(raw);
    if (input.isDefault && !input.isActive) throw new BusinessRuleError("الخزينة الافتراضية يجب أن تكون نشطة.");
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.treasury.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const created = await tx.treasury.create({
        data: {
          name: input.name,
          type: input.type,
          notes: input.notes ?? null,
          isDefault: input.isDefault,
          isActive: input.isActive,
          currentBalance: money(input.openingBalance),
        },
      });
      let openingTransactionNumber: string | null = null;
      if (input.openingBalance > 0) {
        openingTransactionNumber = await nextTransactionNumber(tx);
        const openingTransaction = await tx.treasuryTransaction.create({
          data: {
            transactionNumber: openingTransactionNumber,
            treasuryId: created.id,
            type: "RECEIPT",
            category: "OPENING_BALANCE",
            amount: money(input.openingBalance),
            description: "رصيد افتتاحي للخزينة عند الإنشاء",
            createdByUser: user.id,
          },
        });
        await writeAudit(tx, { tableName: "TreasuryTransaction", recordId: openingTransaction.id, action: "INSERT", newData: openingTransaction, performedBy: user.id });
      }
      await writeAudit(tx, { tableName: "Treasury", recordId: created.id, action: "INSERT", newData: { ...created, openingBalance: input.openingBalance, openingTransactionNumber }, performedBy: user.id });
      return { id: created.id, name: created.name, openingTransactionNumber };
    }, TX_OPTIONS));
    await invalidateCache("dashboard");
    revalidateTreasuryConsumers();
    return ok(result);
  } catch (error) { return toActionError(error, "createTreasuryAction"); }
}

export async function updateTreasuryAction(id: string, raw: TreasuryInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const input = treasurySchema.parse(raw);
    if (input.isDefault && !input.isActive) throw new BusinessRuleError("الخزينة الافتراضية يجب أن تكون نشطة.");
    await withTxRetry(() => prisma.$transaction(async (tx) => {
      const before = await tx.treasury.findUnique({ where: { id } });
      if (!before) throw new BusinessRuleError("الخزينة غير موجودة.");
      if (!input.isActive && before.isDefault) {
        const replacement = await tx.treasury.count({ where: { id: { not: id }, isActive: true, isDefault: true } });
        if (replacement === 0) throw new BusinessRuleError("لا يمكن تعطيل الخزينة الافتراضية قبل تعيين خزينة نشطة أخرى كافتراضية.");
      }
      if (input.isDefault) await tx.treasury.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      const updated = await tx.treasury.update({ where: { id }, data: { ...input, notes: input.notes ?? null } });
      await writeAudit(tx, { tableName: "Treasury", recordId: id, action: "UPDATE", oldData: before, newData: updated, performedBy: user.id });
    }, TX_OPTIONS));
    revalidateTreasuryConsumers();
    return ok({ id });
  } catch (error) { return toActionError(error, "updateTreasuryAction"); }
}

export async function toggleTreasuryStatusAction(id: string): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  try {
    const user = await requirePermission("treasury.manage");
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const treasury = await tx.treasury.findUnique({ where: { id } });
      if (!treasury) throw new BusinessRuleError("الخزينة غير موجودة.");
      const nextIsActive = !treasury.isActive;
      if (!nextIsActive && treasury.isDefault) {
        const replacement = await tx.treasury.count({ where: { id: { not: id }, isActive: true, isDefault: true } });
        if (replacement === 0) throw new BusinessRuleError("لا يمكن تعطيل الخزينة الافتراضية قبل تعيين خزينة نشطة أخرى كافتراضية.");
      }
      const updated = await tx.treasury.update({ where: { id }, data: { isActive: nextIsActive, ...(nextIsActive ? {} : { isDefault: false }) } });
      await writeAudit(tx, { tableName: "Treasury", recordId: id, action: "UPDATE", oldData: treasury, newData: updated, performedBy: user.id });
      return { id: updated.id, isActive: updated.isActive };
    }, TX_OPTIONS));
    revalidateTreasuryConsumers();
    return ok(result);
  } catch (error) { return toActionError(error, "toggleTreasuryStatusAction"); }
}

export async function deleteTreasuryAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("treasury.manage");
    await withTxRetry(() => prisma.$transaction(async (tx) => {
      const treasury = await tx.treasury.findUnique({
        where: { id },
        include: { _count: { select: { transactions: true, shifts: true, invoices: true, heldSales: true, transfersSent: true, transfersReceived: true } } },
      });
      if (!treasury) throw new BusinessRuleError("الخزينة غير موجودة.");
      if (!treasury.currentBalance.eq(0)) {
        throw new BusinessRuleError("لا يمكن حذف الخزينة لأن رصيدها الحالي لا يساوي صفراً. يرجى تصفية أو تحويل الرصيد إلى خزينة أخرى أولاً.");
      }
      const historyCount = Object.values(treasury._count).reduce((total, count) => total + count, 0);
      if (historyCount > 0) {
        throw new BusinessRuleError("لا يمكن حذف خزينة لها سجل حركات مالي أو تشغيلي. استخدم تعطيل الخزينة للحفاظ على التاريخ المحاسبي.");
      }
      await tx.treasury.delete({ where: { id } });
      await writeAudit(tx, { tableName: "Treasury", recordId: id, action: "DELETE", oldData: treasury, performedBy: user.id });
    }, TX_OPTIONS));
    revalidateTreasuryConsumers();
    return ok({ id });
  } catch (error) { return toActionError(error, "deleteTreasuryAction"); }
}

export async function getTreasuryReportAction(raw: TreasuryReportInput) {
  try {
    await requirePermission("treasury.read");
    const input = treasuryReportSchema.parse(raw);
    const where = input.treasuryIds.length ? { in: input.treasuryIds } : undefined;
    const [treasuries, prior, period] = await Promise.all([
      prisma.treasury.findMany({ where: { isActive: true, ...(where ? { id: where } : {}) }, select: { id: true, name: true, currentBalance: true } }),
      prisma.treasuryTransaction.groupBy({ by: ["treasuryId"], where: { ...(where ? { treasuryId: where } : {}), createdAt: { lt: input.fromDate } }, _sum: { amount: true } }),
      prisma.treasuryTransaction.groupBy({ by: ["treasuryId"], where: { ...(where ? { treasuryId: where } : {}), createdAt: { gte: input.fromDate, lt: input.toDate } }, _sum: { amount: true } }),
    ]);
    const priorMap = new Map(prior.map((row) => [row.treasuryId, money(row._sum.amount ?? 0)]));
    const periodMap = new Map(period.map((row) => [row.treasuryId, money(row._sum.amount ?? 0)]));
    const rows = treasuries.map((treasury) => { const opening = priorMap.get(treasury.id) ?? money(0); const netMovement = periodMap.get(treasury.id) ?? money(0); return { id: treasury.id, name: treasury.name, previousBalance: Number(opening), netMovement: Number(netMovement), endingBalance: Number(opening.add(netMovement)), currentBalance: Number(treasury.currentBalance) }; });
    return ok({ fromDate: input.fromDate.toISOString(), toDate: input.toDate.toISOString(), rows, totals: rows.reduce((sum, row) => ({ previousBalance: sum.previousBalance + row.previousBalance, netMovement: sum.netMovement + row.netMovement, endingBalance: sum.endingBalance + row.endingBalance, currentBalance: sum.currentBalance + row.currentBalance }), { previousBalance: 0, netMovement: 0, endingBalance: 0, currentBalance: 0 }) });
  } catch (error) { return toActionError(error, "getTreasuryReportAction"); }
}

/** Internal transfer — both treasuries locked in sorted order (deadlock-free). */
export async function transferBetweenTreasuriesAction(
  raw: TreasuryTransferInput,
): Promise<ActionResult<{ transactionNumbers: string[] }>> {
  try {
    const user = await requirePermission("treasury.transfer");
    const input = treasuryTransferSchema.parse(raw);
    const amount = money(input.amount);

    const numbers = await withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const locked = await lockTreasuriesForUpdate(tx, [input.fromTreasuryId, input.toTreasuryId]);
        const from = locked.get(input.fromTreasuryId)!;
        const to = locked.get(input.toTreasuryId)!;

        if (from.currentBalance.lt(amount)) {
          throw new BusinessRuleError(
            `السيولة غير كافية في "${from.name}". الرصيد: ${formatMoney(from.currentBalance)}`,
          );
        }

        await tx.treasury.update({
          where: { id: from.id },
          data: { currentBalance: { decrement: amount } },
        });
        await tx.treasury.update({
          where: { id: to.id },
          data: { currentBalance: { increment: amount } },
        });

        const outNumber = await nextTransactionNumber(tx);
        const inNumber = await nextTransactionNumber(tx);
        const transfer = await tx.treasuryTransfer.create({
          data: {
            transferNumber: `TRF-${outNumber}`,
            fromTreasuryId: from.id,
            toTreasuryId: to.id,
            amount,
            notes: input.description || null,
            createdById: user.id,
          },
        });

        await tx.treasuryTransaction.createMany({
          data: [
            {
              transactionNumber: outNumber,
              treasuryId: from.id,
              transferId: transfer.id,
              type: "TRANSFER",
              amount: amount.neg(),
              description: `تحويل صادر إلى "${to.name}" — ${input.description}`,
              createdByUser: user.id,
            },
            {
              transactionNumber: inNumber,
              treasuryId: to.id,
              transferId: transfer.id,
              type: "TRANSFER",
              amount,
              description: `تحويل وارد من "${from.name}" — ${input.description}`,
              createdByUser: user.id,
            },
          ],
        });

        await writeAudit(tx, {
          tableName: "Treasury",
          recordId: from.id,
          action: "UPDATE",
          oldData: { from: from.currentBalance, to: to.currentBalance },
          newData: { transferred: amount, fromId: from.id, toId: to.id, transferId: transfer.id },
          performedBy: user.id,
        });

        return [outNumber, inNumber];
      }, TX_OPTIONS),
    );

    await invalidateCache("dashboard");
    revalidatePath("/treasury");
    return ok({ transactionNumbers: numbers });
  } catch (error) {
    return toActionError(error, "transferBetweenTreasuriesAction");
  }
}

export async function openShiftAction(
  raw: { treasuryId: string; openingBalance: number; notes?: string },
): Promise<ActionResult<{ shiftNumber: string }>> {
  try {
    const user = await requirePermission("treasury.closeShift");
    const input = openShiftSchema.parse(raw);

    const shift = await prisma.$transaction(async (tx) => {
      const treasuries = await lockTreasuriesForUpdate(tx, [input.treasuryId]);
      const treasury = treasuries.get(input.treasuryId)!;
      const open = await tx.treasuryShift.findFirst({
        where: { treasuryId: input.treasuryId, closedAt: null },
        select: { shiftNumber: true },
      });
      if (open) throw new BusinessRuleError(`يوجد وردية مفتوحة بالفعل (${open.shiftNumber}). أغلقها أولاً.`);

      const created = await tx.treasuryShift.create({
        data: {
          shiftNumber: await nextShiftNumber(tx),
          treasuryId: input.treasuryId,
          openedByUserId: user.id,
          openingBalance: money(input.openingBalance),
          // Snapshot the treasury's own balance so the Z-report reconciles
          // against the books, not against the cashier's declared figure.
          bookOpeningBalance: treasury.currentBalance,
          notes: input.notes || null,
        },
      });
      await writeAudit(tx, {
        tableName: "TreasuryShift",
        recordId: created.id,
        action: "INSERT",
        newData: created,
        performedBy: user.id,
      });
      return created;
    }, TX_OPTIONS);

    revalidatePath("/treasury");
    return ok({ shiftNumber: shift.shiftNumber });
  } catch (error) {
    return toActionError(error, "openShiftAction");
  }
}

/**
 * Z-Report close.
 *
 * A cash over/short is not just recorded on the shift — it is *posted* to the
 * treasury as a RECEIPT (overage) or PAYMENT (shortage), and the book balance is
 * moved to the counted amount. Previously the variance was stored but never
 * posted, so the treasury stayed wrong and the same discrepancy was re-detected
 * and re-reported at every subsequent close instead of clearing.
 */
export async function closeShiftAction(
  raw: { shiftId: string; countedCash: number; notes?: string },
): Promise<
  ActionResult<{
    shiftNumber: string;
    variance: number;
    systemBalance: number;
    postedTransactionNumber: string | null;
  }>
> {
  try {
    const user = await requirePermission("treasury.closeShift");
    const input = closeShiftSchema.parse(raw);

    const result = await withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const shift = await tx.treasuryShift.findUnique({ where: { id: input.shiftId } });
        if (!shift) throw new BusinessRuleError("الوردية غير موجودة.");
        if (shift.closedAt) throw new BusinessRuleError("هذه الوردية مغلقة بالفعل.");

        const treasuries = await lockTreasuriesForUpdate(tx, [shift.treasuryId]);
        const treasury = treasuries.get(shift.treasuryId)!;

        const counted = money(input.countedCash);
        const bookBalance = treasury.currentBalance;
        const variance = money(counted.sub(bookBalance));

        // Post the discrepancy so the books match the drawer.
        let postedTransactionNumber: string | null = null;
        let varianceTxId: string | null = null;
        if (!variance.isZero()) {
          const isOverage = variance.gt(0);
          const transaction = await tx.treasuryTransaction.create({
            data: {
              transactionNumber: await nextTransactionNumber(tx),
              treasuryId: treasury.id,
              type: isOverage ? "RECEIPT" : "PAYMENT",
              amount: variance.abs(),
              description:
                `تسوية فرق جرد وردية ${shift.shiftNumber}: ` +
                `${isOverage ? "زيادة" : "عجز"} ${formatMoney(variance.abs())} — ` +
                `الرصيد الدفتري ${formatMoney(bookBalance)}، المعدود ${formatMoney(counted)}`,
              createdByUser: user.id,
            },
          });
          postedTransactionNumber = transaction.transactionNumber;
          varianceTxId = transaction.id;

          await tx.treasury.update({
            where: { id: treasury.id },
            data: { currentBalance: counted },
          });
        }

        const closed = await tx.treasuryShift.update({
          where: { id: shift.id },
          data: {
            closedAt: new Date(),
            closingBalance: bookBalance,
            countedCash: counted,
            varianceAmount: variance,
            varianceTxId,
            notes: input.notes || shift.notes,
          },
        });

        await writeAudit(tx, {
          tableName: "TreasuryShift",
          recordId: shift.id,
          action: "UPDATE",
          oldData: shift,
          newData: { ...closed, postedTransactionNumber },
          performedBy: user.id,
        });

        return {
          shiftNumber: shift.shiftNumber,
          variance: Number(variance),
          systemBalance: Number(bookBalance),
          postedTransactionNumber,
        };
      }, TX_OPTIONS),
    );

    revalidatePath("/treasury");
    revalidatePath("/");
    return ok(result);
  } catch (error) {
    return toActionError(error, "closeShiftAction");
  }
}
