import { parseSpreadsheetNumber } from "./inventory-import";
import { normalizeImportHeader } from "./import-export/parser";
import { normalizeSearchTerm } from "./search-utils";

export type PhysicalCountRow = { sourceRowNumber: number; oemNumber: string; nameAr: string; actualQuantity: number | null };

const has = (header: string, values: string[]) => values.some((value) => header.includes(value));
const headerKey = (value: unknown) => normalizeSearchTerm(normalizeImportHeader(value)).numericNormalized;

export function resolveStocktakeHeaders(matrix: unknown[][]) {
  for (let index = 0; index < Math.min(5, matrix.length); index += 1) {
    const headers = (matrix[index] ?? []).map(headerKey);
    const oem = headers.findIndex((header) => has(header, ["oem", "رقمالقطعه", "كودالقطعه", "رقمالصنف", "partnumber"]));
    const name = headers.findIndex((header) => has(header, ["اسمالصنف", "اسمالقطعه", "الصنف", "الاسم", "name"]));
    const actualQuantity = headers.findIndex((header) => has(header, ["الكميهالفعليه", "الرصيدالفعلي", "العدد", "actualquantity", "physicalquantity"]));
    if (actualQuantity >= 0 && (oem >= 0 || name >= 0)) return { headerRowIndex: index, oem, name, actualQuantity };
  }
  return null;
}

export function parsePhysicalCountMatrix(matrix: unknown[][]): { rows: PhysicalCountRow[]; headerRowIndex: number | null; error?: string } {
  const resolved = resolveStocktakeHeaders(matrix);
  if (!resolved) return { rows: [], headerRowIndex: null, error: "تعذر العثور على ترويسة تحتوي الكمية الفعلية مع رقم OEM أو اسم الصنف ضمن أول خمسة صفوف." };
  const rows = matrix.slice(resolved.headerRowIndex + 1).flatMap((values, offset) => {
    const oemNumber = String(resolved.oem >= 0 ? values[resolved.oem] ?? "" : "").trim();
    const nameAr = String(resolved.name >= 0 ? values[resolved.name] ?? "" : "").trim();
    const rawQuantity = resolved.actualQuantity >= 0 ? values[resolved.actualQuantity] : undefined;
    const actualQuantity = parseSpreadsheetNumber(rawQuantity);
    const valuesText = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!valuesText.length || /^(?:الإجمالي|اجمالي|المجموع|total|grand total)$/i.test(valuesText[0] ?? "")) return [];
    return [{ sourceRowNumber: resolved.headerRowIndex + offset + 2, oemNumber, nameAr, actualQuantity: actualQuantity === null ? null : actualQuantity }];
  });
  return { rows, headerRowIndex: resolved.headerRowIndex };
}
