import "server-only";
import { Prisma, type AccountType, type StockMoveReason } from "@prisma/client";
import type { TxClient } from "@/lib/prisma";
import { BusinessRuleError } from "@/lib/errors";
import { money } from "@/lib/utils";

export interface LockedPart {
  id: string;
  oemNumber: string;
  nameAr: string;
  stockQuantity: number;
  stockReserved: number;
  sellPriceMin: Prisma.Decimal;
  buyPriceAvg: Prisma.Decimal;
  buyPriceLast: Prisma.Decimal;
  binLocationId: string | null;
  /** Joined in the locking query so no per-line lookup is needed. */
  binFullCode: string | null;
  isActive: boolean;
}

interface StockMoveRow {
  partId: string;
  invoiceId?: string;
  reason: StockMoveReason;
  quantityDelta: number;
  balanceAfter: number;
  unitCost?: Prisma.Decimal | number | null;
  note?: string;
}

/**
 * Batched ledger append + stock decrement.
 *
 * The per-line `update` + `create` pair used to issue 2N sequential round trips
 * inside the transaction while holding every row lock — on a managed Postgres
 * with real network latency that dominated lock hold time. This collapses the
 * ledger into one `createMany` and the quantity changes into a single
 * `UPDATE … FROM (VALUES …)`.
 */
export async function applyStockDeltas(
  tx: TxClient,
  moves: StockMoveRow[],
  performedById: string,
): Promise<void> {
  if (moves.length === 0) return;

  await tx.stockMovement.createMany({
    data: moves.map((m) => ({
      partId: m.partId,
      invoiceId: m.invoiceId,
      reason: m.reason,
      quantityDelta: m.quantityDelta,
      balanceAfter: m.balanceAfter,
      unitCost: m.unitCost === null || m.unitCost === undefined ? null : money(m.unitCost),
      performedById,
      note: m.note,
    })),
  });

  // Net the deltas per part so a repeated part yields one row in the VALUES list.
  const netByPart = new Map<string, number>();
  for (const m of moves) {
    netByPart.set(m.partId, (netByPart.get(m.partId) ?? 0) + m.quantityDelta);
  }

  // NOTE: Prisma maps `String @id @default(uuid())` to TEXT, not to Postgres
  // `uuid`, so the VALUES column must be cast to text — casting to ::uuid here
  // fails with "operator does not exist: text = uuid".
  const values = Prisma.join(
    [...netByPart.entries()].map(([partId, delta]) => Prisma.sql`(${partId}::text, ${delta}::int)`),
  );

  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "PartItem" AS p
      SET "stockQuantity" = p."stockQuantity" + v.delta
      FROM (VALUES ${values}) AS v(id, delta)
      WHERE p."id" = v.id
    `,
  );
}

/**
 * Pessimistic row-level lock over a batch of parts.
 *
 * `ORDER BY id` inside the locking query is the deadlock guard: every
 * transaction in the system grabs the same rows in the same order, so two
 * concurrent invoices touching parts {A,B} can never each hold half the pair.
 *
 * `FOR UPDATE` (not `FOR NO KEY UPDATE`) blocks any other writer until commit,
 * which is what makes the read-check-decrement sequence atomic.
 *
 * The bin `fullCode` is joined in here rather than fetched per line later: it is
 * static reference data, and issuing one `findUnique` per part inside the
 * transaction added a serial round trip per line while holding every lock.
 * `FOR UPDATE OF "PartItem"` keeps the lock on the parts only, so the join does
 * not lock WarehouseBin rows.
 */
export async function lockPartsForUpdate(tx: TxClient, partIds: string[]): Promise<Map<string, LockedPart>> {
  const unique = [...new Set(partIds)];
  if (unique.length === 0) return new Map();

  const rows = await tx.$queryRaw<LockedPart[]>(
    Prisma.sql`
      SELECT p."id", p."oemNumber", p."nameAr", p."stockQuantity", p."stockReserved",
             p."sellPriceMin", p."buyPriceAvg", p."buyPriceLast", p."binLocationId",
             p."isActive", b."fullCode" AS "binFullCode"
      FROM "PartItem" p
      LEFT JOIN "WarehouseBin" b ON b."id" = p."binLocationId"
      WHERE p."id" IN (${Prisma.join(unique)})
      ORDER BY p."id"
      FOR UPDATE OF p
    `,
  );

  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw new BusinessRuleError(`أصناف غير موجودة في قاعدة البيانات: ${missing.join(", ")}`);
  }

  // $queryRaw returns numerics as Decimal-like values; normalise for safety.
  return new Map(
    rows.map((r) => [
      r.id,
      {
        ...r,
        stockQuantity: Number(r.stockQuantity),
        stockReserved: Number(r.stockReserved),
        sellPriceMin: new Prisma.Decimal(r.sellPriceMin.toString()),
        buyPriceAvg: new Prisma.Decimal(r.buyPriceAvg.toString()),
        buyPriceLast: new Prisma.Decimal(r.buyPriceLast.toString()),
      },
    ]),
  );
}

export async function lockAccountsForUpdate(tx: TxClient, accountIds: string[]): Promise<Map<string, { id: string; name: string; type: AccountType; currentBalance: Prisma.Decimal; creditLimit: Prisma.Decimal; defaultPriceTier: string; isActive: boolean }>> {
  const unique = [...new Set(accountIds)].sort();
  if (unique.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; type: AccountType; currentBalance: Prisma.Decimal; creditLimit: Prisma.Decimal; defaultPriceTier: string; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "name", "type", "currentBalance", "creditLimit", "defaultPriceTier", "isActive"
    FROM "Account" WHERE "id" IN (${Prisma.join(unique)}) ORDER BY "id" FOR UPDATE
  `);
  if (rows.length !== unique.length) throw new BusinessRuleError("أحد الحسابات المحددة غير موجود.");
  for (const row of rows) if (!row.isActive) throw new BusinessRuleError(`الحساب "${row.name}" موقوف.`);
  return new Map(rows.map((row) => [row.id, { ...row, currentBalance: new Prisma.Decimal(row.currentBalance.toString()), creditLimit: new Prisma.Decimal(row.creditLimit.toString()) }]));
}

