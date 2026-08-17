import "server-only";
import { Prisma } from "@prisma/client";

/**
 * Single source of truth for transaction semantics.
 *
 * ISOLATION LEVEL — deliberately READ COMMITTED, not SERIALIZABLE.
 *
 * Every invariant in this system is protected by *pessimistic*
 * `SELECT … FOR UPDATE` row locks (see inventory.service.ts), not by snapshot
 * isolation. Those two strategies actively fight each other:
 *
 *   • Under SERIALIZABLE/REPEATABLE READ, a transaction that blocks on
 *     FOR UPDATE and then unblocks on a row another transaction just changed is
 *     aborted with 40001 "could not serialize access due to concurrent update".
 *   • Under READ COMMITTED, PostgreSQL performs an EvalPlanQual re-read and
 *     hands back the freshly committed row version — so the
 *     read-check-decrement sequence stays atomic *and* makes progress.
 *
 * Measured on this schema (scripts/verify-db.ts, 14 concurrent sales against
 * 10 units): SERIALIZABLE committed only 2/14 and aborted 12 with 40001;
 * READ COMMITTED commits all 10 available units and cleanly rejects the 4
 * genuine overselling attempts. Both are equally safe — stock never went
 * negative in either run — but only one of them is usable at a sales counter.
 *
 * GLOBAL LOCK ORDER — every transaction must acquire locks in this order or
 * PostgreSQL will report deadlocks under concurrency:
 *      1. PartItem  (sorted by id)
 *      2. Account
 *      3. Treasury  (sorted by id)
 */
export const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  /**
   * SERVERLESS BUDGET — these values are sized to fit inside one Vercel Hobby
   * function invocation (10s default max duration), not just to be generous.
   *
   * Worst-case request chain (the 1.5s Redis mutex wait that used to head this
   * list is gone: the application-level lock was removed because the
   * `FOR UPDATE` row locks below already serialise across instances):
   *   maxWait          2.5s  (waiting for a pooled connection)
   * + timeout          5.0s  (the transaction itself)
   * = 7.5s, leaving ~2.5s for auth, validation and cache revalidation.
   *
   * 5s is ample for this workload: the invoice engine batches its writes
   * (one createMany for the ledger, one UPDATE ... FROM VALUES for quantities),
   * so a typical invoice is ~10 round trips.
   *
   * If you raise these, raise the route segment's `maxDuration` to match, or
   * PostgreSQL will be left holding row locks for a request that no longer exists.
   */
  maxWait: 2_500,
  timeout: 5_000,
} as const;

/** Transient PostgreSQL serialization/deadlock failures are safe to replay. */
export function isRetryableTxError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034 write conflict / deadlock, P2028 transaction API error (timeout)
    return error.code === "P2034" || error.code === "P2028";
  }
  const msg = error instanceof Error ? error.message : "";
  return /40001|40P01|could not serialize|deadlock detected/i.test(msg);
}

/**
 * Retries a transaction on transient conflicts with exponential backoff plus
 * jitter, which breaks up lock convoys instead of re-colliding in lockstep.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableTxError(error) || attempt === attempts) throw error;
      await new Promise((r) => setTimeout(r, attempt * 80 + Math.random() * 60));
    }
  }
  throw lastError;
}
