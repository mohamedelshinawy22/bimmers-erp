export type VoucherImportType = "RECEIPT" | "PAYMENT";
export type VoucherWorksheetCell = unknown;
export type VoucherWorksheetMatrix = VoucherWorksheetCell[][];

export type ParsedVoucherRow = {
  sourceRowNumber: number;
  seq: number;
  date: string | null;
  time: string | null;
  movementType: string;
  transactionReference: string;
  externalReference: string;
  amount: number;
  itemCategory: string;
  accountName: string;
  treasuryName: string;
  paymentChannels: Array<{ name: string; amount: number }>;
  notes: string;
  createdByName: string;
};

const aliases = {
  date: ["التاريخ", "date"],
  time: ["الوقت", "time"],
  movementType: ["الحركة", "نوع الحركة", "نوع السند", "movement", "type"],
  transactionReference: ["رقم السند", "رقم الحركة", "رقم المعاملة", "transaction number", "voucher number"],
  externalReference: ["المرجع", "reference", "مرجع"],
  amount: ["المبلغ", "القيمة", "amount", "value"],
  itemCategory: ["البند", "التصنيف", "category", "item"],
  accountName: ["الحساب", "اسم الحساب", "العميل", "المورد", "account"],
  treasuryName: ["الخزينة", "treasury"],
  notes: ["ملاحظات", "البيان", "الوصف", "description", "notes"],
  createdByName: ["إضافة المستخدم", "المستخدم", "المسؤول", "created by", "user"],
} as const;

function normalized(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/\s+/g, " "); }
function value(value: unknown) { return String(value ?? "").trim(); }
function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}
function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return value ? String(value).trim() : null;
}
function timeValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(11, 19);
  return value ? String(value).trim() : null;
}
function findColumn(headers: VoucherWorksheetCell[], keys: readonly string[]) { return headers.findIndex((header) => keys.includes(normalized(header) as never)); }
function cell(row: VoucherWorksheetCell[], index: number) { return index >= 0 ? row[index] : undefined; }
function blank(row: VoucherWorksheetCell[]) { return !row.length || row.every((cell) => value(cell) === ""); }
function isHeaderRow(row: VoucherWorksheetCell[]) { return findColumn(row, aliases.amount) >= 0 && (findColumn(row, aliases.movementType) >= 0 || findColumn(row, aliases.accountName) >= 0); }

/** Parses a flexible Arabic/English voucher report, using headers instead of fixed column positions. */
export function parseVoucherWorkbook(matrix: VoucherWorksheetMatrix, defaultType: VoucherImportType): ParsedVoucherRow[] {
  const headerRowIndex = matrix.findIndex(isHeaderRow);
  if (headerRowIndex < 0) throw new Error("لم يتم العثور على صف عناوين يتضمن «المبلغ» في ملف السندات.");
  const headers = matrix[headerRowIndex] ?? [];
  const columns = {
    date: findColumn(headers, aliases.date), time: findColumn(headers, aliases.time), movementType: findColumn(headers, aliases.movementType), transactionReference: findColumn(headers, aliases.transactionReference), externalReference: findColumn(headers, aliases.externalReference), amount: findColumn(headers, aliases.amount), itemCategory: findColumn(headers, aliases.itemCategory), accountName: findColumn(headers, aliases.accountName), treasuryName: findColumn(headers, aliases.treasuryName), notes: findColumn(headers, aliases.notes), createdByName: findColumn(headers, aliases.createdByName),
  };
  const channelStart = columns.treasuryName >= 0 ? columns.treasuryName + 1 : columns.amount + 1;
  const channelEnd = columns.notes >= 0 ? columns.notes : headers.length;
  const channelColumns = headers.slice(Math.max(0, channelStart), Math.max(channelStart, channelEnd)).map((header, offset) => ({ name: value(header), index: channelStart + offset })).filter((channel) => Boolean(channel.name));
  const fallbackChannels = [
    { name: "درج النقدية", index: headers.findIndex((header) => normalized(header) === "درج النقدية") },
    { name: "انستا باي (المحل)", index: headers.findIndex((header) => normalized(header).includes("انستا باي")) },
    { name: "فودافون كاش (محمد ثروت)", index: headers.findIndex((header) => normalized(header).includes("فودافون كاش")) },
    { name: "البنك ABK", index: headers.findIndex((header) => normalized(header).includes("البنك abk")) },
  ].filter((channel) => channel.index >= 0);

  const rows: ParsedVoucherRow[] = [];
  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    if (blank(row) || isHeaderRow(row)) continue;
    const amount = numberValue(cell(row, columns.amount));
    if (amount <= 0) continue;
    const movementType = value(cell(row, columns.movementType)) || (defaultType === "RECEIPT" ? "قبض" : "صرف");
    const selectedChannelColumns = channelColumns.length ? channelColumns : fallbackChannels;
    const paymentChannels = selectedChannelColumns.map((channel) => ({ name: channel.name, amount: numberValue(cell(row, channel.index)) })).filter((channel) => channel.amount > 0);
    const treasuryName = value(cell(row, columns.treasuryName)) || paymentChannels[0]?.name || "درج النقدية";
    rows.push({
      sourceRowNumber: index + 1,
      seq: numberValue(row[0]) || index + 1,
      date: dateValue(cell(row, columns.date)),
      time: timeValue(cell(row, columns.time)),
      movementType,
      transactionReference: value(cell(row, columns.transactionReference)) || `VOUCH-${index + 1}`,
      externalReference: value(cell(row, columns.externalReference)),
      amount,
      itemCategory: value(cell(row, columns.itemCategory)),
      accountName: value(cell(row, columns.accountName)),
      treasuryName,
      paymentChannels,
      notes: value(cell(row, columns.notes)),
      createdByName: value(cell(row, columns.createdByName)),
    });
  }
  return rows;
}

export function voucherRowsToImportRows(rows: ParsedVoucherRow[], defaultType: VoucherImportType) {
  return rows.map((row) => ({ ...row, defaultType }));
}

export function voucherMovementKind(movement: string, defaultType: VoucherImportType): "RECEIPT" | "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT" {
  const normalizedMovement = normalized(movement);
  if (normalizedMovement.includes("تحويل") && (normalizedMovement.includes("إلى") || normalizedMovement.includes("وارد"))) return "TRANSFER_IN";
  if (normalizedMovement.includes("تحويل") && (normalizedMovement.includes("من") || normalizedMovement.includes("صادر"))) return "TRANSFER_OUT";
  if (normalizedMovement.includes("صرف") || normalizedMovement.includes("دفع")) return "PAYMENT";
  if (normalizedMovement.includes("قبض") || normalizedMovement.includes("تحصيل")) return "RECEIPT";
  return defaultType;
}
