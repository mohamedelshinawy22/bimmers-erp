import type { PrismaClient } from "@prisma/client";

export type CopilotUserContext = {
  userId: string;
  fullName: string;
  role: string;
  tenantId: string;
  allowedTreasuryIds: string[];
};

const limitOf = (value: unknown, fallback = 10, maximum = 25) => Math.min(maximum, Math.max(1, Number(value) || fallback));
const dateOr = (value: unknown, fallback: Date) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};
const startOfToday = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date; };
const money = (value: unknown) => Number(value ?? 0);
const isManager = (role: string) => ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role.toUpperCase());

export function createScopedCopilotTools(db: PrismaClient, user: CopilotUserContext) {
  const manager = isManager(user.role);
  const ownTreasuryFilter = manager || user.allowedTreasuryIds.length === 0 ? {} : { treasuryId: { in: user.allowedTreasuryIds } };
  return {
    async getLiveDashboardMetrics() {
      if (!manager) return { error: "هذا الملخص المالي متاح لمدير النظام فقط." };
      const from = startOfToday();
      const [sales, treasuries, supplierDebt, customerDebt, shortages] = await Promise.all([
        db.invoice.aggregate({ where: { type: "SALE", isVoided: false, createdAt: { gte: from } }, _sum: { grandTotal: true, paidAmount: true }, _count: true }),
        db.treasury.aggregate({ where: { isActive: true }, _sum: { currentBalance: true } }),
        db.account.aggregate({ where: { type: "SUPPLIER", isActive: true, currentBalance: { gt: 0 } }, _sum: { currentBalance: true } }),
        db.account.aggregate({ where: { type: { in: ["CUSTOMER", "WORKSHOP_BMW"] }, isActive: true, currentBalance: { lt: 0 } }, _sum: { currentBalance: true } }),
        db.partItem.count({ where: { isDeleted: false, isActive: true, stockQuantity: { lte: 2 } } }),
      ]);
      return {
        date: from.toLocaleDateString("ar-EG"),
        todaySalesTotal: money(sales._sum.grandTotal), todayPaidTotal: money(sales._sum.paidAmount), todayInvoicesCount: sales._count,
        totalActiveTreasuries: money(treasuries._sum.currentBalance), supplierPayables: money(supplierDebt._sum.currentBalance),
        customerReceivables: Math.abs(money(customerDebt._sum?.currentBalance)), criticalShortagesCount: shortages,
      };
    },

    async queryProducts(args: { query?: string; chassis?: string; engine?: string; lowStockOnly?: boolean }) {
      const query = typeof args?.query === "string" ? args.query.trim() : "";
      const products = await db.partItem.findMany({
        where: {
          isDeleted: false, isActive: true,
          ...(args?.lowStockOnly ? { stockQuantity: { lte: 2 } } : {}),
          ...(query ? { OR: [
            { nameAr: { contains: query, mode: "insensitive" } },
            { nameEn: { contains: query, mode: "insensitive" } },
            { oemNumber: { contains: query, mode: "insensitive" } },
            { brandPartNumber: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
            { category: { contains: query, mode: "insensitive" } },
          ] } : {}),
          ...(args?.chassis ? { compatibleChassis: { some: { chassis: { code: { contains: args.chassis.trim(), mode: "insensitive" } } } } } : {}),
          ...(args?.engine ? { compatibleEngines: { some: { engine: { code: { contains: args.engine.trim(), mode: "insensitive" } } } } } : {}),
        },
        select: { nameAr: true, nameEn: true, oemNumber: true, brandPartNumber: true, barcode: true, brand: { select: { name: true } }, category: true, stockQuantity: true, stockReserved: true, sellPriceRetail: true, sellPriceWholesale: true, buyPriceAvg: true, binLocation: { select: { fullCode: true } } },
        orderBy: { updatedAt: "desc" }, take: limitOf(args?.query ? 10 : 15, 15),
      });
      return products.map((part) => ({
        name: part.nameAr, englishName: part.nameEn, oem: part.oemNumber, brandPartNumber: part.brandPartNumber, barcode: part.barcode,
        brand: part.brand.name, category: part.category, available: part.stockQuantity - part.stockReserved,
        stock: part.stockQuantity, stockStatus: part.stockQuantity <= 0 ? "نافد" : part.stockQuantity <= 2 ? "حرج" : "متوفر",
        retailPrice: money(part.sellPriceRetail), wholesalePrice: manager ? money(part.sellPriceWholesale) : undefined,
        costPrice: manager ? money(part.buyPriceAvg) : undefined, location: part.binLocation?.fullCode ?? null,
      }));
    },

    async queryInvoices(args: { type?: "SALE" | "PURCHASE"; dateFrom?: string; dateTo?: string; accountName?: string }) {
      const from = dateOr(args?.dateFrom, startOfToday());
      const to = dateOr(args?.dateTo, new Date());
      const accountName = typeof args?.accountName === "string" ? args.accountName.trim() : "";
      const where = {
        type: args?.type ?? undefined, isVoided: false, createdAt: { gte: from, lte: to },
        ...(manager ? {} : { userId: user.userId }),
        ...(accountName ? { account: { name: { contains: accountName, mode: "insensitive" as const } } } : {}),
      };
      const invoices = await db.invoice.findMany({ where, select: { invoiceNumber: true, type: true, grandTotal: true, paidAmount: true, remainingAmount: true, paymentMethod: true, createdAt: true, account: { select: { name: true } }, user: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: limitOf(args?.type ? 12 : 15, 15) });
      return invoices.map((invoice) => ({ invoiceNumber: invoice.invoiceNumber, type: invoice.type, total: money(invoice.grandTotal), paid: money(invoice.paidAmount), remaining: money(invoice.remainingAmount), paymentMethod: invoice.paymentMethod, account: invoice.account.name, createdBy: manager ? invoice.user.fullName : undefined, date: invoice.createdAt.toLocaleString("ar-EG") }));
    },

    async queryVouchersAndTreasury(args: { type?: "RECEIPT" | "PAYMENT"; limit?: number }) {
      if (!manager && user.allowedTreasuryIds.length === 0) return { error: "لا توجد خزينة مصرح بها لهذا المستخدم." };
      const vouchers = await db.treasuryTransaction.findMany({ where: { status: "ACTIVE", ...(args?.type ? { type: args.type } : {}), ...(manager ? {} : { createdByUser: user.userId, ...ownTreasuryFilter }) }, select: { transactionNumber: true, type: true, amount: true, description: true, createdAt: true, treasury: { select: { name: true } }, account: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: limitOf(args?.limit, 10, 20) });
      const cash = await db.treasury.findMany({ where: { isActive: true, ...(manager ? {} : { id: { in: user.allowedTreasuryIds } }) }, select: { name: true, currentBalance: true, isDefault: true }, orderBy: { isDefault: "desc" } });
      return { vouchers: vouchers.map((item) => ({ number: item.transactionNumber, type: item.type, amount: money(item.amount), description: item.description, treasury: item.treasury.name, account: item.account?.name ?? "نقدي عام", date: item.createdAt.toLocaleString("ar-EG") })), treasuries: cash.map((item) => ({ name: item.name, balance: money(item.currentBalance), isDefault: item.isDefault })) };
    },

    async queryAccountsAndDebts(args: { search?: string; type?: "CUSTOMER" | "SUPPLIER" | "WORKSHOP_BMW"; withDebtsOnly?: boolean }) {
      if (!manager) return { error: "تفاصيل أرصدة الحسابات العامة متاحة لمدير النظام فقط." };
      const search = typeof args?.search === "string" ? args.search.trim() : "";
      const accounts = await db.account.findMany({ where: { isActive: true, status: "ACTIVE", ...(args?.type ? { type: args.type } : {}), ...(args?.withDebtsOnly ? { currentBalance: { not: 0 } } : {}), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }, { accountNumber: { contains: search } }] } : {}) }, select: { accountNumber: true, name: true, type: true, phone: true, currentBalance: true, creditLimit: true }, orderBy: { currentBalance: "desc" }, take: limitOf(10, 10, 20) });
      return accounts.map((account) => ({ code: account.accountNumber, name: account.name, type: account.type, phone: account.phone, balance: money(account.currentBalance), balanceMeaning: money(account.currentBalance) < 0 ? "مديونية علينا / رصيد دائن للحساب" : money(account.currentBalance) > 0 ? "مستحق لنا" : "متزن", creditLimit: money(account.creditLimit) }));
    },

    async queryUserPerformanceSummary(args: { dateFrom?: string }) {
      if (!manager) return { error: "تقرير أداء المستخدمين مخصص لمدير النظام فقط." };
      const from = dateOr(args?.dateFrom, startOfToday());
      const users = await db.user.findMany({ where: { isActive: true }, select: { fullName: true, username: true, role: true, invoices: { where: { type: "SALE", isVoided: false, createdAt: { gte: from } }, select: { grandTotal: true } } } });
      return users.map((item) => ({ user: item.fullName, username: item.username, role: item.role, invoiceCount: item.invoices.length, salesTotal: item.invoices.reduce((sum, invoice) => sum + money(invoice.grandTotal), 0) }));
    },
  };
}
