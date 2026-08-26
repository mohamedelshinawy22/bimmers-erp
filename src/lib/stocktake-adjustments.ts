export type StocktakeAdjustment = {
  partId: string;
  sourceRowNumber: number;
  sourceRowNumbers?: number[];
  actualQuantity: number;
};

export type ConsolidatedStocktakeAdjustment = {
  partId: string;
  /** First contributing source line, retained for backward-compatible displays. */
  sourceRowNumber: number;
  /** Every source line whose physical count was included in the aggregated value. */
  sourceRowNumbers: number[];
  actualQuantity: number;
};

/**
 * A physical-count sheet can contain the same catalog product on multiple rows,
 * for example when it was counted in separate shelf locations. Sum those counts
 * before stocktake writes so each product receives exactly one locked update,
 * stock movement, and audit event.
 */
export function consolidateStocktakeAdjustments(rows: readonly StocktakeAdjustment[]): ConsolidatedStocktakeAdjustment[] {
  const byPartId = new Map<string, ConsolidatedStocktakeAdjustment>();
  for (const row of rows) {
    const sourceRowNumbers = [...new Set([row.sourceRowNumber, ...(row.sourceRowNumbers ?? [])])];
    const existing = byPartId.get(row.partId);
    if (existing) {
      existing.actualQuantity += row.actualQuantity;
      existing.sourceRowNumbers = [...new Set([...existing.sourceRowNumbers, ...sourceRowNumbers])].sort((left, right) => left - right);
      existing.sourceRowNumber = existing.sourceRowNumbers[0]!;
    } else {
      byPartId.set(row.partId, {
        partId: row.partId,
        sourceRowNumber: Math.min(...sourceRowNumbers),
        sourceRowNumbers: [...sourceRowNumbers].sort((left, right) => left - right),
        actualQuantity: row.actualQuantity,
      });
    }
  }
  return [...byPartId.values()];
}
