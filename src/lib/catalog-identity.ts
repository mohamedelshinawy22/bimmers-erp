import { normalizeSearchTerm } from "./search-utils";

/** Stable comparison key for Arabic/English catalog names without changing the stored label. */
export function normalizeCatalogName(value: string | null | undefined): string {
  return normalizeSearchTerm(value ?? "").normalized;
}

export function hasSameCatalogIdentity(
  candidate: { oemNumber: string; nameAr: string },
  input: { oemNumber: string; nameAr: string },
): boolean {
  return candidate.oemNumber === input.oemNumber
    && normalizeCatalogName(candidate.nameAr) === normalizeCatalogName(input.nameAr);
}
