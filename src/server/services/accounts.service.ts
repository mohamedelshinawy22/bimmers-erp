import "server-only";
import type { AccountType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/utils";

export interface AccountRow {
  id: string;
  accountNumber: string;
  name: string;
  type: AccountType;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  creditLimit: number;
  currentBalance: number;
  /** Positive number = the account owes the shop. */
  debt: number;
  creditUtilizationPercent: number | null;
  defaultPriceTier: string;
  isActive: boolean;
  vehicleCount: number;
  openInvoiceCount: number;
}

export async function listAccounts(options: {
  query?: string;
  type?: AccountType | "ALL";
  debtorsOnly?: boolean;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: AccountRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));

  const and: Prisma.AccountWhereInput[] = [];
  if (options.query) {
    const q = options.query.trim();
    and.push({
      OR: [
        { name: { contains: q } },
        { accountNumber: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { taxNumber: { contains: q } },
      ],
    });
  }
  if (options.type && options.type !== "ALL") and.push({ type: options.type });
  if (options.debtorsOnly) and.push({ currentBalance: { lt: 0 } });

  const where: Prisma.AccountWhereInput = and.length ? { AND: and } : {};

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: [{ currentBalance: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        // `invoices` deliberately omitted: the lifetime count was aggregated on
        // every page load and never rendered. Open invoices come from the single
        // groupBy below.
        _count: { select: { vehicles: true } },
      },
    }),
    prisma.account.count({ where }),
  ]);

  const openCounts = await prisma.invoice.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      isVoided: false,
      paymentStatus: { in: ["CREDIT", "PARTIAL"] },
    },
    _count: { _all: true },
  });
  const openMap = new Map(openCounts.map((o) => [o.accountId, o._count._all]));

  return {
    rows: accounts.map((a) => {
      const balance = num(a.currentBalance);
      const limit = num(a.creditLimit);
      const debt = balance < 0 ? Math.abs(balance) : 0;
      return {
        id: a.id,
        accountNumber: a.accountNumber,
        name: a.name,
        type: a.type,
        phone: a.phone,
        email: a.email,
        taxNumber: a.taxNumber,
        creditLimit: limit,
        currentBalance: balance,
        debt,
        creditUtilizationPercent: limit > 0 ? Math.min(999, (debt / limit) * 100) : null,
        defaultPriceTier: a.defaultPriceTier,
        isActive: a.isActive,
        vehicleCount: a._count.vehicles,
        openInvoiceCount: openMap.get(a.id) ?? 0,
      };
    }),
    total,
    page,
    pageSize,
  };
}

/**
 * POS account picker payload.
 *
 * Vehicles are NOT embedded: loading 300 accounts × up to 25 vehicles (each with
 * nested chassis/engine) meant up to ~7,500 vehicle objects queried and
 * serialized into the RSC payload on every POS load and after every completed
 * sale, when only the selected account's vehicles are ever displayed. They are
 * fetched on demand by `getAccountVehicles`.
 */
export async function getPosAccounts(limit = 500) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true, type: { in: ["CUSTOMER", "WORKSHOP_BMW"] } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      accountNumber: true,
      name: true,
      type: true,
      creditLimit: true,
      currentBalance: true,
      defaultPriceTier: true,
      _count: { select: { vehicles: true } },
    },
  });

  return accounts.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    name: a.name,
    type: a.type,
    creditLimit: num(a.creditLimit),
    currentBalance: num(a.currentBalance),
    defaultPriceTier: a.defaultPriceTier,
    vehicleCount: a._count.vehicles,
  }));
}

export type PosAccount = Awaited<ReturnType<typeof getPosAccounts>>[number];

export interface AccountVehicle {
  id: string;
  vin: string;
  plateNumber: string | null;
  modelYear: number | null;
  chassisCode: string | null;
  series: string | null;
  engineCode: string | null;
}

/** Vehicles for one account — loaded only when that account is selected. */
export async function getAccountVehicles(accountId: string, limit = 50): Promise<AccountVehicle[]> {
  const vehicles = await prisma.customerVehicle.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      vin: true,
      plateNumber: true,
      modelYear: true,
      chassis: { select: { code: true, series: true } },
      engine: { select: { code: true } },
    },
  });
  return vehicles.map((v) => ({
    id: v.id,
    vin: v.vin,
    plateNumber: v.plateNumber,
    modelYear: v.modelYear,
    chassisCode: v.chassis?.code ?? null,
    series: v.chassis?.series ?? null,
    engineCode: v.engine?.code ?? null,
  }));
}

/** Account statement: chronological invoices + treasury movements. */
export async function getAccountStatement(accountId: string, limit = 60) {
  const [account, invoices, transactions] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, accountNumber: true, currentBalance: true, creditLimit: true, type: true },
    }),
    prisma.invoice.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        grandTotal: true,
        paidAmount: true,
        remainingAmount: true,
        paymentStatus: true,
        isVoided: true,
        createdAt: true,
      },
    }),
    prisma.treasuryTransaction.findMany({
      where: { accountId },
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
      },
    }),
  ]);

  if (!account) return null;

  return {
    account: {
      id: account.id,
      name: account.name,
      accountNumber: account.accountNumber,
      type: account.type,
      currentBalance: num(account.currentBalance),
      creditLimit: num(account.creditLimit),
    },
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      type: i.type,
      grandTotal: num(i.grandTotal),
      paidAmount: num(i.paidAmount),
      remainingAmount: num(i.remainingAmount),
      paymentStatus: i.paymentStatus,
      isVoided: i.isVoided,
      createdAt: i.createdAt.toISOString(),
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      transactionNumber: t.transactionNumber,
      type: t.type,
      amount: num(t.amount),
      description: t.description,
      treasuryName: t.treasury.name,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function getVehicleFormOptions() {
  const [chassis, engines] = await Promise.all([
    prisma.bmwChassis.findMany({
      orderBy: [{ series: "asc" }, { code: "asc" }],
      select: { id: true, code: true, series: true },
    }),
    prisma.bmwEngine.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, displacement: true } }),
  ]);
  return { chassis, engines };
}
