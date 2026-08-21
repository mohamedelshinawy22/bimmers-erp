export type InvoiceWorkbookType = "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN";

type WorksheetCell = unknown;
type WorksheetMatrix = WorksheetCell[][];

export type ParsedInvoiceLineItem = {
  sourceRowNumber: number;
  itemCode: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  netTotal: number;
};

export type ParsedMasterInvoice = {
  seq: number;
  sourceRowNumber: number;
  date: string | null;
  time: string | null;
  invoiceNumber: string;
  originalInvoiceNumber?: string;
  accountName: string;
  paymentMethod: string;
  totalQty: number;
  discountAmount: number;
  netTotal: number;
  cashDrawer: number;
  instapay: number;
  vodafoneCash: number;
  bankAbk: number;
  paidAmount: number;
  creditAmount: number;
  dueAmount: number;
  warehouse: string;
  items: ParsedInvoiceLineItem[];
};

const headerAliases = {
  date: ["التاريخ", "date"],
  time: ["الوقت", "time"],
  documentNumber: ["رقم الفاتورة", "invoice number", "invoice"],
  originalInvoiceNumber: ["الفاتورة المرتجعة", "الفاتورة الأصلية", "original invoice"],
  accountName: ["الحساب", "اسم الحساب", "العميل", "المورد", "account"],
  paymentMethod: ["طريقة السداد", "طريقة الدفع", "payment method"],
  totalQty: ["كمية", "الكمية", "qty", "quantity"],
  discount: ["خصم", "الخصم", "discount"],
  netTotal: ["النهائى", "النهائي", "الإجمالي", "الإجمالى", "grand total", "total"],
  cashDrawer: ["درج النقدية", "cash drawer"],
  instapay: ["انستا باي (المحل)", "instapay"],
  vodafoneCash: ["فودافون كاش (محمد ثروت)", "فودافون كاش", "vodafone cash"],
  bankAbk: ["البنك abk", "bank abk"],
  paidAmount: ["مسدد نقدا", "المدفوع", "paid amount"],
  creditAmount: ["الآجل", "credit", "credit amount"],
  dueAmount: ["المستحق", "due", "due amount"],
  warehouse: ["المخزن", "warehouse"],
} as const;

function normalized(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/\s+/g, " ");
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function numericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const parsed = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function findColumn(headers: WorksheetCell[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(normalized(header) as never));
}

function cellAt(row: WorksheetCell[], column: number) {
  return column >= 0 ? row[column] : undefined;
}

function isBlankRow(row: WorksheetCell[]) {
  return !row.length || row.every((cell) => stringValue(cell) === "");
}

function hasItemHeaders(row: WorksheetCell[]) {
  return normalized(row[1]) === "رقم الصنف" && normalized(row[2]) === "اسم الصنف";
}

function isMasterInvoiceRow(row: WorksheetCell[], documentColumn: number) {
  const sequence = numericValue(row[0]);
  return sequence > 0 && stringValue(cellAt(row, documentColumn)) !== "";
}

function toDateString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return stringValue(value) || null;
}

function toTimeString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(11, 19);
  return stringValue(value) || null;
}

/**
 * Parses the hierarchical workbook emitted by the legacy ERP reports. The state
 * machine opens a master invoice on a numbered row, accepts only item rows that
 * follow its item sub-header, and deliberately ignores visual subtotal rows.
 */
