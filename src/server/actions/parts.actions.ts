"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
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
  searchPartsSchema,
  type AdjustStockInput,
  type CreateBinInput,
  type CreatePartInput,
  type UpdatePartInput,
} from "@/lib/validations/parts";
import { recordStockMovement } from "@/server/services/inventory.service";
import { adjustStock } from "@/server/services/stock.service";
import { searchParts } from "@/server/services/parts.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { ensureCatalogCompositeIdentity } from "@/server/services/catalog-identity.service";
import { hasSameCatalogIdentity } from "@/lib/catalog-identity";

function normalizeOptionalPartReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized !== "-" && normalized !== "—" ? normalized : undefined;
}

function normalizePartNumber(value: unknown, fallback = 0): number {
  const numeric = Number(typeof value === "string" ? value.replace(/[\s,]/g, "") : value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

// Product creation may initialise brand/category/fitment references and an opening
// stock ledger row. It gets a bounded one-off budget without multiplying a timed
// out request through retries that would exceed the serverless action lifetime.
const PRODUCT_CREATE_TX_OPTIONS = { ...TX_OPTIONS, maxWait: 1_000, timeout: 8_000 } as const;


export async function createPartAction(
  raw: CreatePartInput,
): Promise<ActionResult<{ id: string; oemNumber: string }>> {
  try {
    const user = await requirePermission("part.write");
    const tenant = await getTenantDbFromSession();
    await tenant.run(() => ensureCatalogCompositeIdentity(tenant.prisma));
    const input = createPartSchema.parse({
      ...raw,
      binLocationId: normalizeOptionalPartReference(raw.binLocationId),
      buyPriceLast: normalizePartNumber(raw.buyPriceLast),
      sellPriceRetail: normalizePartNumber(raw.sellPriceRetail),
      sellPriceWholesale: normalizePartNumber(raw.sellPriceWholesale),
      sellPriceMin: normalizePartNumber(raw.sellPriceMin),
      openingQuantity: Math.trunc(normalizePartNumber(raw.openingQuantity)),
      minReorderLevel: Math.trunc(normalizePartNumber(raw.minReorderLevel, 2)),
    });

    const masters = await tenant.run(async () => {
      let brandId = input.brandId;
      if (!brandId && input.brandName) {
        const normalizedName = input.brandName.trim().toLocaleLowerCase("ar-EG");
        brandId = (await tenant.prisma.brand.upsert({ where: { normalizedName }, update: {}, create: { name: input.brandName.trim(), normalizedName }, select: { id: true } })).id;
      }
      if (!brandId) throw new BusinessRuleError("يجب اختيار أو إضافة الماركة.");
      const categoryLabel = input.categoryName?.trim() || input.category.trim() || "عام";
      const category = input.categoryId
        ? await tenant.prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true, name: true } })
        : await tenant.prisma.category.upsert({ where: { normalizedName: categoryLabel.toLocaleLowerCase("ar-EG") }, update: {}, create: { name: categoryLabel, normalizedName: categoryLabel.toLocaleLowerCase("ar-EG") }, select: { id: true, name: true } });
      if (!category) throw new BusinessRuleError("التصنيف المحدد غير موجود.");
      const [brand, bin, chassisCount, engineCount, customChassisIds, customEngineIds] = await Promise.all([
        tenant.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }),
        input.binLocationId ? tenant.prisma.warehouseBin.findUnique({ where: { id: input.binLocationId }, select: { id: true } }) : Promise.resolve(null),
        input.chassisIds.length ? tenant.prisma.bmwChassis.count({ where: { id: { in: input.chassisIds } } }) : Promise.resolve(0),
        input.engineIds.length ? tenant.prisma.bmwEngine.count({ where: { id: { in: input.engineIds } } }) : Promise.resolve(0),
        Promise.all([...new Set(input.chassisCodes)].map(async (code) => (await tenant.prisma.bmwChassis.upsert({ where: { code }, update: {}, create: { code, series: "غير محدد", productionStartYear: 0 }, select: { id: true } })).id)),
        Promise.all([...new Set(input.engineCodes)].map(async (code) => (await tenant.prisma.bmwEngine.upsert({ where: { code }, update: {}, create: { code }, select: { id: true } })).id)),
      ]);
      if (!brand) throw new BusinessRuleError("الماركة المحددة غير موجودة.");
      if (input.binLocationId && !bin) throw new BusinessRuleError("موقع التخزين المحدد غير موجود.");
      if (input.chassisIds.length && chassisCount !== input.chassisIds.length) throw new BusinessRuleError("أحد أكواد الشاسيه غير صالح.");
      if (input.engineIds.length && engineCount !== input.engineIds.length) throw new BusinessRuleError("أحد أكواد المحرك غير صالح.");
      return { brandId, category, allChassisIds: [...new Set([...input.chassisIds, ...customChassisIds])], allEngineIds: [...new Set([...input.engineIds, ...customEngineIds])] };
    });

    const part = await tenant.run(() => tenant.prisma.$transaction(async (tx) => {
      const buyPrice = money(input.buyPriceLast);
      const sameOemBrand = await tx.partItem.findMany({ where: { oemNumber: input.oemNumber, brandId: masters.brandId }, select: { oemNumber: true, nameAr: true } });
      if (sameOemBrand.some((candidate) => hasSameCatalogIdentity(candidate, input))) throw new BusinessRuleError("يوجد صنف مطابق بنفس OEM والماركة والاسم.");
      const created = await tx.partItem.create({
        data: {
          oemNumber: input.oemNumber,
          // Uses the shared formatter so the stored value always matches what the UI renders.
          partNumberFormatted: formatOemNumber(input.oemNumber),
          nameAr: input.nameAr,
          nameEn: input.nameEn || null,
          brandId: masters.brandId,
          brandPartNumber: input.brandPartNumber || null,
          barcode: input.barcode || null,
          category: masters.category.name,
          categoryId: masters.category.id,
          imageKey: input.imageKey || null,
          imageUrl: input.imageUrl || null,
          sidePosition: input.sidePosition || null,
          binLocationId: input.binLocationId ?? null,
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
            createMany: { data: masters.allChassisIds.map((chassisId) => ({ chassisId })) },
          },
          compatibleEngines: {
            createMany: { data: masters.allEngineIds.map((engineId) => ({ engineId })) },
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
    }, PRODUCT_CREATE_TX_OPTIONS));

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
    const tenant = await getTenantDbFromSession();
    await tenant.run(() => ensureCatalogCompositeIdentity(tenant.prisma));
    const input = updatePartSchema.parse({ ...raw, binLocationId: normalizeOptionalPartReference(raw.binLocationId) });
    if (input.costPrice !== undefined) await requirePermission("part.editCost");

    await tenant.run(() => tenant.prisma.$transaction(async (tx) => {
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
      const sameOemBrand = await tx.partItem.findMany({ where: { oemNumber: before.oemNumber, brandId, id: { not: input.id } }, select: { oemNumber: true, nameAr: true } });
      if (sameOemBrand.some((candidate) => hasSameCatalogIdentity(candidate, { oemNumber: before.oemNumber, nameAr: input.nameAr }))) throw new BusinessRuleError("يوجد صنف آخر مطابق بنفس OEM والماركة والاسم.");
      let categoryId = input.categoryId;
      if (!categoryId && input.categoryName) {
        const normalizedName = input.categoryName.trim().toLocaleLowerCase("ar-EG");
        categoryId = (await tx.category.upsert({ where: { normalizedName }, update: {}, create: { name: input.categoryName.trim(), normalizedName }, select: { id: true } })).id;
      }

      const manualCost = input.costPrice === undefined ? null : money(input.costPrice);
      const costChanged = manualCost !== null && !manualCost.eq(before.buyPriceAvg);
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
          ...(manualCost === null ? {} : { buyPriceLast: manualCost, buyPriceAvg: manualCost }),
          sellPriceRetail: money(input.sellPriceRetail),
          sellPriceWholesale: money(input.sellPriceWholesale),
          sellPriceMin: money(input.sellPriceMin),
          minReorderLevel: input.minReorderLevel,
          isActive: input.isActive,
        },
      });

      if (costChanged && manualCost !== null) {
        await writeAudit(tx, {
          tableName: "PartItem",
          recordId: input.id,
          action: "UPDATE",
          oldData: { event: "PRODUCT_COST_UPDATED", oldCostPrice: before.buyPriceAvg, oldPurchasePrice: before.buyPriceLast },
          newData: { event: "PRODUCT_COST_UPDATED", newCostPrice: manualCost, newPurchasePrice: manualCost, source: "MANUAL_PRODUCT_EDIT" },
          performedBy: user.id,
        });
      }

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
    }, PRODUCT_CREATE_TX_OPTIONS));

    revalidatePath("/inventory");
    revalidatePath("/pos");
    return ok({ id: input.id });
  } catch (error) {
    return toActionError(error, "updatePartAction");
  }
}

