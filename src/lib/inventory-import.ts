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
export function parseSpreadsheetNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const westernDigits = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\u00a0/g, " ")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/[^0-9,\.\-+]/g, "")
    .replace(/\s/g, "")
    // Currency abbreviations such as "ج.م" leave a trailing dot after their
    // letters are removed; it is not part of the numeric value.
    .replace(/[,.]+$/g, "");

  if (!westernDigits || !/[0-9]/.test(westernDigits) || !/^[+-]?[0-9.,]+$/.test(westernDigits)) return null;

  const hasComma = westernDigits.includes(",");
  const hasDot = westernDigits.includes(".");
  let normalized = westernDigits;

  if (hasComma && hasDot) {
    const decimalSeparator = westernDigits.lastIndexOf(",") > westernDigits.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = westernDigits.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
  } else if (hasComma) {
    normalized = /^[+-]?\d{1,3}(,\d{3})+$/.test(westernDigits)
      ? westernDigits.replaceAll(",", "")
      : westernDigits.replace(",", ".");
  } else if ((westernDigits.match(/\./g) ?? []).length > 1) {
    normalized = westernDigits.replaceAll(".", "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

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
