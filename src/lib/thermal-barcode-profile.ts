import { z } from "zod";

export const THERMAL_BARCODE_PROFILE_KEY = "THERMAL_BARCODE_PROFILE";

export const THERMAL_FONT_FAMILIES = [
  { id: "Cairo", label: "كايرو — واضح وجريء", css: "'Cairo', sans-serif", google: "Cairo" },
  { id: "Tajawal", label: "تجوال — عصري ومقروء", css: "'Tajawal', sans-serif", google: "Tajawal" },
  { id: "IBM_PLEX_SANS_ARABIC", label: "IBM Plex Sans Arabic — رسمي", css: "'IBM Plex Sans Arabic', sans-serif", google: "IBM Plex Sans Arabic" },
  { id: "Almarai", label: "المراعي — متناسق مع الأرقام", css: "'Almarai', sans-serif", google: "Almarai" },
  { id: "SYSTEM", label: "النظام الافتراضي", css: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif", google: null },
] as const;

export type ThermalFontFamily = (typeof THERMAL_FONT_FAMILIES)[number]["id"];
export const fontCssForThermalFamily = (family: ThermalFontFamily) => THERMAL_FONT_FAMILIES.find((item) => item.id === family)?.css ?? THERMAL_FONT_FAMILIES[0].css;
export const googleFontUrlForThermalFamily = (family: ThermalFontFamily) => {
  const google = THERMAL_FONT_FAMILIES.find((item) => item.id === family)?.google;
  return google ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(google)}:wght@400;600;700;800;900&display=swap` : "";
};

const legacyLineDensityWidth = (density: "THIN" | "STANDARD" | "BOLD") => density === "THIN" ? 0.8 : density === "BOLD" ? 1.6 : 1.2;

export const thermalBarcodeProfileSchema = z.object({
  presetId: z.enum(["50X25", "38X25", "40X30", "50X30", "60X40", "80X50", "100X150", "CUSTOM"]),
  widthMm: z.coerce.number().finite().min(20).max(150),
  heightMm: z.coerce.number().finite().min(15).max(180),
  symbology: z.enum(["CODE128", "EAN13", "QR"]),
  barcodeHeightMm: z.coerce.number().finite().min(4).max(16),
  // Retained for profiles saved before the continuous density slider was introduced.
  lineDensity: z.enum(["THIN", "STANDARD", "BOLD"]),
  barcodeDensity: z.coerce.number().finite().min(0.8).max(2).optional(),
  fontScale: z.enum(["SMALL", "MEDIUM", "LARGE"]),
  fontFamily: z.enum(["Cairo", "Tajawal", "IBM_PLEX_SANS_ARABIC", "Almarai", "SYSTEM"]).optional(),
  companyNameFontSizePt: z.coerce.number().finite().min(6).max(14).optional(),
  partNameFontSizePt: z.coerce.number().finite().min(7).max(16).optional(),
  oemFontSizePt: z.coerce.number().finite().min(6).max(14).optional(),
  priceFontSizePt: z.coerce.number().finite().min(6).max(14).optional(),
  barcodeTextSizePt: z.coerce.number().finite().min(5).max(10).optional(),
  fontWeight: z.enum(["NORMAL", "BOLD", "EXTRA_BOLD"]).optional(),
  toggles: z.object({
    // `company` is retained as a read-only legacy input so profiles saved before
    // the header split automatically migrate without losing their intended output.
    company: z.boolean().optional(),
    showLogo: z.boolean().optional(),
    showCompanyName: z.boolean().optional(),
    partName: z.boolean(),
    oem: z.boolean(),
    fitment: z.boolean(),
    price: z.boolean(),
    barcode: z.boolean(),
    barcodeText: z.boolean(),
  }).transform((toggles) => ({
    showLogo: toggles.showLogo ?? toggles.company ?? true,
    showCompanyName: toggles.showCompanyName ?? toggles.company ?? true,
    partName: toggles.partName,
    oem: toggles.oem,
    fitment: toggles.fitment,
    price: toggles.price,
    barcode: toggles.barcode,
    barcodeText: toggles.barcodeText,
  })),
}).transform((profile) => ({
  ...profile,
  barcodeDensity: profile.barcodeDensity ?? legacyLineDensityWidth(profile.lineDensity),
  fontFamily: profile.fontFamily ?? "Cairo",
  companyNameFontSizePt: profile.companyNameFontSizePt ?? 8,
  partNameFontSizePt: profile.partNameFontSizePt ?? 9,
  oemFontSizePt: profile.oemFontSizePt ?? 8,
  priceFontSizePt: profile.priceFontSizePt ?? 8.5,
  barcodeTextSizePt: profile.barcodeTextSizePt ?? 6.5,
  fontWeight: profile.fontWeight ?? "EXTRA_BOLD",
}));

export type ThermalBarcodeProfile = z.infer<typeof thermalBarcodeProfileSchema>;

export const DEFAULT_THERMAL_BARCODE_PROFILE: ThermalBarcodeProfile = {
  presetId: "50X25",
  widthMm: 50,
  heightMm: 25,
  symbology: "CODE128",
  barcodeHeightMm: 9,
  lineDensity: "STANDARD",
  barcodeDensity: 1.2,
  fontScale: "MEDIUM",
  fontFamily: "Cairo",
  companyNameFontSizePt: 8,
  partNameFontSizePt: 9,
  oemFontSizePt: 8,
  priceFontSizePt: 8.5,
  barcodeTextSizePt: 6.5,
  fontWeight: "EXTRA_BOLD",
  toggles: { showLogo: true, showCompanyName: true, partName: true, oem: true, fitment: true, price: true, barcode: true, barcodeText: true },
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

export const lineWidthForDensity = (density: ThermalBarcodeProfile["lineDensity"]) => legacyLineDensityWidth(density);
