import "server-only";
import { Prisma, type AccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { money, num } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";

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
    const { variations } = normalizeSearchTerm(options.query);
    and.push({ OR: variations.flatMap((term) => [
      { name: { contains: term } },
      { accountNumber: { contains: term, mode: "insensitive" as const } },
      { phone: { contains: term } },
      { taxNumber: { contains: term } },
    ]) });
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

export type AccountLedgerMode = "SUMMARY" | "DETAILED";
export type AccountLedgerFilters = { from?: string; to?: string; movementTypes?: string[]; query?: string; mode?: AccountLedgerMode };
export type AccountLedgerItem = { id: string; oemNumber: string; nameAr: string; brandName: string; quantity: number; unitPrice: number; lineDiscount: number; totalPrice: number };
export type AccountLedgerRow = { id: string; createdAt: string; reference: string; type: string; typeLabel: string; debit: number; credit: number; runningBalance: number; treasuryName: string | null; note: string | null; documentId: string; documentKind: "INVOICE" | "TREASURY_TRANSACTION"; invoiceId: string | null; items: AccountLedgerItem[] };

/**
 * Produces one replayable account ledger. Account balances use the established
 * convention: a negative balance is receivable from the account; a positive
 * balance is payable/credit for the account. Debit reduces that balance and
 * credit increases it, so every row satisfies `balance += credit - debit`.
 */
export async function getAccountDetailedLedger(accountId: string, filters: AccountLedgerFilters = {}) {
  const [account, invoices, transactions] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, accountNumber: true, phone: true, type: true, creditLimit: true, currentBalance: true, createdAt: true } }),
    prisma.invoice.findMany({
      where: { accountId, isVoided: false },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        grandTotal: true,
        notes: true,
        createdAt: true,
        items: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            lineDiscount: true,
            totalPrice: true,
            part: { select: { nameAr: true, oemNumber: true, brand: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.treasuryTransaction.findMany({ where: { accountId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, transactionNumber: true, invoiceId: true, type: true, amount: true, description: true, createdAt: true, treasury: { select: { name: true } } } }),
  ]);
  if (!account) return null;

  type InternalRow = Omit<AccountLedgerRow, "createdAt" | "debit" | "credit" | "runningBalance"> & { createdAt: Date; debit: Prisma.Decimal; credit: Prisma.Decimal; sequence: number };
  const mode: AccountLedgerMode = filters.mode === "DETAILED" ? "DETAILED" : "SUMMARY";
  const invoiceRows: InternalRow[] = invoices.map((invoice) => {
    const isDebit = invoice.type === "SALE" || invoice.type === "PURCHASE_RETURN";
    const label = invoice.type === "SALE" ? "فاتورة بيع" : invoice.type === "PURCHASE" ? "فاتورة شراء" : invoice.type === "SALE_RETURN" ? "مرتجع بيع" : invoice.type === "PURCHASE_RETURN" ? "مرتجع شراء" : "عرض سعر";
    const items: AccountLedgerItem[] = mode === "DETAILED" ? invoice.items.map((item) => ({ id: item.id, oemNumber: item.part.oemNumber, nameAr: item.part.nameAr, brandName: item.part.brand.name, quantity: item.quantity, unitPrice: num(item.unitPrice), lineDiscount: num(item.lineDiscount), totalPrice: num(item.totalPrice) })) : [];
    return { id: `inv:${invoice.id}`, createdAt: invoice.createdAt, reference: invoice.invoiceNumber, type: invoice.type, typeLabel: label, debit: isDebit ? money(invoice.grandTotal) : new Prisma.Decimal(0), credit: isDebit ? new Prisma.Decimal(0) : money(invoice.grandTotal), treasuryName: null, note: invoice.notes, documentId: invoice.id, documentKind: "INVOICE", invoiceId: invoice.id, items, sequence: 0 };
  });
  const transactionRows: InternalRow[] = transactions.map((transaction) => {
    const isDebit = transaction.type === "PAYMENT";
    return { id: `trx:${transaction.id}`, createdAt: transaction.createdAt, reference: transaction.transactionNumber, type: transaction.type, typeLabel: isDebit ? "سند صرف" : transaction.type === "RECEIPT" ? "سند قبض" : "تحويل خزينة", debit: isDebit ? money(transaction.amount) : new Prisma.Decimal(0), credit: isDebit ? new Prisma.Decimal(0) : money(transaction.amount), treasuryName: transaction.treasury.name, note: transaction.description, documentId: transaction.id, documentKind: "TREASURY_TRANSACTION", invoiceId: transaction.invoiceId, items: [], sequence: 1 };
  });
  const events = [...invoiceRows, ...transactionRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.sequence - b.sequence || a.id.localeCompare(b.id));
  const totalDelta = events.reduce((sum, row) => sum.add(row.credit).sub(row.debit), new Prisma.Decimal(0));
  const inferredOpening = money(account.currentBalance.sub(totalDelta));
  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
  const validTo = to && !Number.isNaN(to.getTime()) ? to : null;
  const movementTypes = new Set((filters.movementTypes ?? []).filter(Boolean));
  const query = filters.query?.trim().toLocaleLowerCase("ar-EG") ?? "";
  let running = inferredOpening;
  let openingBalance = inferredOpening;
  let closingBalance = inferredOpening;
  const rows: AccountLedgerRow[] = [];
  for (const event of events) {
    if (validFrom && event.createdAt < validFrom) {
      running = money(running.add(event.credit).sub(event.debit));
      openingBalance = running;
      closingBalance = running;
      continue;
    }
    if (validTo && event.createdAt > validTo) continue;
    running = money(running.add(event.credit).sub(event.debit));
    closingBalance = running;
    const matchesType = movementTypes.size === 0 || movementTypes.has(event.type);
    const itemSearch = event.items.map((item) => `${item.nameAr} ${item.oemNumber} ${item.brandName}`).join(" ");
    const haystack = `${event.reference} ${event.typeLabel} ${event.note ?? ""} ${event.treasuryName ?? ""} ${itemSearch}`.toLocaleLowerCase("ar-EG");
    if (!matchesType || (query && !haystack.includes(query))) continue;
    rows.push({ ...event, createdAt: event.createdAt.toISOString(), debit: num(event.debit), credit: num(event.credit), runningBalance: num(running) });
  }
  const totalDebit = rows.reduce((sum, row) => sum.add(row.debit), new Prisma.Decimal(0));
  const totalCredit = rows.reduce((sum, row) => sum.add(row.credit), new Prisma.Decimal(0));
  return { account: { id: account.id, name: account.name, accountNumber: account.accountNumber, phone: account.phone, type: account.type, creditLimit: num(account.creditLimit), currentBalance: num(account.currentBalance) }, filters: { from: validFrom?.toISOString() ?? null, to: validTo?.toISOString() ?? null, mode }, openingBalance: num(openingBalance), totalDebit: num(totalDebit), totalCredit: num(totalCredit), closingBalance: num(closingBalance), rows };
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
