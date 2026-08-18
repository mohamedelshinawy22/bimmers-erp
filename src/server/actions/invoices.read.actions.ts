"use server";

import { requirePermission, can } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices.service";
import { getStockLedger } from "@/server/services/parts.service";
import { prisma } from "@/lib/prisma";
import { getAccountDetailedLedger, getAccountStatement } from "@/server/services/accounts.service";

/**
 * Read-only lookups used by drawers and modals.
 *
 * Kept separate from the mutating action files so the read/write split stays
 * obvious, and each one still enforces its own permission.
 */

export async function getInvoiceDetailAction(invoiceId: string): Promise<ActionResult<InvoiceDetail>> {
  try {
    const user = await requirePermission("invoice.read");
    const detail = await getInvoiceDetail(invoiceId);
    if (!detail) return { success: false, error: "الفاتورة غير موجودة." };

    // Cost and margin are only for roles allowed to see cost.
    if (!can(user.role, "part.viewCost")) {
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
    await requirePermission("stock.viewLedger");
    return ok(await getStockLedger(partId, 100));
  } catch (error) {
    return toActionError(error, "getStockLedgerAction");
  }
}

export async function getAccountDetailedLedgerAction(accountId: string, filters?: { from?: string; to?: string; movementTypes?: string[]; query?: string }) {
  try {
    await requirePermission("account.viewStatement");
    const ledger = await getAccountDetailedLedger(accountId, filters);
    if (!ledger) return { success: false as const, error: "الحساب غير موجود." };
    return ok(ledger);
  } catch (error) {
    return toActionError(error, "getAccountDetailedLedgerAction");
  }
}

export async function getAccountPdcInstallmentsAction(accountId: string) {
  try {
    await requirePermission("account.viewStatement");
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        checks: { orderBy: { dueDate: "asc" }, select: { id: true, direction: true, checkNumber: true, bankName: true, amount: true, issueDate: true, dueDate: true, status: true, notes: true } },
        installmentPlans: { orderBy: { startDate: "desc" }, select: { id: true, totalAmount: true, startDate: true, status: true, notes: true, installments: { orderBy: { dueDate: "asc" }, select: { id: true, dueDate: true, amount: true, paidAmount: true, status: true } } } },
      },
    });
    if (!account) return { success: false as const, error: "الحساب غير موجود." };
    return ok({ checks: account.checks.map((check) => ({ ...check, amount: Number(check.amount), issueDate: check.issueDate?.toISOString() ?? null, dueDate: check.dueDate.toISOString() })), installmentPlans: account.installmentPlans.map((plan) => ({ ...plan, totalAmount: Number(plan.totalAmount), startDate: plan.startDate.toISOString(), installments: plan.installments.map((installment) => ({ ...installment, amount: Number(installment.amount), paidAmount: Number(installment.paidAmount), dueDate: installment.dueDate.toISOString() })) })) });
  } catch (error) {
    return toActionError(error, "getAccountPdcInstallmentsAction");
  }
}

export async function getAccountStatementAction(accountId: string) {
  try {
    await requirePermission("account.viewStatement");
    const statement = await getAccountStatement(accountId);
    if (!statement) return { success: false as const, error: "الحساب غير موجود." };
    return ok(statement);
  } catch (error) {
    return toActionError(error, "getAccountStatementAction");
  }
}
