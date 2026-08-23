"use server";

import { can, requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { num } from "@/lib/utils";

type Input = { fromDate: string; toDate: string; chassisId?: string; categoryId?: string; brandId?: string; warehouseName?: string };
type MovementRow = {
  id: string; oemNumber: string; nameAr: string; brandName: string; category: string; chassisCodes: string[]; warehouseName: string;
  openingStock: number; purchasesIn: number; saleReturnsIn: number; salesOut: number; purchaseReturnsOut: number; adjustments: number; netMovement: number; closingStock: number;
  unitsSold: number; salesRevenue: number; grossProfit: number | null; grossMargin: number | null; unitCost: number | null; tiedUpCost: number | null; daysSinceLastMovement: number | null; recommendation: string; demandIndex: number;
};
type ReportData = { canViewCost: boolean; period: { from: string; to: string }; metrics: { unitsSold: number; grossSales: number; inwardUnits: number; frozenCapital: number | null; velocity: number }; topSelling: MovementRow[]; deadStock: MovementRow[]; ledger: MovementRow[]; options: { chassis: Array<{ id: string; code: string }>; categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }>; warehouses: string[] } };

const asDate = (value: string, fallback: Date) => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed : fallback; };

export async function getInventoryMovementReportAction(input: Input): Promise<ActionResult<ReportData>> {
  try {
    await requirePermission("reports.dailyMovement");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const user = tenant.user;
    const canViewCost = can(user.role, "part.viewCost");
    const from = asDate(input.fromDate, new Date(new Date().setHours(0, 0, 0, 0)));
    const to = asDate(input.toDate, new Date());
    if (to < from) return { success: false, error: "يجب أن يكون تاريخ النهاية بعد تاريخ البداية." };

    const where = {
      isActive: true,
      isDeleted: false,
      ...(input.brandId ? { brandId: input.brandId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.warehouseName ? { binLocation: { warehouseName: input.warehouseName } } : {}),
      ...(input.chassisId ? { compatibleChassis: { some: { chassisId: input.chassisId } } } : {}),
    };

    const [parts, chassis, categories, brands, bins] = await Promise.all([
      tenant.prisma.partItem.findMany({
        where,
        select: {
          id: true, oemNumber: true, nameAr: true, category: true, stockQuantity: true, buyPriceAvg: true, createdAt: true,
          brand: { select: { name: true } },
          binLocation: { select: { warehouseName: true } },
          compatibleChassis: { select: { chassis: { select: { code: true } } } },
          stockMovements: { where: { createdAt: { lte: to } }, orderBy: [{ createdAt: "asc" }, { seq: "asc" }], select: { reason: true, quantityDelta: true, balanceAfter: true, createdAt: true } },
          invoiceItems: { where: { invoice: { type: "SALE", isVoided: false, createdAt: { gte: from, lte: to } } }, select: { quantity: true, unitPrice: true, unitCostSnapshot: true, lineDiscount: true } },
        },
      }),
      tenant.prisma.bmwChassis.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
      tenant.prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tenant.prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tenant.prisma.warehouseBin.findMany({ distinct: ["warehouseName"], orderBy: { warehouseName: "asc" }, select: { warehouseName: true } }),
    ]);

    const now = Date.now();
    const rows: MovementRow[] = parts.map((part) => {
      const before = part.stockMovements.filter((movement) => movement.createdAt < from);
      const during = part.stockMovements.filter((movement) => movement.createdAt >= from && movement.createdAt <= to);
      const openingStock = before.length ? before[before.length - 1]!.balanceAfter : during.length ? during[0]!.balanceAfter - during[0]!.quantityDelta : part.createdAt > to ? 0 : part.stockQuantity;
      const closingStock = part.stockMovements.length ? part.stockMovements[part.stockMovements.length - 1]!.balanceAfter : openingStock;
      let purchasesIn = 0; let saleReturnsIn = 0; let salesOut = 0; let purchaseReturnsOut = 0; let adjustments = 0;
      for (const movement of during) {
        if (movement.reason === "PURCHASE") purchasesIn += Math.max(0, movement.quantityDelta);
        else if (movement.reason === "SALE_RETURN") saleReturnsIn += Math.max(0, movement.quantityDelta);
        else if (movement.reason === "SALE") salesOut += Math.abs(Math.min(0, movement.quantityDelta));
        else if (movement.reason === "PURCHASE_RETURN") purchaseReturnsOut += Math.abs(Math.min(0, movement.quantityDelta));
        else adjustments += movement.quantityDelta;
      }
      const unitsSold = part.invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
      const salesRevenue = part.invoiceItems.reduce((sum, item) => sum + num(item.unitPrice) * item.quantity - num(item.lineDiscount), 0);
      const grossProfitValue = part.invoiceItems.reduce((sum, item) => sum + (num(item.unitPrice) - num(item.unitCostSnapshot)) * item.quantity - num(item.lineDiscount), 0);
      const unitCost = num(part.buyPriceAvg);
      const lastMovement = part.stockMovements.length ? part.stockMovements[part.stockMovements.length - 1]!.createdAt : null;
      const daysSinceLastMovement = lastMovement ? Math.max(0, Math.floor((now - lastMovement.getTime()) / 86_400_000)) : null;
      const netMovement = purchasesIn + saleReturnsIn - salesOut - purchaseReturnsOut + adjustments;
      const averageStock = Math.max(1, (openingStock + closingStock) / 2);
      const demandIndex = Math.min(100, Math.round((unitsSold / averageStock) * 100));
      const dead = closingStock > 0 && unitsSold === 0;
      const recommendation = dead ? (daysSinceLastMovement !== null && daysSinceLastMovement > 180 ? "إعادة تسعير أو تصفية" : "عرض ترويجي / متابعة الطلب") : demandIndex >= 70 ? "إعادة طلب ومراقبة المخزون" : "متابعة معدل الطلب";
      return {
        id: part.id, oemNumber: part.oemNumber, nameAr: part.nameAr, brandName: part.brand.name, category: part.category, chassisCodes: part.compatibleChassis.map((item) => item.chassis.code), warehouseName: part.binLocation?.warehouseName ?? "المستودع الرئيسي",
        openingStock, purchasesIn, saleReturnsIn, salesOut, purchaseReturnsOut, adjustments, netMovement, closingStock,
        unitsSold, salesRevenue, grossProfit: canViewCost ? grossProfitValue : null, grossMargin: canViewCost && salesRevenue > 0 ? (grossProfitValue / salesRevenue) * 100 : null, unitCost: canViewCost ? unitCost : null, tiedUpCost: canViewCost && dead ? closingStock * unitCost : null, daysSinceLastMovement, recommendation, demandIndex,
      };
    });

    const unitsSold = rows.reduce((sum, row) => sum + row.unitsSold, 0);
    const grossSales = rows.reduce((sum, row) => sum + row.salesRevenue, 0);
    const inwardUnits = rows.reduce((sum, row) => sum + row.purchasesIn + row.saleReturnsIn, 0);
    const averageStockTotal = rows.reduce((sum, row) => sum + Math.max(0, (row.openingStock + row.closingStock) / 2), 0);
    const frozenCapital = canViewCost ? rows.reduce((sum, row) => sum + (row.tiedUpCost ?? 0), 0) : null;
    const data: ReportData = {
      canViewCost,
      period: { from: from.toISOString(), to: to.toISOString() },
      metrics: { unitsSold, grossSales, inwardUnits, frozenCapital, velocity: averageStockTotal > 0 ? unitsSold / averageStockTotal : 0 },
      topSelling: [...rows].filter((row) => row.unitsSold > 0).sort((a, b) => b.unitsSold - a.unitsSold || b.salesRevenue - a.salesRevenue),
      deadStock: [...rows].filter((row) => row.closingStock > 0 && row.unitsSold === 0).sort((a, b) => (b.tiedUpCost ?? 0) - (a.tiedUpCost ?? 0) || b.closingStock - a.closingStock),
      ledger: rows.sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
      options: { chassis, categories, brands, warehouses: bins.map((bin) => bin.warehouseName) },
    };
    return ok(data);
    });
  } catch (error) {
    return toActionError(error, "getInventoryMovementReportAction");
  }
}
