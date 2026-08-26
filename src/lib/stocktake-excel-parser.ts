import { parseSpreadsheetNumber } from "./inventory-import";
import { normalizeImportHeader } from "./import-export/parser";
import { normalizeSearchTerm } from "./search-utils";

export type PhysicalCountRow = { sourceRowNumber: number; oemNumber: string; nameAr: string; brand: string; category: string; actualQuantity: number | null };

const headerKey = (value: unknown) => normalizeSearchTerm(normalizeImportHeader(value)).numericNormalized;
const includesAny = (header: string, aliases: string[]) => aliases.some((alias) => header.includes(alias));
const SERIAL_HEADERS = new Set(["م", "مسلسل", "ت", "#", "id", "seq", "no", "number"]);
const isSerialHeader = (raw: unknown) => SERIAL_HEADERS.has(normalizeImportHeader(raw).toLocaleLowerCase("ar-EG"));
const isOemHeader = (header: string) => includesAny(header, ["oem", "رقموem", "رقمالقطعه", "كودالصنف", "كودالقطعه", "الباركود", "barcode", "partnumber", "partno", "itemcode", "code"]);
const isStrictNameHeader = (header: string) => includesAny(header, ["اسمالصنف", "اسمالقطعه", "اسمالمنتج", "البيان", "الوصف", "description", "itemname", "productname"]);
const isFallbackNameHeader = (header: string) => ["الصنف", "المنتج", "القطعه", "item", "product", "name"].includes(header);
const isBrandHeader = (header: string) => includesAny(header, ["الماركه", "العلامهالتجاريه", "brand"]);
const isCategoryHeader = (header: string) => includesAny(header, ["التصنيف", "الفئه", "القسم", "category"]);
const textValue = (value: unknown) => /[ء-يa-zA-Z]/.test(String(value ?? "").trim());
const numberValue = (value: unknown) => /^\d+(?:[.,]\d+)?$/.test(String(value ?? "").trim());

function quantityScore(header: string) {
  if (includesAny(header, ["الكميهالفعليه", "الرصيدالفعلي", "actualquantity", "physicalquantity", "physicalcount", "countedquantity"])) return 3;
  if (includesAny(header, ["الرصيد", "الكميه", "العدد", "المخزون", "رصيد", "كميه", "quantity", "qty", "stock", "count", "balance"])) return 2;
  if (includesAny(header, ["فعلي", "actual"])) return 1;
  return 0;
}

function findBestColumn(headers: string[], predicate: (header: string, columnIndex: number) => boolean) {
  const index = headers.findIndex(predicate);
  return index >= 0 ? index : -1;
}

export function resolveStocktakeHeaders(matrix: unknown[][]) {
  for (let index = 0; index < Math.min(5, matrix.length); index += 1) {
    const rawHeaders = matrix[index] ?? [];
    const headers = rawHeaders.map(headerKey);
    const serial = new Set(rawHeaders.flatMap((header, columnIndex) => isSerialHeader(header) ? [columnIndex] : []));
    const oem = findBestColumn(headers, (header, columnIndex) => !serial.has(columnIndex) && isOemHeader(header));
    let name = findBestColumn(headers, (header, columnIndex) => !serial.has(columnIndex) && !isOemHeader(header) && isStrictNameHeader(header));
    if (name < 0) name = findBestColumn(headers, (header, columnIndex) => !serial.has(columnIndex) && !isOemHeader(header) && isFallbackNameHeader(header));
    const actualQuantity = headers.reduce<{ index: number; score: number }>((best, header, columnIndex) => {
      if (serial.has(columnIndex)) return best;
      const score = quantityScore(header);
      return score > best.score ? { index: columnIndex, score } : best;
    }, { index: -1, score: 0 }).index;
    const sampleRows = matrix.slice(index + 1).filter((row) => row.some((value) => String(value ?? "").trim())).slice(0, 5);
    const nameMostlyNumeric = name >= 0 && sampleRows.length > 0 && sampleRows.every((row) => numberValue(row[name]));
    if (nameMostlyNumeric) {
      const recoveredName = headers.findIndex((header, columnIndex) => !serial.has(columnIndex) && columnIndex !== actualQuantity && columnIndex !== oem && !isOemHeader(header) && sampleRows.some((row) => textValue(row[columnIndex])));
      if (recoveredName >= 0) name = recoveredName;
    }
    const brand = findBestColumn(headers, (header, columnIndex) => !serial.has(columnIndex) && isBrandHeader(header));
    const category = findBestColumn(headers, (header, columnIndex) => !serial.has(columnIndex) && isCategoryHeader(header));
    if (actualQuantity >= 0 && (oem >= 0 || name >= 0)) return { headerRowIndex: index, oem, name, brand, category, actualQuantity };
  }
  return null;
}

export function parsePhysicalCountMatrix(matrix: unknown[][]): { rows: PhysicalCountRow[]; headerRowIndex: number | null; error?: string } {
  const resolved = resolveStocktakeHeaders(matrix);
  if (!resolved) return { rows: [], headerRowIndex: null, error: "تعذر العثور على ترويسة تحتوي الرصيد أو الكمية مع رقم OEM أو كود الصنف أو اسم الصنف ضمن أول خمسة صفوف." };
  const rows = matrix.slice(resolved.headerRowIndex + 1).flatMap((values, offset) => {
    const oemNumber = String(resolved.oem >= 0 ? values[resolved.oem] ?? "" : "").trim();
    const nameAr = String(resolved.name >= 0 ? values[resolved.name] ?? "" : "").trim();
    const brand = String(resolved.brand >= 0 ? values[resolved.brand] ?? "" : "").trim();
    const category = String(resolved.category >= 0 ? values[resolved.category] ?? "" : "").trim();
    const rawQuantity = resolved.actualQuantity >= 0 ? values[resolved.actualQuantity] : undefined;
    const actualQuantity = parseSpreadsheetNumber(rawQuantity);
    const valuesText = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!valuesText.length || /^(?:الإجمالي|اجمالي|المجموع|total|grand total)$/i.test(valuesText[0] ?? "")) return [];
    return [{ sourceRowNumber: resolved.headerRowIndex + offset + 2, oemNumber, nameAr, brand, category, actualQuantity: actualQuantity === null ? null : actualQuantity }];
  });
  return { rows, headerRowIndex: resolved.headerRowIndex };
}
