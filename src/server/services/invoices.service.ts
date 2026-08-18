import "server-only";
import { Prisma, type InvoiceType, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/utils";
import { normalizeSearchTerm } from "@/lib/search-utils";

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  type: InvoiceType;
  accountName: string;
  accountId: string;
  userName: string;
  itemCount: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  isVoided: boolean;
  voidReason: string | null;
  treasuryName: string | null;
  vehicleLabel: string | null;
  createdAt: string;
}

export async function listInvoices(options: {
  query?: string;
  type?: InvoiceType | "ALL";
  status?: PaymentStatus | "ALL";
  includeVoided?: boolean;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: InvoiceListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));

  const and: Prisma.InvoiceWhereInput[] = [];
  if (options.query) {
    const { variations } = normalizeSearchTerm(options.query);
    and.push({ OR: variations.flatMap((term) => [
      { invoiceNumber: { contains: term, mode: "insensitive" as const } },
      { account: { name: { contains: term } } },
      { account: { phone: { contains: term } } },
      { notes: { contains: term } },
    ]) });
  }
  if (options.type && options.type !== "ALL") and.push({ type: options.type });
  if (options.status && options.status !== "ALL") and.push({ paymentStatus: options.status });
  if (!options.includeVoided) and.push({ isVoided: false });
  if (options.from || options.to) {
    and.push({ createdAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } });
  }

  const where: Prisma.InvoiceWhereInput = and.length ? { AND: and } : {};

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        accountId: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        grandTotal: true,
        paidAmount: true,
        remainingAmount: true,
        paymentStatus: true,
        paymentMethod: true,
        isVoided: true,
        voidReason: true,
        createdAt: true,
        account: { select: { name: true } },
        user: { select: { fullName: true } },
        treasury: { select: { name: true } },
        vehicle: { select: { vin: true, plateNumber: true, chassis: { select: { code: true } } } },
        _count: { select: { items: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    rows: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      type: i.type,
      accountId: i.accountId,
      accountName: i.account.name,
      userName: i.user.fullName,
      itemCount: i._count.items,
      subtotal: num(i.subtotal),
      discountAmount: num(i.discountAmount),
      taxAmount: num(i.taxAmount),
      grandTotal: num(i.grandTotal),
      paidAmount: num(i.paidAmount),
      remainingAmount: num(i.remainingAmount),
      paymentStatus: i.paymentStatus,
      paymentMethod: i.paymentMethod,
      isVoided: i.isVoided,
      voidReason: i.voidReason,
      treasuryName: i.treasury?.name ?? null,
      vehicleLabel: i.vehicle
        ? [i.vehicle.chassis?.code, i.vehicle.plateNumber ?? i.vehicle.vin.slice(-6)]
            .filter(Boolean)
            .join(" • ")
        : null,
      createdAt: i.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

/** Full document for the detail drawer and the printable copy. */
export async function getInvoiceDetail(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      grandTotal: true,
      paidAmount: true,
      remainingAmount: true,
      paymentStatus: true,
      paymentMethod: true,
      notes: true,
      isVoided: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      account: { select: { id: true, name: true, accountNumber: true, phone: true, taxNumber: true } },
      user: { select: { fullName: true } },
      treasury: { select: { name: true } },
      vehicle: {
        select: {
          vin: true,
          plateNumber: true,
          modelYear: true,
          chassis: { select: { code: true, series: true } },
          engine: { select: { code: true } },
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          unitCostSnapshot: true,
          binLocationSnapshot: true,
          part: { select: { id: true, oemNumber: true, nameAr: true, brand: { select: { name: true } } } },
        },
      },
    },
  });
  if (!invoice) return null;

  return {
    ...invoice,
    subtotal: num(invoice.subtotal),
    discountAmount: num(invoice.discountAmount),
    taxAmount: num(invoice.taxAmount),
    grandTotal: num(invoice.grandTotal),
    paidAmount: num(invoice.paidAmount),
    remainingAmount: num(invoice.remainingAmount),
    createdAt: invoice.createdAt.toISOString(),
    voidedAt: invoice.voidedAt ? invoice.voidedAt.toISOString() : null,
    vehicleLabel: invoice.vehicle
      ? [
          invoice.vehicle.chassis?.code,
          invoice.vehicle.chassis?.series,
          invoice.vehicle.modelYear,
          invoice.vehicle.plateNumber ?? invoice.vehicle.vin,
        ]
          .filter(Boolean)
          .join(" • ")
      : null,
    items: invoice.items.map((it) => ({
      id: it.id,
      partId: it.part.id,
      oemNumber: it.part.oemNumber,
      nameAr: it.part.nameAr,
      brandName: it.part.brand.name,
      quantity: it.quantity,
      unitPrice: num(it.unitPrice),
      unitCostSnapshot: num(it.unitCostSnapshot),
      totalPrice: num(it.totalPrice),
      binLocationSnapshot: it.binLocationSnapshot,
    })),
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>;

/** Suppliers for the goods-receipt screen. */
export async function getPurchaseFormOptions() {
  const [suppliers, treasuries] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true, type: "SUPPLIER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, accountNumber: true, currentBalance: true },
    }),
    prisma.treasury.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, currentBalance: true },
    }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ ...s, currentBalance: num(s.currentBalance) })),
    treasuries: treasuries.map((t) => ({ ...t, currentBalance: num(t.currentBalance) })),
  };
}
