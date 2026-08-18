"use server";

import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { getInvoiceDetail } from "@/server/services/invoices.service";
import { getCompanyProfile } from "@/server/services/settings.service";

export async function getInvoicePrintDataAction(invoiceId: string): Promise<ActionResult<InvoicePrintData>> {
  try {
    await requirePermission("invoice.read");
    const [invoice, company] = await Promise.all([getInvoiceDetail(invoiceId), getCompanyProfile()]);
    if (!invoice) return { success: false, error: "الفاتورة غير موجودة." };
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    const verificationUrl = `${origin.replace(/\/$/, "")}/invoices/${invoice.id}`;
    const qrPayload = JSON.stringify({ seller: company.name, taxNumber: company.taxNumber || null, invoiceNumber: invoice.invoiceNumber, issuedAt: invoice.createdAt, total: invoice.grandTotal, verificationUrl });
    return ok({
      company: { name: company.name, commercialName: company.commercialName, phone: company.phonePrimary, phonePrimary: company.phonePrimary, phoneSecondary: company.phoneSecondary, address: company.address, taxNumber: company.taxNumber, commercialRegister: company.commercialRegister, footer: company.invoiceFooter, logoUrl: company.logoUrl || null },
      invoice: {
        id: invoice.id, invoiceNumber: invoice.invoiceNumber, type: invoice.type, createdAt: invoice.createdAt,
        paymentMethod: invoice.paymentMethod, paymentStatus: invoice.paymentStatus, subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount, taxAmount: invoice.taxAmount, grandTotal: invoice.grandTotal,
        paidAmount: invoice.paidAmount, remainingAmount: invoice.remainingAmount, notes: invoice.notes,
        isVoided: invoice.isVoided, voidReason: invoice.voidReason, treasuryName: invoice.treasury?.name ?? null,
        cashierName: invoice.user.fullName, accountBalanceBefore: null, accountBalanceAfter: null, verificationUrl, qrPayload,
      },
      account: { name: invoice.account.name, accountNumber: invoice.account.accountNumber, phone: invoice.account.phone, taxNumber: invoice.account.taxNumber, vehicleLabel: invoice.vehicleLabel },
      lines: invoice.items.map((item) => ({ id: item.id, oemNumber: item.oemNumber, nameAr: item.nameAr, brandName: item.brandName, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice, lineDiscount: 0, chassisLabel: null })),
    });
  } catch (error) {
    return toActionError(error, "getInvoicePrintDataAction");
  }
}
