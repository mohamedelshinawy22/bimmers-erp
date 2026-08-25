"use client";

import { useMemo, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { downloadInventoryImportTemplateAction, executeInventoryImportAction } from "@/server/actions/import.actions";
import { parseSpreadsheetNumber, validateInventoryImportRow } from "@/lib/inventory-import";
import { normalizeImportHeader, resolveImportColumns } from "@/lib/import-export/parser";

const FIELDS = [["nameAr", "اسم الصنف *"], ["oemNumber", "كود القطعة / OEM *"], ["barcode", "الباركود"], ["brand", "الماركة (اختياري)"], ["category", "التصنيف (اختياري)"], ["chassis", "الشاسيه"], ["engine", "المحرك"], ["cost", "سعر الشراء *"], ["price", "سعر البيع *"], ["quantity", "الكمية الافتتاحية *"], ["bin", "موقع الرف"]] as const;
type MappedRow = { nameAr: string; oemNumber: string; barcode: string; brand: string; category: string; chassis: string; engine: string; cost: string; price: string; quantity: string; bin: string };
type SpreadsheetRow = Record<string, unknown> & { __sourceRowNumber?: number };

function cellText(value: unknown) { return String(value ?? "").trim(); }
function downloadBase64(base64: string, fileName: string, mimeType: string) { const raw = atob(base64); const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: mimeType })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
function isIgnoredSpreadsheetRow(row: Record<string, unknown>, headers: string[]) {
  const values = Object.entries(row).filter(([key]) => key !== "__sourceRowNumber").map(([, value]) => cellText(value)).filter(Boolean);
  if (values.length === 0) return true;
  const normalizedHeaders = new Set(headers.map(normalizeImportHeader));
  const repeatedHeader = values.length >= 2 && values.every((value) => normalizedHeaders.has(normalizeImportHeader(value)));
  if (repeatedHeader) return true;
  const first = values[0]?.toLocaleLowerCase("ar-EG") ?? "";
  return /^(?:الإجمالي|اجمالي|المجموع|total|grand total)\b/i.test(first);
}

