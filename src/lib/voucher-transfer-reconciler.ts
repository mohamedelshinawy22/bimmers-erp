import type { ParsedVoucherRow } from "@/lib/voucher-excel-parser";

export type ReconciledTransfer = {
  key: string;
  date: string | null;
  time: string | null;
  amount: number;
  fromTreasuryName: string;
  toTreasuryName: string;
  notes: string;
  paymentRowNumber: number;
  receiptRowNumber: number;
};

export type TransferReconciliation = {
  matchedTransfers: ReconciledTransfer[];
  unmatchedReceiptRows: ParsedVoucherRow[];
  unmatchedPaymentRows: ParsedVoucherRow[];
};

function isTransfer(row: ParsedVoucherRow) { return String(row.movementType ?? "").includes("تحويل"); }
function dateKey(value: string | null) { return String(value ?? "").slice(0, 10); }
function timeKey(value: string | null) { return String(value ?? "").replace(/\s+/g, "").slice(0, 8); }
function sameTime(a: string | null, b: string | null) { const one = timeKey(a); const two = timeKey(b); return !one || !two || one === two; }

/** Pairs legacy split transfers: receipt side is the destination and payment side is the source. */
export function reconcileInternalTransfers(receiptRows: ParsedVoucherRow[], paymentRows: ParsedVoucherRow[]): TransferReconciliation {
  const receiptTransfers = receiptRows.filter(isTransfer);
  const paymentTransfers = paymentRows.filter(isTransfer);
  const usedPaymentRows = new Set<number>();
  const matchedTransfers: ReconciledTransfer[] = [];
  const unmatchedReceiptRows: ParsedVoucherRow[] = [];

  for (const receipt of receiptTransfers) {
    const payment = paymentTransfers.find((candidate) => !usedPaymentRows.has(candidate.sourceRowNumber) && dateKey(candidate.date) === dateKey(receipt.date) && Math.abs(candidate.amount - receipt.amount) < 0.01 && sameTime(candidate.time, receipt.time));
    if (!payment) { unmatchedReceiptRows.push(receipt); continue; }
    usedPaymentRows.add(payment.sourceRowNumber);
    const fromTreasuryName = payment.treasuryName?.trim() || "درج النقدية";
    const toTreasuryName = receipt.treasuryName?.trim() || "البنك ABK";
    matchedTransfers.push({
      key: `TRF:${dateKey(receipt.date)}:${timeKey(receipt.time) || "any"}:${receipt.amount.toFixed(2)}:${payment.sourceRowNumber}:${receipt.sourceRowNumber}`,
      date: receipt.date,
      time: receipt.time || payment.time,
      amount: receipt.amount,
      fromTreasuryName,
      toTreasuryName,
      notes: receipt.notes || payment.notes || `تحويل داخلي من ${fromTreasuryName} إلى ${toTreasuryName}`,
      paymentRowNumber: payment.sourceRowNumber,
      receiptRowNumber: receipt.sourceRowNumber,
    });
  }

  return { matchedTransfers, unmatchedReceiptRows, unmatchedPaymentRows: paymentTransfers.filter((row) => !usedPaymentRows.has(row.sourceRowNumber)) };
}
