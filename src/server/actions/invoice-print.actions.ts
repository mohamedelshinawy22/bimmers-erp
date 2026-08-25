"use server";

import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { getInvoiceDetail } from "@/server/services/invoices.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { getAccountDetailedLedger } from "@/server/services/accounts.service";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";

export async function getInvoicePrintDataAction(invoiceId: string): Promise<ActionResult<InvoicePrintData>> {
  try {
    await requirePermission("invoice.read");
    const tenant = await getTenantDbFromSession();
    const [invoice, company] = await tenant.run(() => Promise.all([getInvoiceDetail(tenant.prisma, invoiceId), getCompanyProfile(tenant.prisma)]));
    if (!invoice) return { success: false, error: "الفاتورة غير موجودة." };
    const isReturn = invoice.type === "SALE_RETURN" || invoice.type === "PURCHASE_RETURN";
    const needsLedgerFallback = isReturn || (invoice.type === "PURCHASE" && (invoice.accountBalanceBefore === null || invoice.accountBalanceAfter === null));
    const historicLedger = needsLedgerFallback ? await getAccountDetailedLedger(invoice.account.id) : null;
    const linkedLedgerRows = historicLedger?.rows.filter((row) => row.invoiceId === invoice.id) ?? [];
    const ledgerDocumentRow = linkedLedgerRows.find((row) => row.type === invoice.type && row.documentKind === "INVOICE");
    const reconstructedBalanceBefore = ledgerDocumentRow
      ? ledgerDocumentRow.runningBalance - ledgerDocumentRow.credit + ledgerDocumentRow.debit
      : null;
    const balanceBefore = invoice.accountBalanceBefore ?? reconstructedBalanceBefore;
    const balanceAfter = invoice.accountBalanceAfter ?? ledgerDocumentRow?.runningBalance ?? invoice.account.currentBalance;
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    const verificationUrl = `${origin.replace(/\/$/, "")}/invoices/${invoice.id}`;
    const qrPayload = JSON.stringify({ seller: company.name, taxNumber: company.taxNumber || null, invoiceNumber: invoice.invoiceNumber, documentType: invoice.type, sourceInvoiceNumber: invoice.sourceInvoiceNumber, issuedAt: invoice.createdAt, total: invoice.grandTotal, verificationUrl });
    return ok({
      company: { name: company.name, commercialName: company.commercialName, phone: company.phonePrimary, phonePrimary: company.phonePrimary, phoneSecondary: company.phoneSecondary, address: company.address, taxNumber: company.taxNumber, commercialRegister: company.commercialRegister, footer: company.invoiceFooter, logoUrl: company.logoUrl || null },
      invoice: {
        id: invoice.id, invoiceNumber: invoice.invoiceNumber, type: invoice.type, createdAt: invoice.createdAt,
        paymentMethod: invoice.paymentMethod, paymentStatus: invoice.paymentStatus, subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount, taxAmount: invoice.taxAmount, grandTotal: invoice.grandTotal,
        paidAmount: invoice.paidAmount, remainingAmount: invoice.remainingAmount, notes: invoice.notes,
        isVoided: invoice.isVoided, voidReason: invoice.voidReason, treasuryName: invoice.treasury?.name ?? null,
        cashierName: invoice.user.fullName, accountBalanceBefore: balanceBefore, accountBalanceAfter: balanceAfter, sourceInvoiceNumber: invoice.sourceInvoiceNumber, verificationUrl, qrPayload,
      },
      account: { name: invoice.account.name, accountNumber: invoice.account.accountNumber, phone: invoice.account.phone, taxNumber: invoice.account.taxNumber, vehicleLabel: invoice.vehicleLabel },
      lines: invoice.items.map((item) => ({ id: item.id, oemNumber: item.oemNumber, nameAr: item.nameAr, brandName: item.brandName, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice, lineDiscount: 0, chassisLabel: null })),
    });
  } catch (error) {
    return toActionError(error, "getInvoicePrintDataAction");
  }
}
