"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError, ForbiddenError } from "@/lib/errors";
import { formatOemNumber, money } from "@/lib/utils";
import {
  adjustStockSchema,
  createBinSchema,
  createPartSchema,
  updatePartSchema,
  type AdjustStockInput,
  type CreateBinInput,
  type CreatePartInput,
  type UpdatePartInput,
} from "@/lib/validations/parts";
import { recordStockMovement } from "@/server/services/inventory.service";
import { adjustStock } from "@/server/services/stock.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";


export async function createPartAction(
  raw: CreatePartInput,
): Promise<ActionResult<{ id: string; oemNumber: string }>> {
  try {
    const user = await requirePermission("part.write");
    const input = createPartSchema.parse(raw);

    const part = await prisma.$transaction(async (tx) => {
      // Validate every FK up-front so we return a readable Arabic error instead
      // of a raw constraint violation.
      const brand = await tx.brand.findUnique({ where: { id: input.brandId }, select: { id: true } });
      if (!brand) throw new BusinessRuleError("الماركة المحددة غير موجودة.");

      if (input.binLocationId) {
        const bin = await tx.warehouseBin.findUnique({
          where: { id: input.binLocationId },
          select: { id: true },
        });
        if (!bin) throw new BusinessRuleError("موقع التخزين المحدد غير موجود.");
      }
      if (input.chassisIds.length) {
        const count = await tx.bmwChassis.count({ where: { id: { in: input.chassisIds } } });
        if (count !== input.chassisIds.length) throw new BusinessRuleError("أحد أكواد الشاسيه غير صالح.");
      }
      if (input.engineIds.length) {
        const count = await tx.bmwEngine.count({ where: { id: { in: input.engineIds } } });
        if (count !== input.engineIds.length) throw new BusinessRuleError("أحد أكواد المحرك غير صالح.");
      }

      const buyPrice = money(input.buyPriceLast);
      const created = await tx.partItem.create({
        data: {
          oemNumber: input.oemNumber,
          // Uses the shared formatter so the stored value always matches what the UI renders.
          partNumberFormatted: formatOemNumber(input.oemNumber),
          nameAr: input.nameAr,
          nameEn: input.nameEn || null,
          brandId: input.brandId,
          brandPartNumber: input.brandPartNumber || null,
          barcode: input.barcode || null,
          category: input.category,
          sidePosition: input.sidePosition || null,
          binLocationId: input.binLocationId,
          buyPriceLast: buyPrice,
          // Opening stock establishes the initial average cost.
          buyPriceAvg: input.openingQuantity > 0 ? buyPrice : money(0),
          sellPriceRetail: money(input.sellPriceRetail),
          sellPriceWholesale: money(input.sellPriceWholesale),
          sellPriceMin: money(input.sellPriceMin),
          stockQuantity: input.openingQuantity,
          minReorderLevel: input.minReorderLevel,
          isActive: input.isActive,
          compatibleChassis: {
            createMany: { data: input.chassisIds.map((chassisId) => ({ chassisId })) },
          },
          compatibleEngines: {
            createMany: { data: input.engineIds.map((engineId) => ({ engineId })) },
          },
        },
      });

      if (input.openingQuantity > 0) {
        await recordStockMovement(tx, {
          partId: created.id,
          reason: "OPENING_BALANCE",
          quantityDelta: input.openingQuantity,
          balanceAfter: input.openingQuantity,
          unitCost: buyPrice,
          performedById: user.id,
          note: "رصيد افتتاحي عند إنشاء الصنف",
        });
      }

      await writeAudit(tx, {
        tableName: "PartItem",
        recordId: created.id,
        action: "INSERT",
        newData: created,
        performedBy: user.id,
      });

      return created;
    }, TX_OPTIONS);

    revalidatePath("/inventory");
    revalidatePath("/pos");
    return ok({ id: part.id, oemNumber: part.oemNumber });
  } catch (error) {
    return toActionError(error, "createPartAction");
  }
}

