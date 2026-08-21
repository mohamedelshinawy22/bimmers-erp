import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/redis";
import { num, startOfToday, startOfYesterday } from "@/lib/utils";

export interface DashboardMetrics {
  salesToday: number;
  salesYesterday: number;
  salesDeltaPercent: number | null;
  invoiceCountToday: number;
  cashOnHand: number;
  totalLiquidity: number;
  workshopReceivables: number;
  overdueWorkshopCount: number;
  supplierPayables: number;
  lowStockCount: number;
  inventoryValue: number;
  grossProfitToday: number;
  openShift: { shiftNumber: string; treasuryName: string; openedAt: string } | null;
}

const EXCLUDE_VOIDED = { isVoided: false } satisfies Prisma.InvoiceWhereInput;

/**
 * Cockpit KPIs.
 *
 * Wrapped in the Redis cache with a short TTL: two of these queries are full
 * `PartItem` scans (the low-stock count and the inventory valuation both compare
 * or multiply columns, so no index can serve them). Every mutating action calls
 * `invalidateCache("dashboard")`, so the figures stay correct while repeat loads
 * within the TTL stop re-scanning the table.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  return cached("dashboard:metrics", 20, loadDashboardMetrics);
}

async function loadDashboardMetrics(): Promise<DashboardMetrics> {
  const today = startOfToday();
  const yesterday = startOfYesterday();

  const [
    salesTodayAgg,
    salesYesterdayAgg,
    treasuries,
    receivablesAgg,
    payablesAgg,
    overdueCount,
    lowStock,
    inventoryValueRows,
    profitRows,
    openShift,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...EXCLUDE_VOIDED, type: "SALE", createdAt: { gte: today } },
      _sum: { grandTotal: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { ...EXCLUDE_VOIDED, type: "SALE", createdAt: { gte: yesterday, lt: today } },
      _sum: { grandTotal: true },
    }),
    prisma.treasury.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true, currentBalance: true },
    }),
    // Negative balance = the account owes us.
    prisma.account.aggregate({
      where: { type: { in: ["CUSTOMER", "WORKSHOP_BMW"] }, currentBalance: { lt: 0 } },
      _sum: { currentBalance: true },
    }),
    // Positive balance on a supplier = we owe them.
    prisma.account.aggregate({
      where: { type: "SUPPLIER", currentBalance: { gt: 0 } },
      _sum: { currentBalance: true },
    }),
    prisma.account.count({
      where: {
        type: "WORKSHOP_BMW",
        currentBalance: { lt: 0 },
        invoices: {
          some: {
            ...EXCLUDE_VOIDED,
            paymentStatus: { in: ["CREDIT", "PARTIAL"] },
            // Older than 30 days = past due.
            createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        },
      },
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "PartItem" WHERE "stockQuantity" <= "minReorderLevel" AND "isActive" = true`,
    ),
    prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>(
      Prisma.sql`SELECT COALESCE(SUM("stockQuantity" * "buyPriceAvg"), 0) AS value FROM "PartItem" WHERE "isActive" = true AND "stockQuantity" > 0`,
    ),
    /**
     * Gross profit = line margin − invoice-level discount.
     *
     * `InvoiceItem.totalPrice` is net of the per-line discount only; the header
     * discount lives on the invoice. Summing line margins alone reported every
     * header discount as pure profit. The header discount is subtracted once per
     * invoice via a separate scalar subquery, not inside the line join (which
     * would multiply it by the line count).
     */
    prisma.$queryRaw<Array<{ profit: Prisma.Decimal | null }>>(
      Prisma.sql`
        SELECT COALESCE(line_margin, 0) - COALESCE(header_discount, 0) AS profit
        FROM (
          SELECT SUM(ii."totalPrice" - (ii."unitCostSnapshot" * ii."quantity")) AS line_margin
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i."id" = ii."invoiceId"
          WHERE i."type" = 'SALE' AND i."isVoided" = false AND i."createdAt" >= ${today}
        ) margins
        CROSS JOIN (
          SELECT SUM(i."discountAmount") AS header_discount
          FROM "Invoice" i
          WHERE i."type" = 'SALE' AND i."isVoided" = false AND i."createdAt" >= ${today}
        ) discounts
      `,
    ),
    prisma.treasuryShift.findFirst({
      where: { closedAt: null },
      orderBy: { openedAt: "desc" },
      select: { shiftNumber: true, openedAt: true, treasury: { select: { name: true } } },
    }),
  ]);

  const salesToday = num(salesTodayAgg._sum.grandTotal);
  const salesYesterday = num(salesYesterdayAgg._sum.grandTotal);

  const cashOnHand = treasuries
    .filter((t) => t.type === "CASH_DRAWER")
    .reduce((sum, t) => sum + num(t.currentBalance), 0);
  const totalLiquidity = treasuries.reduce((sum, t) => sum + num(t.currentBalance), 0);

  return {
    salesToday,
    salesYesterday,
    salesDeltaPercent:
      salesYesterday > 0 ? ((salesToday - salesYesterday) / salesYesterday) * 100 : null,
    invoiceCountToday: salesTodayAgg._count,
    cashOnHand,
    totalLiquidity,
    workshopReceivables: Math.abs(num(receivablesAgg._sum.currentBalance)),
    overdueWorkshopCount: overdueCount,
    supplierPayables: num(payablesAgg._sum.currentBalance),
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    inventoryValue: num(inventoryValueRows[0]?.value ?? 0),
    grossProfitToday: num(profitRows[0]?.profit ?? 0),
    openShift: openShift
      ? {
          shiftNumber: openShift.shiftNumber,
          treasuryName: openShift.treasury.name,
          openedAt: openShift.openedAt.toISOString(),
        }
      : null,
  };
}

