"use server";

import { can, requirePermission } from "@/lib/auth";
import { z } from "zod";
import { getUserAccess, hasPermission } from "@/lib/user-permissions";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getInvoiceDetail, listInvoices, type InvoiceDetail } from "@/server/services/invoices.service";
import { getStockLedger } from "@/server/services/parts.service";
import { prisma } from "@/lib/prisma";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { serializeData } from "@/lib/serialize";
import { getAccountDetailedLedger, getAccountStatement } from "@/server/services/accounts.service";
import { normalizeSearchTerm } from "@/lib/search-utils";

const invoicePrintFiltersSchema = z.object({
  query: z.string().trim().max(100).optional(),
  type: z.enum(["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"]).optional(),
  status: z.enum(["PAID", "PARTIAL", "CREDIT", "VOIDED"]).optional(),
  includeVoided: z.boolean().default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Read-only lookups used by drawers and modals.
 *
 * Kept separate from the mutating action files so the read/write split stays
 * obvious, and each one still enforces its own permission.
 */

export async function getInvoicesForPrintAction(raw: unknown) {
  try {
    await requirePermission("invoice.read");
    const filters = invoicePrintFiltersSchema.parse(raw ?? {});
    const { status, ...rest } = filters;
    const result = await listInvoices({ ...rest, status: status === "VOIDED" ? "ALL" : status, voidedOnly: status === "VOIDED", page: 1, pageSize: 100, isForPrint: true });
    return ok({ rows: result.rows, total: result.total, capped: result.total > result.rows.length });
  } catch (error) {
    return toActionError(error, "getInvoicesForPrintAction");
  }
}

export async function getInvoiceDetailAction(invoiceId: string): Promise<ActionResult<InvoiceDetail>> {
  try {
    const user = await requirePermission("invoice.read");
    const detail = await getInvoiceDetail(invoiceId);
    if (!detail) return { success: false, error: "الفاتورة غير موجودة." };

    // Cost and margin are only returned to sessions explicitly allowed to view cost.
    const access = await getUserAccess(user.id);
    if (!can(user.role, "part.viewCost") || !hasPermission(access, "canViewCostPrice")) {
      return ok({
        ...detail,
        items: detail.items.map((i) => ({ ...i, unitCostSnapshot: 0 })),
      });
    }
    return ok(detail);
  } catch (error) {
    return toActionError(error, "getInvoiceDetailAction");
  }
}

export async function getStockLedgerAction(partId: string) {
  try {
    const user = await requirePermission("stock.viewLedger");
    const tenant = await getTenantDbFromSession();
    const rows = await tenant.run(() => getStockLedger(tenant.prisma, partId, 100));
    const access = await getUserAccess(user.id);
    return ok(hasPermission(access, "canViewCostPrice") ? rows : rows.map((row) => ({ ...row, unitCost: 0, invoiceUnitCost: 0, invoiceTotalCost: 0 })));
  } catch (error) {
    return toActionError(error, "getStockLedgerAction");
  }
}

export async function getAccountDetailedLedgerAction(accountId: string, filters?: { from?: string; to?: string; movementTypes?: string[]; query?: string; mode?: "SUMMARY" | "DETAILED" }) {
  try {
    await requirePermission("account.viewStatement");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const ledger = await getAccountDetailedLedger(accountId, filters);
      if (!ledger) return { success: false as const, error: "الحساب غير موجود." };
      return ok(serializeData(ledger));
    });
  } catch (error) {
    return toActionError(error, "getAccountDetailedLedgerAction");
  }
}

export async function getAccountPdcInstallmentsAction(accountId: string) {
  try {
    await requirePermission("account.viewStatement");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const account = await tenant.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        checks: { orderBy: { dueDate: "asc" }, select: { id: true, direction: true, checkNumber: true, bankName: true, amount: true, issueDate: true, dueDate: true, status: true, notes: true } },
        installmentPlans: { orderBy: { startDate: "desc" }, select: { id: true, totalAmount: true, startDate: true, status: true, notes: true, installments: { orderBy: { dueDate: "asc" }, select: { id: true, dueDate: true, amount: true, paidAmount: true, status: true } } } },
      },
    });
    if (!account) return { success: false as const, error: "الحساب غير موجود." };
    return ok(serializeData({ checks: account.checks.map((check) => ({ ...check, amount: Number(check.amount), issueDate: check.issueDate?.toISOString() ?? null, dueDate: check.dueDate?.toISOString() ?? null })), installmentPlans: account.installmentPlans.map((plan) => ({ ...plan, totalAmount: Number(plan.totalAmount), startDate: plan.startDate?.toISOString() ?? null, installments: plan.installments.map((installment) => ({ ...installment, amount: Number(installment.amount), paidAmount: Number(installment.paidAmount), dueDate: installment.dueDate?.toISOString() ?? null })) })) }));
    });
  } catch (error) {
    return toActionError(error, "getAccountPdcInstallmentsAction");
  }
}

