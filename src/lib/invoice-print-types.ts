export type InvoicePrintFormat = "A4_STANDARD" | "THERMAL_80";

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
  company: { name: string; phone: string; address: string; taxNumber: string; footer: string; logoUrl?: string | null };
  invoice: {
    id: string; invoiceNumber: string; type: string; createdAt: string; paymentMethod: string; paymentStatus: string;
    subtotal: number; discountAmount: number; taxAmount: number; grandTotal: number; paidAmount: number; remainingAmount: number;
    notes?: string | null; isVoided: boolean; voidReason?: string | null; treasuryName?: string | null; cashierName?: string | null;
    accountBalanceBefore?: number | null; accountBalanceAfter?: number | null; verificationUrl: string;
  };
  account: { name: string; accountNumber: string; phone?: string | null; taxNumber?: string | null; vehicleLabel?: string | null };
  lines: InvoicePrintLine[];
}

export const PRINT_FORMATS: Array<{ value: InvoicePrintFormat; label: string }> = [
  { value: "A4_STANDARD", label: "A4 رسمي" },
  { value: "THERMAL_80", label: "حراري 80 مم" },
];
