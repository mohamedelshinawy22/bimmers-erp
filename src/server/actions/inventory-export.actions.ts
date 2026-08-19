"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import * as XLSX from "xlsx";
import { can, requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getUserAccess, hasPermission } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { normalizeSearchTerm } from "@/lib/search-utils";

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

const headers = ["رقم OEM", "اسم الصنف", "الماركة", "التصنيف", "الباركود", "الكمية الحالية", "حد الطلب الأدنى", "حالة المخزون", "سعر التكلفة", "سعر البيع", "سعر الجملة", "موديلات الشاسيه المتوافقة"];

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function scopeFileToken(scope: "ALL" | "CRITICAL" | "OUT_OF_STOCK" | "FILTERED") {
  return scope === "ALL" ? "all" : scope === "CRITICAL" ? "critical" : scope === "OUT_OF_STOCK" ? "out-of-stock" : "filtered";
}

export async function exportInventoryDataAction(raw: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; base64: string; count: number; costIncluded: boolean }>> {
  try {
    const user = await requirePermission("part.read");
    const input = inventoryExportSchema.parse(raw);
    const filters = input.filters ?? {};
    const and: Prisma.PartItemWhereInput[] = [];

    if (filters.query) {
      const { numericNormalized, variations } = normalizeSearchTerm(filters.query);
      and.push({ OR: [
        { oemNumber: { contains: numericNormalized, mode: "insensitive" } },
        { barcode: { equals: numericNormalized } },
        ...variations.flatMap((term) => [
          { nameAr: { contains: term } },
          { nameEn: { contains: term, mode: "insensitive" as const } },
          { brandPartNumber: { contains: term, mode: "insensitive" as const } },
          { brand: { name: { contains: term, mode: "insensitive" as const } } },
        ]),
      ] });
    }
    if (filters.chassisCode) and.push({ compatibleChassis: { some: { chassis: { code: filters.chassisCode.toUpperCase() } } } });
    if (filters.engineCode) and.push({ compatibleEngines: { some: { engine: { code: filters.engineCode.toUpperCase() } } } });
    if (filters.category) and.push({ category: filters.category });
    if (filters.brandId) and.push({ brandId: filters.brandId });
    if (input.scope === "OUT_OF_STOCK") and.push({ stockQuantity: 0 });
    if (input.scope === "CRITICAL" || (input.scope === "FILTERED" && filters.lowStockOnly)) and.push({ stockQuantity: { gt: 0 } });

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
      ? parts.filter((part) => Number(part.stockQuantity ?? 0) > 0 && Number(part.stockQuantity ?? 0) <= Number(part.minReorderLevel ?? 0))
      : parts;
    const access = await getUserAccess(user.id);
    const costIncluded = can(user.role, "part.viewCost") && hasPermission(access, "canViewCostPrice");

    const records = scopedParts.map((part) => {
      const quantity = Number(part.stockQuantity ?? 0);
      const minStock = Number(part.minReorderLevel ?? 0);
      const brand = part.brand && typeof part.brand === "object" ? (part.brand.name || "عام") : "عام";
      const compatibility = Array.isArray(part.compatibleChassis)
        ? part.compatibleChassis.map((entry) => entry?.chassis?.code ?? "").filter(Boolean).join("، ")
        : "";
      return {
        "رقم OEM": part.oemNumber || "-",
        "اسم الصنف": part.nameAr || "-",
        "الماركة": brand,
        "التصنيف": part.category || "بدون تصنيف",
        "الباركود": part.barcode || "-",
        "الكمية الحالية": quantity,
        "حد الطلب الأدنى": minStock,
        "حالة المخزون": quantity <= 0 ? "نافد" : quantity <= minStock ? "حد حرج" : "متاح",
        "سعر التكلفة": costIncluded ? decimalToNumber(part.buyPriceAvg) : "غير مصرح",
        "سعر البيع": decimalToNumber(part.sellPriceRetail),
        "سعر الجملة": decimalToNumber(part.sellPriceWholesale),
        "موديلات الشاسيه المتوافقة": compatibility || "-",
      };
    });

    const sheet = XLSX.utils.json_to_sheet(records, { header: headers });
    sheet["!cols"] = [14, 32, 18, 20, 18, 15, 16, 14, 16, 14, 14, 28].map((wch) => ({ wch }));
    const date = new Date().toISOString().slice(0, 10);
    const extension = input.format === "XLSX" ? "xlsx" : "csv";
    const fileName = `bimmer_inventory_${scopeFileToken(input.scope)}_${date}.${extension}`;

    if (input.format === "CSV") {
      const csv = `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`;
      return ok({ fileName, mimeType: "text/csv;charset=utf-8", base64: Buffer.from(csv, "utf8").toString("base64"), count: records.length, costIncluded });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "المخزون");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return ok({ fileName, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from(buffer).toString("base64"), count: records.length, costIncluded });
  } catch (error) {
    console.error("[INVENTORY_EXPORT_ERROR]", error);
    return toActionError(error, "exportInventoryDataAction");
  }
}
