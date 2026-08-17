import "server-only";
import { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

import { formatMoney, money, ZERO } from "@/lib/utils";
import type { CreateSaleInvoiceInput, CreatePurchaseInvoiceInput, VoidInvoiceInput } from "@/lib/validations/invoice";
import { nextInvoiceNumber, nextTransactionNumber } from "./numbering.service";
import {
  applyStockDeltas,
  assertAccountTypeFor,
  lockAccountForUpdate,
  lockPartsForUpdate,
  lockTreasuriesForUpdate,
  recordStockMovement,
  weightedAverageCost,
} from "./inventory.service";
import { getSetting } from "./settings.service";
import { reverseAverageCost } from "./stock.service";
import { TX_OPTIONS, withTxRetry } from "./tx";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ACID INVOICE ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately decoupled from the request/session layer: the server actions do
 * authentication and RBAC, then hand a resolved `InvoiceActor` to these
 * functions. That keeps the transactional core exercisable by the concurrency
 * test suite (scripts/verify-db.ts) instead of only through a live browser.
 *
 * GLOBAL LOCK ORDER (must be identical in every transaction, or PostgreSQL
 * will report deadlocks under load):
 *      1. PartItem  (sorted by id)
 *      2. Account
 *      3. Treasury  (sorted by id)
 */

export interface InvoiceActor {
  id: string;
  /** Manager-level override allowing a sale below PartItem.sellPriceMin. */
  canSellBelowMin: boolean;
  /** Manager-level override allowing a discount above the configured cap. */
  canOverrideDiscount: boolean;
}

export interface InvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  changeDue: number;
}

/** Clamps an operator-editable percentage setting into a sane range. */
function safeRate(raw: string, fallback: number): Prisma.Decimal {
  const n = Number(raw);
  const value = Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
  return new Prisma.Decimal(value);
}

/**
 * Recomputes the money side of an invoice from the line items and server-held
 * settings. NEVER trust client-sent totals: server actions are public HTTP
 * endpoints, so a caller could otherwise post `taxAmount: 0` on a taxable sale,
 * an arbitrarily inflated tax, or a 100% discount.
 */
function computeTotals(args: {
  subtotal: Prisma.Decimal;
  requestedDiscount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  requestedPaid: Prisma.Decimal;
  payFull: boolean;
}) {
  const discountAmount = money(Prisma.Decimal.min(args.requestedDiscount, args.subtotal));
  const taxable = money(args.subtotal.sub(discountAmount));
  const taxAmount = money(taxable.mul(args.taxRate).div(100));
  const grandTotal = money(taxable.add(taxAmount));

  // `payFull` removes the class of bug where a client-side rounding difference
  // of one piastre left a phantom receivable and flipped the invoice to PARTIAL.
  const requestedPaid = args.payFull ? grandTotal : money(args.requestedPaid);
  const paidAmount = Prisma.Decimal.min(requestedPaid, grandTotal);
  const changeDue = money(requestedPaid.sub(paidAmount));
  const remainingAmount = money(grandTotal.sub(paidAmount));

  return { discountAmount, taxAmount, grandTotal, paidAmount, changeDue, remainingAmount };
}




/* ═══════════════════════════════════════════════════════════════════════════
   SALE
   ═══════════════════════════════════════════════════════════════════════════ */
