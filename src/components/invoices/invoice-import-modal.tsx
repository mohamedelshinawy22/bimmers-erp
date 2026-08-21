"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { downloadInvoiceImportTemplateAction, executeInvoiceImportAction, previewInvoiceImportAction } from "@/server/actions/invoice-import.actions";
import { detailedInvoiceExtractionStats, detectInvoiceWorkbookMode, detailedInvoicesToImportRows, parseUniversalInvoiceWorkbook, summaryInvoicesToImportRows } from "@/lib/invoice-excel-parser";

type InvoiceImportType = "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN";
const importMeta: Record<InvoiceImportType, { title: string; template: string; tone: string }> = {
  SALE: { title: "معالج استيراد فواتير البيع", template: "نموذج فواتير البيع", tone: "text-bmw-blue" },
  PURCHASE: { title: "معالج استيراد فواتير الشراء", template: "نموذج فواتير الشراء", tone: "text-purple-300" },
  SALE_RETURN: { title: "معالج استيراد مرتجع المبيعات", template: "نموذج مرتجعات البيع", tone: "text-amber-300" },
  PURCHASE_RETURN: { title: "معالج استيراد مرتجع المشتريات", template: "نموذج مرتجعات الشراء", tone: "text-rose-300" },
};

type ImportMode = "SUMMARY" | "DETAILED";
type PreviewFilter = "ALL" | "VALID" | "INVALID";
type InvoiceImportPreview = {
  total: number;
  valid: number;
  invalid: Array<{ row: number; reason: string }>;
  rows: Array<{ row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; partName: string; grandTotal: number; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; accountStatus: "CASH_FALLBACK" | "MATCHED" | "AUTO_CREATE" | "NOT_FOUND"; partStatus: "NOT_APPLICABLE" | "MATCHED_CATALOG" | "UNLINKED_TEXT_ITEM"; isValid: boolean; reason?: string; suggestedFix?: string; errorCode?: "ACCOUNT_NOT_FOUND" | "INVALID_QUANTITY" | "INVALID_AMOUNT" | "TREASURY_NOT_FOUND" | "TYPE_MISMATCH" | "FORMAT_INVALID" }>;
};

const aliases: Record<string, string[]> = {
  documentNumber: ["رقم الفاتورة", "الفاتورة", "invoice number", "invoice"],
  type: ["نوع الفاتورة", "نوع المستند", "النوع", "type"],
  accountName: ["الحساب", "اسم الحساب", "العميل", "المورد", "account"],
  accountPhone: ["رقم الهاتف", "الهاتف", "موبايل", "phone"],
  date: ["التاريخ", "date"],
  time: ["الوقت", "time"],
  originalInvoiceNumber: ["الفاتورة المرتجعة", "الفاتورة الأصلية", "original invoice", "return invoice"],
  paymentMethod: ["طريقة السداد", "طريقة الدفع", "payment method"],
  treasuryName: ["الخزينة", "treasury"],
  cashDrawer: ["درج النقدية", "cash drawer"],
  instapay: ["انستا باي (المحل)", "انستا باي", "instapay"],
  vodafoneCash: ["فودافون كاش (محمد ثروت)", "فودافون كاش", "vodafone cash"],
  bankAbk: ["البنك abk", "bank abk", "abk"],
  creditAmount: ["الآجل", "credit"],
  dueAmount: ["المستحق", "due"],
  warehouse: ["المخزن", "warehouse"],
  oemNumber: ["رقم الصنف (oem)", "رقم الصنف/oem", "رقم الصنف", "oem", "oem number", "كود الصنف"],
  partName: ["اسم الصنف", "اسم المنتج", "part name", "item name"],
  quantity: ["كمية", "الكمية", "qty", "quantity"],
  unitPrice: ["السعر", "سعر الوحدة", "price", "unit price"],
  lineDiscount: ["خصم السطر", "خصم", "discount"],
  paidAmount: ["المدفوع", "مسدد نقدا", "paid", "paid amount"],
  grandTotal: ["النهائى", "النهائي", "الإجمالي", "الإجمالى", "grand total", "total"],
  notes: ["ملاحظات", "البيان", "notes"],
};

