export type ReconciliationAccountType = "CUSTOMER" | "WORKSHOP_BMW" | "SUPPLIER" | "EXPENSE" | "EMPLOYEE" | "ADVANCE" | "PARTNER" | "OTHER";
export type ReconciliationInvoice = { type: "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN" | "PRICE_QUOTATION"; remainingAmount: number; isVoided: boolean };
export type ReconciliationTransaction = { type: "RECEIPT" | "PAYMENT" | "TRANSFER"; amount: number; status: string; invoiceId: string | null };

const finite = (value: number) => Number.isFinite(value) ? value : 0;

/**
 * Replays the persisted customer exposure convention without double counting.
 * Invoice `remainingAmount` already includes its linked settlement vouchers, so
 * only active, standalone (invoice-free) vouchers are added independently.
 */
export function rebuildAccountBalanceFromLedger(
  accountType: ReconciliationAccountType,
  invoices: ReconciliationInvoice[],
  transactions: ReconciliationTransaction[],
) {
  if (accountType === "EXPENSE") return 0;
  const invoiceEffect = invoices.reduce((total, invoice) => {
    if (invoice.isVoided) return total;
    const amount = finite(invoice.remainingAmount);
    if (invoice.type === "SALE") return total - amount;
    if (invoice.type === "PURCHASE") return total + amount;
    if (invoice.type === "SALE_RETURN") return total + amount;
    if (invoice.type === "PURCHASE_RETURN") return total - amount;
    return total;
  }, 0);
  const standaloneVoucherEffect = transactions.reduce((total, transaction) => {
    if (transaction.status === "VOIDED" || transaction.invoiceId || transaction.type === "TRANSFER") return total;
    const amount = finite(transaction.amount);
    return transaction.type === "RECEIPT" ? total + amount : total - amount;
  }, 0);
  return Number((invoiceEffect + standaloneVoucherEffect).toFixed(2));
}
