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
    const [sales, purchases, receipts, payments] = await Promise.all([
      prisma.invoice.aggregate({ where: { type: "SALE", isVoided: false, createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) }, _count: { _all: true }, _sum: { grandTotal: true, paidAmount: true, remainingAmount: true } }),
      prisma.invoice.aggregate({ where: { type: "PURCHASE", isVoided: false, createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) }, _count: { _all: true }, _sum: { grandTotal: true, paidAmount: true, remainingAmount: true } }),
      prisma.treasuryTransaction.aggregate({ where: { type: "RECEIPT", createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.treasuryTransaction.aggregate({ where: { type: "PAYMENT", createdAt: period, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const n = (value: unknown) => Number(value ?? 0);
    const salesCash = n(sales._sum.paidAmount); const purchaseCash = n(purchases._sum.paidAmount); const receiptTotal = n(receipts._sum.amount); const paymentTotal = n(payments._sum.amount);
    return ok({
      scope: { fromDate: input.fromDate.toISOString(), toDate: input.toDate.toISOString(), treasuryIds: input.treasuryIds },
      operations: [
        { key: "sales", label: "بيع", count: sales._count._all, total: n(sales._sum.grandTotal), cash: salesCash, credit: n(sales._sum.remainingAmount) },
        { key: "purchases", label: "شراء", count: purchases._count._all, total: n(purchases._sum.grandTotal), cash: purchaseCash, credit: n(purchases._sum.remainingAmount) },
        { key: "receipts", label: "قبض", count: receipts._count._all, total: receiptTotal, cash: receiptTotal, credit: 0 },
        { key: "payments", label: "صرف", count: payments._count._all, total: paymentTotal, cash: paymentTotal, credit: 0 },
      ],
      reconciliation: { cashSales: salesCash, cashPurchases: purchaseCash, receipts: receiptTotal, payments: paymentTotal, netMovement: salesCash + receiptTotal - purchaseCash - paymentTotal },
    });
  } catch (error) { return toActionError(error, "getDailyMovementReportAction"); }
}
