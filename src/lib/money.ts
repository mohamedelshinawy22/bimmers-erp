import Decimal from "decimal.js-light";

/**
 * Client-safe money arithmetic.
 *
 * The POS needs live totals as the cashier types, so it cannot round-trip to the
 * server on every keystroke. Using plain JS floats there caused a real defect:
 * `Math.round(3 * 1.005 * 100) / 100` yields 3.01 while the server's
 * `Prisma.Decimal` (also decimal.js) yields 3.02, so the client under-reported
 * the total, sent it as `paidAmount`, and the server booked a phantom 0.01
 * receivable that flipped the invoice from PAID to PARTIAL.
 *
 * This module uses the same decimal engine and the same rounding mode as the
 * server (`ROUND_HALF_UP`), so previews agree with the persisted values.
 *
 * The server remains authoritative regardless: `createSaleInvoice` recomputes
 * every figure from the line items and ignores client-supplied totals.
 */
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = number | string | Decimal;

export function dec(value: MoneyInput): Decimal {
  // Route numbers through their shortest round-trip string so the decimal value
  // matches what the server's Decimal(number) constructor produces.
  return value instanceof Decimal ? value : new Decimal(String(value));
}

/** Round to 2 decimal places, half-up — matches the DB's Decimal(12,2). */
export function round2(value: MoneyInput): number {
  return Number(dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
}

/** quantity × unitPrice − lineDiscount, rounded once at the end. */
export function lineTotal(quantity: number, unitPrice: MoneyInput, lineDiscount: MoneyInput = 0): number {
  return round2(dec(unitPrice).times(quantity).minus(dec(lineDiscount)));
}

export function sum(values: MoneyInput[]): number {
  return round2(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

/** taxable × rate%, rounded to 2dp. Mirrors the server's tax computation. */
export function taxOf(taxable: MoneyInput, ratePercent: MoneyInput): number {
  return round2(dec(taxable).times(dec(ratePercent)).dividedBy(100));
}

export { Decimal as ClientDecimal };
