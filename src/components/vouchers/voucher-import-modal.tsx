"use client";

import { useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { downloadVoucherImportTemplateAction, executeVoucherImportAction, previewVoucherImportAction } from "@/server/actions/voucher-import.actions";
import { parseVoucherWorkbook, voucherRowsToImportRows, type VoucherImportType } from "@/lib/voucher-excel-parser";

type Preview = { total: number; valid: number; invalid: Array<{ row: number; reason: string }>; rows: Array<{ row: number; reference: string; kind: "RECEIPT" | "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT"; amount: number; accountName: string; itemCategory: string; channels: Array<{ name: string; amount: number }>; isValid: boolean; reason?: string; accountStatus: "MATCHED" | "AUTO_CREATE" | "EXPENSE_ACCOUNT" | "NONE" }> };

function downloadBase64(file: { fileName: string; mimeType: string; base64: string }) {
  const bytes = Uint8Array.from(atob(file.base64), (value) => value.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(url);
}

const typeLabel: Record<VoucherImportType, string> = { RECEIPT: "سندات قبض", PAYMENT: "سندات صرف" };
const kindLabel: Record<Preview["rows"][number]["kind"], string> = { RECEIPT: "قبض", PAYMENT: "صرف", TRANSFER_IN: "تحويل وارد", TRANSFER_OUT: "تحويل صادر" };

export function VoucherImportModal({ type, onClose, onDone }: { type: VoucherImportType; onClose: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [autoCreateAccounts, setAutoCreateAccounts] = useState(false);
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const downloadTemplate = () => startTransition(async () => {
    setError(null);
    const result = await downloadVoucherImportTemplateAction({ type });
    if (!result.success) { setError(result.error); return; }
    downloadBase64(result.data);
    setMessage("تم تنزيل النموذج. احذف الصف التوضيحي ثم ارفع الملف بعد تعبئته.");
  });

  const loadFile = (file: File) => {
    setError(null); setMessage(null); setPreview(null); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        if (!sheet) throw new Error("لا توجد ورقة بيانات قابلة للقراءة.");
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
        const parsed = voucherRowsToImportRows(parseVoucherWorkbook(matrix, type), type);
        if (!parsed.length) throw new Error("لم يتم العثور على سندات بمبلغ صالح في الملف.");
        if (parsed.length > 10_000) throw new Error("الحد الأقصى للاستيراد هو 10,000 سند.");
        setRows(parsed); setStep(2);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
    };
    reader.readAsArrayBuffer(file);
  };

  const runPreview = () => startTransition(async () => {
    setError(null);
    const result = await previewVoucherImportAction({ type, rows, autoCreateAccounts, skipInvalidRows });
    if (!result.success) { setError(result.error); return; }
    setPreview(result.data); setStep(3);
  });

  const execute = () => startTransition(async () => {
    setError(null);
    const result = await executeVoucherImportAction({ type, rows, autoCreateAccounts, skipInvalidRows });
    if (!result.success) { setError(result.error); return; }
    setMessage(`تم ترحيل ${result.data.created} سند، منها ${result.data.transfers} تحويل داخلي، وتخطي ${result.data.skipped} صف. رقم العملية: ${result.data.jobId}`);
    onDone();
  });

  const invalidCount = preview?.invalid.length ?? 0;
  const canExecute = Boolean(preview && preview.valid > 0 && (skipInvalidRows || invalidCount === 0));
  return <Modal open onClose={onClose} title={`استيراد ${typeLabel[type]} من Excel`} description="يتم إنشاء قيود الخزائن والحسابات والتحويلات في معاملات ذرية مدققة." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{step === 2 ? <Button onClick={runPreview} loading={pending}><CheckCircle2 size={15} /> فحص المطابقة</Button> : null}{step === 3 ? <Button variant={type === "RECEIPT" ? "success" : "danger"} onClick={execute} loading={pending} disabled={!canExecute}><UploadCloud size={15} /> تنفيذ الترحيل الآمن</Button> : null}</>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}{message ? <Alert variant="success">{message}</Alert> : null}
      <div className="grid grid-cols-3 gap-2 text-xs"><div className={`rounded-lg border p-2 ${step >= 1 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>1. النموذج والرفع</div><div className={`rounded-lg border p-2 ${step >= 2 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>2. الفحص والمطابقة</div><div className={`rounded-lg border p-2 ${step >= 3 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>3. الترحيل</div></div>
      {step === 1 ? <section className="space-y-3"><Alert variant="info">يدعم الملف قبضاً وصرفاً وتحويلات داخلية. تُكتشف قنوات الدفع من عناوين الأعمدة وتُربط بالخزائن أو تُنشأ تلقائياً داخل عملية الترحيل.</Alert><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate} loading={pending}><Download size={15} /> تنزيل النموذج القياسي</Button><Button onClick={() => inputRef.current?.click()}><FileSpreadsheet size={15} /> اختيار ملف {typeLabel[type]}</Button><input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.currentTarget.value = ""; }} /></div></section> : null}
      {step === 2 ? <section className="space-y-3"><Alert variant="info">تم استخراج <b>{rows.length}</b> سند من الملف <b>{fileName}</b>. عند وجود «الحساب» يُطابق كعميل أو مورد؛ وعند غيابه مع وجود «البند» يُعامل كبند مصروف أو سلفة.</Alert><div className="max-h-64 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المرجع</th><th className="p-2">الحركة</th><th className="p-2">الحساب / البند</th><th className="p-2">المبلغ</th><th className="p-2">قنوات السداد</th></tr></thead><tbody>{rows.slice(0, 30).map((row) => <tr key={String(row.sourceRowNumber)} className="border-t border-bmw-cardBorder"><td className="p-2">{String(row.sourceRowNumber)}</td><td className="p-2 font-mono" dir="ltr">{String(row.transactionReference)}</td><td className="p-2">{String(row.movementType)}</td><td className="p-2">{String(row.accountName || row.itemCategory || "—")}</td><td className="p-2 font-mono">{Number(row.amount ?? 0).toLocaleString("ar-EG")}</td><td className="p-2 text-bmw-muted">{Array.isArray(row.paymentChannels) ? (row.paymentChannels as Array<{ name: string; amount: number }>).map((channel) => `${channel.name}: ${channel.amount}`).join(" + ") || String(row.treasuryName) : String(row.treasuryName)}</td></tr>)}</tbody></table></div></section> : null}
      {step === 3 && preview ? <section className="space-y-3"><Alert variant="info">كل قناة بمبلغ موجب تُسجل بحركة خزينة مستقلة. في التحويل الداخلي، ينشأ تحويل واحد وحركتان متقابلتان بين الخزينة المصدر والوجهة.</Alert><div className="grid grid-cols-3 gap-2"><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-center text-xs">إجمالي الصفوف: <b>{preview.total}</b></div><div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs text-emerald-300">صالحة: <b>{preview.valid}</b></div><div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs text-rose-300">غير صالحة: <b>{invalidCount}</b></div></div><label className="flex cursor-pointer items-start gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><input type="checkbox" checked={autoCreateAccounts} onChange={(event) => setAutoCreateAccounts(event.target.checked)} /><span><b>إنشاء الحسابات غير الموجودة تلقائياً</b>؛ البنود بلا حساب تُنشئ حساب مصروف أو سلفة مصنفاً عند الحاجة.</span></label>{invalidCount ? <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} /><span><b>تخطي الصفوف غير الصالحة</b> ومتابعة ترحيل السندات المطابقة.</span></label> : null}<div className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المرجع</th><th className="p-2">النوع</th><th className="p-2">الحساب / البند</th><th className="p-2">المبلغ</th><th className="p-2">القنوات</th><th className="p-2">الحالة</th></tr></thead><tbody>{preview.rows.slice(0, 150).map((row) => <tr key={row.row} className="border-t border-bmw-cardBorder"><td className="p-2">{row.row}</td><td className="p-2 font-mono" dir="ltr">{row.reference}</td><td className="p-2">{kindLabel[row.kind]}</td><td className="p-2">{row.accountName || row.itemCategory || "—"}</td><td className="p-2 font-mono">{row.amount.toLocaleString("ar-EG")}</td><td className="p-2 text-bmw-muted">{row.channels.map((channel) => `${channel.name}: ${channel.amount.toLocaleString("ar-EG")}`).join(" + ")}</td><td className={`p-2 ${row.isValid ? "text-emerald-400" : "text-bmw-mRed"}`}>{row.isValid ? row.accountStatus === "AUTO_CREATE" ? "سيُنشأ الحساب تلقائياً" : row.accountStatus === "EXPENSE_ACCOUNT" ? "بند مصروف / سلفة" : "مطابق" : row.reason}</td></tr>)}</tbody></table></div></section> : null}
    </div>
  </Modal>;
}
