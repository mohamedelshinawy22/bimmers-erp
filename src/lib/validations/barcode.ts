import { z } from "zod";

const mm = z.coerce.number().finite().min(0).max(300);
const fontSize = z.coerce.number().int().min(6).max(32);

export const barcodeConfigSchema = z.object({
  storeNameText: z.string().trim().min(1).max(100),
  labelWidthMm: mm.refine((value) => value > 0, "العرض يجب أن يكون أكبر من صفر"),
  barcodeHeightMm: z.coerce.number().finite().min(5).max(100),
  topMarginMm: mm,
  leftMarginMm: mm,
  fontFamily: z.enum(["Arial", "Tahoma", "Noto Sans Arabic", "Arial Black"]),
  titleFontSize: fontSize,
  partNameFontSize: fontSize,
  codeFontSize: fontSize,
  priceFontSize: fontSize,
  codeType: z.enum(["BARCODE", "OEM_CODE", "ITEM_CODE"]),
  priceType: z.enum(["RETAIL", "WHOLESALE", "NONE"]),
  showPartName: z.boolean(),
  showCode: z.boolean(),
  showPrice: z.boolean(),
  includeTaxInPrice: z.boolean(),
  twoLinePartName: z.boolean(),
  dualHorizontal: z.boolean(),
  dualVertical: z.boolean(),
  dualGapMm: mm,
  targetPrinter: z.string().trim().min(2).max(100),
});

export type BarcodeConfigInput = z.infer<typeof barcodeConfigSchema>;