export function parseDetailedInvoiceWorkbook(worksheetData: WorksheetMatrix, type: InvoiceWorkbookType): ParsedMasterInvoice[] {
  const topHeaderIndex = worksheetData.findIndex((row) => findColumn(row, headerAliases.documentNumber) >= 0);
  if (topHeaderIndex < 0) throw new Error("لم يتم العثور على رأس «رقم الفاتورة» في التقرير التفصيلي.");

  const headers = worksheetData[topHeaderIndex] ?? [];
  const documentColumn = findColumn(headers, headerAliases.documentNumber);
  const dateColumn = findColumn(headers, headerAliases.date);
  const timeColumn = findColumn(headers, headerAliases.time);
  const originalColumn = findColumn(headers, headerAliases.originalInvoiceNumber);
  const accountColumn = findColumn(headers, headerAliases.accountName);
  const paymentColumn = findColumn(headers, headerAliases.paymentMethod);
  const qtyColumn = findColumn(headers, headerAliases.totalQty);
  const discountColumn = findColumn(headers, headerAliases.discount);
  const totalColumn = findColumn(headers, headerAliases.netTotal);
  const cashColumn = findColumn(headers, headerAliases.cashDrawer);
  const instapayColumn = findColumn(headers, headerAliases.instapay);
  const walletColumn = findColumn(headers, headerAliases.vodafoneCash);
  const bankColumn = findColumn(headers, headerAliases.bankAbk);
  const paidColumn = findColumn(headers, headerAliases.paidAmount);
  const creditColumn = findColumn(headers, headerAliases.creditAmount);
  const dueColumn = findColumn(headers, headerAliases.dueAmount);
  const warehouseColumn = findColumn(headers, headerAliases.warehouse);

  const invoices: ParsedMasterInvoice[] = [];
  let currentInvoice: ParsedMasterInvoice | null = null;
  let itemSectionOpen = false;

  for (let rowIndex = topHeaderIndex + 1; rowIndex < worksheetData.length; rowIndex += 1) {
    const row = worksheetData[rowIndex] ?? [];
    if (isBlankRow(row)) continue;

    if (isMasterInvoiceRow(row, documentColumn)) {
      if (currentInvoice) invoices.push(currentInvoice);
      const accountName = stringValue(cellAt(row, accountColumn)) || "نقدي";
      const originalInvoiceNumber = stringValue(cellAt(row, originalColumn));
      currentInvoice = {
        seq: numericValue(row[0]),
        sourceRowNumber: rowIndex + 1,
        date: toDateString(cellAt(row, dateColumn)),
        time: toTimeString(cellAt(row, timeColumn)),
        invoiceNumber: stringValue(cellAt(row, documentColumn)),
        ...(originalInvoiceNumber ? { originalInvoiceNumber } : {}),
        accountName,
        paymentMethod: stringValue(cellAt(row, paymentColumn)) || "نقدي",
        totalQty: numericValue(cellAt(row, qtyColumn)),
        discountAmount: numericValue(cellAt(row, discountColumn)),
        netTotal: numericValue(cellAt(row, totalColumn)),
        cashDrawer: numericValue(cellAt(row, cashColumn)),
        instapay: numericValue(cellAt(row, instapayColumn)),
        vodafoneCash: numericValue(cellAt(row, walletColumn)),
        bankAbk: numericValue(cellAt(row, bankColumn)),
        paidAmount: numericValue(cellAt(row, paidColumn)),
        creditAmount: numericValue(cellAt(row, creditColumn)),
        dueAmount: numericValue(cellAt(row, dueColumn)),
        warehouse: stringValue(cellAt(row, warehouseColumn)) || "المخزن الرئيسي",
        items: [],
      };
      itemSectionOpen = false;
      continue;
    }

    if (hasItemHeaders(row)) {
      itemSectionOpen = Boolean(currentInvoice);
      continue;
    }

    if (!currentInvoice || !itemSectionOpen) continue;
    const itemCode = stringValue(row[1]);
    const itemName = stringValue(row[2]);
    // Totals rows retain only qty / totals, whereas valid item rows always carry
    // both an item code and name. Keeping this condition prevents phantom rows.
    if (!itemCode || !itemName) continue;

    currentInvoice.items.push({
      sourceRowNumber: rowIndex + 1,
      itemCode,
      name: itemName,
      unit: stringValue(row[3]) || "قطعة",
      quantity: numericValue(row[5]),
      unitPrice: numericValue(row[6]),
      discount: numericValue(row[7]),
      netTotal: numericValue(row[8]),
    });
  }

  if (currentInvoice) invoices.push(currentInvoice);
  return invoices;
}

export function detectInvoiceWorkbookMode(worksheetData: WorksheetMatrix): "DETAILED" | "SUMMARY" {
  return worksheetData.some((row) => hasItemHeaders(row)) ? "DETAILED" : "SUMMARY";
}

/**
 * Parses either workbook form emitted by the legacy ERP: a hierarchical report
 * with item subheaders, or one flat summary row per invoice. Flat records receive
 * one descriptive, non-stock summary line so their document context survives any
 * caller that expects line-oriented records; summary posting still remains
 * financial-only and never creates stock movements.
 */
