import "server-only";
import { Prisma, type TreasuryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num, startOfToday } from "@/lib/utils";

export interface TreasuryRow {
  id: string;
  name: string;
  type: TreasuryType;
  currentBalance: number;
  isActive: boolean;
  isDefault: boolean;
  notes: string | null;
  todayIn: number;
  todayOut: number;
  openShift: { id: string; shiftNumber: string; openingBalance: number; openedAt: string; openedBy: string } | null;
}

export async function listTreasuries(): Promise<TreasuryRow[]> {
  const today = startOfToday();

  const [treasuries, signedFlows, shifts] = await Promise.all([
    prisma.treasury.findMany({ orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }] }),
    // RECEIPT/PAYMENT are stored as positive magnitudes; TRANSFER carries its sign.
    prisma.treasuryTransaction.groupBy({
      by: ["treasuryId", "type"],
      where: { createdAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.treasuryShift.findMany({
      where: { closedAt: null },
      select: {
        id: true,
        shiftNumber: true,
        treasuryId: true,
        openingBalance: true,
        openedAt: true,
        openedByUser: { select: { fullName: true } },
      },
    }),
  ]);

  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const f of signedFlows) {
    const amount = num(f._sum.amount);
    if (f.type === "RECEIPT") {
      inMap.set(f.treasuryId, (inMap.get(f.treasuryId) ?? 0) + amount);
    } else if (f.type === "PAYMENT") {
      outMap.set(f.treasuryId, (outMap.get(f.treasuryId) ?? 0) + amount);
    } else if (amount >= 0) {
      inMap.set(f.treasuryId, (inMap.get(f.treasuryId) ?? 0) + amount);
    } else {
      outMap.set(f.treasuryId, (outMap.get(f.treasuryId) ?? 0) + Math.abs(amount));
    }
  }

  const shiftMap = new Map(shifts.map((s) => [s.treasuryId, s]));

  return treasuries.map((t) => {
    const shift = shiftMap.get(t.id);
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      currentBalance: num(t.currentBalance),
      isActive: t.isActive,
      isDefault: t.isDefault,
      notes: t.notes,
      todayIn: inMap.get(t.id) ?? 0,
      todayOut: outMap.get(t.id) ?? 0,
      openShift: shift
        ? {
            id: shift.id,
            shiftNumber: shift.shiftNumber,
            openingBalance: num(shift.openingBalance),
            openedAt: shift.openedAt.toISOString(),
            openedBy: shift.openedByUser.fullName,
          }
        : null,
    };
  });
}

export async function listTreasuryTransactions(limit = 40, treasuryId?: string) {
  const rows = await prisma.treasuryTransaction.findMany({
    where: treasuryId ? { treasuryId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      transactionNumber: true,
      type: true,
      amount: true,
      description: true,
      createdAt: true,
      treasury: { select: { name: true } },
      account: { select: { name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    transactionNumber: r.transactionNumber,
    type: r.type,
    amount: num(r.amount),
    description: r.description,
    treasuryName: r.treasury.name,
    accountName: r.account?.name ?? null,
    invoiceNumber: r.invoice?.invoiceNumber ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Z-Report: full end-of-shift reconciliation for one treasury. */
export async function getZReport(treasuryId: string) {
  const treasury = await prisma.treasury.findUnique({
    where: { id: treasuryId },
    select: { id: true, name: true, type: true, currentBalance: true },
  });
  if (!treasury) return null;

  const shift = await prisma.treasuryShift.findFirst({
    where: { treasuryId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      shiftNumber: true,
      openingBalance: true,
      bookOpeningBalance: true,
      openedAt: true,
      openedByUser: { select: { fullName: true } },
    },
  });

  const since = shift?.openedAt ?? startOfToday();

  const [flows, invoicesByMethod] = await Promise.all([
    prisma.treasuryTransaction.groupBy({
      by: ["type"],
      where: { treasuryId, createdAt: { gte: since } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["paymentMethod"],
      where: { treasuryId, isVoided: false, type: "SALE", createdAt: { gte: since } },
      _sum: { grandTotal: true, paidAmount: true },
      _count: { _all: true },
    }),
  ]);

  const receipts = num(flows.find((f) => f.type === "RECEIPT")?._sum.amount);
  const payments = num(flows.find((f) => f.type === "PAYMENT")?._sum.amount);
  const transfers = num(flows.find((f) => f.type === "TRANSFER")?._sum.amount);

  /**
   * Reconcile against the treasury's own balance at open time, not the cashier's
   * declared figure. With no open shift we derive the period's starting balance
   * by backing today's flows out of the current balance — otherwise the report
   * showed a variance equal to the entire carried-forward balance.
   */
  const currentBalance = num(treasury.currentBalance);
  const opening = shift
    ? num(shift.bookOpeningBalance)
    : currentBalance - receipts + payments - transfers;

  // Invoice count is already available per payment method; no extra query.
  const invoiceCount = invoicesByMethod.reduce((sum, m) => sum + m._count._all, 0);

  return {
    treasury: {
      id: treasury.id,
      name: treasury.name,
      type: treasury.type,
      currentBalance,
    },
    shift: shift
      ? {
          id: shift.id,
          shiftNumber: shift.shiftNumber,
          openingBalance: num(shift.openingBalance),
          bookOpeningBalance: num(shift.bookOpeningBalance),
          openedAt: shift.openedAt.toISOString(),
          openedBy: shift.openedByUser.fullName,
        }
      : null,
    periodStart: since.toISOString(),
    receipts,
    payments,
    transfers,
    openingBalance: opening,
    expectedBalance: opening + receipts - payments + transfers,
    invoiceCount,
    byPaymentMethod: invoicesByMethod.map((m) => ({
      method: m.paymentMethod,
      count: m._count._all,
      total: num(m._sum.grandTotal),
      collected: num(m._sum.paidAmount),
    })),
  };
}

export async function getClosedShifts(limit = 15) {
  const shifts = await prisma.treasuryShift.findMany({
    where: { closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    take: limit,
    select: {
      id: true,
      shiftNumber: true,
      openingBalance: true,
      closingBalance: true,
      countedCash: true,
      varianceAmount: true,
      openedAt: true,
      closedAt: true,
      treasury: { select: { name: true } },
      openedByUser: { select: { fullName: true } },
    },
  });
  return shifts.map((s) => ({
    id: s.id,
    shiftNumber: s.shiftNumber,
    treasuryName: s.treasury.name,
    openedBy: s.openedByUser.fullName,
    openingBalance: num(s.openingBalance),
    closingBalance: num(s.closingBalance),
    countedCash: num(s.countedCash),
    varianceAmount: num(s.varianceAmount),
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
  }));
}
