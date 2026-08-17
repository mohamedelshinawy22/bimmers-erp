import { z } from "zod";
import { arabicName, nonNegativeMoney, oemNumber, optionalText, optionalUuid, uuid } from "./common";

/**
 * Price invariants shared by the create and update paths.
 *
 * These used to exist only on `createPartSchema`, with the update path
 * hand-checking a single rule in the action. That let the edit modal save
 * `sellPriceWholesale > sellPriceRetail` — combinations the create path
 * rejects — which then priced wholesale accounts above retail in the POS.
 */
interface PriceShape {
  sellPriceRetail: number;
  sellPriceWholesale: number;
  sellPriceMin: number;
  /** Absent on the update path, where cost is derived from purchase invoices. */
  buyPriceLast?: number;
}

export function refinePartPrices(data: PriceShape, ctx: z.RefinementCtx): void {
  if (data.sellPriceMin > data.sellPriceRetail) {
    ctx.addIssue({
      code: "custom",
      path: ["sellPriceMin"],
      message: "الحد الأدنى للسعر لا يجب أن يتجاوز سعر القطاعي",
    });
  }
  if (data.sellPriceWholesale > data.sellPriceRetail) {
    ctx.addIssue({
      code: "custom",
      path: ["sellPriceWholesale"],
      message: "سعر الجملة لا يجب أن يتجاوز سعر القطاعي",
    });
  }
  if (data.sellPriceMin > 0 && data.sellPriceWholesale > 0 && data.sellPriceMin > data.sellPriceWholesale) {
    ctx.addIssue({
      code: "custom",
      path: ["sellPriceMin"],
      message: "الحد الأدنى للسعر لا يجب أن يتجاوز سعر الجملة",
    });
  }
  if (data.buyPriceLast !== undefined && data.buyPriceLast > 0 && data.sellPriceMin < data.buyPriceLast) {
    ctx.addIssue({
      code: "custom",
      path: ["sellPriceMin"],
      message: "الحد الأدنى للسعر أقل من سعر الشراء — سيتحقق خسارة مؤكدة",
    });
  }
}

export const createPartSchema = z
  .object({
    oemNumber,
    nameAr: arabicName,
    nameEn: optionalText(200),
    brandId: uuid,
    brandPartNumber: optionalText(60),
    barcode: optionalText(60),
    category: z.string().trim().min(2, "يجب اختيار التصنيف").max(80),
    sidePosition: optionalText(60),
    binLocationId: optionalUuid,

    buyPriceLast: nonNegativeMoney.default(0),
    sellPriceRetail: nonNegativeMoney,
    sellPriceWholesale: nonNegativeMoney,
    sellPriceMin: nonNegativeMoney,

    openingQuantity: z.number().int().min(0).max(1_000_000).default(0),
    minReorderLevel: z.number().int().min(0).max(100_000).default(2),
    isActive: z.boolean().default(true),

    chassisIds: z.array(uuid).max(80).default([]),
    engineIds: z.array(uuid).max(80).default([]),
  })
  .superRefine(refinePartPrices);

export type CreatePartInput = z.infer<typeof createPartSchema>;

export const updatePartSchema = z
  .object({
    id: uuid,
    nameAr: arabicName,
    nameEn: optionalText(200),
    brandId: uuid,
    brandPartNumber: optionalText(60),
    barcode: optionalText(60),
    category: z.string().trim().min(2).max(80),
    sidePosition: optionalText(60),
    binLocationId: optionalUuid,
    sellPriceRetail: nonNegativeMoney,
    sellPriceWholesale: nonNegativeMoney,
    sellPriceMin: nonNegativeMoney,
    minReorderLevel: z.number().int().min(0).max(100_000),
    isActive: z.boolean(),
    chassisIds: z.array(uuid).max(80).default([]),
    engineIds: z.array(uuid).max(80).default([]),
  })
  .superRefine(refinePartPrices);

export type UpdatePartInput = z.infer<typeof updatePartSchema>;

export const adjustStockSchema = z.object({
  partId: uuid,
  /** Signed delta: +5 receives five units, -3 writes off three. */
  quantityDelta: z
    .number()
    .int("يجب إدخال رقم صحيح")
    .refine((v) => v !== 0, "لا يمكن أن تكون التسوية صفراً")
    .refine((v) => Math.abs(v) <= 1_000_000, "قيمة التسوية كبيرة جداً"),
  reason: z.enum(["MANUAL_ADJUSTMENT", "STOCKTAKE", "OPENING_BALANCE"]),
  /**
   * Unit cost for inbound adjustments. Required in effect: the service refuses a
   * positive adjustment when neither this nor the part's existing average cost
   * gives a non-zero cost, so stock can never be brought in valued at zero.
   */
  unitCost: nonNegativeMoney.optional(),
  note: z.string().trim().min(3, "يجب توضيح سبب التسوية").max(500),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const searchPartsSchema = z.object({
  query: z.string().trim().max(100).default(""),
  chassisCode: z.string().trim().max(20).optional(),
  engineCode: z.string().trim().max(20).optional(),
  category: z.string().trim().max(80).optional(),
  brandId: optionalUuid,
  lowStockOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
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
