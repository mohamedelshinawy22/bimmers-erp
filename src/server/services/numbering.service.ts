import "server-only";
import { Prisma } from "@prisma/client";
import type { TxClient } from "@/lib/prisma";

/**
 * Race-free document numbering.
 *
 * `SELECT count(*) + 1` is unsafe: two concurrent cashiers both read the same
 * count and produce the same invoice number, and one transaction dies on the
 * unique constraint. Instead we do a single atomic upsert-and-increment that
 * takes a row lock on exactly one counter row and returns the new value.
 *
 * Must be called with the transaction client so the number is only consumed if
 * the surrounding document actually commits.
 */
async function nextValue(tx: TxClient, scope: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(
    Prisma.sql`
      INSERT INTO "DocumentCounter" ("scope", "lastValue", "updatedAt")
      VALUES (${scope}, 1, NOW())
      ON CONFLICT ("scope")
      DO UPDATE SET "lastValue" = "DocumentCounter"."lastValue" + 1,
                    "updatedAt" = NOW()
      RETURNING "lastValue"
    `,
  );
  const value = rows[0]?.lastValue;
  if (value === undefined) throw new Error(`Failed to allocate document number for scope ${scope}`);
  return Number(value);
}

function datePart(date = new Date()): string {
  // Use local time so the day boundary matches the shop's business day.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const PREFIX = {
  SALE: "INV",
  PURCHASE: "PUR",
  SALE_RETURN: "SRT",
  PURCHASE_RETURN: "PRT",
  PRICE_QUOTATION: "QUO",
} as const;

export async function nextInvoiceNumber(
  tx: TxClient,
  type: keyof typeof PREFIX,
): Promise<string> {
  const day = datePart();
  const prefix = PREFIX[type];
  const seq = await nextValue(tx, `${prefix}-${day}`);
  return `${prefix}-${day}-${String(seq).padStart(4, "0")}`;
}

export async function nextTransactionNumber(tx: TxClient): Promise<string> {
  const seq = await nextValue(tx, "TRX");
  return `TRX-${String(seq).padStart(6, "0")}`;
}

export async function nextShiftNumber(tx: TxClient): Promise<string> {
  const seq = await nextValue(tx, "SHIFT");
  return `SH-${datePart()}-${String(seq).padStart(4, "0")}`;
}

export async function nextAccountNumber(tx: TxClient, prefix = "ACC"): Promise<string> {
  // Counters can predate a restored database or manual legacy imports. Keep the
  // atomic counter for concurrency, but skip any code already present until the
  // counter catches up with legacy data. Every candidate is unique to this call.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const seq = await nextValue(tx, `ACCOUNT-${prefix}`);
    const accountNumber = `${prefix}-${String(seq).padStart(4, "0")}`;
    const existing = await tx.account.findUnique({ where: { accountNumber }, select: { id: true } });
    if (!existing) return accountNumber;
  }
  throw new Error("Unable to allocate a unique account number after 10000 attempts.");
}
