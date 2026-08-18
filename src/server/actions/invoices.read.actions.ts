"use server";

import { requirePermission, can } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices.service";
import { getStockLedger } from "@/server/services/parts.service";
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
