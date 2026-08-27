export const PRICE_MANAGER_CONFIRMATION = "تطبيق تعديل الأسعار";

export type PriceAdjustmentTarget = "RETAIL" | "WHOLESALE" | "BOTH";
export type PriceAdjustmentRule = "PERCENT_OF_COST" | "PERCENT_OF_CURRENT_PRICE" | "FIXED_AMOUNT";

export interface PriceAdjustmentConfig {
  target: PriceAdjustmentTarget;
  rule: PriceAdjustmentRule;
  value: number;
  roundTo: 1 | 5 | 10 | 50;
}

export interface ProductPriceSnapshot {
  id: string;
  buyPriceAvg: number;
  sellPriceRetail: number;
  sellPriceWholesale: number;
  sellPriceMin: number;
}

export interface AdjustedProductPrice extends ProductPriceSnapshot {
  proposedRetail: number;
  proposedWholesale: number;
  proposedMinimum: number;
  marginPercent: number | null;
  warning: string | null;
}

function finiteMoney(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100) : 0;
}

function roundUp(value: number, increment: number): number {
  if (increment <= 1) return finiteMoney(value);
  return finiteMoney(Math.ceil(value / increment) * increment);
}

function calculateBase(current: number, cost: number, config: PriceAdjustmentConfig): number {
  if (config.rule === "PERCENT_OF_COST") return cost > 0 ? cost * (1 + config.value / 100) : current;
  if (config.rule === "PERCENT_OF_CURRENT_PRICE") return current * (1 + config.value / 100);
  return current + config.value;
}

/**
 * Produces a safe preview. Retail/wholesale are never reduced below the current
 * purchase cost and the current minimum is adjusted only enough to preserve the
 * catalog's existing price invariants.
 */
export function calculateAdjustedProductPrice(row: ProductPriceSnapshot, config: PriceAdjustmentConfig): AdjustedProductPrice {
  const cost = finiteMoney(row.buyPriceAvg);
  let retail = finiteMoney(row.sellPriceRetail);
  let wholesale = finiteMoney(row.sellPriceWholesale);
  const value = Number.isFinite(config.value) ? config.value : 0;
  const normalizedConfig = { ...config, value };

  if (config.target === "RETAIL" || config.target === "BOTH") retail = roundUp(calculateBase(retail, cost, normalizedConfig), config.roundTo);
  if (config.target === "WHOLESALE" || config.target === "BOTH") wholesale = roundUp(calculateBase(wholesale, cost, normalizedConfig), config.roundTo);

  retail = Math.max(retail, cost);
  wholesale = Math.max(Math.min(wholesale, retail), cost);
  const minimum = Math.max(cost, Math.min(finiteMoney(row.sellPriceMin), wholesale, retail));
  const marginPercent = cost > 0 ? finiteMoney(((retail - cost) / cost) * 100) : null;
  const warning = config.rule === "PERCENT_OF_COST" && cost <= 0
    ? "لا توجد تكلفة شراء موجبة؛ احتُفظ بالسعر الحالي لهذا الصنف."
    : null;

  return { ...row, proposedRetail: retail, proposedWholesale: wholesale, proposedMinimum: minimum, marginPercent, warning };
}

export function validateProposedProductPrice(price: { cost: number; retail: number; wholesale: number; minimum: number }): string | null {
  const values = [price.cost, price.retail, price.wholesale, price.minimum];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return "الأسعار يجب أن تكون أرقاماً موجبة أو صفراً.";
  if (price.wholesale > price.retail) return "سعر الجملة لا يجب أن يتجاوز سعر القطاعي.";
  if (price.minimum > price.retail || (price.wholesale > 0 && price.minimum > price.wholesale)) return "الحد الأدنى لا يجب أن يتجاوز سعر البيع أو الجملة.";
  if (price.cost > 0 && price.minimum < price.cost) return "الحد الأدنى لا يجب أن يقل عن سعر الشراء.";
  return null;
}
