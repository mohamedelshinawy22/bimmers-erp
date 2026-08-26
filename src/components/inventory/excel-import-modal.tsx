"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { downloadInventoryImportTemplateAction } from "@/server/actions/import.actions";
import { parseSpreadsheetNumber, validateInventoryImportRow } from "@/lib/inventory-import";
import { normalizeImportHeader, resolveImportColumns } from "@/lib/import-export/parser";

const FIELDS = [["nameAr", "اسم الصنف *"], ["oemNumber", "كود القطعة / OEM *"], ["barcode", "الباركود"], ["brand", "الماركة (اختياري)"], ["category", "التصنيف (اختياري)"], ["chassis", "الشاسيه"], ["engine", "المحرك"], ["cost", "سعر الشراء *"], ["price", "سعر البيع *"], ["quantity", "الكمية الافتتاحية *"], ["bin", "موقع الرف"]] as const;
type MappedRow = { nameAr: string; oemNumber: string; barcode: string; brand: string; category: string; chassis: string; engine: string; cost: string; price: string; quantity: string; bin: string };
type SpreadsheetRow = Record<string, unknown> & { __sourceRowNumber?: number };
type ImportChunkResponse = { success?: boolean; error?: string; data?: { created: number; skipped: number; skippedInvalid: number } };
const INVENTORY_IMPORT_CHUNK_SIZE = 10;

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
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [prunedRows, setPrunedRows] = useState(0);
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number } | null>(null);
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
    const headers = ["رقم الصف في الإكسيل", "كود OEM / الصنف", "سبب الاستبعاد"];
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = invalidRows.map(({ sourceRowNumber, row, issues }) => [sourceRowNumber, row.oemNumber || row.nameAr || "—", issues.map((issue) => issue.message).join(" • ")]);
    const csv = [headers, ...lines].map((line) => line.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "inventory-import-invalid-rows.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => startTransition(async () => {
    setMessage("");
    const result = await downloadInventoryImportTemplateAction();
    if (!result.success) { setMessage(result.error); return; }
    downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType);
  });

  const confirm = () => {
    void (async () => {
    setMessage("");
    const submissionRows = rowChecks.map(({ sourceRowNumber, row }) => ({
        ...row,
        sourceRowNumber,
        cost: parseSpreadsheetNumber(row.cost) ?? Number.NaN,
        price: parseSpreadsheetNumber(row.price) ?? Number.NaN,
        quantity: parseSpreadsheetNumber(row.quantity) ?? Number.NaN,
      }));
    let created = 0; let skipped = 0; let skippedInvalid = 0; let processed = 0;
    setImportProgress({ processed, total: submissionRows.length });
    try {
      for (let start = 0; start < submissionRows.length; start += INVENTORY_IMPORT_CHUNK_SIZE) {
        const rows = submissionRows.slice(start, start + INVENTORY_IMPORT_CHUNK_SIZE);
        let result: ImportChunkResponse | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch("/api/catalog/import-chunk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapping, skipInvalidRows, rows }) });
          const parsed = await response.json().catch(() => null) as ImportChunkResponse | null;
          result = parsed;
          if (response.ok && result?.success && result.data) break;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (!result?.success || !result.data) throw new Error(result?.error || `تعذر معالجة الدفعة رقم ${Math.floor(start / INVENTORY_IMPORT_CHUNK_SIZE) + 1}`);
        created += result.data.created; skipped += result.data.skipped; skippedInvalid += result.data.skippedInvalid;
        processed += rows.length;
        setImportProgress({ processed, total: submissionRows.length });
      }
      router.refresh();
      setMessage(`تم استيراد ${created} صنف، وتخطي ${skipped} صنف مكرر${skippedInvalid ? `، واستبعاد ${skippedInvalid} صف غير صالح` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر استيراد دفعة من الأصناف.");
    } finally {
      setImportProgress(null);
    }
    })();
  };

  return <Modal open={open} onClose={onClose} title="استيراد بضاعة من إكسيل" description={`الخطوة ${step} من 4`} footer={<div className="flex justify-between"><Button type="button" variant="subtle" disabled={pending || Boolean(importProgress)} onClick={() => step === 1 ? onClose() : setStep(step - 1)}><ChevronRight size={16} />السابق</Button>{step < 4 ? <Button type="button" disabled={Boolean(importProgress) || (step === 2 && !requiredMapped) || (step === 3 && !canProceed)} onClick={() => setStep(step + 1)}>التالي<ChevronLeft size={16} /></Button> : <Button type="button" loading={pending || Boolean(importProgress)} disabled={!canProceed || Boolean(importProgress)} onClick={confirm}>تأكيد الاستيراد</Button>}</div>}>
    {step === 1 ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bmw-cardBorder"><Upload className="text-bmw-blue" /><span>اختر ملف XLSX أو CSV</span><label className="cursor-pointer rounded-lg bg-bmw-blue px-3 py-2 text-sm font-medium text-white">رفع ملف<input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void fileChange(event.target.files?.[0])} /></label><Button type="button" variant="outline" size="sm" loading={pending} onClick={downloadTemplate}><Download size={15} />تحميل النموذج القياسي</Button></div> : null}
    {step === 2 ? <div className="max-h-96 space-y-2 overflow-auto"><p className="rounded-lg bg-bmw-blue/10 p-2 text-xs text-bmw-silver">حقول الماركة والتصنيف اختيارية؛ سيُستخدم <b>عام</b> و<b>بدون تصنيف</b> عند تركهما فارغين.</p>{FIELDS.map(([field, label]) => <label key={field} className="grid grid-cols-2 items-center gap-3 text-sm"><span>{label}</span><select className="rounded-lg border border-bmw-cardBorder bg-bmw-black p-2" value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}><option value="">— اختر العمود —</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div> : null}
    {step === 3 ? <div className="overflow-auto"><div className={`mb-3 flex items-center gap-2 ${invalidCount === 0 ? "text-emerald-400" : "text-amber-400"}`}>{invalidCount === 0 ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{invalidCount === 0 ? `عدد السجلات الجاهزة: ${rows.length}` : `يوجد ${invalidCount} صف غير صالح و${validCount} صنف سليم.`}</div>{prunedRows > 0 ? <p className="mb-3 text-xs text-bmw-muted">تم تجاهل {prunedRows} صف فارغ أو صف إجمالي أو عنوان مكرر تلقائياً.</p> : null}{invalidCount > 0 ? <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><label className="flex cursor-pointer items-start gap-2 text-sm text-bmw-silver"><input type="checkbox" className="mt-1 h-4 w-4 accent-bmw-blue" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} /><span><b>تخطي الصفوف غير الصالحة ({invalidCount} صنف)</b> ومتابعة استيراد الأصناف السليمة ({validCount} صنف).</span></label><button type="button" onClick={downloadInvalidReport} className="mt-2 inline-flex items-center gap-1 text-xs text-bmw-blue underline underline-offset-4"><Download size={14} />تحميل تقرير الصفوف غير الصالحة CSV</button></div> : null}<table className="w-full text-xs"><thead><tr><th>صف الملف</th><th>الصنف</th><th>OEM</th><th>تكلفة</th><th>بيع</th><th>كمية</th><th>التحقق</th></tr></thead><tbody>{preview.map(({ sourceRowNumber, row, issues }) => { const issueText = issues.map((issue) => issue.message).join(" • "); return <tr key={sourceRowNumber} className={issues.length ? "bg-bmw-mRed/15 text-bmw-silver" : ""}><td>{sourceRowNumber}</td><td>{row.nameAr || "—"}</td><td>{row.oemNumber || "—"}</td><td>{row.cost}</td><td>{row.price}</td><td>{row.quantity}</td><td>{issues.length ? <span title={issueText} aria-label={issueText} className="inline-flex cursor-help items-center gap-1 text-bmw-mRed"><AlertCircle size={16} /><span>خطأ</span></span> : <CheckCircle2 size={16} className="text-emerald-400" />}</td></tr>; })}</tbody></table>{rowChecks.length > 10 ? <p className="mt-2 text-xs text-bmw-muted">تُعرض أول 10 صفوف فقط؛ تم فحص جميع {rowChecks.length} صفاً قبل المتابعة.</p> : null}</div> : null}
    {step === 4 ? <div className="rounded-xl bg-bmw-carbon p-4 text-sm"><p>سيتم استيراد {validCount} صنف سليم في دفعات آمنة من {INVENTORY_IMPORT_CHUNK_SIZE} صف{skipInvalidRows && invalidCount > 0 ? `، مع تخطي ${invalidCount} صف غير صالح` : ""}. تقبل الأرقام الفواصل والرموز النقدية والمسافات، ويسمح OEM بالشرطة والشرطة المائلة مثل <span className="font-mono">51117111741/742</span>.</p>{invalidCount > 0 ? <details className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><summary className="cursor-pointer font-semibold text-amber-300">عرض تفاصيل {invalidCount} صف غير صالح</summary><div className="mt-3 max-h-56 overflow-auto"><table className="w-full text-xs"><thead><tr><th className="p-2 text-right">رقم الصف في الإكسيل</th><th className="p-2 text-right">كود OEM / الصنف</th><th className="p-2 text-right">سبب الاستبعاد</th></tr></thead><tbody>{invalidRows.map(({ sourceRowNumber, row, issues }) => <tr key={sourceRowNumber} className="border-t border-amber-500/20"><td className="p-2 tabular">{sourceRowNumber}</td><td className="p-2">{row.oemNumber || row.nameAr || "—"}</td><td className="p-2 text-bmw-silver">{issues.map((issue) => issue.message).join(" • ")}</td></tr>)}</tbody></table></div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={downloadInvalidReport}><Download size={14} />تحميل تقرير الصفوف غير الصالحة CSV</Button></details> : null}{importProgress ? <div className="mt-3 rounded-lg border border-bmw-blue/30 bg-bmw-blue/10 p-3"><div className="mb-2 flex justify-between text-xs text-bmw-blue"><span>جارٍ ترحيل الأصناف: {importProgress.processed} من أصل {importProgress.total}</span><b>{Math.round((importProgress.processed / Math.max(1, importProgress.total)) * 100)}%</b></div><div className="h-2 overflow-hidden rounded-full bg-bmw-carbon"><div className="h-full bg-bmw-blue transition-all" style={{ width: `${Math.round((importProgress.processed / Math.max(1, importProgress.total)) * 100)}%` }} /></div></div> : null}{message ? <p className={`mt-2 ${message.includes("تم") || message.includes("سبق") ? "text-emerald-400" : "text-bmw-mRed"}`}>{message}</p> : null}</div> : null}
  </Modal>;
}
