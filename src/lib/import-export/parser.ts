export type ImportColumnKey = "nameAr" | "nameEn" | "oemNumber" | "barcode" | "brand" | "category" | "cost" | "price" | "quantity" | "date" | "accountName" | "treasuryName" | "description" | "chassis" | "engine" | "bin";

export const IMPORT_COLUMN_ALIASES: Record<ImportColumnKey, readonly string[]> = {
  nameAr: ["اسم الصنف", "اسم القطعة", "item name", "product name", "name"],
  nameEn: ["الاسم الانجليزي", "اسم الصنف بالانجليزية", "english name", "item name en"],
  oemNumber: ["رقم القطعة", "رقم oem", "كود oem", "oem", "oem / code", "part number", "item code", "code"],
  barcode: ["باركود", "barcode"],
  brand: ["الماركة", "العلامة التجارية", "brand"],
  category: ["التصنيف", "الفئة", "القسم", "category"],
  cost: ["سعر الشراء", "التكلفة", "cost", "buy price", "purchase price"],
  price: ["سعر البيع", "سعر القطاعي", "selling price", "sale price", "retail price", "price"],
  quantity: ["الكمية", "الرصيد", "quantity", "qty", "opening quantity"],
  date: ["التاريخ", "date", "invoice date", "transaction date"],
  accountName: ["الحساب", "العميل", "المورد", "account", "customer", "supplier"],
  treasuryName: ["الخزينة", "treasury", "cash drawer"],
  description: ["البيان", "الوصف", "description", "notes"],
  chassis: ["الشاسيه", "كود الشاسيه", "chassis", "fitment chassis"],
  engine: ["المحرك", "كود المحرك", "engine", "fitment engine"],
  bin: ["الموقع", "موقع التخزين", "bin", "warehouse bin", "location"],
};

const arabicDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

export function normalizeImportHeader(value: unknown): string {
  return arabicDigits(String(value ?? ""))
    .trim()
    .toLocaleLowerCase("ar-EG")
    .replace(/[‏‎]/g, "")
    .replace(/[_.:]+/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveImportColumns(headers: readonly unknown[]): Partial<Record<ImportColumnKey, number>> {
  const normalizedHeaders = headers.map(normalizeImportHeader);
  return Object.fromEntries(Object.entries(IMPORT_COLUMN_ALIASES).flatMap(([key, aliases]) => {
    const index = normalizedHeaders.findIndex((header) => aliases.some((alias) => header === normalizeImportHeader(alias)));
    return index >= 0 ? [[key, index]] : [];
  })) as Partial<Record<ImportColumnKey, number>>;
}

export function normalizeImportText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return /^(?:-|—|–|n\/?a|null|undefined)$/i.test(text) ? "" : text;
}

/** Parses locale-specific spreadsheet numeric cells without turning malformed values into zero. */
export function parseImportNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = normalizeImportText(value);
  if (!raw) return null;
  const digits = arabicDigits(raw)
    .replace(/\u00a0/g, " ")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/(?:EGP|ج\.?م\.?|LE|USD|SAR)/gi, "")
    .replace(/[^0-9,.+\-]/g, "")
    .replace(/\s/g, "")
    .replace(/[,.]+$/g, "");
  if (!digits || !/[0-9]/.test(digits) || !/^[+-]?[0-9.,]+$/.test(digits)) return null;
  const comma = digits.lastIndexOf(",");
  const dot = digits.lastIndexOf(".");
  const decimal = comma > dot ? "," : ".";
  const hasBoth = comma >= 0 && dot >= 0;
  const normalized = hasBoth
    ? digits.replaceAll(decimal === "," ? "." : ",", "").replace(decimal, ".")
    : digits.includes(",")
      ? (/^[+-]?\d{1,3}(,\d{3})+$/.test(digits) ? digits.replaceAll(",", "") : digits.replace(",", "."))
      : (digits.match(/\./g) ?? []).length > 1 ? digits.replaceAll(".", "") : digits;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Accepts Excel serial dates, JS Dates, ISO values, and common Arabic/standard date strings. */
export function parseImportDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = normalizeImportText(value);
  if (!text) return null;
  const western = arabicDigits(text).replace(/[.]/g, "/").trim();
  const dmy = western.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? date : null;
  }
  const iso = new Date(western);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function splitImportCodes(value: unknown, limit = 30): string[] {
  return normalizeImportText(value).split(/[,/|;\n]+/).map((part) => part.trim().toUpperCase()).filter(Boolean).slice(0, limit);
}