function normalizeHeader(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/\s+/g, " "); }
function readMappedRow(headers: unknown[], values: unknown[], sourceRowNumber: number, type: InvoiceImportType) {
  const result: Record<string, unknown> = { sourceRowNumber, type };
  for (const [target, names] of Object.entries(aliases)) {
    const index = headers.findIndex((header) => names.includes(normalizeHeader(header)));
    if (index >= 0) result[target] = values[index] ?? "";
  }
  return result;
}
function isUsableInvoiceRow(row: Record<string, unknown>) { return Boolean(String(row.documentNumber ?? "").trim()); }
function previewStateLabel(row: InvoiceImportPreview["rows"][number], mode: ImportMode) {
  if (row.reason) return row.reason;
  if (row.accountStatus === "CASH_FALLBACK") return "عميل نقدي افتراضي";
  if (row.accountStatus === "AUTO_CREATE") return "سيُنشأ الحساب تلقائياً";
  if (mode === "DETAILED" && row.partStatus === "UNLINKED_TEXT_ITEM") return "صنف نصي حر (مقبول)";
  if (mode === "DETAILED" && row.partStatus === "MATCHED_CATALOG") return "مطابق للكتالوج";
  return "مطابق";
}

function downloadBase64(base64: string, fileName: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a"); link.href = href; link.download = fileName; link.click(); URL.revokeObjectURL(href);
}

