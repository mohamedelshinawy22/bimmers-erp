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
  masterCatalogCreateSchema,
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
      // Resolve a selected or newly typed brand inside the transaction so concurrent submissions cannot duplicate it.
      let brandId = input.brandId;
      if (!brandId && input.brandName) {
        const normalizedName = input.brandName.trim().toLocaleLowerCase("ar-EG");
        brandId = (await tx.brand.upsert({
          where: { normalizedName },
          update: {},
          create: { name: input.brandName.trim(), normalizedName },
          select: { id: true },
        })).id;
      }
      if (!brandId) throw new BusinessRuleError("يجب اختيار أو إضافة الماركة.");
      const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      if (!brand) throw new BusinessRuleError("الماركة المحددة غير موجودة.");

      let categoryId = input.categoryId;
      if (!categoryId && input.categoryName) {
        const normalizedName = input.categoryName.trim().toLocaleLowerCase("ar-EG");
        categoryId = (await tx.category.upsert({
          where: { normalizedName },
          update: {},
          create: { name: input.categoryName.trim(), normalizedName },
          select: { id: true },
        })).id;
      }

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

      const customChassisIds = await Promise.all(input.chassisCodes.map(async (code) => (await tx.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id));
      const customEngineIds = await Promise.all(input.engineCodes.map(async (code) => (await tx.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id));
      const allChassisIds = [...new Set([...input.chassisIds, ...customChassisIds])];
      const allEngineIds = [...new Set([...input.engineIds, ...customEngineIds])];
      const buyPrice = money(input.buyPriceLast);
      const created = await tx.partItem.create({
        data: {
          oemNumber: input.oemNumber,
          // Uses the shared formatter so the stored value always matches what the UI renders.
          partNumberFormatted: formatOemNumber(input.oemNumber),
          nameAr: input.nameAr,
          nameEn: input.nameEn || null,
          brandId,
          brandPartNumber: input.brandPartNumber || null,
          barcode: input.barcode || null,
          category: input.categoryName || input.category,
          categoryId,
          imageKey: input.imageKey || null,
          imageUrl: input.imageUrl || null,
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
            createMany: { data: allChassisIds.map((chassisId) => ({ chassisId })) },
          },
          compatibleEngines: {
            createMany: { data: allEngineIds.map((engineId) => ({ engineId })) },
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

      let brandId = input.brandId;
      if (!brandId && input.brandName) {
        const normalizedName = input.brandName.trim().toLocaleLowerCase("ar-EG");
        brandId = (await tx.brand.upsert({ where: { normalizedName }, update: {}, create: { name: input.brandName.trim(), normalizedName }, select: { id: true } })).id;
      }
      if (!brandId) throw new BusinessRuleError("يجب اختيار أو إضافة الماركة.");
      let categoryId = input.categoryId;
      if (!categoryId && input.categoryName) {
        const normalizedName = input.categoryName.trim().toLocaleLowerCase("ar-EG");
        categoryId = (await tx.category.upsert({ where: { normalizedName }, update: {}, create: { name: input.categoryName.trim(), normalizedName }, select: { id: true } })).id;
      }

      const updated = await tx.partItem.update({
        where: { id: input.id },
        data: {
          nameAr: input.nameAr,
          nameEn: input.nameEn || null,
          brandId,
          brandPartNumber: input.brandPartNumber || null,
          barcode: input.barcode || null,
          category: input.categoryName || input.category,
          categoryId,
          imageKey: input.imageKey || null,
          imageUrl: input.imageUrl || null,
          sidePosition: input.sidePosition || null,
          binLocationId: input.binLocationId ?? null,
          sellPriceRetail: money(input.sellPriceRetail),
          sellPriceWholesale: money(input.sellPriceWholesale),
          sellPriceMin: money(input.sellPriceMin),
          minReorderLevel: input.minReorderLevel,
          isActive: input.isActive,
        },
      });

      // Resolve newly typed codes before replacing the relation matrix.
      const customChassisIds = await Promise.all(input.chassisCodes.map(async (code) => (await tx.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id));
      const customEngineIds = await Promise.all(input.engineCodes.map(async (code) => (await tx.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id));
      const allChassisIds = [...new Set([...input.chassisIds, ...customChassisIds])];
      const allEngineIds = [...new Set([...input.engineIds, ...customEngineIds])];
      // Replace the fitment matrix wholesale — simpler and race-free within the tx.
      await tx.partChassis.deleteMany({ where: { partId: input.id } });
      if (allChassisIds.length) await tx.partChassis.createMany({ data: allChassisIds.map((chassisId) => ({ partId: input.id, chassisId })), skipDuplicates: true });
      await tx.partEngine.deleteMany({ where: { partId: input.id } });
      if (allEngineIds.length) await tx.partEngine.createMany({ data: allEngineIds.map((engineId) => ({ partId: input.id, engineId })), skipDuplicates: true });

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

export async function getMasterCatalogDataAction() {
  try {
    await requirePermission("part.read");
    const [brands, categories, chassis, engines] = await Promise.all([
      prisma.brand.findMany({ select: { id: true, name: true, isOem: true }, orderBy: { name: "asc" } }),
      prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.bmwChassis.findMany({ select: { id: true, code: true, series: true }, orderBy: { code: "asc" } }),
      prisma.bmwEngine.findMany({ select: { id: true, code: true, displacement: true, fuelType: true }, orderBy: { code: "asc" } }),
    ]);
    return ok({ brands, categories, chassis, engines });
  } catch (error) { return toActionError(error, "getMasterCatalogDataAction"); }
}

export async function createMasterCatalogEntryAction(kind: "brand" | "category" | "chassis" | "engine", raw: unknown) {
  try {
    const user = await requirePermission("part.write");
    const input = masterCatalogCreateSchema.parse(raw);
    const name = input.name.trim();
    const normalizedName = name.toLocaleLowerCase("ar-EG");
    const result = await prisma.$transaction(async (tx) => {
      if (kind === "brand") return tx.brand.upsert({ where: { normalizedName }, update: {}, create: { name, normalizedName, isOem: input.isOem ?? false } });
      if (kind === "category") return tx.category.upsert({ where: { normalizedName }, update: {}, create: { name, normalizedName } });
      if (kind === "chassis") {
        if (!input.series || !input.productionStartYear) throw new BusinessRuleError("يلزم إدخال الفئة وسنة بدء الإنتاج للشاسيه الجديد.");
        return tx.bmwChassis.upsert({ where: { code: name.toUpperCase() }, update: {}, create: { code: name.toUpperCase(), series: input.series, productionStartYear: input.productionStartYear } });
      }
      return tx.bmwEngine.upsert({ where: { code: name.toUpperCase() }, update: {}, create: { code: name.toUpperCase(), displacement: input.displacement || null, fuelType: input.fuelType || "PETROL" } });
    });
    await writeAudit(prisma, { tableName: `Master:${kind}`, recordId: result.id, action: "INSERT", newData: result, performedBy: user.id });
    revalidatePath("/inventory");
    return ok({ id: result.id, label: "name" in result ? result.name : result.code });
  } catch (error) { return toActionError(error, "createMasterCatalogEntryAction"); }
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

