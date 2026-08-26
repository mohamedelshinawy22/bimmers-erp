import { parseImportNumber } from "./import-export/parser";

export type ParsedAccountImportRow = {
  sourceRowNumber: number;
  accountNumber: string;
  name: string;
  type: string;
  phone: string;
  email: string;
  taxNumber: string;
  address: string;
  category: string;
  creditLimit: string | number;
  defaultPriceTier: string;
  openingBalance: string | number;
  isActive: string | boolean;
};

type FieldName = keyof Omit<ParsedAccountImportRow, "sourceRowNumber">;
type ColumnMap = Partial<Record<FieldName | "debit" | "credit", number>>;

const normalizeHeader = (value: unknown) => String(value ?? "")
  .trim()
  .toLocaleLowerCase("ar-EG")
  .replace(/[أإآٱ]/g, "ا")
  .replace(/[ىي]/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/[^\p{L}\p{N}]/gu, "");

const aliases: Record<FieldName | "debit" | "credit", string[]> = {
  accountNumber: ["كودالحساب", "رقمالحساب", "رقمالعميل", "رقمالمورد", "الكود", "accountcode", "accountnumber", "code"],
  name: ["اسمالحساب", "اسمالعميل", "اسمالمورد", "الاسم", "العميل", "المورد", "name", "accountname", "customername", "suppliername"],
  type: ["طبيعهالحساب", "نوعالحساب", "النوع", "التصنيف", "type", "accounttype", "classification"],
  phone: ["موبايل", "رقمالهاتف", "التليفون", "الهاتف", "الموبايل", "mobile", "phone"],
  email: ["البريدالالكتروني", "email"],
  taxNumber: ["الرقمالضريبيالسجل", "الرقمالضريبي", "taxid", "taxnumber"],
  address: ["العنوان", "address"],
  category: ["تصنيفالحساب", "الفئه", "category"],
  creditLimit: ["حدالائتمان", "السقفالمصرفي", "السقفالاتماني", "creditlimit"],
  defaultPriceTier: ["شريحهالتسعير", "pricetier", "defaultpricetier"],
  openingBalance: ["الرصيدالافتتاحي", "رصيدافتتاحي", "الرصيدالحالي", "openingbalance", "balance"],
  isActive: ["الحاله", "نشط", "فعال", "active", "status"],
  debit: ["عليهمدين", "مدين", "debit"],
  credit: ["لهدائن", "دائن", "credit"],
};

const hasAlias = (label: string, candidates: string[]) => candidates.some((candidate) => label === candidate || label.includes(candidate));
const getCell = (row: unknown[], index?: number) => index === undefined ? "" : row[index] ?? "";
const text = (value: unknown) => String(value ?? "").trim();

function normalizeAccountType(value: unknown) {
  const token = normalizeHeader(value);
  if (["supplier", "مورد", "موردون"].includes(token)) return "SUPPLIER";
  if (["workshop", "workshopbmw", "ورشه", "ورش", "ورشهbmw"].includes(token)) return "WORKSHOP_BMW";
  if (["expense", "مصروف", "مصروفات"].includes(token)) return "EXPENSE";
  return "CUSTOMER";
}

function isSummaryName(value: string) {
  const key = normalizeHeader(value);
  return key.includes("الاجمالي") || key.includes("اجمالي") || key.includes("total");
}

function isHeaderContinuation(row: unknown[], nameColumn?: number, accountNumberColumn?: number) {
  if (!row.length) return false;
  const headerCells = row.map(normalizeHeader);
  const headerMatches = headerCells.filter((cell) => Object.values(aliases).some((values) => hasAlias(cell, values))).length;
  const hasDataIdentifier = Boolean(text(getCell(row, nameColumn)) || text(getCell(row, accountNumberColumn)));
  return headerMatches > 0 && !hasDataIdentifier;
}

function resolveColumns(header: unknown[], continuation: unknown[] | null): ColumnMap {
  const labels = header.map((cell, index) => [normalizeHeader(cell), continuation ? normalizeHeader(continuation[index]) : ""].filter(Boolean).join(" "));
  const map: ColumnMap = {};
  for (const [field, candidates] of Object.entries(aliases) as Array<[keyof ColumnMap, string[]]>) {
    const column = field === "accountNumber"
      ? candidates.map((candidate) => labels.findIndex((label) => label === candidate || label.includes(candidate))).find((index) => index >= 0) ?? -1
      : labels.findIndex((label) => hasAlias(label, candidates));
    if (column >= 0) map[field] = column;
  }
  return map;
}

export function parseAccountImportMatrix(matrix: unknown[][]): ParsedAccountImportRow[] {
  const headerRowIndex = matrix.slice(0, 5).findIndex((row) => {
    const labels = row.map(normalizeHeader);
    return labels.some((label) => hasAlias(label, aliases.name) || hasAlias(label, aliases.accountNumber));
  });
  if (headerRowIndex < 0) return [];

  const header = matrix[headerRowIndex] ?? [];
  const initialColumns = resolveColumns(header, null);
  const nextRow = matrix[headerRowIndex + 1] ?? [];
  const continuation = isHeaderContinuation(nextRow, initialColumns.name, initialColumns.accountNumber) ? nextRow : null;
  const resolvedColumns = resolveColumns(header, continuation);
  const firstDataRowIndex = headerRowIndex + (continuation ? 2 : 1);
  const firstDataRow = matrix[firstDataRowIndex] ?? [];
  const hasUnlabelledLeadingIndex = firstDataRow.length > header.length
    && /^\d+$/.test(text(firstDataRow[0]));
  const columns: ColumnMap = hasUnlabelledLeadingIndex
    ? Object.fromEntries(Object.entries(resolvedColumns).map(([field, column]) => [field, Number(column) + 1]))
    : resolvedColumns;

  return matrix.slice(firstDataRowIndex).flatMap((record, offset) => {
    const name = text(getCell(record, columns.name));
    const accountNumber = text(getCell(record, columns.accountNumber));
    const phone = text(getCell(record, columns.phone));
    const debit = parseImportNumber(getCell(record, columns.debit)) ?? 0;
    const credit = parseImportNumber(getCell(record, columns.credit)) ?? 0;
    const directBalance = getCell(record, columns.openingBalance);
    const hasValues = [name, accountNumber, phone, text(directBalance), text(getCell(record, columns.debit)), text(getCell(record, columns.credit))].some(Boolean);
    if (!hasValues || isSummaryName(name)) return [];

    return [{
      sourceRowNumber: firstDataRowIndex + offset + 1,
      accountNumber,
      name,
      type: normalizeAccountType(getCell(record, columns.type)),
      phone,
      email: text(getCell(record, columns.email)),
      taxNumber: text(getCell(record, columns.taxNumber)),
      address: text(getCell(record, columns.address)),
      category: text(getCell(record, columns.category)),
      creditLimit: text(getCell(record, columns.creditLimit)),
      defaultPriceTier: /جمله|wholesale/i.test(text(getCell(record, columns.defaultPriceTier))) ? "WHOLESALE" : "RETAIL",
      openingBalance: debit > 0 ? -debit : credit > 0 ? credit : text(directBalance),
      isActive: text(getCell(record, columns.isActive)) || "true",
    }];
  });
}