export async function updatePartAction(raw: UpdatePartInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("part.write");
    const input = updatePartSchema.parse(raw);

    await prisma.$transaction(async (tx) => {
      const before = await tx.partItem.findUnique({
        where: { id: input.id },
        include: { compatibleChassis: true, compatibleEngines: true },
      });
      if (!before) throw new BusinessRuleError("الصنف غير موجود.");

      /**
       * Deactivation guard. This used to live in a separate action that no UI
       * ever called, while this reachable path flipped `isActive` with no check
       * at all — so a part could be retired while still holding stock, hiding
       * that inventory from the catalog and from valuation.
       *
       * Price invariants are enforced by `updatePartSchema`'s shared refinement.
       */
      if (before.isActive && !input.isActive) {
        if (!can(user.role, "part.deactivate")) {
          throw new ForbiddenError("إيقاف الأصناف يتطلب صلاحية مدير.");
        }
        if (before.stockQuantity > 0) {
          throw new BusinessRuleError(
            `لا يمكن إيقاف الصنف "${before.nameAr}" ورصيده ${before.stockQuantity}. صفّر الرصيد أولاً.`,
          );
        }
      }

      const updated = await tx.partItem.update({
        where: { id: input.id },
        data: {
          nameAr: input.nameAr,
          nameEn: input.nameEn || null,
          brandId: input.brandId,
          brandPartNumber: input.brandPartNumber || null,
          barcode: input.barcode || null,
          category: input.category,
          sidePosition: input.sidePosition || null,
          binLocationId: input.binLocationId ?? null,
          sellPriceRetail: money(input.sellPriceRetail),
          sellPriceWholesale: money(input.sellPriceWholesale),
          sellPriceMin: money(input.sellPriceMin),
          minReorderLevel: input.minReorderLevel,
          isActive: input.isActive,
        },
      });

      // Replace the fitment matrix wholesale — simpler and race-free within the tx.
      await tx.partChassis.deleteMany({ where: { partId: input.id } });
      if (input.chassisIds.length) {
        await tx.partChassis.createMany({
          data: input.chassisIds.map((chassisId) => ({ partId: input.id, chassisId })),
          skipDuplicates: true,
        });
      }
      await tx.partEngine.deleteMany({ where: { partId: input.id } });
      if (input.engineIds.length) {
        await tx.partEngine.createMany({
          data: input.engineIds.map((engineId) => ({ partId: input.id, engineId })),
          skipDuplicates: true,
        });
      }

      await writeAudit(tx, {
        tableName: "PartItem",
        recordId: input.id,
        action: "UPDATE",
        oldData: before,
        newData: updated,
        performedBy: user.id,
      });
    }, TX_OPTIONS);

    revalidatePath("/inventory");
    revalidatePath("/pos");
    return ok({ id: input.id });
  } catch (error) {
    return toActionError(error, "updatePartAction");
  }
}

export async function adjustStockAction(
  raw: AdjustStockInput,
): Promise<ActionResult<{ balanceAfter: number; averageCostAfter: number }>> {
  try {
    const user = await requirePermission("stock.adjust");
    const input = adjustStockSchema.parse(raw);
    const result = await adjustStock(input, user.id);

    revalidatePath("/inventory");
    revalidatePath("/");
    return ok({ balanceAfter: result.balanceAfter, averageCostAfter: result.averageCostAfter });
  } catch (error) {
    return toActionError(error, "adjustStockAction");
  }
}

export async function createBinAction(raw: CreateBinInput): Promise<ActionResult<{ id: string; fullCode: string }>> {
  try {
    const user = await requirePermission("part.write");
    const input = createBinSchema.parse(raw);
    const fullCode = `${input.aisle}-${input.rack}-${input.shelf}-${input.boxBin}`.toUpperCase();

    const bin = await prisma.$transaction(async (tx) => {
      const created = await tx.warehouseBin.create({
        data: { ...input, fullCode },
      });
      await writeAudit(tx, {
        tableName: "WarehouseBin",
        recordId: created.id,
        action: "INSERT",
        newData: created,
        performedBy: user.id,
      });
      return created;
    });

    revalidatePath("/inventory");
    revalidatePath("/settings");
    return ok({ id: bin.id, fullCode: bin.fullCode });
  } catch (error) {
    return toActionError(error, "createBinAction");
  }
}

