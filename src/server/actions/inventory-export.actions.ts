"use server";

import { z } from "zod";
import * as XLSX from "xlsx";
import { can, requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getUserAccess, hasPermission } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { normalizeSearchTerm } from "@/lib/search-utils";
import { num } from "@/lib/utils";

const inventoryExportSchema = z.object({
  scope: z.enum(["ALL", "CRITICAL", "OUT_OF_STOCK", "FILTERED"]),
  format: z.enum(["XLSX", "CSV"]),
  filters: z.object({
    query: z.string().trim().max(160).optional(),
    chassisCode: z.string().trim().max(60).optional(),
    engineCode: z.string().trim().max(60).optional(),
    category: z.string().trim().max(120).optional(),
    brandId: z.string().trim().max(80).optional(),
    lowStockOnly: z.boolean().optional(),
  }).optional(),
});

function scopeFileToken(scope: "ALL" | "CRITICAL" | "OUT_OF_STOCK" | "FILTERED") {
  return scope === "ALL" ? "all" : scope === "CRITICAL" ? "critical" : scope === "OUT_OF_STOCK" ? "out-of-stock" : "filtered";
}

export async function exportInventoryDataAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string; count: number; costIncluded: boolean }>> {
  try {
    const user = await requirePermission("part.read");
    const input = inventoryExportSchema.parse(raw);
    const filters = input.filters ?? {};
    const and: Array<Record<string, unknown>> = [];

    if (filters.query) {
      const { numericNormalized, variations } = normalizeSearchTerm(filters.query);
      and.push({ OR: [
        { oemNumber: { contains: numericNormalized, mode: "insensitive" } },
        { barcode: { equals: numericNormalized } },
        ...variations.flatMap((term) => [
          { nameAr: { contains: term } },
          { nameEn: { contains: term, mode: "insensitive" } },
          { brandPartNumber: { contains: term, mode: "insensitive" } },
          { brand: { name: { contains: term, mode: "insensitive" } } },
        ]),
      ] });
    }
    if (filters.chassisCode) and.push({ compatibleChassis: { some: { chassis: { code: filters.chassisCode.toUpperCase() } } } });
    if (filters.engineCode) and.push({ compatibleEngines: { some: { engine: { code: filters.engineCode.toUpperCase() } } } });
    if (filters.category) and.push({ category: filters.category });
    if (filters.brandId) and.push({ brandId: filters.brandId });
    if (input.scope === "OUT_OF_STOCK") and.push({ stockQuantity: 0 });
    if (input.scope === "CRITICAL") and.push({ stockQuantity: { gt: 0 } });
    if (input.scope === "FILTERED" && filters.lowStockOnly) and.push({ stockQuantity: { gt: 0 } });

    const parts = await prisma.partItem.findMany({
      where: { isDeleted: false, isActive: true, ...(and.length ? { AND: and } : {}) },
      orderBy: [{ nameAr: "asc" }, { oemNumber: "asc" }],
      select: {
        oemNumber: true,
        nameAr: true,
        brand: { select: { name: true } },
        category: true,
        barcode: true,
        stockQuantity: true,
        minReorderLevel: true,
        buyPriceAvg: true,
        sellPriceRetail: true,
        sellPriceWholesale: true,
        compatibleChassis: { orderBy: { chassis: { code: "asc" } }, select: { chassis: { select: { code: true } } } },
      },
    });

    const scopedParts = (input.scope === "CRITICAL" || (input.scope === "FILTERED" && filters.lowStockOnly))
      ? parts.filter((part) => part.stockQuantity > 0 && part.stockQuantity <= part.minReorderLevel)
      : parts;
    const access = await getUserAccess(user.id);
    const costIncluded = can(user.role, "part.viewCost") && hasPermission(access, "canViewCostPrice");
    const records = scopedParts.map((part) => ({
      "رقم OEM": part.oemNumber,
      "اسم الصنف": part.nameAr,
      "الماركة": part.brand.name,
      "التصنيف": part.category || "بدون تصنيف",
      "الباركود": part.barcode ?? "",
      "الكمية الحالية": part.stockQuantity,
      "حد الطلب الأدنى": part.minReorderLevel,
      "حالة المخزون": part.stockQuantity === 0 ? "نافد" : part.stockQuantity <= part.minReorderLevel ? "حد حرج" : "متاح",
      "سعر التكلفة": costIncluded ? num(part.buyPriceAvg) : "غير مصرح",
      "سعر البيع": num(part.sellPriceRetail),
      "سعر الجملة": num(part.sellPriceWholesale),
      "موديلات الشاسيه المتوافقة": part.compatibleChassis.map((entry) => entry.chassis.code).join("، "),
    }));

    const date = new Date().toISOString().slice(0, 10);
    const extension = input.format === "XLSX" ? "xlsx" : "csv";
    const fileName = `bimmer_inventory_${scopeFileToken(input.scope)}_${date}.${extension}`;
    const headers = ["رقم OEM", "اسم الصنف", "الماركة", "التصنيف", "الباركود", "الكمية الحالية", "حد الطلب الأدنى", "حالة المخزون", "سعر التكلفة", "سعر البيع", "سعر الجملة", "موديلات الشاسيه المتوافقة"];
    const sheet = XLSX.utils.json_to_sheet(records, { header: headers });
    sheet["!cols"] = [14, 32, 18, 20, 18, 15, 16, 14, 16, 14, 14, 28].map((wch) => ({ wch }));
    const base64 = input.format === "XLSX"
      ? XLSX.write(XLSX.utils.book_new(), { type: "base64", bookType: "xlsx" })
      : "";

    if (input.format === "XLSX") {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "المخزون");
      return ok({ fileName, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }), count: records.length, costIncluded });
    }
    const csv = `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`;
    return ok({ fileName, mimeType: "text/csv;charset=utf-8", base64: Buffer.from(csv, "utf8").toString("base64"), count: records.length, costIncluded });
  } catch (error) {
    return toActionError(error, "exportInventoryDataAction");
  }
}
