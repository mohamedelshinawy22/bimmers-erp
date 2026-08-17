/**
 * Central registry of operator-editable settings.
 *
 * Previously the boolean/numeric key lists were duplicated between
 * `server/actions/settings.actions.ts` (server-side validation) and
 * `app/(app)/settings/settings-form.tsx` (which widget to render). Adding a key
 * to only one list silently produced either an unvalidated free-text boolean —
 * which `getSetting(...) === "true"` then reads as `false`, quietly disabling a
 * business rule — or a select whose value the server never checked.
 *
 * Client-safe: no server-only imports, so both sides use this one definition.
 */

export const BOOLEAN_SETTING_KEYS = new Set([
  "ALLOW_NEGATIVE_STOCK",
  "ENFORCE_MIN_SELL_PRICE",
  "ENFORCE_CREDIT_LIMIT",
]);

export const NUMERIC_SETTING_KEYS = new Set(["TAX_RATE_PERCENT", "MAX_INVOICE_DISCOUNT_PERCENT"]);

/** JSON-valued settings are managed through dedicated UI, not a text box. */
export const HIDDEN_SETTING_KEYS = new Set(["PART_CATEGORIES"]);

export const SETTING_GROUP_LABELS: Record<string, string> = {
  GENERAL: "بيانات الشركة",
  TAX: "الضرائب",
  PRINTING: "الطباعة",
  INVENTORY: "المخزون",
  PRICING: "التسعير والائتمان",
};

export function isBooleanSetting(key: string): boolean {
  return BOOLEAN_SETTING_KEYS.has(key);
}

export function isNumericSetting(key: string): boolean {
  return NUMERIC_SETTING_KEYS.has(key);
}
