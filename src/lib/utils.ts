import { Prisma } from "@prisma/client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    numberingSystem: "latn",
  }).format(date);
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(date);
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

/** 34116859066 → 34 11 6 859 066 (BMW ETK display convention). */
export function formatOemNumber(oem: string): string {
  const clean = oem.replace(/\D/g, "");
  if (clean.length !== 11) return oem;
  return `${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 11)}`;
}

export function normalizeOemNumber(oem: string): string {
  return oem.replace(/[\s\-.]/g, "").toUpperCase();
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