export async function getRecentInvoices(limit = 8) {
  const invoices = await prisma.invoice.findMany({
    where: { type: { in: ["SALE", "PURCHASE"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      grandTotal: true,
      paymentStatus: true,
      isVoided: true,
      createdAt: true,
      account: { select: { name: true } },
      user: { select: { fullName: true } },
      _count: { select: { items: true } },
    },
  });
  return invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    type: i.type,
    grandTotal: num(i.grandTotal),
    paymentStatus: i.paymentStatus,
    isVoided: i.isVoided,
    createdAt: i.createdAt.toISOString(),
    accountName: i.account.name,
    userName: i.user.fullName,
    itemCount: i._count.items,
  }));
}

/** Sales by day for the cockpit sparkline. */
export async function getSalesTrend(days = 7) {
  const since = startOfToday();
  since.setDate(since.getDate() - (days - 1));

  const rows = await prisma.$queryRaw<Array<{ day: Date; total: Prisma.Decimal }>>(
    Prisma.sql`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM("grandTotal"), 0) AS total
      FROM "Invoice"
      WHERE "type" = 'SALE' AND "isVoided" = false AND "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  );

  const byDay = new Map(rows.map((r) => [new Date(r.day).toDateString(), num(r.total)]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    return { date: d.toISOString(), total: byDay.get(d.toDateString()) ?? 0 };
  });
}

export async function getTopSellingParts(limit = 5) {
  const since = startOfToday();
  since.setDate(since.getDate() - 30);

  const grouped = await prisma.invoiceItem.groupBy({
    by: ["partId"],
    where: { partId: { not: null }, invoice: { type: "SALE", isVoided: false, createdAt: { gte: since } } },
    _sum: { quantity: true, totalPrice: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return [];

  const parts = await prisma.partItem.findMany({
    where: { id: { in: grouped.flatMap((g) => g.partId ? [g.partId] : []) } },
    select: { id: true, nameAr: true, oemNumber: true, stockQuantity: true },
  });
  const map = new Map(parts.map((p) => [p.id, p]));

  return grouped.flatMap((g) => {
    if (!g.partId) return [];
    const part = map.get(g.partId);
    if (!part) return [];
    return [
      {
        partId: g.partId,
        nameAr: part.nameAr,
        oemNumber: part.oemNumber,
        stockQuantity: part.stockQuantity,
        soldQuantity: g._sum.quantity ?? 0,
        revenue: num(g._sum.totalPrice),
      },
    ];
  });
}
