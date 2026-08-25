import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/tx", () => ({
  TX_OPTIONS: { maxWait: 2_500, timeout: 5_000 },
  withTxRetry: <T>(work: () => Promise<T>) => work(),
}));

import { executeTenantChunkedImport, MAX_IMPORT_CHUNK_SIZE } from "./chunked-import";

describe("tenant chunked import executor", () => {
  it("uses one bounded tenant transaction and preserves ordered processor results", async () => {
    const transaction = vi.fn(async (work: (tx: object) => Promise<number[]>) => work({}));
    const processor = vi.fn(async (_tx: object, row: number, index: number) => row + index);
    await expect(executeTenantChunkedImport({ tenantDb: { $transaction: transaction } as never, chunk: [2, 4, 6], processor })).resolves.toEqual([2, 5, 8]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized chunks before opening a tenant transaction", async () => {
    const transaction = vi.fn();
    await expect(executeTenantChunkedImport({ tenantDb: { $transaction: transaction } as never, chunk: Array.from({ length: MAX_IMPORT_CHUNK_SIZE + 1 }, (_, index) => index), processor: async () => 0 })).rejects.toThrow("الحد الأقصى");
    expect(transaction).not.toHaveBeenCalled();
  });
});
