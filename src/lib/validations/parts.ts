import { z } from "zod";
import { arabicName, nonNegativeMoney, oemNumber, optionalText, optionalUuid, uuid } from "./common";

interface PriceShape {
  sellPriceRetail: number;
  sellPriceWholesale: number;
  sellPriceMin: number;
  buyPriceLast?: number;
  costPrice?: number;
}

export function refinePartPrices(data: PriceShape, ctx: z.RefinementCtx): void {
  if (data.sellPriceMin > data.sellPriceRetail) {
    ctx.addIssue({ code: "custom", path: ["sellPriceMin"], message: "الحد الأدنى للسعر لا يجب أن يتجاوز سعر القطاعي" });
  }
  if (data.sellPriceWholesale > data.sellPriceRetail) {
    ctx.addIssue({ code: "custom", path: ["sellPriceWholesale"], message: "سعر الجملة لا يجب أن يتجاوز سعر القطاعي" });
  }
  if (data.sellPriceMin > 0 && data.sellPriceWholesale > 0 && data.sellPriceMin > data.sellPriceWholesale) {
    ctx.addIssue({ code: "custom", path: ["sellPriceMin"], message: "الحد الأدنى للسعر لا يجب أن يتجاوز سعر الجملة" });
  }
  const purchaseCost = data.costPrice ?? data.buyPriceLast;
  if (purchaseCost !== undefined && purchaseCost > 0 && data.sellPriceMin < purchaseCost) {
    ctx.addIssue({ code: "custom", path: ["sellPriceMin"], message: "الحد الأدنى للسعر أقل من سعر الشراء — سيتحقق خسارة مؤكدة" });
  }
}

const masterName = z.string().trim().min(2, "القيمة قصيرة جداً").max(100);
const code = z.string().trim().min(2).max(30).transform((value) => value.replace(/\s+/g, "").toUpperCase());

const partMasterFields = {
  brandId: optionalUuid,
  brandName: optionalText(100),
  categoryId: optionalUuid,
  categoryName: optionalText(100),
  category: z.string().trim().min(2, "يجب اختيار التصنيف").max(80).default("عام"),
  chassisIds: z.array(uuid).max(80).default([]),
  engineIds: z.array(uuid).max(80).default([]),
  chassisCodes: z.array(code).max(80).default([]),
  engineCodes: z.array(code).max(80).default([]),
  imageKey: optionalText(500),
  imageUrl: optionalText(1000),
};

export const createPartSchema = z
  .object({
    oemNumber,
    nameAr: arabicName,
    nameEn: optionalText(200),
    ...partMasterFields,
    brandPartNumber: optionalText(60),
    barcode: optionalText(60),
    sidePosition: optionalText(60),
    binLocationId: optionalUuid,
    buyPriceLast: nonNegativeMoney.default(0),
    sellPriceRetail: nonNegativeMoney,
    sellPriceWholesale: nonNegativeMoney,
    sellPriceMin: nonNegativeMoney,
    openingQuantity: z.number().int().min(0).max(1_000_000).default(0),
    minReorderLevel: z.number().int().min(0).max(100_000).default(2),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    refinePartPrices(data, ctx);
    if (!data.brandId && !data.brandName) {
      ctx.addIssue({ code: "custom", path: ["brandId"], message: "يجب اختيار أو إضافة الماركة" });
    }
  });

export type CreatePartInput = z.infer<typeof createPartSchema>;

export const updatePartSchema = z
  .object({
    id: uuid,
    nameAr: arabicName,
    nameEn: optionalText(200),
    ...partMasterFields,
    brandPartNumber: optionalText(60),
    barcode: optionalText(60),
    sidePosition: optionalText(60),
    binLocationId: optionalUuid,
    costPrice: nonNegativeMoney.optional(),
    sellPriceRetail: nonNegativeMoney,
    sellPriceWholesale: nonNegativeMoney,
    sellPriceMin: nonNegativeMoney,
    minReorderLevel: z.number().int().min(0).max(100_000),
    isActive: z.boolean(),
  })
  .superRefine((data, ctx) => {
    refinePartPrices(data, ctx);
    if (!data.brandId && !data.brandName) {
      ctx.addIssue({ code: "custom", path: ["brandId"], message: "يجب اختيار أو إضافة الماركة" });
    }
  });

export type UpdatePartInput = z.infer<typeof updatePartSchema>;

export const masterCatalogCreateSchema = z.object({
  name: masterName,
  isOem: z.boolean().optional(),
  series: optionalText(100),
  productionStartYear: z.number().int().min(1950).max(new Date().getFullYear() + 2).optional(),
  displacement: optionalText(50),
  fuelType: optionalText(40),
});

export type MasterCatalogCreateInput = z.infer<typeof masterCatalogCreateSchema>;

export const adjustStockSchema = z.object({
  partId: uuid,
  quantityDelta: z
    .number()
    .int("يجب إدخال رقم صحيح")
    .refine((v) => v !== 0, "لا يمكن أن تكون التسوية صفراً")
    .refine((v) => Math.abs(v) <= 1_000_000, "قيمة التسوية كبيرة جداً"),
  reason: z.enum(["MANUAL_ADJUSTMENT", "STOCKTAKE", "OPENING_BALANCE"]),
  unitCost: nonNegativeMoney.optional(),
  note: z.string().trim().min(3, "يجب توضيح سبب التسوية").max(500),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const searchPartsSchema = z.object({
  query: z.string().trim().max(100).default(""),
  chassisCode: z.string().trim().max(80).optional(),
  engineCode: z.string().trim().max(20).optional(),
  category: z.string().trim().max(80).optional(),
  brandId: optionalUuid,
  inStockOnly: z.boolean().default(false),
  lowStockOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  isForPrint: z.boolean().default(false),
});

export type SearchPartsInput = z.infer<typeof searchPartsSchema>;

export const createBinSchema = z.object({
  warehouseName: z.string().trim().min(2).max(80).default("المستودع الرئيسي"),
  aisle: z.string().trim().min(1).max(10),
  rack: z.string().trim().min(1).max(10),
  shelf: z.string().trim().min(1).max(10),
  boxBin: z.string().trim().min(1).max(10),
});

export type CreateBinInput = z.infer<typeof createBinSchema>;