export async function createSaleInvoice(
  input: CreateSaleInvoiceInput,
  actor: InvoiceActor,
): Promise<InvoiceResult> {
  const [enforceMinPriceRaw, enforceCreditLimitRaw, allowNegativeStockRaw, taxRateRaw, maxDiscountRaw] =
    await Promise.all([
      getSetting("ENFORCE_MIN_SELL_PRICE", "true"),
      getSetting("ENFORCE_CREDIT_LIMIT", "true"),
      getSetting("ALLOW_NEGATIVE_STOCK", "false"),
      getSetting("TAX_RATE_PERCENT", "0"),
      getSetting("MAX_INVOICE_DISCOUNT_PERCENT", "100"),
    ]);
  const enforceMinPrice = enforceMinPriceRaw === "true";
  const enforceCreditLimit = enforceCreditLimitRaw === "true";
  const allowNegativeStock = allowNegativeStockRaw === "true";
  const taxRate = safeRate(taxRateRaw, 0);
  const maxDiscountPercent = safeRate(maxDiscountRaw, 100);

  const belowMinAllowed = input.allowBelowMinPrice && actor.canSellBelowMin;
  const partIds = [...new Set(input.items.map((i) => i.partId))];

  // Serialisation is provided by the pessimistic `SELECT … FOR UPDATE` row locks
  // taken inside the transaction (see lockPartsForUpdate). Those locks live in
  // PostgreSQL, so they already serialise across app instances; an application
  // level mutex in front of them added no safety and measurably destroyed
  // throughput under contention (1/10 units sold vs 10/10).
  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const parts = await lockPartsForUpdate(tx, partIds);
      const account = await lockAccountForUpdate(tx, input.accountId);
      assertAccountTypeFor("SALE", account);

      // Aggregate per part so the availability check matches the whole
      // invoice, not just one line at a time.
      const requestedByPart = new Map<string, number>();
      for (const item of input.items) {
        requestedByPart.set(item.partId, (requestedByPart.get(item.partId) ?? 0) + item.quantity);
      }

      let subtotal = ZERO;
      const runningStock = new Map<string, number>();
      const lines: Array<{
        partId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        unitCostSnapshot: Prisma.Decimal;
        totalPrice: Prisma.Decimal;
        binLocationSnapshot: string | null;
        balanceAfter: number;
      }> = [];

      for (const item of input.items) {
        const part = parts.get(item.partId);
        if (!part) throw new BusinessRuleError(`الصنف غير موجود: ${item.partId}`);
        if (!part.isActive) {
          throw new BusinessRuleError(`الصنف "${part.nameAr}" موقوف ولا يمكن بيعه.`);
        }

        const totalRequested = requestedByPart.get(item.partId) ?? 0;
        const available = part.stockQuantity - part.stockReserved;
        if (!allowNegativeStock && available < totalRequested) {
          throw new BusinessRuleError(
            `الرصيد غير كافٍ للصنف "${part.nameAr}" (${part.oemNumber}). ` +
              `المتاح: ${available}، المطلوب: ${totalRequested}`,
          );
        }

        const unitPrice = money(item.unitPrice);
        if (enforceMinPrice && !belowMinAllowed && unitPrice.lt(part.sellPriceMin)) {
          throw new BusinessRuleError(
            `سعر البيع (${formatMoney(unitPrice)}) للصنف "${part.nameAr}" ` +
              `أقل من الحد الأدنى المسموح (${formatMoney(part.sellPriceMin)}). يلزم اعتماد المدير.`,
          );
        }

        const lineTotal = money(unitPrice.mul(item.quantity).sub(money(item.lineDiscount)));
        subtotal = subtotal.add(lineTotal);

        const prior = runningStock.get(item.partId) ?? part.stockQuantity;
        const balanceAfter = prior - item.quantity;
        runningStock.set(item.partId, balanceAfter);

        lines.push({
          partId: item.partId,
          quantity: item.quantity,
          unitPrice,
          unitCostSnapshot: part.buyPriceAvg,
          totalPrice: lineTotal,
          binLocationSnapshot: part.binFullCode,
          balanceAfter,
        });
      }

      // ── Server-authoritative money ────────────────────────────────────
      // Tax comes from TAX_RATE_PERCENT, never from the request; the
      // discount is capped by MAX_INVOICE_DISCOUNT_PERCENT unless a manager
      // explicitly authorises an override.
      const requestedDiscount = money(input.discountAmount);
      const discountCap = money(subtotal.mul(maxDiscountPercent).div(100));
      if (requestedDiscount.gt(discountCap) && !actor.canOverrideDiscount) {
        throw new BusinessRuleError(
          `الخصم (${formatMoney(requestedDiscount)}) يتجاوز الحد المسموح ` +
            `(${maxDiscountPercent.toString()}% = ${formatMoney(discountCap)}). يلزم اعتماد المدير.`,
        );
      }
      if (requestedDiscount.gt(subtotal)) {
        throw new BusinessRuleError("الخصم أكبر من إجمالي الأصناف.");
      }

      const totals = computeTotals({
        subtotal,
        requestedDiscount,
        taxRate,
        requestedPaid: money(input.paidAmount),
        payFull: input.payFull === true && input.paymentMethod !== "ON_ACCOUNT",
      });
      const { discountAmount, taxAmount, grandTotal, paidAmount, changeDue, remainingAmount } = totals;

      if (input.paymentMethod === "ON_ACCOUNT" && paidAmount.gt(0)) {
        throw new BusinessRuleError("لا يمكن تحصيل مبلغ نقدي في فاتورة على الحساب.");
      }

      const paymentStatus = remainingAmount.lte(0) ? "PAID" : paidAmount.gt(0) ? "PARTIAL" : "CREDIT";

      // ── Credit limit gate ──────────────────────────────────────────────
      if (remainingAmount.gt(0) && enforceCreditLimit) {
        const balanceAfter = account.currentBalance.sub(remainingAmount);
        if (balanceAfter.lt(0)) {
          if (account.creditLimit.eq(0)) {
            throw new BusinessRuleError(
              `الحساب "${account.name}" غير مسموح له بالبيع الآجل (حد الائتمان = صفر).`,
            );
          }
          const debtAfter = balanceAfter.abs();
          if (debtAfter.gt(account.creditLimit)) {
            throw new BusinessRuleError(
              `تجاوز حد الائتمان للحساب "${account.name}". ` +
                `الحد: ${formatMoney(account.creditLimit)}، ` +
                `المديونية بعد الفاتورة: ${formatMoney(debtAfter)}`,
            );
          }
        }
      }

      if (input.vehicleId) {
        const vehicle = await tx.customerVehicle.findUnique({
          where: { id: input.vehicleId },
          select: { accountId: true },
        });
        if (!vehicle || vehicle.accountId !== input.accountId) {
          throw new BusinessRuleError("السيارة المحددة لا تنتمي لهذا الحساب.");
        }
      }

      if (paidAmount.gt(0)) {
        if (!input.treasuryId) throw new BusinessRuleError("يجب تحديد الخزينة لتحصيل المبلغ.");
        await lockTreasuriesForUpdate(tx, [input.treasuryId]);
      }

      const invoiceNumber = await nextInvoiceNumber(tx, "SALE");
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: "SALE",
          accountId: input.accountId,
          treasuryId: paidAmount.gt(0) ? input.treasuryId : null,
          vehicleId: input.vehicleId,
          userId: actor.id,
          subtotal,
          discountAmount,
          taxAmount,
          grandTotal,
          paidAmount,
          remainingAmount,
          paymentStatus,
          paymentMethod: input.paymentMethod,
          notes: input.notes || null,
        },
      });

      await tx.invoiceItem.createMany({
        data: lines.map((l) => ({
          invoiceId: invoice.id,
          partId: l.partId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCostSnapshot: l.unitCostSnapshot,
          totalPrice: l.totalPrice,
          binLocationSnapshot: l.binLocationSnapshot,
        })),
      });

      await applyStockDeltas(
        tx,
        lines.map((line) => ({
          partId: line.partId,
          invoiceId: invoice.id,
          reason: "SALE" as const,
          quantityDelta: -line.quantity,
          balanceAfter: line.balanceAfter,
          unitCost: line.unitCostSnapshot,
          note: `بيع - فاتورة ${invoiceNumber}`,
        })),
        actor.id,
      );

      if (paidAmount.gt(0) && input.treasuryId) {
        await tx.treasury.update({
          where: { id: input.treasuryId },
          data: { currentBalance: { increment: paidAmount } },
        });
        await tx.treasuryTransaction.create({
          data: {
            transactionNumber: await nextTransactionNumber(tx),
            treasuryId: input.treasuryId,
            accountId: input.accountId,
            invoiceId: invoice.id,
            type: "RECEIPT",
            amount: paidAmount,
            description: `تحصيل فاتورة بيع رقم ${invoiceNumber}`,
            createdByUser: actor.id,
          },
        });
      }

      // Negative account balance = owed to us.
      if (remainingAmount.gt(0)) {
        await tx.account.update({
          where: { id: input.accountId },
          data: { currentBalance: { decrement: remainingAmount } },
        });
      }

      await writeAudit(tx, {
        tableName: "Invoice",
        recordId: invoice.id,
        action: "INSERT",
        newData: { ...invoice, itemCount: lines.length },
        performedBy: actor.id,
      });

      return {
        invoiceId: invoice.id,
        invoiceNumber,
        subtotal: Number(subtotal),
        discountAmount: Number(discountAmount),
        taxAmount: Number(taxAmount),
        grandTotal: Number(grandTotal),
        paidAmount: Number(paidAmount),
        remainingAmount: Number(remainingAmount),
        changeDue: Number(changeDue),
      } satisfies InvoiceResult;
    }, TX_OPTIONS),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PURCHASE — stock receipt + weighted-average cost recalculation
   ═══════════════════════════════════════════════════════════════════════════ */
