export const CHASSIS_DICTIONARY = [
  "E30", "E34", "E36", "E39", "E46", "E53", "E60", "E65", "E66", "E70", "E71", "E83", "E84", "E87", "E88", "E89", "E90", "E91", "E92", "E93",
  "F01", "F02", "F10", "F11", "F15", "F16", "F20", "F22", "F25", "F26", "F30", "F31", "F32", "F33", "F34", "F36", "F48", "F80", "F82", "F85", "F86", "F87",
  "G01", "G02", "G05", "G06", "G07", "G11", "G12", "G20", "G21", "G22", "G23", "G26", "G30", "G31", "G80", "G82",
  "X1", "X3", "X4", "X5", "X6", "X7", "Z4", "MINI",
] as const;

export const ENGINE_DICTIONARY = [
  "N13", "N20", "N26", "N42", "N43", "N46", "N47", "N52", "N53", "N54", "N55", "N57", "N62", "N63", "N74",
  "B38", "B47", "B48", "B57", "B58",
  "S55", "S58", "S63", "S65", "S85",
  "M40", "M43", "M44", "M50", "M52", "M54", "M57", "M60", "M62",
] as const;

export const BRAND_DICTIONARY: Record<string, string> = {
  avortex: "AVORTEX", stern: "STERN", original: "ORIGINAL", asli: "ORIGINAL", "اصلي": "ORIGINAL", "أصلي": "ORIGINAL",
  mkf: "MKF", mtour: "MTOUR", febi: "FEBI", lemforder: "LEMFORDER", elring: "ELRING", hella: "HELLA", bosch: "BOSCH", behr: "BEHR", mahle: "MAHLE", swag: "SWAG", meyle: "MEYLE", "بجوراتي": "بجوراتي",
};

export interface ExtractedAutomotiveMetadata {
  chassis: string[];
  engines: string[];
  brand: string | null;
}

function normalizeArabic(value: string): string {
  return value.toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u065F]/g, "");
}

function containsCode(tokens: string[], code: string): boolean {
  return tokens.some((token) => token === code || token.startsWith(code));
}

/** Extracts recognised automotive metadata only; unknown words are intentionally ignored. */
export function parseAutomotiveMetadata(name: string): ExtractedAutomotiveMetadata {
  if (!name.trim()) return { chassis: [], engines: [], brand: null };
  const tokens = name.toLocaleUpperCase("en-US").replace(/[\-_/\\.,:;+()]+/g, " ").split(/\s+/).filter(Boolean);
  const normalized = normalizeArabic(name);
  const chassis = CHASSIS_DICTIONARY.filter((code) => containsCode(tokens, code));
  const engines = ENGINE_DICTIONARY.filter((code) => containsCode(tokens, code));
  const brand = Object.entries(BRAND_DICTIONARY).find(([alias]) => {
    const asciiAlias = /^[a-z0-9]+$/i.test(alias);
    return asciiAlias ? tokens.includes(alias.toUpperCase()) : normalized.includes(normalizeArabic(alias));
  })?.[1] ?? null;
  return { chassis: [...new Set(chassis)], engines: [...new Set(engines)], brand };
}

export function mergeAutomotiveCodes(current: readonly string[] = [], inferred: readonly string[] = []): string[] {
  return [...new Set([...current, ...inferred].map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

export function isGenericBrandName(value: string | null | undefined): boolean {
  const normalized = normalizeArabic(value?.trim() ?? "");
  return !normalized || normalized === "عام" || normalized === "بدون علامه تجاريه";
}

export function enrichAutomotiveMetadata<T extends { nameAr: string; nameEn?: string | null; brandName?: string; chassisCodes?: string[]; engineCodes?: string[] }>(input: T): T {
  const extracted = parseAutomotiveMetadata(`${input.nameAr} ${input.nameEn ?? ""}`);
  return {
    ...input,
    brandName: isGenericBrandName(input.brandName) && extracted.brand ? extracted.brand : input.brandName,
    chassisCodes: mergeAutomotiveCodes(input.chassisCodes, extracted.chassis),
    engineCodes: mergeAutomotiveCodes(input.engineCodes, extracted.engines),
  };
}
