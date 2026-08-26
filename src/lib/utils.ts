import { Prisma } from "@prisma/client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Converts Arabic-Indic and Persian digits plus Arabic decimal separators to Western numeric text. */
export function normalizeDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٫،]/g, ".");
}

/** Keeps a browser numeric field editable while normalizing localized digits, separators, and an optional leading minus sign. */
export function sanitizeNumericInput(value: string | number | null | undefined, options: { allowNegative?: boolean } = {}): string {
  const normalized = normalizeDigits(value);
  const negative = options.allowNegative && normalized.trimStart().startsWith("-") ? "-" : "";
  const decimal = normalized.replace(/[^0-9.]/g, "").replace(/(\..*?)\..*/g, "$1");
  return `${negative}${decimal}`;
}

export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "ج.م";

/** ── Money ────────────────────────────────────────────────────────────────
 * All arithmetic that touches money uses Prisma.Decimal (arbitrary precision).
 * `Number` is only used at the presentation edge. Never sum floats.
 */
export type Money = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);

/** Round to 2 dp, half-up — matches Decimal(12,2) storage. */
export function money(v: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Decimal → plain number, for crossing the server → client boundary. */
export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

const arabicFormatter = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  numberingSystem: "latn",
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMoney(v: Prisma.Decimal | number | string | null | undefined): string {
  return arabicFormatter.format(num(v));
}

export function formatMoneyWithCurrency(v: Prisma.Decimal | number | string | null | undefined): string {
  return `${formatMoney(v)} ${CURRENCY}`;
}

export function formatInt(v: number | null | undefined): string {
  return compactFormatter.format(v ?? 0);
}

/** ── Dates ────────────────────────────────────────────────────────────── */
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    numberingSystem: "latn",
  }).format(date).replace(/^\+/, "");
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(date).replace(/^\+/, "");
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfYesterday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - 1);
  return d;
}

/** ── BMW domain helpers ───────────────────────────────────────────────── */

/** Approved characters for OEM and aftermarket part identifiers. */
export const OEM_REGEX = /^[a-zA-Z0-9ء-ي\s\-/_.,:+#()]+$/;

/**
 * Cleans an OEM value without removing punctuation that is meaningful in
 * automotive identifiers. Integer spreadsheet codes formatted as `14733.00`
 * are reduced to `14733`, while genuine decimal-bearing codes stay intact.
 */
export function sanitizeAndNormalizeOem(rawOem: unknown): string {
  if (rawOem === null || rawOem === undefined) return "";
  let value = normalizeDigits(String(rawOem))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
  if (/^\d+\.0+$/.test(value)) value = value.replace(/\.0+$/, "");
  return value;
}

export function isSupportedOem(value: string): boolean {
  return OEM_REGEX.test(value);
}

/**
 * OEM identifiers are operational codes, not prose. Keep them continuous so RTL
 * layouts cannot reorder legacy ETK chunks (e.g. 17 11 8 484 638) visually.
 * Valid separators such as / and - remain intact for display.
 */
export function formatOemNumber(oem?: string | null): string {
  if (!oem) return "-";
  return sanitizeAndNormalizeOem(oem).replace(/\s+/g, "").toUpperCase();
}

/** Stable comparison key for OEM searching across spaces, hyphens, slashes, dots, and underscores. */
export function sanitizeOemForSearch(oem: string): string {
  return String(oem).replace(/[\s\-_/\.]/g, "").toUpperCase();
}

export function normalizeOemNumber(oem: string): string {
  return sanitizeOemForSearch(oem);
}

/** BMW VINs are 17 chars and never contain I, O or Q. */
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isValidVin(vin: string): boolean {
  return VIN_REGEX.test(vin.toUpperCase());
}

export const ARABIC_LABELS = {
  role: {
    SUPER_ADMIN: "مدير النظام",
    MANAGER: "مدير",
    CASHIER: "كاشير",
    STOREKEEPER: "أمين مخزن",
  },
  accountType: {
    CUSTOMER: "عميل",
    WORKSHOP_BMW: "ورشة BMW",
    SUPPLIER: "مورد",
    EXPENSE: "مصروف",
    EMPLOYEE: "موظف",
    ADVANCE: "سلفة",
    PARTNER: "شريك",
    OTHER: "جهة أخرى",
  },
  invoiceType: {
    SALE: "فاتورة بيع",
    PURCHASE: "فاتورة شراء",
    SALE_RETURN: "مرتجع بيع",
    PURCHASE_RETURN: "مرتجع شراء",
    PRICE_QUOTATION: "عرض سعر",
  },
  paymentStatus: {
    PAID: "مدفوعة",
    PARTIAL: "مدفوعة جزئياً",
    CREDIT: "آجل",
  },
  paymentMethod: {
    CASH: "نقدي",
    VISA: "فيزا / شبكة",
    SPLIT: "دفع مقسّم",
    ON_ACCOUNT: "على الحساب",
  },
  treasuryType: {
    CASH_DRAWER: "درج نقدية",
    BANK_ACCOUNT: "حساب بنكي",
    POS_TERMINAL: "ماكينة دفع",
    WALLET: "محفظة إلكترونية",
    INSTAPAY: "إنستا باي",
    OTHER: "أخرى",
  },
  transactionType: {
    RECEIPT: "سند قبض",
    PAYMENT: "سند صرف",
    TRANSFER: "تحويل",
  },
  stockReason: {
    PURCHASE: "شراء",
    SALE: "بيع",
    SALE_RETURN: "مرتجع بيع",
    PURCHASE_RETURN: "مرتجع شراء",
    MANUAL_ADJUSTMENT: "تسوية يدوية",
    OPENING_BALANCE: "رصيد افتتاحي",
    STOCKTAKE: "جرد",
  },
} as const;
