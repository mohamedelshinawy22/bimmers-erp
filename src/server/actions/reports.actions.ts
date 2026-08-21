"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError } from "@/lib/action-result";
import { dailyMovementReportSchema, type DailyMovementReportInput } from "@/lib/validations/reports";

const n = (value: unknown) => Number(value ?? 0);

type InvoiceKind = "SALE" | "SALE_RETURN" | "PURCHASE" | "PURCHASE_RETURN";

export async function getDailyMovementReportAction(raw: DailyMovementReportInput) {
  try {
    await requirePermission("reports.dailyMovement");
    const input = dailyMovementReportSchema.parse(raw);
    const operatorId = input.operatorId || undefined;
    const warehouseName = input.warehouseName || undefined;
    const treasuryScope = input.treasuryIds.length ? { in: input.treasuryIds } : undefined;
    const period = { gte: input.fromDate, lt: input.toDate };
    const warehouseInvoiceScope = warehouseName ? { items: { some: { part: { binLocation: { warehouseName } } } } } : {};
    const warehouseStockScope = warehouseName ? { part: { binLocation: { warehouseName } } } : {};

    const [invoices, ledger, stockMoves, priorLedger, users, treasuries, warehouseRows] = await Promise.all([
      prisma.invoice.findMany({
        where: { isVoided: false, createdAt: period, ...(operatorId ? { userId: operatorId } : {}), ...(treasuryScope ? { treasuryId: treasuryScope } : {}), ...warehouseInvoiceScope },
        select: { id: true, invoiceNumber: true, type: true, createdAt: true, grandTotal: true, paidAmount: true, remainingAmount: true, paymentMethod: true, treasury: { select: { id: true, name: true } }, user: { select: { id: true, fullName: true, username: true } }, account: { select: { name: true } }, items: { select: { quantity: true, partNameSnapshot: true, oemNumberSnapshot: true, part: { select: { nameAr: true, oemNumber: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.treasuryTransaction.findMany({
        where: { createdAt: period, ...(operatorId ? { createdByUser: operatorId } : {}), ...(treasuryScope ? { treasuryId: treasuryScope } : {}), ...(warehouseName ? { invoice: warehouseInvoiceScope } : {}) },
        select: { id: true, transactionNumber: true, invoiceId: true, type: true, category: true, amount: true, description: true, createdByUser: true, createdAt: true, treasury: { select: { id: true, name: true } }, account: { select: { name: true } }, invoice: { select: { invoiceNumber: true, type: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.stockMovement.findMany({
        where: { createdAt: period, ...(operatorId ? { performedById: operatorId } : {}), ...warehouseStockScope },
        select: { id: true, reason: true, quantityDelta: true, unitCost: true, note: true, createdAt: true, part: { select: { nameAr: true, oemNumber: true, binLocation: { select: { warehouseName: true, fullCode: true } } } }, performedBy: { select: { id: true, fullName: true, username: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.treasuryTransaction.findMany({
        where: { createdAt: { lt: input.fromDate }, ...(treasuryScope ? { treasuryId: treasuryScope } : {}) },
        select: { type: true, amount: true },
      }),
      prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true } }),
      prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.warehouseBin.findMany({ distinct: ["warehouseName"], orderBy: { warehouseName: "asc" }, select: { warehouseName: true } }),
    ]);

    const operatorNames = new Map(users.map((user) => [user.id, `${user.fullName} (@${user.username})`]));
    const signedLedger = (row: { type: "RECEIPT" | "PAYMENT" | "TRANSFER"; amount: unknown }) => row.type === "PAYMENT" ? -n(row.amount) : n(row.amount);
    const invoiceRows = (type: InvoiceKind) => invoices.filter((invoice) => invoice.type === type).map((invoice) => {
      const sign = type === "SALE_RETURN" || type === "PURCHASE_RETURN" ? -1 : 1;
      return {
        id: invoice.id, documentId: invoice.id, reference: invoice.invoiceNumber, at: invoice.createdAt.toISOString(), party: invoice.account.name,
        description: invoice.items.slice(0, 3).map((item) => `${item.part?.nameAr ?? item.partNameSnapshot ?? "صنف نصي"} (${item.part?.oemNumber ?? item.oemNumberSnapshot ?? "—"}) ×${item.quantity}`).join("، "),
        itemCount: invoice.items.reduce((total, item) => total + item.quantity, 0), total: sign * n(invoice.grandTotal), paid: sign * n(invoice.paidAmount), remaining: sign * n(invoice.remainingAmount),
        treasury: invoice.treasury?.name ?? "—", warehouse: warehouseName ?? "—", user: `${invoice.user.fullName} (@${invoice.user.username})`, source: type,
      };
    });
    const sales = invoiceRows("SALE"), saleReturns = invoiceRows("SALE_RETURN"), purchases = invoiceRows("PURCHASE"), purchaseReturns = invoiceRows("PURCHASE_RETURN");
    const sum = (rows: Array<{ total: number; paid: number; remaining: number }>) => rows.reduce((acc, row) => ({ total: acc.total + row.total, paid: acc.paid + row.paid, remaining: acc.remaining + row.remaining }), { total: 0, paid: 0, remaining: 0 });
    const saleTotals = sum(sales), saleReturnTotals = sum(saleReturns), purchaseTotals = sum(purchases), purchaseReturnTotals = sum(purchaseReturns);

    const treasuryRows = ledger.map((row) => ({
      id: row.id, documentId: row.invoiceId, reference: row.invoice?.invoiceNumber ?? row.transactionNumber, at: row.createdAt.toISOString(), party: row.account?.name ?? "—", description: row.description,
      total: signedLedger(row), paid: signedLedger(row), remaining: 0, treasury: row.treasury.name, warehouse: "—", user: operatorNames.get(row.createdByUser) ?? "مستخدم غير معروف",
      source: row.type === "TRANSFER" ? "تحويل خزينة" : row.type === "RECEIPT" ? (row.invoiceId ? "قبض مرتبط بفاتورة" : "سند قبض") : row.invoiceId ? "صرف مرتبط بفاتورة" : "سند صرف",
      transactionType: row.type,
    }));
    const receiptsRows = treasuryRows.filter((row) => row.transactionType === "RECEIPT");
    const paymentsRows = treasuryRows.filter((row) => row.transactionType === "PAYMENT");
    const stocktakeRows = stockMoves.filter((row) => row.reason === "STOCKTAKE").map((row) => ({
      id: row.id, documentId: row.invoice?.id ?? null, reference: row.invoice?.invoiceNumber ?? `STK-${row.id.slice(0, 8)}`, at: row.createdAt.toISOString(), party: "—", description: row.note ?? `${row.part.nameAr} (${row.part.oemNumber})`,
      total: row.quantityDelta * n(row.unitCost), paid: 0, remaining: 0, treasury: "—", warehouse: row.part.binLocation?.warehouseName ?? "غير محدد", user: `${row.performedBy.fullName} (@${row.performedBy.username})`, source: "جرد مخزن", quantityDelta: row.quantityDelta,
    }));
    const adjustmentRows = stockMoves.filter((row) => row.reason === "MANUAL_ADJUSTMENT").map((row) => ({
      id: row.id, documentId: row.invoice?.id ?? null, reference: row.invoice?.invoiceNumber ?? `ADJ-${row.id.slice(0, 8)}`, at: row.createdAt.toISOString(), party: "—", description: row.note ?? `${row.part.nameAr} (${row.part.oemNumber})`,
      total: row.quantityDelta * n(row.unitCost), paid: 0, remaining: 0, treasury: "—", warehouse: row.part.binLocation?.warehouseName ?? "غير محدد", user: `${row.performedBy.fullName} (@${row.performedBy.username})`, source: "تسوية مخزن", quantityDelta: row.quantityDelta,
    }));

    const operation = (key: string, label: string, rows: Array<{ total: number; paid: number; remaining: number }>) => ({ key, label, count: rows.length, ...sum(rows) });
    const cashSales = ledger.filter((row) => row.type === "RECEIPT" && row.invoice?.type === "SALE").reduce((total, row) => total + n(row.amount), 0);
    const cashSaleRefunds = ledger.filter((row) => row.type === "PAYMENT" && row.invoice?.type === "SALE_RETURN").reduce((total, row) => total - n(row.amount), 0);
    const cashPurchases = ledger.filter((row) => row.type === "PAYMENT" && row.invoice?.type === "PURCHASE").reduce((total, row) => total - n(row.amount), 0);
    const cashPurchaseReturns = ledger.filter((row) => row.type === "RECEIPT" && row.invoice?.type === "PURCHASE_RETURN").reduce((total, row) => total + n(row.amount), 0);
    const generalReceipts = ledger.filter((row) => row.type === "RECEIPT" && !row.invoiceId).reduce((total, row) => total + n(row.amount), 0);
    const generalPayments = ledger.filter((row) => row.type === "PAYMENT" && !row.invoiceId).reduce((total, row) => total - n(row.amount), 0);
    const invoiceExpenses = ledger.filter((row) => row.type === "PAYMENT" && row.invoiceId && row.invoice?.type !== "PURCHASE" && row.invoice?.type !== "SALE_RETURN").reduce((total, row) => total - n(row.amount), 0);
    const openingBalance = priorLedger.reduce((total, row) => total + signedLedger(row), 0);
    const netMovement = ledger.reduce((total, row) => total + signedLedger(row), 0);

    return ok({
      scope: { fromDate: input.fromDate.toISOString(), toDate: input.toDate.toISOString(), operatorId: operatorId ?? null, warehouseName: warehouseName ?? null, treasuryIds: input.treasuryIds },
      filterOptions: { users, treasuries, warehouses: warehouseRows.map((row) => row.warehouseName) },
      operations: [operation("sales", "بيع", sales), operation("saleReturns", "مرتجع بيع", saleReturns), operation("purchases", "شراء", purchases), operation("purchaseReturns", "مرتجع شراء", purchaseReturns), operation("receipts", "قبض", receiptsRows), operation("payments", "صرف", paymentsRows), operation("stocktakes", "جرد مخزن", stocktakeRows), operation("branchTransfers", "تحويل لمخزن", []), operation("adjustments", "تسوية مخزن", adjustmentRows)],
      treasurySummary: [
        { key: "cashSales", label: "بيع نقدي", amount: cashSales }, { key: "cashSaleRefunds", label: "مرتجع بيع نقدي", amount: cashSaleRefunds },
        { key: "cashPurchases", label: "شراء نقدي", amount: cashPurchases }, { key: "cashPurchaseReturns", label: "مرتجع شراء نقدي", amount: cashPurchaseReturns },
        { key: "receipts", label: "قبض", amount: generalReceipts }, { key: "payments", label: "صرف", amount: generalPayments },
        { key: "invoiceExpenses", label: "مصروف فواتير", amount: invoiceExpenses }, { key: "opening", label: "رصيد سابق", amount: openingBalance },
        { key: "net", label: "صافي حركة الخزينة", amount: netMovement }, { key: "closing", label: "الرصيد النهائي", amount: openingBalance + netMovement },
      ],
      drillDowns: { sales, saleReturns, purchases, purchaseReturns, receipts: receiptsRows, payments: paymentsRows, stocktakes: stocktakeRows, adjustments: adjustmentRows, treasuryMovements: treasuryRows },
    });
  } catch (error) {
    return toActionError(error, "getDailyMovementReportAction");
  }
}
