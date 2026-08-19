import { z } from "zod";

export const THERMAL_BARCODE_PROFILE_KEY = "THERMAL_BARCODE_PROFILE";

export const thermalBarcodeProfileSchema = z.object({
  presetId: z.enum(["50X25", "38X25", "40X30", "50X30", "60X40", "80X50", "100X150", "CUSTOM"]),
  widthMm: z.coerce.number().finite().min(20).max(150),
  heightMm: z.coerce.number().finite().min(15).max(180),
  symbology: z.enum(["CODE128", "EAN13", "QR"]),
  barcodeHeightMm: z.coerce.number().finite().min(4).max(14),
  lineDensity: z.enum(["THIN", "STANDARD", "BOLD"]),
  fontScale: z.enum(["SMALL", "MEDIUM", "LARGE"]),
  toggles: z.object({
    company: z.boolean(),
    partName: z.boolean(),
    oem: z.boolean(),
    fitment: z.boolean(),
    price: z.boolean(),
    barcode: z.boolean(),
    barcodeText: z.boolean(),
  }),
});

export type ThermalBarcodeProfile = z.infer<typeof thermalBarcodeProfileSchema>;

export const DEFAULT_THERMAL_BARCODE_PROFILE: ThermalBarcodeProfile = {
  presetId: "50X25",
  widthMm: 50,
  heightMm: 25,
  symbology: "CODE128",
  barcodeHeightMm: 9,
  lineDensity: "STANDARD",
  fontScale: "MEDIUM",
  toggles: { company: true, partName: true, oem: true, fitment: true, price: true, barcode: true, barcodeText: true },
};

export const THERMAL_LABEL_PRESETS = [
  { id: "50X25", label: "50 مم × 25 مم — قياسي", widthMm: 50, heightMm: 25 },
  { id: "38X25", label: "38 مم × 25 مم — مدمج", widthMm: 38, heightMm: 25 },
  { id: "40X30", label: "40 مم × 30 مم — متوسط", widthMm: 40, heightMm: 30 },
  { id: "50X30", label: "50 مم × 30 مم — تفصيلي", widthMm: 50, heightMm: 30 },
  { id: "60X40", label: "60 مم × 40 مم — كبير", widthMm: 60, heightMm: 40 },
  { id: "80X50", label: "80 مم × 50 مم — كرتون", widthMm: 80, heightMm: 50 },
  { id: "100X150", label: "100 مم × 150 مم (4×6) — شحن", widthMm: 100, heightMm: 150 },
] as const;

export const lineWidthForDensity = (density: ThermalBarcodeProfile["lineDensity"]) => density === "THIN" ? 0.8 : density === "BOLD" ? 1.6 : 1.2;
