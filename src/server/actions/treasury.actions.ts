"use server";

import { Prisma } from "@prisma/client";
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
} from "@/lib/validations/invoice";
import { nextShiftNumber, nextTransactionNumber } from "@/server/services/numbering.service";
import { lockAccountForUpdate, lockTreasuriesForUpdate } from "@/server/services/inventory.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";





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
        // Account first, treasury second — see GLOBAL LOCK ORDER above.
        if (input.accountId) await lockAccountForUpdate(tx, input.accountId);

        const treasuries = await lockTreasuriesForUpdate(tx, [input.treasuryId]);
        const treasury = treasuries.get(input.treasuryId)!;

        if (input.type === "PAYMENT" && treasury.currentBalance.lt(amount)) {
          throw new BusinessRuleError(
            `السيولة غير كافية في "${treasury.name}". الرصيد الحالي: ${formatMoney(treasury.currentBalance)}`,
          );
        }

        const updatedTreasury = await tx.treasury.update({
          where: { id: input.treasuryId },
          data:
            input.type === "RECEIPT"
              ? { currentBalance: { increment: amount } }
              : { currentBalance: { decrement: amount } },
          select: { currentBalance: true },
        });

        // Ledger sign convention: positive balance = we owe them (له),
        // negative = they owe us (عليه).
        if (input.accountId) {
          await tx.account.update({
            where: { id: input.accountId },
            data:
              input.type === "RECEIPT"
                ? { currentBalance: { increment: amount } }
                : { currentBalance: { decrement: amount } },
          });
        }

        const transaction = await tx.treasuryTransaction.create({
          data: {
            transactionNumber: await nextTransactionNumber(tx),
            treasuryId: input.treasuryId,
            accountId: input.accountId,
            type: input.type,
            amount,
            description: input.description,
            createdByUser: user.id,
          },
        });

        await writeAudit(tx, {
          tableName: "TreasuryTransaction",
          recordId: transaction.id,
          action: "INSERT",
          newData: transaction,
          performedBy: user.id,
        });

        return {
          transactionNumber: transaction.transactionNumber,
          treasuryBalance: Number(updatedTreasury.currentBalance),
        };
      }, TX_OPTIONS),
    );

    await invalidateCache("dashboard");
    revalidatePath("/");
    revalidatePath("/treasury");
    revalidatePath("/accounts");
    return ok(result);
  } catch (error) {
    return toActionError(error, "createTreasuryTransactionAction");
  }
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

        await tx.treasuryTransaction.createMany({
          data: [
            {
              transactionNumber: outNumber,
              treasuryId: from.id,
              type: "TRANSFER",
              amount: amount.neg(),
              description: `تحويل صادر إلى "${to.name}" — ${input.description}`,
              createdByUser: user.id,
            },
            {
              transactionNumber: inNumber,
              treasuryId: to.id,
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
          newData: { transferred: amount, fromId: from.id, toId: to.id },
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