export async function getAccountStatementAction(accountId: string) {
  try {
    await requirePermission("account.viewStatement");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const statement = await getAccountStatement(accountId);
      if (!statement) return { success: false as const, error: "الحساب غير موجود." };
      return ok(serializeData(statement));
    });
  } catch (error) {
    return toActionError(error, "getAccountStatementAction");
  }
}

export async function searchReturnSourceInvoicesAction(type: "SALE" | "PURCHASE", query = "") {
  try {
    await requirePermission("invoice.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const term = query.trim();
    const variations = term ? normalizeSearchTerm(term).variations : [];
    const invoices = await tenant.prisma.invoice.findMany({
      where: {
        type,
        isVoided: false,
        ...(term ? {
          OR: variations.flatMap((variation) => [
            { invoiceNumber: { contains: variation, mode: "insensitive" } },
            { account: { name: { contains: variation } } },
            { account: { phone: { contains: variation } } },
          ]),
        } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        grandTotal: true,
        paidAmount: true,
        remainingAmount: true,
        paymentStatus: true,
        account: { select: { name: true, phone: true, accountNumber: true } },
      },
    });
    return ok(invoices.map((invoice) => ({
      ...invoice,
      grandTotal: Number(invoice.grandTotal),
      paidAmount: Number(invoice.paidAmount),
      remainingAmount: Number(invoice.remainingAmount),
      createdAt: invoice.createdAt.toISOString(),
    })));
    });
  } catch (error) {
    return toActionError(error, "searchReturnSourceInvoicesAction");
  }
}

export async function getReturnSourceInvoiceAction(invoiceId: string) {
  try {
    await requirePermission("invoice.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
    const invoice = await tenant.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        createdAt: true,
        isVoided: true,
        account: { select: { id: true, name: true, phone: true, accountNumber: true, currentBalance: true } },
        items: {
          select: {
            id: true,
            partId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            partNameSnapshot: true,
            oemNumberSnapshot: true,
            part: { select: { nameAr: true, oemNumber: true, stockQuantity: true } },
          },
        },
        returns: {
          where: { isVoided: false },
          select: { items: { select: { partId: true, quantity: true } } },
        },
      },
    });
    if (!invoice || invoice.isVoided || (invoice.type !== "SALE" && invoice.type !== "PURCHASE")) {
      return { success: false as const, error: "الفاتورة الأصلية غير متاحة للمرتجع." };
    }
    const returnedByPart = new Map<string, number>();
    for (const returned of invoice.returns) {
      for (const item of returned.items) if (item.partId) returnedByPart.set(item.partId, (returnedByPart.get(item.partId) ?? 0) + item.quantity);
    }
    return ok({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type,
      subtotal: Number(invoice.subtotal),
      discountAmount: Number(invoice.discountAmount),
      taxAmount: Number(invoice.taxAmount),
      createdAt: invoice.createdAt.toISOString(),
      account: invoice.account
        ? { ...invoice.account, currentBalance: Number(invoice.account.currentBalance) }
        : { id: "", name: "حساب غير متاح", phone: null, accountNumber: "-", currentBalance: 0 },
      items: invoice.items.map((item) => ({
        id: item.id,
        partId: item.partId,
        nameAr: item.part?.nameAr ?? item.partNameSnapshot ?? "صنف نصي غير مربوط",
        oemNumber: item.part?.oemNumber ?? item.oemNumberSnapshot ?? "-",
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        stockQuantity: item.part?.stockQuantity ?? 0,
        previouslyReturnedQuantity: item.partId ? returnedByPart.get(item.partId) ?? 0 : item.quantity,
        availableQuantity: item.partId ? Math.max(0, item.quantity - (returnedByPart.get(item.partId) ?? 0)) : 0,
      })),
    });
    });
  } catch (error) {
    return toActionError(error, "getReturnSourceInvoiceAction");
  }
}
