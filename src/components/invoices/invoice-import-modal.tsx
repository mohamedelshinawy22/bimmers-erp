"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { downloadInvoiceImportTemplateAction, executeInvoiceImportAction, previewInvoiceImportAction } from "@/server/actions/invoice-import.actions";

type InvoiceImportType = "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN";
const importMeta: Record<InvoiceImportType, { title: string; template: string; tone: string }> = {
  SALE: { title: "معالج استيراد فواتير البيع", template: "نموذج فواتير البيع", tone: "text-bmw-blue" },
  PURCHASE: { title: "معالج استيراد فواتير الشراء", template: "نموذج فواتير الشراء", tone: "text-purple-300" },
  SALE_RETURN: { title: "معالج استيراد مرتجع المبيعات", template: "نموذج مرتجعات البيع", tone: "text-amber-300" },
  PURCHASE_RETURN: { title: "معالج استيراد مرتجع المشتريات", template: "نموذج مرتجعات الشراء", tone: "text-rose-300" },
};

type InvoiceImportPreview = {
  total: number;
  valid: number;
  invalid: Array<{ row: number; reason: string }>;
  rows: Array<{ row: number; documentNumber: string; type: string; accountName: string; oemNumber: string; accountMatched: boolean; partMatched: boolean; treasuryMatched: boolean; reason?: string }>;
};

const aliases: Record<string, string[]> = {
  documentNumber: ["رقم الفاتورة", "الفاتورة", "invoice number", "invoice"],
  type: ["نوع الفاتورة", "نوع المستند", "النوع", "type"],
  accountName: ["الحساب", "اسم الحساب", "العميل", "المورد", "account"],
  accountPhone: ["رقم الهاتف", "الهاتف", "موبايل", "phone"],
  originalInvoiceNumber: ["الفاتورة المرتجعة", "الفاتورة الأصلية", "original invoice", "return invoice"],
  paymentMethod: ["طريقة السداد", "طريقة الدفع", "payment method"],
  treasuryName: ["الخزينة", "treasury"],
  oemNumber: ["رقم الصنف (oem)", "رقم الصنف", "oem", "oem number", "كود الصنف"],
  quantity: ["كمية", "الكمية", "qty", "quantity"],
  unitPrice: ["السعر", "سعر الوحدة", "price", "unit price"],
  lineDiscount: ["خصم السطر", "خصم", "discount"],
  paidAmount: ["المدفوع", "مسدد نقدا", "paid", "paid amount"],
  notes: ["ملاحظات", "البيان", "notes"],
};

function normalizeHeader(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/\s+/g, " "); }
function mapRows(sheet: XLSX.WorkSheet) {
  const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return source.map((record, index) => {
    const result: Record<string, unknown> = { sourceRowNumber: index + 2 };
    for (const [target, names] of Object.entries(aliases)) {
      const sourceKey = Object.keys(record).find((key) => names.includes(normalizeHeader(key)));
      result[target] = sourceKey ? record[sourceKey] : "";
    }
    return result;
  }).filter((row) => Object.values(row).some((value) => String(value).trim()));
}

function downloadBase64(base64: string, fileName: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a"); link.href = href; link.download = fileName; link.click(); URL.revokeObjectURL(href);
}