/** Lock a single treasury row so concurrent receipts can't clobber the balance. */
export async function lockTreasuriesForUpdate(
  tx: TxClient,
  treasuryIds: string[],
): Promise<Map<string, { id: string; name: string; currentBalance: Prisma.Decimal; isActive: boolean }>> {
  const unique = [...new Set(treasuryIds)];
  if (unique.length === 0) return new Map();

  const rows = await tx.$queryRaw<
    Array<{ id: string; name: string; currentBalance: Prisma.Decimal; isActive: boolean }>
  >(
    Prisma.sql`
      SELECT "id", "name", "currentBalance", "isActive"
      FROM "Treasury"
      WHERE "id" IN (${Prisma.join(unique)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );

  if (rows.length !== unique.length) {
    throw new BusinessRuleError("الخزينة المحددة غير موجودة.");
  }
  for (const r of rows) {
    if (!r.isActive) throw new BusinessRuleError(`الخزينة "${r.name}" موقوفة ولا تقبل حركات.`);
  }
  return new Map(
    rows.map((r) => [r.id, { ...r, currentBalance: new Prisma.Decimal(r.currentBalance.toString()) }]),
  );
}

export async function lockAccountForUpdate(
  tx: TxClient,
  accountId: string,
): Promise<{
  id: string;
  name: string;
  accountNumber: string;
  category: string | null;
  type: AccountType;
  currentBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal;
  defaultPriceTier: string;
  isActive: boolean;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      name: string;
      accountNumber: string;
      category: string | null;
      type: AccountType;
      currentBalance: Prisma.Decimal;
      creditLimit: Prisma.Decimal;
      defaultPriceTier: string;
      isActive: boolean;
    }>
  >(
    Prisma.sql`
      SELECT "id", "name", "accountNumber", "category", "type", "currentBalance", "creditLimit", "defaultPriceTier", "isActive"
      FROM "Account"
      WHERE "id" = ${accountId}
      FOR UPDATE
    `,
  );
  const row = rows[0];
  if (!row) throw new BusinessRuleError("الحساب المحدد غير موجود.");
  if (!row.isActive) throw new BusinessRuleError(`الحساب "${row.name}" موقوف.`);
  return {
    ...row,
    currentBalance: new Prisma.Decimal(row.currentBalance.toString()),
    creditLimit: new Prisma.Decimal(row.creditLimit.toString()),
  };
}

/**
 * Account type must match the document type.
 *
 * `Account.currentBalance` is a single signed field, so booking a credit sale
 * against a SUPPLIER would net a receivable against a payable and make the
 * amount invisible to both the receivables and payables dashboard KPIs (which
 * filter by type *and* sign).
 */
const ALLOWED_ACCOUNT_TYPES: Record<"SALE" | "PURCHASE", readonly AccountType[]> = {
  SALE: ["CUSTOMER", "WORKSHOP_BMW"],
  PURCHASE: ["SUPPLIER"],
};

export function assertAccountTypeFor(
  document: "SALE" | "PURCHASE",
  account: { name: string; type: AccountType },
): void {
  const allowed = ALLOWED_ACCOUNT_TYPES[document];
  if (!allowed.includes(account.type)) {
    const label = document === "SALE" ? "فاتورة بيع" : "فاتورة شراء";
    throw new BusinessRuleError(
      `لا يمكن تحرير ${label} على الحساب "${account.name}" لأن نوعه (${account.type}) غير مناسب.`,
    );
  }
}

interface StockMoveArgs {
  partId: string;
  invoiceId?: string;
  reason: StockMoveReason;
  quantityDelta: number;
  balanceAfter: number;
  unitCost?: Prisma.Decimal | number | null;
  performedById: string;
  note?: string;
}

/** Append to the immutable stock ledger. Never update or delete these rows. */
export async function recordStockMovement(tx: TxClient, args: StockMoveArgs): Promise<void> {
  await tx.stockMovement.create({
    data: {
      partId: args.partId,
      invoiceId: args.invoiceId,
      reason: args.reason,
      quantityDelta: args.quantityDelta,
      balanceAfter: args.balanceAfter,
      unitCost: args.unitCost === null || args.unitCost === undefined ? null : money(args.unitCost),
      performedById: args.performedById,
      note: args.note,
    },
  });
}

/**
 * Weighted moving average cost.
 * newAvg = (oldQty * oldAvg + inQty * inCost) / (oldQty + inQty)
 * Guards against a negative starting quantity poisoning the average.
 */
export function weightedAverageCost(
  currentQty: number,
  currentAvg: Prisma.Decimal,
  incomingQty: number,
  incomingCost: Prisma.Decimal,
): Prisma.Decimal {
  const baseQty = Math.max(currentQty, 0);
  const totalQty = baseQty + incomingQty;
  if (totalQty <= 0) return money(incomingCost);
  const totalValue = currentAvg.mul(baseQty).add(incomingCost.mul(incomingQty));
  return money(totalValue.div(totalQty));
}
