export type InventoryImportRow = {
  nameAr: string;
  oemNumber: string;
  barcode?: string;
  brand?: string;
  category?: string;
  chassis?: string;
  engine?: string;
  cost: string | number;
  price: string | number;
  quantity: string | number;
  bin?: string;
};

export type InventoryImportRowIssue = {
  field: "nameAr" | "oemNumber" | "cost" | "price" | "quantity";
  message: string;
};

/**
 * Parses the common values exported by Excel: Arabic/Western digits, thousands
 * separators, NBSPs, and currency labels/symbols. It deliberately returns null
 * for blank or malformed values so an invalid spreadsheet row is not silently
 * imported as zero.
 */
export const parseSpreadsheetNumber = parseImportNumber;

export function validateInventoryImportRow(row: InventoryImportRow): InventoryImportRowIssue[] {
  const issues: InventoryImportRowIssue[] = [];
  if (!row.nameAr?.trim()) issues.push({ field: "nameAr", message: "اسم الصنف مطلوب." });
  if (!row.oemNumber?.trim()) issues.push({ field: "oemNumber", message: "كود الصنف / OEM مطلوب." });

  const cost = parseSpreadsheetNumber(row.cost);
  const price = parseSpreadsheetNumber(row.price);
  const quantity = parseSpreadsheetNumber(row.quantity);

  if (cost === null || cost < 0) issues.push({ field: "cost", message: "سعر الشراء يجب أن يكون رقماً صفرياً أو موجباً." });
  if (price === null || price < 0) issues.push({ field: "price", message: "سعر البيع يجب أن يكون رقماً صفرياً أو موجباً." });
  if (quantity === null || !Number.isInteger(quantity) || quantity < 0) issues.push({ field: "quantity", message: "الكمية الافتتاحية يجب أن تكون عدداً صحيحاً صفرياً أو موجباً." });

  return issues;
}
import { parseImportNumber } from "./import-export/parser";