export async function createPurchaseInvoice(
  input: CreatePurchaseInvoiceInput,
  actor: InvoiceActor,
): Promise<InvoiceResult> {
  const taxRate = safeRate(await getSetting("TAX_RATE_PERCENT", "0"), 0);
  const partIds = [...new Set(input.items.map((i) => i.partId))];

  // Serialisation is provided by the pessimistic `SELECT … FOR UPDATE` row locks
  // taken inside the transaction (see lockPartsForUpdate). Those locks live in
  // PostgreSQL, so they already serialise across app instances; an application
  // level mutex in front of them added no safety and measurably destroyed
  // throughput under contention (1/10 units sold vs 10/10).
  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const parts = await lockPartsForUpdate(tx, partIds);
      const supplier = await lockAccountForUpdate(tx, input.accountId);
      assertAccountTypeFor("PURCHASE", supplier);

      let subtotal = ZERO;
      for (const item of input.items) {
        subtotal = subtotal.add(
          money(money(item.unitPrice).mul(item.quantity).sub(money(item.lineDiscount))),
        );
      }

      // Header-level discount reduces the real acquisition cost, so it has
      // to be allocated across the lines before the weighted average is
      // recomputed — otherwise inventory is valued above what we paid.
      const requestedDiscount = money(input.discountAmount);
      if (requestedDiscount.gt(subtotal)) {
        throw new BusinessRuleError("الخصم أكبر من إجمالي أصناف فاتورة الشراء.");
      }
      const netFactor = subtotal.gt(0)
        ? subtotal.sub(requestedDiscount).div(subtotal)
        : new Prisma.Decimal(1);

      const runningStock = new Map<string, number>();
      const runningAvg = new Map<string, Prisma.Decimal>();

      const lines = input.items.map((item) => {
        const part = parts.get(item.partId)!;
        const grossUnit = money(item.unitPrice);
        const lineTotal = money(grossUnit.mul(item.quantity).sub(money(item.lineDiscount)));

        // Net unit cost: line discount already removed, header discount
        // allocated pro-rata. This — not the gross list price — is what the
        // part actually cost us.
        const netUnitCost = money(lineTotal.mul(netFactor).div(item.quantity));

        const priorQty = runningStock.get(item.partId) ?? part.stockQuantity;
        const priorAvg = runningAvg.get(item.partId) ?? part.buyPriceAvg;
        const newAvg = weightedAverageCost(priorQty, priorAvg, item.quantity, netUnitCost);
        const balanceAfter = priorQty + item.quantity;

        runningStock.set(item.partId, balanceAfter);
        runningAvg.set(item.partId, newAvg);

        return {
          partId: item.partId,
          quantity: item.quantity,
          unitPrice: grossUnit,
          netUnitCost,
          totalPrice: lineTotal,
          balanceAfter,
          newAvg,
        };
      });

      const totals = computeTotals({
        subtotal,
        requestedDiscount,
        taxRate,
        requestedPaid: money(input.paidAmount),
        payFull: input.payFull === true && input.paymentMethod !== "ON_ACCOUNT",
      });
      const { discountAmount, taxAmount, grandTotal, paidAmount, remainingAmount } = totals;
      const paymentStatus = remainingAmount.lte(0) ? "PAID" : paidAmount.gt(0) ? "PARTIAL" : "CREDIT";

      if (paidAmount.gt(0)) {
        if (!input.treasuryId) throw new BusinessRuleError("يجب تحديد الخزينة لصرف المبلغ.");
        const treasuries = await lockTreasuriesForUpdate(tx, [input.treasuryId]);
        const treasury = treasuries.get(input.treasuryId)!;
        if (treasury.currentBalance.lt(paidAmount)) {
          throw new BusinessRuleError(
            `السيولة غير كافية في "${treasury.name}". ` +
              `الرصيد: ${formatMoney(treasury.currentBalance)}، المطلوب: ${formatMoney(paidAmount)}`,
          );
        }
      }

      const invoiceNumber = await nextInvoiceNumber(tx, "PURCHASE");
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: "PURCHASE",
          accountId: input.accountId,
          treasuryId: paidAmount.gt(0) ? input.treasuryId : null,
          userId: actor.id,
          subtotal,
          discountAmount,
          taxAmount,
          grandTotal,
          paidAmount,
          remainingAmount,
          paymentStatus,
          paymentMethod: input.paymentMethod,
          notes: input.notes || null,
        },
      });

      await tx.invoiceItem.createMany({
        data: lines.map((l) => ({
          invoiceId: invoice.id,
          partId: l.partId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCostSnapshot: l.netUnitCost,
          totalPrice: l.totalPrice,
        })),
      });

      await applyStockDeltas(
        tx,
        lines.map((line) => ({
          partId: line.partId,
          invoiceId: invoice.id,
          reason: "PURCHASE" as const,
          quantityDelta: line.quantity,
          balanceAfter: line.balanceAfter,
          unitCost: line.netUnitCost,
          note: `استلام شحنة - فاتورة ${invoiceNumber}`,
        })),
        actor.id,
      );

      // Cost fields differ per part, so they are set from the final running
      // average rather than folded into the batched quantity statement.
      for (const [partId, newAvg] of runningAvg) {
        const last = lines.filter((l) => l.partId === partId).at(-1)!;
        await tx.partItem.update({
          where: { id: partId },
          data: { buyPriceLast: last.netUnitCost, buyPriceAvg: newAvg },
        });
      }

      if (paidAmount.gt(0) && input.treasuryId) {
        await tx.treasury.update({
          where: { id: input.treasuryId },
          data: { currentBalance: { decrement: paidAmount } },
        });
        await tx.treasuryTransaction.create({
          data: {
            transactionNumber: await nextTransactionNumber(tx),
            treasuryId: input.treasuryId,
            accountId: input.accountId,
            invoiceId: invoice.id,
            type: "PAYMENT",
            amount: paidAmount,
            description: `سداد فاتورة شراء رقم ${invoiceNumber} - ${supplier.name}`,
            createdByUser: actor.id,
          },
        });
      }

      // Unpaid purchase = we owe the supplier → positive balance (له).
      if (remainingAmount.gt(0)) {
        await tx.account.update({
          where: { id: input.accountId },
          data: { currentBalance: { increment: remainingAmount } },
        });
      }

      await writeAudit(tx, {
        tableName: "Invoice",
        recordId: invoice.id,
        action: "INSERT",
        newData: { ...invoice, itemCount: lines.length },
        performedBy: actor.id,
      });

      return {
        invoiceId: invoice.id,
        invoiceNumber,
        subtotal: Number(subtotal),
        discountAmount: Number(discountAmount),
        taxAmount: Number(taxAmount),
        grandTotal: Number(grandTotal),
        paidAmount: Number(paidAmount),
        remainingAmount: Number(remainingAmount),
        changeDue: 0,
      } satisfies InvoiceResult;
    }, TX_OPTIONS),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VOID — reversing entries, never a hard delete (zero data loss)
   ═══════════════════════════════════════════════════════════════════════════ */
