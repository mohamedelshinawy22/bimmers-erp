import * as XLSX from "xlsx";

export type SpreadsheetFormat = "XLSX" | "CSV";

export function tenantFileToken(tenantName: string): string {
  const normalized = tenantName
    .trim()
    .toLocaleLowerCase("ar-EG")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "tenant";
}

/** Builds a right-to-left workbook whose identity is supplied by the active tenant. */
export function buildTenantWorkbook({
  tenantName,
  reportTitle,
  sheetName,
  headers,
  records,
  widths,
  format,
  footerRows = [],
}: {
  tenantName: string;
  reportTitle: string;
  sheetName: string;
  headers: readonly string[];
  records: ReadonlyArray<Record<string, unknown>>;
  widths: readonly number[];
  format: SpreadsheetFormat;
  footerRows?: ReadonlyArray<readonly unknown[]>;
}): { base64: string; mimeType: string; extension: "xlsx" | "csv" } {
  const rows: unknown[][] = [
    [tenantName],
    [reportTitle],
    [`تاريخ التصدير: ${new Date().toLocaleDateString("ar-EG")}`],
    [...headers],
    ...records.map((record) => headers.map((header) => record[header] ?? "")),
    ...footerRows.map((row) => [...row]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!views"] = [{ rightToLeft: true }];

  if (format === "CSV") {
    const csv = `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`;
    return { base64: Buffer.from(csv, "utf8").toString("base64"), mimeType: "text/csv;charset=utf-8", extension: "csv" };
  }

  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return { base64: Buffer.from(buffer).toString("base64"), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
}