export function ExcelImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [prunedRows, setPrunedRows] = useState(0);
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [pending, startTransition] = useTransition();
  const required = ["nameAr", "oemNumber", "cost", "price", "quantity"];
  const requiredMapped = required.every((field) => mapping[field]);

  const mappedRows = useMemo(() => {
    const cell = (row: SpreadsheetRow, field: keyof MappedRow) => {
      const column = mapping[field];
      return column ? cellText(row[column]) : "";
    };
    return rows.map((row, index) => ({
      sourceRowNumber: Number(row.__sourceRowNumber ?? index + 2),
      row: {
        nameAr: cell(row, "nameAr"), oemNumber: cell(row, "oemNumber"), barcode: cell(row, "barcode"),
        brand: cell(row, "brand"), category: cell(row, "category"), chassis: cell(row, "chassis"), engine: cell(row, "engine"),
        cost: cell(row, "cost"), price: cell(row, "price"), quantity: cell(row, "quantity"), bin: cell(row, "bin"),
      } satisfies MappedRow,
    }));
  }, [rows, mapping]);

  const rowChecks = useMemo(() => mappedRows.map(({ sourceRowNumber, row }) => ({ sourceRowNumber, row, issues: validateInventoryImportRow(row) })), [mappedRows]);
  const preview = rowChecks.slice(0, 10);
  const invalidRows = rowChecks.filter((check) => check.issues.length > 0);
  const invalidCount = invalidRows.length;
  const validCount = rowChecks.length - invalidCount;
  const canProceed = requiredMapped && (invalidCount === 0 || (skipInvalidRows && validCount > 0));

  const fileChange = async (file?: File) => {
    if (!file) return;
    const data = await file.arrayBuffer();
    const book = XLSX.read(data, { type: "array" });
    const sheetName = book.SheetNames[0];
    const sheet = sheetName ? book.Sheets[sheetName] : undefined;
    if (!sheet) { setMessage("الملف لا يحتوي على ورقة بيانات صالحة."); return; }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
    const headerRowIndex = matrix.findIndex((row) => {
      const detected = resolveImportColumns(row);
      return typeof detected.nameAr === "number" && typeof detected.oemNumber === "number";
    });
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", range: headerRowIndex >= 0 ? headerRowIndex : 0 });
    if (json.length === 0) { setMessage("الورقة لا تحتوي على صفوف بيانات للاستيراد."); return; }
    const fileHeaders = Object.keys(json[0] ?? {});
    const parsedRows = json.map((row, index) => ({ ...row, __sourceRowNumber: index + (headerRowIndex >= 0 ? headerRowIndex + 2 : 2) }));
    const cleanRows = parsedRows.filter((row) => !isIgnoredSpreadsheetRow(row, fileHeaders));
    if (cleanRows.length === 0) { setMessage("لم يتم العثور على صفوف أصناف بعد تجاهل الصفوف الفارغة أو صفوف الإجمالي والعناوين المكررة."); return; }
    const automaticColumns = resolveImportColumns(fileHeaders);
    const automaticMapping = Object.entries(automaticColumns).reduce<Record<string, string>>((result, [field, index]) => {
      const header = typeof index === "number" ? fileHeaders[index] : undefined;
      if (header) result[field] = header;
      return result;
    }, {});
    setRows(cleanRows); setHeaders(fileHeaders); setPrunedRows(parsedRows.length - cleanRows.length); setMapping(automaticMapping); setSkipInvalidRows(true); setMessage(""); setStep(2);
  };

  const downloadInvalidReport = () => {
    if (invalidRows.length === 0) return;
    const report = invalidRows.map(({ sourceRowNumber, row, issues }) => ({
      "رقم الصف في الملف": sourceRowNumber,
      "سبب الرفض": issues.map((issue) => issue.message).join(" • "),
      "اسم الصنف": row.nameAr,
      "OEM": row.oemNumber,
      "سعر الشراء": row.cost,
      "سعر البيع": row.price,
      "الكمية": row.quantity,
      "الماركة": row.brand,
      "التصنيف": row.category,
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report), "الصفوف غير الصالحة");
    XLSX.writeFile(book, "inventory-import-invalid-rows.xlsx");
  };

  const downloadTemplate = () => startTransition(async () => {
    setMessage("");
    const result = await downloadInventoryImportTemplateAction();
    if (!result.success) { setMessage(result.error); return; }
    downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType);
  });

  const confirm = () => startTransition(async () => {
    setMessage("");
    const result = await executeInventoryImportAction({
      mapping,
      skipInvalidRows,
      rows: rowChecks.map(({ sourceRowNumber, row }) => ({
        ...row,
        sourceRowNumber,
        cost: parseSpreadsheetNumber(row.cost) ?? Number.NaN,
        price: parseSpreadsheetNumber(row.price) ?? Number.NaN,
        quantity: parseSpreadsheetNumber(row.quantity) ?? Number.NaN,
      })),
    });
    if (!result.success) { setMessage(result.error); return; }
    if (result.data.duplicate) { setMessage("سبق تنفيذ نفس الصفوف السليمة في هذا الملف؛ لم تُنشأ أصناف إضافية."); return; }
    setMessage(`تم استيراد ${result.data.created} صنف، وتخطي ${result.data.skipped} صنف مكرر${result.data.skippedInvalid ? `، واستبعاد ${result.data.skippedInvalid} صف غير صالح` : ""}.`);
  });

  return <Modal open={open} onClose={onClose} title="استيراد بضاعة من إكسيل" description={`الخطوة ${step} من 4`} footer={<div className="flex justify-between"><Button type="button" variant="subtle" disabled={pending} onClick={() => step === 1 ? onClose() : setStep(step - 1)}><ChevronRight size={16} />السابق</Button>{step < 4 ? <Button type="button" disabled={(step === 2 && !requiredMapped) || (step === 3 && !canProceed)} onClick={() => setStep(step + 1)}>التالي<ChevronLeft size={16} /></Button> : <Button type="button" loading={pending} disabled={!canProceed} onClick={confirm}>تأكيد الاستيراد</Button>}</div>}>
    {step === 1 ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bmw-cardBorder"><Upload className="text-bmw-blue" /><span>اختر ملف XLSX أو CSV</span><label className="cursor-pointer rounded-lg bg-bmw-blue px-3 py-2 text-sm font-medium text-white">رفع ملف<input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void fileChange(event.target.files?.[0])} /></label><Button type="button" variant="outline" size="sm" loading={pending} onClick={downloadTemplate}><Download size={15} />تحميل النموذج القياسي</Button></div> : null}
    {step === 2 ? <div className="max-h-96 space-y-2 overflow-auto"><p className="rounded-lg bg-bmw-blue/10 p-2 text-xs text-bmw-silver">حقول الماركة والتصنيف اختيارية؛ سيُستخدم <b>عام</b> و<b>بدون تصنيف</b> عند تركهما فارغين.</p>{FIELDS.map(([field, label]) => <label key={field} className="grid grid-cols-2 items-center gap-3 text-sm"><span>{label}</span><select className="rounded-lg border border-bmw-cardBorder bg-bmw-black p-2" value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}><option value="">— اختر العمود —</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div> : null}
    {step === 3 ? <div className="overflow-auto"><div className={`mb-3 flex items-center gap-2 ${invalidCount === 0 ? "text-emerald-400" : "text-amber-400"}`}>{invalidCount === 0 ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{invalidCount === 0 ? `عدد السجلات الجاهزة: ${rows.length}` : `يوجد ${invalidCount} صف غير صالح و${validCount} صنف سليم.`}</div>{prunedRows > 0 ? <p className="mb-3 text-xs text-bmw-muted">تم تجاهل {prunedRows} صف فارغ أو صف إجمالي أو عنوان مكرر تلقائياً.</p> : null}{invalidCount > 0 ? <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><label className="flex cursor-pointer items-start gap-2 text-sm text-bmw-silver"><input type="checkbox" className="mt-1 h-4 w-4 accent-bmw-blue" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} /><span><b>تخطي الصفوف غير الصالحة ({invalidCount} صنف)</b> ومتابعة استيراد الأصناف السليمة ({validCount} صنف).</span></label><button type="button" onClick={downloadInvalidReport} className="mt-2 inline-flex items-center gap-1 text-xs text-bmw-blue underline underline-offset-4"><Download size={14} />تحميل تقرير الصفوف غير الصالحة (Excel)</button></div> : null}<table className="w-full text-xs"><thead><tr><th>صف الملف</th><th>الصنف</th><th>OEM</th><th>تكلفة</th><th>بيع</th><th>كمية</th><th>التحقق</th></tr></thead><tbody>{preview.map(({ sourceRowNumber, row, issues }) => { const issueText = issues.map((issue) => issue.message).join(" • "); return <tr key={sourceRowNumber} className={issues.length ? "bg-bmw-mRed/15 text-bmw-silver" : ""}><td>{sourceRowNumber}</td><td>{row.nameAr || "—"}</td><td>{row.oemNumber || "—"}</td><td>{row.cost}</td><td>{row.price}</td><td>{row.quantity}</td><td>{issues.length ? <span title={issueText} aria-label={issueText} className="inline-flex cursor-help items-center gap-1 text-bmw-mRed"><AlertCircle size={16} /><span>خطأ</span></span> : <CheckCircle2 size={16} className="text-emerald-400" />}</td></tr>; })}</tbody></table>{rowChecks.length > 10 ? <p className="mt-2 text-xs text-bmw-muted">تُعرض أول 10 صفوف فقط؛ تم فحص جميع {rowChecks.length} صفاً قبل المتابعة.</p> : null}</div> : null}
    {step === 4 ? <div className="rounded-xl bg-bmw-carbon p-4 text-sm"><p>سيتم استيراد {validCount} صنف سليم في دفعات آمنة من 100 صف{skipInvalidRows && invalidCount > 0 ? `، مع تخطي ${invalidCount} صف غير صالح` : ""}. تقبل الأرقام الفواصل والرموز النقدية والمسافات، ويسمح OEM بالشرطة والشرطة المائلة مثل <span className="font-mono">51117111741/742</span>.</p>{message ? <p className={`mt-2 ${message.includes("تم") || message.includes("سبق") ? "text-emerald-400" : "text-bmw-mRed"}`}>{message}</p> : null}</div> : null}
  </Modal>;
}