export function InvoiceImportModal({ type, onClose, onDone }: { type: InvoiceImportType; onClose: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState("");
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [autoCreateAccounts, setAutoCreateAccounts] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvoiceImportPreview | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const invalidCount = preview?.invalid.length ?? 0;
  const validCount = preview?.valid ?? 0;
  const canExecute = rows.length > 0 && (!invalidCount || skipInvalidRows) && validCount > 0;
  const rowSummary = useMemo(() => preview?.rows.slice(0, 10) ?? [], [preview]);

  const downloadTemplate = (format: "SUMMARY" | "DETAILED") => startTransition(async () => {
    setError(null);
    const result = await downloadInvoiceImportTemplateAction({ type, format });
    if (!result.success) { setError(result.error); return; }
    downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType);
    setMessage("تم تنزيل النموذج القياسي. املأ صفاً لكل صنف من أصناف الفاتورة ثم ارفعه هنا.");
  });

  const loadFile = (file: File) => {
    setError(null); setMessage(null); setPreview(undefined); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const first = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        if (!first) throw new Error("لا توجد ورقة بيانات قابلة للقراءة في الملف.");
        const parsed = mapRows(first);
        if (!parsed.length) throw new Error("لم يتم العثور على صفوف بيانات في الملف.");
        if (parsed.length > 10_000) throw new Error("الحد الأقصى للاستيراد هو 10,000 صف.");
        setRows(parsed); setStep(2);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
    };
    reader.readAsArrayBuffer(file);
  };

  const runPreview = () => startTransition(async () => {
    setError(null);
    const result = await previewInvoiceImportAction({ type, rows, skipInvalidRows, autoCreateAccounts });
    if (!result.success) { setError(result.error); return; }
    setPreview(result.data); setStep(3);
  });

  const executeImport = () => startTransition(async () => {
    setError(null);
    const result = await executeInvoiceImportAction({ type, rows, skipInvalidRows, autoCreateAccounts });
    if (!result.success) { setError(result.error); return; }
    setMessage(`تم إنشاء ${result.data.created} مستند وتخطي ${result.data.skipped} مستند. رقم عملية الاستيراد: ${result.data.jobId}`);
    onDone();
  });

  return <Modal open onClose={onClose} title={importMeta[type].title} description="يقبل هذا المعالج نوع المستند المحدد فقط. كل فاتورة تُرحّل عبر المحرك المالي الذري نفسه المستخدم في النظام." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{step === 2 ? <Button onClick={runPreview} loading={pending} disabled={!rows.length}><CheckCircle2 size={15}/> فحص المطابقة</Button> : null}{step === 3 ? <Button onClick={executeImport} loading={pending} disabled={!canExecute}><UploadCloud size={15}/> تنفيذ الاستيراد الآمن</Button> : null}</>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
      <div className="grid grid-cols-3 gap-2 text-xs"><div className={`rounded-lg border p-2 ${step >= 1 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>1. النموذج والرفع</div><div className={`rounded-lg border p-2 ${step >= 2 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>2. مطابقة البيانات</div><div className={`rounded-lg border p-2 ${step >= 3 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>3. التنفيذ</div></div>
      {step === 1 ? <section className="space-y-3"><Alert variant="info">الحقول الأساسية: رقم الفاتورة، نوع الفاتورة، الحساب، رقم OEM، الكمية، والسعر. للمرتجعات أضف رقم الفاتورة الأصلية. لا يتم اعتماد أي صف قبل مطابقة الحساب والصنف والخزينة على الخادم.</Alert><p className={`rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2 text-sm font-bold ${importMeta[type].tone}`}>{importMeta[type].title}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadTemplate("SUMMARY")} loading={pending}><Download size={15}/> تنزيل {importMeta[type].template} — ملخص</Button><Button variant="outline" onClick={() => downloadTemplate("DETAILED")} loading={pending}><Download size={15}/> تنزيل {importMeta[type].template} — تفصيلي</Button><Button onClick={() => inputRef.current?.click()}><FileSpreadsheet size={15}/> اختيار ملف Excel</Button><input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.currentTarget.value = ""; }} /></div></section> : null}
      {step === 2 ? <section className="space-y-3"><Alert variant="info">تمت قراءة <b>{rows.length}</b> صفاً من الملف <b>{fileName}</b>. اضغط فحص المطابقة للتحقق من الحسابات، الأصناف، والخزائن قبل أي قيد مالي.</Alert><div className="max-h-64 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المستند</th><th className="p-2">النوع</th><th className="p-2">الحساب</th><th className="p-2">OEM</th></tr></thead><tbody>{rows.slice(0, 15).map((row) => <tr key={String(row.sourceRowNumber)} className="border-t border-bmw-cardBorder"><td className="p-2">{String(row.sourceRowNumber)}</td><td className="p-2">{String(row.documentNumber)}</td><td className="p-2">{String(row.type)}</td><td className="p-2">{String(row.accountName)}</td><td className="p-2 font-mono" dir="ltr">{String(row.oemNumber)}</td></tr>)}</tbody></table></div></section> : null}
      {step === 3 && preview ? <section className="space-y-3"><div className="grid gap-2 sm:grid-cols-3"><Alert variant="info">إجمالي الصفوف: {preview.total}</Alert><Alert variant="success">المستندات السليمة: {validCount}</Alert><Alert variant={invalidCount ? "warning" : "success"}>غير صالحة: {invalidCount}</Alert></div><label className="flex cursor-pointer items-start gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><input type="checkbox" checked={autoCreateAccounts} onChange={(event) => setAutoCreateAccounts(event.target.checked)} /><span><b>إنشاء الحسابات غير الموجودة تلقائياً</b> بالنوع المناسب لهذا المعالج؛ الحسابات المتطابقة فقط تُستخدم عند إيقاف الخيار.</span></label>{invalidCount ? <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} /><span><b>تخطي الصفوف غير الصالحة</b> ومتابعة استيراد البيانات المطابقة فقط.</span></label> : null}<div className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المرجع</th><th className="p-2">الحساب</th><th className="p-2">OEM</th><th className="p-2">الحالة</th></tr></thead><tbody>{rowSummary.map((row) => <tr key={row.row} className="border-t border-bmw-cardBorder"><td className="p-2">{row.row}</td><td className="p-2">{row.documentNumber}</td><td className="p-2">{row.accountName}</td><td className="p-2 font-mono" dir="ltr">{row.oemNumber}</td><td className={`p-2 ${row.reason ? "text-bmw-mRed" : "text-emerald-400"}`}>{row.reason ?? "مطابق"}</td></tr>)}</tbody></table></div></section> : null}
    </div>
  </Modal>;
}
