import type { Prisma, PrismaClient } from "@prisma/client";
import { BusinessRuleError } from "../../../lib/errors";
import { TX_OPTIONS, withTxRetry } from "../../services/tx";

export const MAX_IMPORT_CHUNK_SIZE = 100;
type TenantImportDb = Pick<PrismaClient, "$transaction">;
export type TenantImportTransaction = Prisma.TransactionClient;

/**
 * Executes one client-dispatched import chunk against the currently resolved
 * tenant only. The caller keeps UI progress and chunk sequencing; this helper
 * enforces the server-side size cap and the established serverless TX budget.
 */
export async function executeTenantChunkedImport<T, R>({
  tenantDb,
  chunk,
  processor,
}: {
  tenantDb: TenantImportDb;
  chunk: readonly T[];
  processor: (tx: TenantImportTransaction, row: T, index: number) => Promise<R>;
}): Promise<R[]> {
  if (chunk.length === 0) return [];
  if (chunk.length > MAX_IMPORT_CHUNK_SIZE) {
    throw new BusinessRuleError(`الحد الأقصى للدفعة الواحدة هو ${MAX_IMPORT_CHUNK_SIZE} سجل.`);
  }
  return withTxRetry(() => tenantDb.$transaction(async (tx) => {
    const results: R[] = [];
    for (const [index, row] of chunk.entries()) results.push(await processor(tx, row, index));
    return results;
  }, TX_OPTIONS));
}
