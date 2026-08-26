import { parseSpreadsheetNumber } from "./inventory-import";
import { normalizeImportHeader } from "./import-export/parser";
import { normalizeSearchTerm } from "./search-utils";

export type PhysicalCountRow = { sourceRowNumber: number; oemNumber: string; nameAr: string; actualQuantity: number | null };

const headerKey = (value: unknown) => normalizeSearchTerm(normalizeImportHeader(value)).numericNormalized;
const includesAny = (header: string, aliases: string[]) => aliases.some((alias) => header.includes(alias));

function quantityScore(header: string) {
  if (includesAny(header, ["الكميهالفعليه", "الرصيدالفعلي", "actualquantity", "physicalquantity", "physicalcount", "countedquantity"])) return 3;
  if (includesAny(header, ["الرصيد", "الكميه", "العدد", "المخزون", "رصيد", "كميه", "quantity", "qty", "stock", "count", "balance"])) return 2;
  if (includesAny(header, ["فعلي", "actual"])) return 1;
  return 0;
}

function findBestColumn(headers: string[], predicate: (header: string) => boolean) {
  const index = headers.findIndex(predicate);
  return index >= 0 ? index : -1;
}

export function resolveStocktakeHeaders(matrix: unknown[][]) {
  for (let index = 0; index < Math.min(5, matrix.length); index += 1) {
    const headers = (matrix[index] ?? []).map(headerKey);
    const oem = findBestColumn(headers, (header) => includesAny(header, ["oem", "رقموem", "رقمالقطعه", "كودالصنف", "كودالقطعه", "الباركود", "barcode", "partnumber", "itemcode", "code"]));
    const name = findBestColumn(headers, (header) => includesAny(header, ["اسمالصنف", "الصنف", "اسمالقطعه", "البيان", "الوصف", "المنتج", "description", "product", "item", "name"]));
    const actualQuantity = headers.reduce<{ index: number; score: number }>((best, header, columnIndex) => {
      const score = quantityScore(header);
      return score > best.score ? { index: columnIndex, score } : best;
    }, { index: -1, score: 0 }).index;
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
