"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError } from "@/lib/action-result";
import { treasuryReportSchema, type TreasuryReportInput } from "@/lib/validations/treasury";

export async function getDailyMovementReportAction(raw: TreasuryReportInput) {
  try {
    await requirePermission("reports.dailyMovement");
    const input = treasuryReportSchema.parse(raw);
    const treasuryScope = input.treasuryIds.length ? { in: input.treasuryIds } : undefined;
    const period = { gte: input.fromDate, lt: input.toDate };
    const invoiceWhere = { isVoided: false, createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) };
    const [invoices, ledger] = await Promise.all([
      prisma.invoice.findMany({ where: invoiceWhere, select: { id: true, invoiceNumber: true, type: true, createdAt: true, grandTotal: true, paidAmount: true, remainingAmount: true, paymentMethod: true, treasury: { select: { name: true } }, user: { select: { fullName: true } }, account: { select: { name: true } }, items: { select: { quantity: true, part: { select: { nameAr: true, oemNumber: true } } } } }, orderBy: { createdAt: "desc" } }),
      prisma.treasuryTransaction.findMany({ where: { createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) }, select: { transactionNumber: true, invoiceId: true, type: true, amount: true, description: true, createdAt: true, treasury: { select: { name: true } }, account: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    const n = (value: unknown) => Number(value ?? 0);
    const byType = (type: "SALE" | "SALE_RETURN" | "PURCHASE" | "PURCHASE_RETURN") => invoices.filter((invoice) => invoice.type === type).map((invoice) => ({ id: invoice.id, reference: invoice.invoiceNumber, at: invoice.createdAt.toISOString(), account: invoice.account.name, total: n(invoice.grandTotal), paid: n(invoice.paidAmount), remaining: n(invoice.remainingAmount), paymentMethod: invoice.paymentMethod, treasury: invoice.treasury?.name ?? null, user: invoice.user.fullName, itemCount: invoice.items.reduce((sum, item) => sum + item.quantity, 0), itemSummary: invoice.items.slice(0, 3).map((item) => `${item.part.nameAr} (${item.part.oemNumber}) ×${item.quantity}`).join("، ") }));
    const sales = byType("SALE"), saleReturns = byType("SALE_RETURN"), purchases = byType("PURCHASE"), purchaseReturns = byType("PURCHASE_RETURN");
    const sum = (rows: Array<{ total: number; paid: number; remaining: number }>) => rows.reduce((acc, row) => ({ total: acc.total + row.total, paid: acc.paid + row.paid, remaining: acc.remaining + row.remaining }), { total: 0, paid: 0, remaining: 0 });
    const saleTotals = sum(sales), purchaseTotals = sum(purchases), saleReturnTotals = sum(saleReturns), purchaseReturnTotals = sum(purchaseReturns);
    const receipts = ledger.filter((row) => row.type === "RECEIPT").reduce((total, row) => total + n(row.amount), 0);
    const payments = ledger.filter((row) => row.type === "PAYMENT").reduce((total, row) => total + n(row.amount), 0);
    const transferNet = ledger.filter((row) => row.type === "TRANSFER").reduce((total, row) => total + n(row.amount), 0);
    const invoiceReceipts = ledger.filter((row) => row.type === "RECEIPT" && row.invoiceId).reduce((total, row) => total + n(row.amount), 0);
    const manualReceipts = receipts - invoiceReceipts;
    const invoicePayments = ledger.filter((row) => row.type === "PAYMENT" && row.invoiceId).reduce((total, row) => total + n(row.amount), 0);
    const manualPayments = payments - invoicePayments;
    return ok({
      scope: { fromDate: input.fromDate.toISOString(), toDate: input.toDate.toISOString(), treasuryIds: input.treasuryIds },
      operations: [
        { key: "sales", label: "بيع", count: sales.length, ...saleTotals }, { key: "saleReturns", label: "مرتجع بيع", count: saleReturns.length, ...saleReturnTotals },
        { key: "purchases", label: "شراء", count: purchases.length, ...purchaseTotals }, { key: "purchaseReturns", label: "مرتجع شراء", count: purchaseReturns.length, ...purchaseReturnTotals },
        { key: "receipts", label: "قبض", count: ledger.filter((row) => row.type === "RECEIPT").length, total: receipts, paid: receipts, remaining: 0 }, { key: "payments", label: "صرف", count: ledger.filter((row) => row.type === "PAYMENT").length, total: payments, paid: payments, remaining: 0 },
      ],
      drillDowns: { sales, saleReturns, purchases, purchaseReturns, treasuryMovements: ledger.map((row) => ({ reference: row.transactionNumber, at: row.createdAt.toISOString(), source: row.type === "TRANSFER" ? "تحويل خزينة" : row.type === "RECEIPT" ? (row.invoiceId ? "تحصيل فاتورة" : "سند قبض مستقل") : row.invoiceId ? "سداد / رد فاتورة" : "سند صرف مستقل", description: row.description, treasury: row.treasury.name, account: row.account?.name ?? null, invoiceLinked: Boolean(row.invoiceId), amount: n(row.amount) })) },
      reconciliation: { invoiceReceipts, manualReceipts, invoicePayments, manualPayments, receipts, payments, transferNet, salesReturns: saleReturnTotals.paid, purchaseReturns: purchaseReturnTotals.paid, netMovement: receipts - payments + transferNet },
    });
  } catch (error) { return toActionError(error, "getDailyMovementReportAction"); }
}