export function InvoiceImportModal({ type, onClose, onDone }: { type: InvoiceImportType; onClose: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [importMode, setImportMode] = useState<ImportMode>("DETAILED");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [extractionStats, setExtractionStats] = useState<{ invoices: number; items: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [autoCreateAccounts, setAutoCreateAccounts] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("ALL");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvoiceImportPreview | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const invalidCount = preview?.invalid.length ?? 0;
  const validCount = preview?.valid ?? 0;
  const canExecute = rows.length > 0 && (!invalidCount || skipInvalidRows) && validCount > 0;
  const rowSummary = useMemo(() => {
    const source = preview?.rows ?? [];
    const filtered = previewFilter === "VALID" ? source.filter((row) => row.isValid) : previewFilter === "INVALID" ? source.filter((row) => !row.isValid) : source;
    return filtered.slice(0, 100);
  }, [preview, previewFilter]);
  const invalidPreviewRows = useMemo(() => (preview?.rows ?? []).filter((row) => !row.isValid), [preview]);
  const hasUnregisteredAccountErrors = invalidPreviewRows.some((row) => row.errorCode === "ACCOUNT_NOT_FOUND");

  const downloadTemplate = (format: "SUMMARY" | "DETAILED") => startTransition(async () => {
    setError(null);
    const result = await downloadInvoiceImportTemplateAction({ type, format });
    if (!result.success) { setError(result.error); return; }
    downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType);
    setMessage("تم تنزيل النموذج القياسي. املأ صفاً لكل صنف من أصناف الفاتورة ثم ارفعه هنا.");
  });

  const loadFile = (file: File) => {
    setError(null); setMessage(null); setPreview(undefined); setExtractionStats(null); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const first = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        if (!first) throw new Error("لا توجد ورقة بيانات قابلة للقراءة في الملف.");
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: "", raw: true });
        const detectedMode: ImportMode = detectInvoiceWorkbookMode(matrix);
        const parsedInvoices = parseUniversalInvoiceWorkbook(matrix, type);
        const parsed = detectedMode === "DETAILED" ? detailedInvoicesToImportRows(parsedInvoices, type) : summaryInvoicesToImportRows(parsedInvoices, type);
        if (!parsed.length) throw new Error(detectedMode === "DETAILED" ? "لم يتم العثور على بنود أصناف صالحة مرتبطة بفواتير رئيسية." : "لم يتم العثور على صفوف فواتير إجمالية صالحة في الملف.");
        if (parsed.length > 10_000) throw new Error("الحد الأقصى للاستيراد هو 10,000 صف.");
        if (detectedMode === "DETAILED") setExtractionStats(detailedInvoiceExtractionStats(parsedInvoices));
        else setExtractionStats({ invoices: parsedInvoices.length, items: parsedInvoices.length });
        setImportMode(detectedMode);
        if (detectedMode !== importMode) setMessage(detectedMode === "SUMMARY" ? "تم التعرف تلقائياً على التقرير الإجمالي؛ سيُرحّل كقيود مالية من دون بنود مخزون." : "تم التعرف تلقائياً على التقرير التفصيلي بالأصناف؛ سيُرحّل مع بنود المخزون المطابقة.");
        setRows(parsed); setStep(2);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
    };
    reader.readAsArrayBuffer(file);
  };

  const runPreview = () => startTransition(async () => {
    setError(null);
    const result = await previewInvoiceImportAction({ type, mode: importMode, rows, skipInvalidRows, autoCreateAccounts });
    if (!result.success) { setError(result.error); return; }
    setPreview(result.data); setPreviewFilter("ALL"); setStep(3);
  });

  const enableAutoAccountCreation = () => startTransition(async () => {
    setError(null); setAutoCreateAccounts(true);
    const result = await previewInvoiceImportAction({ type, mode: importMode, rows, skipInvalidRows, autoCreateAccounts: true });
    if (!result.success) { setError(result.error); return; }
    setPreview(result.data); setPreviewFilter("ALL"); setStep(3);
  });

  const executeImport = () => startTransition(async () => {
    setError(null);
    const result = await executeInvoiceImportAction({ type, mode: importMode, rows, skipInvalidRows, autoCreateAccounts });
    if (!result.success) { setError(result.error); return; }
    setMessage(`تم إنشاء ${result.data.created} مستند وتخطي ${result.data.skipped} مستند. رقم عملية الاستيراد: ${result.data.jobId}`);
    onDone();
  });

  return <Modal open onClose={onClose} title={importMeta[type].title} description="يقبل هذا المعالج نوع المستند المحدد فقط. كل فاتورة تُرحّل عبر المحرك المالي الذري نفسه المستخدم في النظام." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{step === 2 ? <Button onClick={runPreview} loading={pending} disabled={!rows.length}><CheckCircle2 size={15}/> فحص المطابقة</Button> : null}{step === 3 ? <Button onClick={executeImport} loading={pending} disabled={!canExecute}><UploadCloud size={15}/> تنفيذ الاستيراد الآمن</Button> : null}</>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
      <div className="grid grid-cols-3 gap-2 text-xs"><div className={`rounded-lg border p-2 ${step >= 1 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>1. النموذج والرفع</div><div className={`rounded-lg border p-2 ${step >= 2 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>2. مطابقة البيانات</div><div className={`rounded-lg border p-2 ${step >= 3 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>3. التنفيذ</div></div>
      {step === 1 ? <section className="space-y-3"><Alert variant="info">اختر طريقة الاستيراد أولاً. الاستيراد التفصيلي يطابق الأصناف ويرحّل حركات المخزون، بينما الاستيراد الإجمالي ينشئ قيوداً مالية للفواتير دون بنود أصناف أو أي حركة مخزنية.</Alert><div className="grid gap-3 md:grid-cols-2"><button type="button" onClick={() => { setImportMode("DETAILED"); setRows([]); setPreview(undefined); }} className={`rounded-2xl border p-4 text-right transition ${importMode === "DETAILED" ? "border-bmw-blue bg-bmw-blue/15 ring-1 ring-bmw-blue" : "border-bmw-cardBorder bg-bmw-carbon hover:border-bmw-blue/60"}`}><b className="block text-base text-bmw-blue">استيراد تفصيلي — موصى به</b><span className="mt-1 block text-xs text-bmw-muted">فواتير ببنود أصناف؛ يتحقق من OEM ويحدّث رصيد المخزون عبر محرك الترحيل الذري.</span></button><button type="button" onClick={() => { setImportMode("SUMMARY"); setRows([]); setPreview(undefined); }} className={`rounded-2xl border p-4 text-right transition ${importMode === "SUMMARY" ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500" : "border-bmw-cardBorder bg-bmw-carbon hover:border-emerald-500/60"}`}><b className="block text-base text-emerald-400">استيراد إجمالي — مالي فقط</b><span className="mt-1 block text-xs text-bmw-muted">فاتورة واحدة لكل صف؛ يحدّث الحساب والخزينة فقط، من دون InvoiceItem أو حركات مخزون.</span></button></div><p className={`rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2 text-sm font-bold ${importMeta[type].tone}`}>{importMeta[type].title} — {importMode === "DETAILED" ? "تفصيلي بالأصناف" : "إجمالي مالي"}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadTemplate("SUMMARY")} loading={pending}><Download size={15}/> تنزيل نموذج ملخص مالي</Button><Button variant="outline" onClick={() => downloadTemplate("DETAILED")} loading={pending}><Download size={15}/> تنزيل نموذج تفصيلي بالأصناف</Button><Button onClick={() => inputRef.current?.click()}><FileSpreadsheet size={15}/> اختيار ملف Excel ({importMode === "DETAILED" ? "تفصيلي" : "إجمالي"})</Button><input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.currentTarget.value = ""; }} /></div></section> : null}
      {step === 2 ? <section className="space-y-3"><Alert variant="info">تمت قراءة <b>{rows.length}</b> صفاً من الملف <b>{fileName}</b>. {importMode === "DETAILED" ? "الأصناف المطابقة فقط تؤثر في المخزون؛ الأصناف غير المسجلة تُحفظ كبنود نصية مقبولة مع ترحيل الفاتورة ومالياتها كاملة." : "سيجري التحقق من الحسابات والخزائن قبل إنشاء القيود المالية فقط."}</Alert>{extractionStats ? <div className="grid gap-2 sm:grid-cols-2"><Alert variant="success">تم استخراج <b>{extractionStats.invoices}</b> فاتورة بنجاح.</Alert><Alert variant="info">{importMode === "DETAILED" ? <>تتضمن <b>{extractionStats.items}</b> صنفاً مرتبطاً بفواتيره الرئيسية.</> : <>تقرير مالي إجمالي دون بنود أصناف.</>}</Alert></div> : null}<div className="max-h-64 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المستند</th><th className="p-2">الحساب</th>{importMode === "DETAILED" ? <><th className="p-2">كود الصنف/OEM</th><th className="p-2">اسم القطعة</th><th className="p-2">الكمية</th><th className="p-2">السعر</th></> : <th className="p-2">الإجمالي</th>}</tr></thead><tbody>{rows.slice(0, 15).map((row) => <tr key={String(row.sourceRowNumber)} className="border-t border-bmw-cardBorder"><td className="p-2">{String(row.sourceRowNumber)}</td><td className="p-2 font-mono" dir="ltr">{String(row.documentNumber)}</td><td className="p-2">{String(row.accountName)}</td>{importMode === "DETAILED" ? <><td className="p-2 font-mono" dir="ltr">{String(row.oemNumber)}</td><td className="p-2">{String(row.partName)}</td><td className="p-2 font-mono">{String(row.quantity)}</td><td className="p-2 font-mono">{String(row.unitPrice)}</td></> : <td className="p-2 font-mono">{String(row.grandTotal)}</td>}</tr>)}</tbody></table></div></section> : null}
      {step === 3 && preview ? <section className="space-y-3"><div className="grid grid-cols-3 gap-2 text-center"><button type="button" onClick={() => setPreviewFilter("ALL")} className={`rounded-xl border p-2.5 text-xs font-bold transition ${previewFilter === "ALL" ? "border-slate-500 bg-slate-800 text-white ring-1 ring-slate-500" : "border-bmw-cardBorder bg-bmw-carbon text-bmw-muted hover:border-slate-600"}`}>إجمالي الصفوف: {preview.total}</button><button type="button" onClick={() => setPreviewFilter("VALID")} className={`rounded-xl border p-2.5 text-xs font-bold transition ${previewFilter === "VALID" ? "border-emerald-500 bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-500" : "border-bmw-cardBorder bg-bmw-carbon text-emerald-400 hover:border-emerald-700"}`}>المستندات السليمة: {validCount}</button><button type="button" onClick={() => setPreviewFilter("INVALID")} className={`rounded-xl border p-2.5 text-xs font-bold transition ${previewFilter === "INVALID" ? "border-rose-500 bg-rose-950/60 text-rose-300 ring-1 ring-rose-500" : "border-bmw-cardBorder bg-bmw-carbon text-bmw-mRed hover:border-rose-700"}`}>غير صالحة: {invalidCount}</button></div>{importMode === "DETAILED" ? <Alert variant="info">الأزرق يعني <b>صنفاً نصياً حراً مقبولاً</b>: يُحفظ باسمه وكوده وأسعاره في الفاتورة، ولا ينشئ حركة مخزون حتى يرتبط بصنف كتالوج مستقبلاً.</Alert> : null}<label className="flex cursor-pointer items-start gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><input type="checkbox" checked={autoCreateAccounts} onChange={(event) => setAutoCreateAccounts(event.target.checked)} /><span><b>إنشاء الحسابات غير الموجودة تلقائياً</b> بالنوع المناسب لهذا المعالج؛ الحسابات المتطابقة فقط تُستخدم عند إيقاف الخيار.</span></label>{invalidCount ? <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} /><span><b>تخطي الصفوف غير الصالحة</b> ومتابعة استيراد البيانات المطابقة فقط.</span></label> : null}<div className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المرجع</th><th className="p-2">الحساب</th>{importMode === "DETAILED" ? <><th className="p-2">OEM</th><th className="p-2">اسم القطعة</th></> : <th className="p-2">الإجمالي</th>}<th className="p-2">الحالة</th></tr></thead><tbody>{rowSummary.map((row) => <tr key={row.row} className="border-t border-bmw-cardBorder"><td className="p-2">{row.row}</td><td className="p-2 font-mono" dir="ltr">{row.documentNumber || "—"}</td><td className="p-2">{row.accountName || "—"}</td>{importMode === "DETAILED" ? <><td className="p-2 font-mono" dir="ltr">{row.oemNumber}</td><td className="p-2">{row.partName || "—"}</td></> : <td className="p-2 font-mono">{row.grandTotal.toLocaleString("ar-EG", { minimumFractionDigits: 2 })}</td>}<td className={`p-2 ${!row.isValid ? "text-bmw-mRed" : row.partStatus === "UNLINKED_TEXT_ITEM" ? "text-sky-300" : "text-emerald-400"}`}>{previewStateLabel(row, importMode)}</td></tr>)}</tbody></table></div>{invalidPreviewRows.length ? <div className="space-y-3 rounded-xl border border-rose-900/50 bg-rose-950/25 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-rose-300">بيان الصفوف غير الصالحة وأسباب عدم المطابقة ({invalidPreviewRows.length} صفوف)</p>{hasUnregisteredAccountErrors && !autoCreateAccounts ? <button type="button" onClick={enableAutoAccountCreation} disabled={pending} className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:opacity-60">تفعيل إنشاء الحسابات تلقائياً وحل الأخطاء فوراً</button> : null}</div><div className="max-h-52 overflow-auto rounded-lg border border-rose-900/40"><table className="w-full text-right text-[11px]"><thead><tr className="bg-rose-950/50 text-rose-200"><th className="p-2 text-center">الصف</th><th className="p-2 text-center">رقم الفاتورة</th><th className="p-2">الحساب</th><th className="p-2">الصنف / OEM</th><th className="p-2">سبب عدم الصلاحية</th><th className="p-2">الإجراء المقترح</th></tr></thead><tbody>{invalidPreviewRows.map((row) => <tr key={`invalid-${row.row}`} className="border-t border-rose-900/30 text-slate-300"><td className="p-2 text-center font-mono font-bold text-bmw-mRed">{row.row}</td><td className="p-2 text-center font-mono" dir="ltr">{row.documentNumber || "—"}</td><td className="p-2 font-semibold text-white">{row.accountName || "—"}</td><td className="p-2 font-mono text-slate-400" dir="ltr">{row.oemNumber ? `${row.oemNumber}${row.partName ? ` — ${row.partName}` : ""}` : row.partName || "—"}</td><td className="p-2 text-rose-300">{row.reason || "صف غير صالح"}</td><td className="p-2 text-amber-300/90">{row.suggestedFix || "راجع بيانات الصف ثم أعد الفحص."}</td></tr>)}</tbody></table></div></div> : null}</section> : null}
    </div>
  </Modal>;
}
