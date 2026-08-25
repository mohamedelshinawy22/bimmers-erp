import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSearchTerm } from "@/lib/search-utils";
import { num } from "@/lib/utils";

export type VoucherTypeFilter = "ALL" | "RECEIPT" | "PAYMENT";
export type VoucherStatusFilter = "ALL" | "ACTIVE" | "VOIDED";

export interface VoucherRegisterFilters {
  type?: VoucherTypeFilter;
  status?: VoucherStatusFilter;
  treasuryId?: string;
  query?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface VoucherRegisterRow {
  id: string;
  transactionNumber: string;
  type: "RECEIPT" | "PAYMENT";
  amount: number;
  description: string;
  category: string | null;
  status: "ACTIVE" | "VOIDED";
  createdAt: string;
  updatedAt: string;
  treasury: { id: string; name: string };
  account: { id: string; name: string; accountNumber: string } | null;
  invoiceNumber: string | null;
  transferId: string | null;
  createdByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface VoucherRegisterData {
  rows: VoucherRegisterRow[];
  summary: { receipts: number; payments: number; netCashflow: number; activeCount: number; voidedCount: number; totalCount: number };
}

type VoucherDb = Pick<PrismaClient, "treasuryTransaction" | "user" | "treasury" | "account" | "invoice">;

function voucherWhere(filters: VoucherRegisterFilters): Prisma.TreasuryTransactionWhereInput {
  const and: Prisma.TreasuryTransactionWhereInput[] = [{ type: { in: ["RECEIPT", "PAYMENT"] } }];
  if (filters.type && filters.type !== "ALL") and.push({ type: filters.type });
  if (filters.status && filters.status !== "ALL") and.push({ status: filters.status });
  if (filters.treasuryId) and.push({ treasuryId: filters.treasuryId });
  if (filters.from || filters.to) and.push({ createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } });
  if (filters.query?.trim()) {
    const { variations } = normalizeSearchTerm(filters.query);
    and.push({ OR: variations.flatMap((term) => [
      { transactionNumber: { contains: term, mode: "insensitive" } },
      { description: { contains: term } },
      { account: { is: { name: { contains: term } } } },
      { account: { is: { accountNumber: { contains: term, mode: "insensitive" } } } },
      { treasury: { is: { name: { contains: term } } } },
    ]) });
  }
  return { AND: and };
}

export async function getVoucherRegister(db: VoucherDb, filters: VoucherRegisterFilters = {}): Promise<VoucherRegisterData> {
  const where = voucherWhere(filters);
  const rows = await db.treasuryTransaction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { transactionNumber: "desc" }],
    take: Math.min(Math.max(filters.limit ?? 500, 1), 5_000),
    select: {
      id: true, transactionNumber: true, type: true, amount: true, description: true, category: true, status: true, createdAt: true, updatedAt: true, createdByUser: true,
      transferId: true, voidedAt: true, voidReason: true,
      treasury: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, accountNumber: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });
  const userIds = [...new Set(rows.map((row) => row.createdByUser).filter(Boolean))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
  const userMap = new Map(users.map((user) => [user.id, user.fullName]));
  const mapped = rows.map((row) => ({
    id: row.id, transactionNumber: row.transactionNumber, type: row.type as "RECEIPT" | "PAYMENT", amount: num(row.amount), description: row.description,
    category: row.category, status: row.status as "ACTIVE" | "VOIDED", createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    treasury: row.treasury, account: row.account, invoiceNumber: row.invoice?.invoiceNumber ?? null, transferId: row.transferId,
    createdByName: userMap.get(row.createdByUser) ?? null, voidedAt: row.voidedAt?.toISOString() ?? null, voidReason: row.voidReason,
  }));
  const active = mapped.filter((row) => row.status === "ACTIVE");
  const receipts = active.filter((row) => row.type === "RECEIPT").reduce((total, row) => total + row.amount, 0);
  const payments = active.filter((row) => row.type === "PAYMENT").reduce((total, row) => total + row.amount, 0);
  return { rows: mapped, summary: { receipts, payments, netCashflow: receipts - payments, activeCount: active.length, voidedCount: mapped.length - active.length, totalCount: mapped.length } };
}

export async function getVoucherFilterTreasuries(db: VoucherDb) {
  return db.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currentBalance: true, isDefault: true } }).then((rows) => rows.map((row) => ({ ...row, currentBalance: num(row.currentBalance) })));
}

export async function getVoucherAccounts(db: VoucherDb) {
  return db.account.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }], take: 5_000, select: { id: true, name: true, accountNumber: true, type: true, phone: true, currentBalance: true } }).then((rows) => rows.map((row) => ({ ...row, currentBalance: num(row.currentBalance) })));
}

export async function getOpenInvoicesForVouchers(db: VoucherDb) {
  return db.invoice.findMany({ where: { isVoided: false, remainingAmount: { gt: 0 }, type: { in: ["SALE", "PURCHASE"] } }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, invoiceNumber: true, type: true, accountId: true, account: { select: { name: true, accountNumber: true } }, remainingAmount: true } }).then((rows) => rows.map((row) => ({ id: row.id, invoiceNumber: row.invoiceNumber, type: row.type, accountId: row.accountId, accountName: row.account.name, accountNumber: row.account.accountNumber, remainingAmount: num(row.remainingAmount) })));
}

export function parseVoucherDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function normalizeVoucherFilters(raw: { type?: string; status?: string; treasuryId?: string; q?: string; from?: string; to?: string }) : VoucherRegisterFilters {
  const type = raw.type === "RECEIPT" || raw.type === "PAYMENT" ? raw.type : "ALL";
  const status = raw.status === "ACTIVE" || raw.status === "VOIDED" ? raw.status : "ALL";
  return { type, status, treasuryId: raw.treasuryId || undefined, query: raw.q?.trim() || undefined, from: raw.from ? parseVoucherDate(raw.from, new Date(0)) : undefined, to: raw.to ? parseVoucherDate(raw.to, new Date()) : undefined };
}
