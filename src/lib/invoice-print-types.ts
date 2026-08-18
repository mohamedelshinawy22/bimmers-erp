export type InvoicePrintFormat = "A4_STANDARD" | "A5" | "THERMAL_80" | "THERMAL_57" | "E_INVOICE";

export interface InvoicePrintLine {
  id: string;
  oemNumber: string;
  nameAr: string;
  brandName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  lineDiscount: number;
  chassisLabel?: string | null;
}

export interface InvoicePrintData {
  company: { name: string; commercialName: string; phone: string; phonePrimary: string; phoneSecondary: string; address: string; taxNumber: string; commercialRegister: string; footer: string; logoUrl?: string | null };
  invoice: {
    id: string; invoiceNumber: string; type: string; createdAt: string; paymentMethod: string; paymentStatus: string;
    subtotal: number; discountAmount: number; taxAmount: number; grandTotal: number; paidAmount: number; remainingAmount: number;
    notes?: string | null; isVoided: boolean; voidReason?: string | null; treasuryName?: string | null; cashierName?: string | null;
    accountBalanceBefore?: number | null; accountBalanceAfter?: number | null; verificationUrl: string; qrPayload: string;
  };
  account: { name: string; accountNumber: string; phone?: string | null; taxNumber?: string | null; vehicleLabel?: string | null };
  lines: InvoicePrintLine[];
}

export const PRINT_FORMATS: Array<{ value: InvoicePrintFormat; label: string }> = [
  { value: "A4_STANDARD", label: "A4 رسمي" },
  { value: "A5", label: "A5 نصف صفحة" },
  { value: "THERMAL_80", label: "حراري 80 مم" },
  { value: "THERMAL_57", label: "حراري 57 مم" },
  { value: "E_INVOICE", label: "فاتورة إلكترونية" },
];
