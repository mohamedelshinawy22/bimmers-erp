import { normalizeSearchTerm } from "./search-utils";

export type StocktakeMatchMethod = "OEM_BRAND" | "OEM_NAME" | "OEM" | "NAME_BRAND" | "NAME_CATEGORY" | "NAME";
export type StocktakeMatchCandidate = { id: string; oemNumber: string; nameAr: string; brandName: string; category?: string };
export type StocktakeMatchInput = { oemNumber: string; nameAr: string; brand: string; category?: string };
export type StocktakeMatchResult = { part: StocktakeMatchCandidate | null; matchedBy: StocktakeMatchMethod | null; ambiguous: boolean };

const normalizeOem = (value?: string) => normalizeSearchTerm(value ?? "").numericNormalized;
const normalizeName = (value?: string) => normalizeSearchTerm(value ?? "").normalized;

function unique(candidates: StocktakeMatchCandidate[]): StocktakeMatchCandidate | null {
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * Resolves catalog variants conservatively. Brand/name combinations win before
 * OEM-only or name-only fallbacks, so shared automotive references never
 * silently select the wrong manufacturer variant.
 */
export function matchStocktakeProduct(input: StocktakeMatchInput, catalog: readonly StocktakeMatchCandidate[]): StocktakeMatchResult {
  const oem = normalizeOem(input.oemNumber);
  const name = normalizeName(input.nameAr);
  const brand = normalizeName(input.brand);
  const category = normalizeName(input.category);
  const oemMatches = oem ? catalog.filter((part) => normalizeOem(part.oemNumber) === oem) : [];
  const nameMatches = name ? catalog.filter((part) => normalizeName(part.nameAr) === name) : [];

  if (oem && brand) {
    const part = unique(oemMatches.filter((candidate) => normalizeName(candidate.brandName) === brand));
    if (part) return { part, matchedBy: "OEM_BRAND", ambiguous: false };
  }
  if (oem && name) {
    const part = unique(oemMatches.filter((candidate) => normalizeName(candidate.nameAr) === name));
    if (part) return { part, matchedBy: "OEM_NAME", ambiguous: false };
  }
  if (oem) {
    const part = unique(oemMatches);
    if (part) return { part, matchedBy: "OEM", ambiguous: false };
  }
  if (name && brand) {
    const part = unique(nameMatches.filter((candidate) => normalizeName(candidate.brandName) === brand));
    if (part) return { part, matchedBy: "NAME_BRAND", ambiguous: false };
  }
  if (name && category) {
    const part = unique(nameMatches.filter((candidate) => normalizeName(candidate.category) === category));
    if (part) return { part, matchedBy: "NAME_CATEGORY", ambiguous: false };
  }
  if (name) {
    const part = unique(nameMatches);
    if (part) return { part, matchedBy: "NAME", ambiguous: false };
  }
  return { part: null, matchedBy: null, ambiguous: oemMatches.length > 0 || nameMatches.length > 0 };
}