export async function voidInvoice(input: VoidInvoiceInput, actor: InvoiceActor): Promise<{ invoiceNumber: string }> {
  const target = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, items: { select: { partId: true } } },
  });
  if (!target) throw new BusinessRuleError("الفاتورة غير موجودة.");

  const partIds = [...new Set(target.items.map((i) => i.partId))];

  // Serialisation is provided by the pessimistic `SELECT … FOR UPDATE` row locks
  // taken inside the transaction (see lockPartsForUpdate). Those locks live in
  // PostgreSQL, so they already serialise across app instances; an application
  // level mutex in front of them added no safety and measurably destroyed
  // throughput under contention (1/10 units sold vs 10/10).
  const invoiceNumber = await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        include: { items: true },
      });
      if (!invoice) throw new BusinessRuleError("الفاتورة غير موجودة.");
      if (invoice.isVoided) throw new BusinessRuleError("هذه الفاتورة ملغاة بالفعل.");
      if (invoice.type === "PRICE_QUOTATION") {
        throw new BusinessRuleError("عرض السعر لا يحتاج إلى إلغاء محاسبي.");
      }

      const parts = await lockPartsForUpdate(tx, partIds);
      await lockAccountForUpdate(tx, invoice.accountId);

      const isOutbound = invoice.type === "SALE" || invoice.type === "PURCHASE_RETURN";
      // Voiding an inbound receipt must also back its cost out of the
      // weighted average, otherwise the voided purchase's price stays baked
      // into inventory valuation permanently.
      const reversesCost = invoice.type === "PURCHASE";
      const runningStock = new Map<string, number>();
      const runningAvg = new Map<string, Prisma.Decimal>();

      for (const item of invoice.items) {
        const part = parts.get(item.partId)!;
        const prior = runningStock.get(item.partId) ?? part.stockQuantity;
        const delta = isOutbound ? item.quantity : -item.quantity;
        const balanceAfter = prior + delta;

        if (balanceAfter < 0) {
          throw new BusinessRuleError(
            `لا يمكن إلغاء الفاتورة: الصنف "${part.nameAr}" سيصبح رصيده سالباً (${balanceAfter}).`,
          );
        }
        runningStock.set(item.partId, balanceAfter);

        let averageUpdate: { buyPriceAvg: Prisma.Decimal } | undefined;
        if (reversesCost) {
          const priorAvg = runningAvg.get(item.partId) ?? part.buyPriceAvg;
          const restored = reverseAverageCost(
            balanceAfter,
            priorAvg,
            item.quantity,
            item.unitCostSnapshot,
          );
          runningAvg.set(item.partId, restored);
          averageUpdate = { buyPriceAvg: restored };
        }

        await tx.partItem.update({
          where: { id: item.partId },
          data: { stockQuantity: { increment: delta }, ...averageUpdate },
        });
        await recordStockMovement(tx, {
          partId: item.partId,
          invoiceId: invoice.id,
          reason: isOutbound ? "SALE_RETURN" : "PURCHASE_RETURN",
          quantityDelta: delta,
          balanceAfter,
          unitCost: item.unitCostSnapshot,
          performedById: actor.id,
          note: `إلغاء فاتورة ${invoice.invoiceNumber}: ${input.reason}`,
        });
      }

      if (invoice.paidAmount.gt(0) && invoice.treasuryId) {
        const treasuries = await lockTreasuriesForUpdate(tx, [invoice.treasuryId]);
        const treasury = treasuries.get(invoice.treasuryId)!;
        const reversalType = isOutbound ? "PAYMENT" : "RECEIPT";

        if (reversalType === "PAYMENT" && treasury.currentBalance.lt(invoice.paidAmount)) {
          throw new BusinessRuleError(
            `السيولة غير كافية في "${treasury.name}" لرد مبلغ الفاتورة (${formatMoney(invoice.paidAmount)}).`,
          );
        }

        await tx.treasury.update({
          where: { id: invoice.treasuryId },
          data: isOutbound
            ? { currentBalance: { decrement: invoice.paidAmount } }
            : { currentBalance: { increment: invoice.paidAmount } },
        });
        await tx.treasuryTransaction.create({
          data: {
            transactionNumber: await nextTransactionNumber(tx),
            treasuryId: invoice.treasuryId,
            accountId: invoice.accountId,
            invoiceId: invoice.id,
            type: reversalType,
            amount: invoice.paidAmount,
            description: `عكس قيد إلغاء الفاتورة ${invoice.invoiceNumber}`,
            createdByUser: actor.id,
          },
        });
      }

      if (invoice.remainingAmount.gt(0)) {
        await tx.account.update({
          where: { id: invoice.accountId },
          data: isOutbound
            ? { currentBalance: { increment: invoice.remainingAmount } }
            : { currentBalance: { decrement: invoice.remainingAmount } },
        });
      }

      const voided = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          isVoided: true,
          voidedAt: new Date(),
          voidReason: input.reason,
          paymentStatus: "PAID",
          remainingAmount: ZERO,
        },
      });

      await writeAudit(tx, {
        tableName: "Invoice",
        recordId: invoice.id,
        action: "VOID",
        oldData: invoice,
        newData: voided,
        performedBy: actor.id,
      });

      return invoice.invoiceNumber;
    }, TX_OPTIONS),
  );

  return { invoiceNumber };
}
