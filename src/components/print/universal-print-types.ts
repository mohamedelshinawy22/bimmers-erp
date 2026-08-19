import type { AccountStatementPrintData } from "./templates/AccountStatementTemplate";

export type PrintDocumentType = "invoice" | "statement" | "part" | "daily_report";
export type UniversalPrintTemplate = "modern" | "classic" | "thermal-80mm";

export interface UniversalPrintOptions {
  template: UniversalPrintTemplate;
  showBalance: boolean;
  showPartMeta: boolean;
}

export interface PartLedgerPrintData {
  company: {
    name: string;
    commercialName?: string;
    address?: string;
    phonePrimary?: string;
    phoneSecondary?: string;
    taxNumber?: string;
    logoUrl?: string | null;
  };
  part: {
    nameAr: string;
    oemNumber: string;
    stockQuantity: number;
    brandNames: string[];
    categoryName?: string;
    chassisCodes?: string[];
    barcode?: string | null;
    retailPrice?: number | null;
  };
  filters: { from?: string; to?: string; reason?: string; bin?: string };
  totals: { inbound: number; outbound: number; cost: number; sales: number };
  rows: Array<{
    id: string;
    createdAt: string;
    reason: string;
    reasonLabel: string;
    quantityDelta: number;
    balanceAfter: number;
    unitSalePrice: number | null;
    totalSalePrice: number | null;
    unitCost: number;
    invoiceNumber: string | null;
    partyName: string | null;
    binCode: string | null;
    note: string | null;
    invoiceIsVoided: boolean;
  }>;
}

export interface PartCatalogPrintData {
  company: {
    name: string;
    commercialName?: string;
    address?: string;
    phonePrimary?: string;
    phoneSecondary?: string;
    taxNumber?: string;
    logoUrl?: string | null;
  };
  title: string;
  parts: Array<{
    id: string;
    nameAr: string;
    oemNumber: string;
    brandName: string;
    category: string;
    barcode: string | null;
    stockQuantity: number;
    sellPriceRetail: number;
    chassisCodes: string[];
  }>;
}

export interface DailyReportPrintData {
  company: {
    name: string;
    commercialName?: string;
    address?: string;
    phonePrimary?: string;
    phoneSecondary?: string;
    taxNumber?: string;
    logoUrl?: string | null;
  };
  period: { from: string; to: string };
  filters: { operator?: string; warehouse?: string; treasury?: string };
  operations: Array<{ key: string; label: string; count: number; total: number; paid: number; remaining: number }>;
  treasurySummary: Array<{ key: string; label: string; amount: number }>;
  detailRows: Array<{
    id: string;
    reference: string;
    at: string;
    party: string;
    description: string;
    total: number;
    paid: number;
    remaining: number;
    treasury: string;
    warehouse: string;
    user: string;
  }>;
}

export type StatementPrintData = AccountStatementPrintData;

export const UNIVERSAL_PRINT_TEMPLATES: Array<{ value: UniversalPrintTemplate; label: string; description: string }> = [
  { value: "modern", label: "عصري", description: "تصميم ملون مع ملخصات مرئية وبيانات المنشأة" },
  { value: "classic", label: "كلاسيكي", description: "نموذج رسمي عالي التباين للطابعات الليزر" },
  { value: "thermal-80mm", label: "حراري 80 مم", description: "إيصال مختصر محسّن لطابعات نقاط البيع" },
];

export function printTemplateStorageKey(documentType: PrintDocumentType) {
  return `bimmer_print_template_${documentType}`;
}