export function parseUniversalInvoiceWorkbook(worksheetData: WorksheetMatrix, type: InvoiceWorkbookType): ParsedMasterInvoice[] {
  if (detectInvoiceWorkbookMode(worksheetData) === "DETAILED") return parseDetailedInvoiceWorkbook(worksheetData, type);
  const headerIndex = worksheetData.findIndex((row) => findColumn(row, headerAliases.documentNumber) >= 0);
  if (headerIndex < 0) throw new Error("لم يتم العثور على رأس «رقم الفاتورة» في التقرير الإجمالي.");
  const headers = worksheetData[headerIndex] ?? [];
  const documentColumn = findColumn(headers, headerAliases.documentNumber);
  const dateColumn = findColumn(headers, headerAliases.date);
  const timeColumn = findColumn(headers, headerAliases.time);
  const originalColumn = findColumn(headers, headerAliases.originalInvoiceNumber);
  const accountColumn = findColumn(headers, headerAliases.accountName);
  const paymentColumn = findColumn(headers, headerAliases.paymentMethod);
  const qtyColumn = findColumn(headers, headerAliases.totalQty);
  const discountColumn = findColumn(headers, headerAliases.discount);
  const totalColumn = findColumn(headers, headerAliases.netTotal);
  const cashColumn = findColumn(headers, headerAliases.cashDrawer);
  const instapayColumn = findColumn(headers, headerAliases.instapay);
  const walletColumn = findColumn(headers, headerAliases.vodafoneCash);
  const bankColumn = findColumn(headers, headerAliases.bankAbk);
  const paidColumn = findColumn(headers, headerAliases.paidAmount);
  const creditColumn = findColumn(headers, headerAliases.creditAmount);
  const dueColumn = findColumn(headers, headerAliases.dueAmount);
  const warehouseColumn = findColumn(headers, headerAliases.warehouse);
  const invoices: ParsedMasterInvoice[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < worksheetData.length; rowIndex += 1) {
    const row = worksheetData[rowIndex] ?? [];
    if (isBlankRow(row) || !isMasterInvoiceRow(row, documentColumn)) continue;
    const invoiceNumber = stringValue(cellAt(row, documentColumn));
    const totalQty = numericValue(cellAt(row, qtyColumn));
    const netTotal = numericValue(cellAt(row, totalColumn));
    const discountAmount = numericValue(cellAt(row, discountColumn));
    const originalInvoiceNumber = stringValue(cellAt(row, originalColumn));
    invoices.push({
      seq: numericValue(row[0]), sourceRowNumber: rowIndex + 1, date: toDateString(cellAt(row, dateColumn)), time: toTimeString(cellAt(row, timeColumn)), invoiceNumber,
      ...(originalInvoiceNumber ? { originalInvoiceNumber } : {}), accountName: stringValue(cellAt(row, accountColumn)) || "نقدي", paymentMethod: stringValue(cellAt(row, paymentColumn)) || "نقدي",
      totalQty, discountAmount, netTotal, cashDrawer: numericValue(cellAt(row, cashColumn)), instapay: numericValue(cellAt(row, instapayColumn)), vodafoneCash: numericValue(cellAt(row, walletColumn)), bankAbk: numericValue(cellAt(row, bankColumn)), paidAmount: numericValue(cellAt(row, paidColumn)), creditAmount: numericValue(cellAt(row, creditColumn)), dueAmount: numericValue(cellAt(row, dueColumn)), warehouse: stringValue(cellAt(row, warehouseColumn)) || "المخزن الرئيسي",
      items: [{ sourceRowNumber: rowIndex + 1, itemCode: "", name: `فاتورة إجمالية #${invoiceNumber}`, unit: "عملية", quantity: totalQty || 1, unitPrice: netTotal, discount: discountAmount, netTotal }],
    });
  }
  return invoices;
}

export function summaryInvoicesToImportRows(invoices: ParsedMasterInvoice[], type: InvoiceWorkbookType) {
  return invoices.map((invoice) => ({
    sourceRowNumber: invoice.sourceRowNumber, documentNumber: invoice.invoiceNumber, type, accountName: invoice.accountName, originalInvoiceNumber: invoice.originalInvoiceNumber ?? "", paymentMethod: invoice.paymentMethod, treasuryName: "", cashDrawer: invoice.cashDrawer, instapay: invoice.instapay, vodafoneCash: invoice.vodafoneCash, bankAbk: invoice.bankAbk, creditAmount: invoice.creditAmount, dueAmount: invoice.dueAmount, warehouse: invoice.warehouse, oemNumber: "", partName: `فاتورة إجمالية #${invoice.invoiceNumber}`, quantity: invoice.totalQty || 1, unitPrice: invoice.netTotal, lineDiscount: invoice.discountAmount, grandTotal: invoice.netTotal, paidAmount: invoice.paidAmount, notes: `تقرير إجمالي — فاتورة ${invoice.invoiceNumber}`,
  }));
}

export function detailedInvoicesToImportRows(invoices: ParsedMasterInvoice[], type: InvoiceWorkbookType) {
  return invoices.flatMap((invoice) => invoice.items.map((item) => ({
    sourceRowNumber: item.sourceRowNumber,
    documentNumber: invoice.invoiceNumber,
    type,
    accountName: invoice.accountName,
    originalInvoiceNumber: invoice.originalInvoiceNumber ?? "",
    paymentMethod: invoice.paymentMethod,
    treasuryName: "",
    cashDrawer: invoice.cashDrawer,
    instapay: invoice.instapay,
    vodafoneCash: invoice.vodafoneCash,
    bankAbk: invoice.bankAbk,
    creditAmount: invoice.creditAmount,
    dueAmount: invoice.dueAmount,
    warehouse: invoice.warehouse,
    oemNumber: item.itemCode,
    partName: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineDiscount: item.discount,
    grandTotal: invoice.netTotal,
    paidAmount: invoice.paidAmount,
    notes: `تقرير تفصيلي — فاتورة ${invoice.invoiceNumber}`,
  })));
}

export function detailedInvoiceExtractionStats(invoices: ParsedMasterInvoice[]) {
  return { invoices: invoices.length, items: invoices.reduce((total, invoice) => total + invoice.items.length, 0) };
}
