import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/errors";
import { money } from "@/lib/utils";
import type { AdjustStockInput } from "@/lib/validations/parts";
import { lockPartsForUpdate, recordStockMovement, weightedAverageCost } from "./inventory.service";
import { TX_OPTIONS, withTxRetry } from "./tx";

export interface AdjustStockResult {
  balanceAfter: number;
  unitCostApplied: number;
  averageCostAfter: number;
}

/**
 * Manual stock correction (adjustment / stocktake / opening balance).
 *
 * Takes the same `FOR UPDATE` row lock as an invoice, so a stocktake cannot race
 * a sale and produce a phantom balance.
 *
 * COSTING: a positive adjustment is an inbound movement and must carry a cost.
 * Previously it only wrote `stockQuantity`, so units brought in this way were
 * valued at whatever `buyPriceAvg` happened to be — zero for a part created
 * without opening stock. Those units then sold with `unitCostSnapshot = 0`,
 * understating inventory value and reporting ~100% gross margin.
 *
 * When no cost is supplied we fall back to the current average; if that is also
 * zero we refuse rather than silently booking free inventory.
 */
export async function adjustStock(
  input: AdjustStockInput,
  actorId: string,
): Promise<AdjustStockResult> {
  // Serialisation is provided by the pessimistic `SELECT … FOR UPDATE` row locks
  // taken inside the transaction (see lockPartsForUpdate). Those locks live in
  // PostgreSQL, so they already serialise across app instances; an application
  // level mutex in front of them added no safety and measurably destroyed
  // throughput under contention (1/10 units sold vs 10/10).
  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const parts = await lockPartsForUpdate(tx, [input.partId]);
      const part = parts.get(input.partId)!;
      const next = part.stockQuantity + input.quantityDelta;

      if (next < 0) {
        throw new BusinessRuleError(
          `التسوية مرفوضة: الرصيد سيصبح سالباً (${next}). الرصيد الحالي: ${part.stockQuantity}`,
        );
      }

      const isInbound = input.quantityDelta > 0;
      let unitCost = input.unitCost === undefined ? part.buyPriceAvg : money(input.unitCost);
      let averageCostAfter = part.buyPriceAvg;

      if (isInbound) {
        if (unitCost.lte(0)) {
          throw new BusinessRuleError(
            "يجب تحديد تكلفة الوحدة لهذه الإضافة، فلا يوجد متوسط تكلفة مسجّل للصنف.",
          );
        }
        averageCostAfter = weightedAverageCost(
          part.stockQuantity,
          part.buyPriceAvg,
          input.quantityDelta,
          unitCost,
        );
      } else {
        // Outbound: value the write-off at the existing average, never change it.
        unitCost = part.buyPriceAvg;
      }

      await tx.partItem.update({
        where: { id: input.partId },
        data: {
          stockQuantity: next,
          ...(isInbound
            ? { buyPriceAvg: averageCostAfter, buyPriceLast: unitCost }
            : {}),
        },
      });

      await recordStockMovement(tx, {
        partId: input.partId,
        reason: input.reason,
        quantityDelta: input.quantityDelta,
        balanceAfter: next,
        unitCost,
        performedById: actorId,
        note: input.note,
      });

      await writeAudit(tx, {
        tableName: "PartItem",
        recordId: input.partId,
        action: "UPDATE",
        oldData: { stockQuantity: part.stockQuantity, buyPriceAvg: part.buyPriceAvg },
        newData: {
          stockQuantity: next,
          buyPriceAvg: averageCostAfter,
          reason: input.reason,
          note: input.note,
        },
        performedBy: actorId,
      });

      return {
        balanceAfter: next,
        unitCostApplied: Number(unitCost),
        averageCostAfter: Number(averageCostAfter),
      } satisfies AdjustStockResult;
    }, TX_OPTIONS),
  );
}

/**
 * Reverses a purchase receipt's effect on the weighted average.
 *
 * Voiding a purchase used to remove the units but leave that purchase's cost
 * baked into `buyPriceAvg` forever, so inventory valuation drifted a little
 * further with every voided goods receipt.
 *
 *   avgBefore = (qtyAfterVoid * avgAfter − voidedQty * voidedCost) / qtyAfterVoid
 *
 * Clamped at zero, and when the void empties the part we keep the last known
 * average rather than dividing by zero.
 */
export function reverseAverageCost(
  quantityAfterVoid: number,
  averageAfter: Prisma.Decimal,
  voidedQuantity: number,
  voidedUnitCost: Prisma.Decimal,
): Prisma.Decimal {
  if (quantityAfterVoid <= 0) return money(averageAfter);
  const totalBefore = averageAfter.mul(quantityAfterVoid + voidedQuantity);
  const remaining = totalBefore.sub(voidedUnitCost.mul(voidedQuantity));
  if (remaining.lte(0)) return money(averageAfter);
  return money(remaining.div(quantityAfterVoid));
}
