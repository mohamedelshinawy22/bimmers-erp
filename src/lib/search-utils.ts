const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";

function translateDigits(value: string, from: string, to: string): string {
  return value.replace(new RegExp(`[${from}]`, "g"), (digit) => to[from.indexOf(digit)] ?? digit);
}

/**
 * Produces comparable Arabic/English and numeric search tokens without changing
 * stored data. Database queries can use the returned variations as ILIKE terms.
 */
export function normalizeSearchTerm(term: string): { normalized: string; numericNormalized: string; variations: string[] } {
  const westernDigits = translateDigits(term, EASTERN_DIGITS, WESTERN_DIGITS);
  const normalized = westernDigits
    .trim()
    .toLocaleLowerCase("ar-EG")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[يى]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
  const numericNormalized = normalized.replace(/[\s\-_/().]/g, "");
  const easternNormalized = translateDigits(numericNormalized, WESTERN_DIGITS, EASTERN_DIGITS);
  const original = term.trim().toLocaleLowerCase("ar-EG");
  return {
    normalized,
    numericNormalized,
    variations: [...new Set([original, normalized, numericNormalized, easternNormalized].filter(Boolean))],
  };
}

export function normalizeStoredSearchValue(value: string | null | undefined): string {
  return normalizeSearchTerm(value ?? "").normalized;
}