const deletePartsSchema = z.object({ partIds: z.array(z.string().uuid()).min(1).max(200) });

/**
 * Removes only catalog-only parts. Any historical invoice, stock ledger, or
 * held-sale reference blocks the whole selected set, preserving auditability.
 */
export async function deletePartAction(raw: { partIds: string[] }): Promise<ActionResult<{ deleted: number; archived: number }>> {
  try {
    const user = await requirePermission("part.deactivate");
    const input = deletePartsSchema.parse(raw);
    const partIds = [...new Set(input.partIds)];

    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const parts = await tx.partItem.findMany({ where: { id: { in: partIds } }, select: { id: true, nameAr: true, oemNumber: true, stockQuantity: true, stockReserved: true } });
      if (parts.length !== partIds.length) throw new BusinessRuleError("أحد الأصناف المحددة لم يعد موجوداً.");

      let deleted = 0;
      let archived = 0;
      for (const part of parts) {
        const [activeInvoiceLines, activeMovementInvoiceRefs, movementWithoutInvoiceCount, heldSaleCount, voidedInvoiceLineCount, voidedMovementCount] = await Promise.all([
          tx.invoiceItem.findMany({ where: { partId: part.id, invoice: { isVoided: false } }, select: { invoiceId: true }, distinct: ["invoiceId"] }),
          tx.stockMovement.findMany({ where: { partId: part.id, invoiceId: { not: null }, invoice: { isVoided: false } }, select: { invoiceId: true }, distinct: ["invoiceId"] }),
          tx.stockMovement.count({ where: { partId: part.id, invoiceId: null } }),
          tx.heldSaleItem.count({ where: { partId: part.id } }),
          tx.invoiceItem.count({ where: { partId: part.id, invoice: { isVoided: true } } }),
          tx.stockMovement.count({ where: { partId: part.id, invoice: { isVoided: true } } }),
        ]);
        const activeInvoiceIds = new Set([...activeInvoiceLines.map((line) => line.invoiceId), ...activeMovementInvoiceRefs.map((movement) => movement.invoiceId).filter((id): id is string => Boolean(id))]);
        const hasActiveStock = part.stockQuantity !== 0 || part.stockReserved !== 0;
        if (activeInvoiceIds.size > 0 || movementWithoutInvoiceCount > 0 || heldSaleCount > 0 || hasActiveStock) {
          const historyText = [
            activeInvoiceIds.size > 0 ? `${activeInvoiceIds.size} فاتورة نشطة مرتبطة` : "",
            movementWithoutInvoiceCount > 0 ? `${movementWithoutInvoiceCount} حركة مخزون غير مرتبطة بفاتورة` : "",
            heldSaleCount > 0 ? `${heldSaleCount} عملية بيع معلقة` : "",
            hasActiveStock ? `رصيد حالي ${part.stockQuantity}` : "",
          ].filter(Boolean).join(" و");
          throw new BusinessRuleError(`لا يمكن حذف الصنف (${part.nameAr}) لوجود ${historyText}. يجب إلغاء الفواتير أو تصفير الرصيد والحركات المرتبطة أولاً لإتمام الحذف.`);
        }

        const hasVoidedHistory = voidedInvoiceLineCount > 0 || voidedMovementCount > 0;
        if (hasVoidedHistory) {
          const archivedPart = await tx.partItem.update({ where: { id: part.id }, data: { isDeleted: true, isActive: false, deletedAt: new Date() } });
          await writeAudit(tx, { tableName: "PartItem", recordId: part.id, action: "DELETE", oldData: part, newData: { isDeleted: true, deletedAt: archivedPart.deletedAt, reason: "VOIDED_HISTORY_PRESERVED" }, performedBy: user.id });
          archived += 1;
        } else {
          await tx.partItem.delete({ where: { id: part.id } });
          await writeAudit(tx, { tableName: "PartItem", recordId: part.id, action: "DELETE", oldData: part, performedBy: user.id });
          deleted += 1;
        }
      }
      return { deleted, archived };
    }, TX_OPTIONS));

    revalidatePath("/inventory");
    revalidatePath("/pos");
    return ok(result);
  } catch (error) {
    return toActionError(error, "deletePartAction");
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

export async function getPartsForPrintAction(raw: unknown) {
  try {
    await requirePermission("part.read");
    const filters = searchPartsSchema.parse(raw ?? {});
    const tenant = await getTenantDbFromSession();
    const result = await tenant.run(() => searchParts(tenant.prisma, { ...filters, page: 1, pageSize: 100, isForPrint: true }));
    return ok({ rows: result.rows, total: result.total, capped: result.total > result.rows.length });
  } catch (error) {
    return toActionError(error, "getPartsForPrintAction");
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
