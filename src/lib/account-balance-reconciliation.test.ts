import { describe, expect, it } from "vitest";
import { rebuildAccountBalanceFromLedger } from "./account-balance-reconciliation";

describe("account balance reconciliation", () => {
  it("uses current invoice remaining exposure and does not double count its linked settlement voucher", () => {
    const balance = rebuildAccountBalanceFromLedger("CUSTOMER", [
      { type: "SALE", remainingAmount: 700, isVoided: false },
    ], [
      { type: "RECEIPT", amount: 300, status: "ACTIVE", invoiceId: "sale-1" },
      { type: "RECEIPT", amount: 200, status: "ACTIVE", invoiceId: null },
    ]);
    expect(balance).toBe(-500);
  });

  it("replays purchase and return exposure using the ERP sign convention", () => {
    const balance = rebuildAccountBalanceFromLedger("SUPPLIER", [
      { type: "PURCHASE", remainingAmount: 1_000, isVoided: false },
      { type: "PURCHASE_RETURN", remainingAmount: 100, isVoided: false },
      { type: "SALE", remainingAmount: 50, isVoided: true },
    ], [
      { type: "PAYMENT", amount: 300, status: "ACTIVE", invoiceId: null },
      { type: "RECEIPT", amount: 40, status: "VOIDED", invoiceId: null },
    ]);
    expect(balance).toBe(600);
  });

  it("rebuilds sale returns correctly and keeps operating expense accounts at zero", () => {
    expect(rebuildAccountBalanceFromLedger("CUSTOMER", [{ type: "SALE_RETURN", remainingAmount: 75.5, isVoided: false }], [])).toBe(75.5);
    expect(rebuildAccountBalanceFromLedger("EXPENSE", [{ type: "PURCHASE", remainingAmount: 1_000, isVoided: false }], [{ type: "PAYMENT", amount: 500, status: "ACTIVE", invoiceId: null }])).toBe(0);
  });
});
