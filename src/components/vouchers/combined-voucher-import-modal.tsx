"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { executeVoucherImportAction, previewVoucherImportAction } from "@/server/actions/voucher-import.actions";
import { parseVoucherWorkbook, voucherRowsToImportRows, type ParsedVoucherRow } from "@/lib/voucher-excel-parser";
import { reconcileInternalTransfers, type ReconciledTransfer } from "@/lib/voucher-transfer-reconciler";

type Preview = { total: number; valid: number; invalid: Array<{ row: number; reason: string }>; rows: Array<{ row: number; reference: string; kind: "RECEIPT" | "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT"; amount: number; accountName: string; itemCategory: string; channels: Array<{ name: string; amount: number }>; isValid: boolean; reason?: string }> };
type Treasury = { id: string; name: string; currentBalance: number; isDefault: boolean };
const VOUCHER_CHUNK_SIZE = 20;

function rowKey(type: "RECEIPT" | "PAYMENT", row: ParsedVoucherRow) { return `${type}:${row.sourceRowNumber}`; }
function kindLabel(kind: Preview["rows"][number]["kind"]) { return kind === "RECEIPT" ? "قبض" : kind === "PAYMENT" ? "صرف" : kind === "TRANSFER_IN" ? "تحويل وارد" : "تحويل صادر"; }

export function CombinedVoucherImportModal({ treasuries, onClose, onDone }: { treasuries: Treasury[]; onClose: () => void; onDone: () => void }) {
  const receiptRef = useRef<HTMLInputElement>(null); const paymentRef = useRef<HTMLInputElement>(null);
  const [receiptRows, setReceiptRows] = useState<ParsedVoucherRow[]>([]); const [paymentRows, setPaymentRows] = useState<ParsedVoucherRow[]>([]);
  const [receiptName, setReceiptName] = useState(""); const [paymentName, setPaymentName] = useState("");
  const [manualCounterparts, setManualCounterparts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null); const [autoCreateAccounts, setAutoCreateAccounts] = useState(false); const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition();

  const reconciliation = useMemo(() => reconcileInternalTransfers(receiptRows, paymentRows), [receiptRows, paymentRows]);
  const defaultSource = treasuries.find((treasury) => /درج|كاش|نقد/i.test(treasury.name))?.name ?? treasuries.find((treasury) => treasury.isDefault)?.name ?? "درج النقدية";
  const defaultDestination = treasuries.find((treasury) => /بنك|abk|انستا/i.test(treasury.name))?.name ?? treasuries.find((treasury) => treasury.isDefault)?.name ?? "البنك ABK";
  const unmatched = useMemo(() => [
    ...reconciliation.unmatchedReceiptRows.map((row) => ({ type: "RECEIPT" as const, row, label: "خزينة المصدر المحوّل منها", defaultValue: defaultSource })),
    ...reconciliation.unmatchedPaymentRows.map((row) => ({ type: "PAYMENT" as const, row, label: "خزينة الوجهة المحوّل إليها", defaultValue: defaultDestination })),
  ], [reconciliation, defaultSource, defaultDestination]);

  const upload = (file: File, type: "RECEIPT" | "PAYMENT") => {
    setError(null); setMessage(null); setPreview(null);
    const reader = new FileReader(); reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array", cellDates: true }); const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        if (!sheet) throw new Error("لا توجد ورقة بيانات قابلة للقراءة.");
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }); const parsed = parseVoucherWorkbook(matrix, type);
        if (!parsed.length) throw new Error("لم يتم العثور على سندات بمبالغ صالحة في الملف.");
        if (type === "RECEIPT") { setReceiptRows(parsed); setReceiptName(file.name); } else { setPaymentRows(parsed); setPaymentName(file.name); }
      } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
    }; reader.readAsArrayBuffer(file);
  };

  const counterpartyFor = (type: "RECEIPT" | "PAYMENT", row: ParsedVoucherRow) => manualCounterparts[rowKey(type, row)] || (type === "RECEIPT" ? defaultSource : defaultDestination);
  const payload = useMemo(() => {
    const rows = [
      ...voucherRowsToImportRows(receiptRows, "RECEIPT").map((row) => ({ ...row, transferCounterpartyTreasuryName: counterpartyFor("RECEIPT", row) })),
      ...voucherRowsToImportRows(paymentRows, "PAYMENT").map((row) => ({ ...row, transferCounterpartyTreasuryName: counterpartyFor("PAYMENT", row) })),
    ];
    return { type: "RECEIPT" as const, rows, reconciledTransfers: reconciliation.matchedTransfers, autoCreateAccounts, skipInvalidRows };
  }, [receiptRows, paymentRows, reconciliation.matchedTransfers, autoCreateAccounts, skipInvalidRows, manualCounterparts, defaultSource, defaultDestination]);

  const missingManualPair = unmatched.some(({ type, row }) => !counterpartyFor(type, row).trim());
  const runPreview = () => startTransition(async () => { setError(null); if (!payload.rows.length) { setError("ارفع ملف قبض أو صرف واحداً على الأقل."); return; } if (missingManualPair) { setError("اختر الخزينة المقابلة لكل تحويل غير مطابق قبل الفحص."); return; } const result = await previewVoucherImportAction(payload); if (!result.success) { setError(result.error); return; } setPreview(result.data); });
  const execute = () => startTransition(async () => {
    setError(null); const validRowIds = new Set(preview?.rows.filter((row) => row.isValid).map((row) => row.row) ?? []); const validRows = preview ? payload.rows.filter((row) => validRowIds.has(Number(row.sourceRowNumber))) : payload.rows;
    let created = 0; let transfers = 0; let processed = 0; setProgress({ processed, total: validRows.length });
    for (let start = 0; start < validRows.length; start += VOUCHER_CHUNK_SIZE) {
      const rows = validRows.slice(start, start + VOUCHER_CHUNK_SIZE);
      const result = await executeVoucherImportAction({ ...payload, rows, reconciledTransfers: [] });
      if (!result.success) { setError(result.error); setProgress(null); return; }
      created += result.data.created; transfers += result.data.transfers; processed += rows.length; setProgress({ processed, total: validRows.length });
    }
    if (payload.reconciledTransfers.length) {
      const transfersResult = await executeVoucherImportAction({ ...payload, rows: [], reconciledTransfers: payload.reconciledTransfers });
      if (!transfersResult.success) { setError(transfersResult.error); setProgress(null); return; }
      created += transfersResult.data.created; transfers += transfersResult.data.transfers;
    }
    setProgress(null); setMessage(`تم ترحيل ${created} سند وتحويل ${transfers} حركة داخلية موحدة.`); onDone();
  });
  const canExecute = Boolean(preview && preview.valid > 0 && (skipInvalidRows || preview.invalid.length === 0));

  return <Modal open onClose={onClose} title="استيراد شامل للسندات والتحويلات" description="ارفع قبض.xlsx وصرف.xlsx معاً لمطابقة التحويلات الداخلية تلقائياً، أو حدّد الخزينة المقابلة للملف المنفرد." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{!preview ? <Button onClick={runPreview} loading={pending} disabled={!receiptRows.length && !paymentRows.length}><CheckCircle2 size={15} /> فحص ومطابقة التحويلات</Button> : <Button variant="success" onClick={execute} loading={pending} disabled={!canExecute}><UploadCloud size={15} /> تنفيذ الترحيل الموحد</Button>}</>}>
    <div className="space-y-4" dir="rtl">{error ? <Alert variant="error">{error}</Alert> : null}{message ? <Alert variant="success">{message}</Alert> : null}{progress ? <div className="rounded-xl border border-bmw-blue/40 bg-bmw-blue/10 p-3 text-sm text-bmw-blue"><div className="mb-2 flex justify-between"><span>جارٍ ترحيل السندات: {progress.processed} من أصل {progress.total}</span><b>{Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%</b></div><div className="h-2 overflow-hidden rounded-full bg-bmw-carbon"><div className="h-full bg-bmw-blue transition-all" style={{ width: `${Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%` }} /></div></div> : null}
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 rounded-2xl border-2 border-dashed border-emerald-500/40 bg-emerald-950/20 p-4 text-center"><div className="text-2xl">🟢</div><p className="text-xs font-bold text-emerald-300">ملف سندات القبض والإيداع (قبض.xlsx)</p><Button size="sm" variant="outline" onClick={() => receiptRef.current?.click()}><FileSpreadsheet size={14} /> اختيار ملف قبض</Button><input ref={receiptRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file, "RECEIPT"); event.currentTarget.value = ""; }} />{receiptName ? <p className="font-mono text-[11px] text-emerald-400">{receiptName} — {receiptRows.length} صف</p> : null}</div><div className="space-y-2 rounded-2xl border-2 border-dashed border-rose-500/40 bg-rose-950/20 p-4 text-center"><div className="text-2xl">🔴</div><p className="text-xs font-bold text-rose-300">ملف سندات الصرف والمصروفات (صرف.xlsx)</p><Button size="sm" variant="outline" onClick={() => paymentRef.current?.click()}><FileSpreadsheet size={14} /> اختيار ملف صرف</Button><input ref={paymentRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file, "PAYMENT"); event.currentTarget.value = ""; }} />{paymentName ? <p className="font-mono text-[11px] text-rose-400">{paymentName} — {paymentRows.length} صف</p> : null}</div></div>
      <section className="grid grid-cols-3 gap-2 text-xs"><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-center">قبض: <b>{receiptRows.length}</b></div><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-center">صرف: <b>{paymentRows.length}</b></div><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-3 text-center text-bmw-blue">تحويلات مطابقة: <b>{reconciliation.matchedTransfers.length}</b></div></section>
      {reconciliation.matchedTransfers.length ? <Alert variant="success">تمت مطابقة {reconciliation.matchedTransfers.length} تحويل داخلي تلقائياً حسب التاريخ والوقت والمبلغ. كل مطابقة ستنشئ تحويلاً واحداً فقط وحركتين متقابلتين.</Alert> : null}
      {unmatched.length ? <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><p className="text-sm font-bold text-amber-200">تحويلات تحتاج اختيار خزينة مقابلة</p>{unmatched.map(({ type, row, label, defaultValue }) => { const key = rowKey(type, row); return <div key={key} className="grid gap-2 rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2 sm:grid-cols-[1fr_1fr]"><div className="text-xs"><b>{type === "RECEIPT" ? "تحويل إلى الخزينة" : "تحويل من الخزينة"}</b> — {row.amount.toLocaleString("ar-EG")} ج.م — {row.treasuryName || "الخزينة غير محددة"}</div><label className="text-xs text-bmw-muted">{label}<select className="mt-1 w-full rounded-lg border border-bmw-cardBorder bg-bmw-card px-2 py-1.5 text-white" value={manualCounterparts[key] ?? defaultValue} onChange={(event) => setManualCounterparts((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر الخزينة المقابلة…</option>{[...new Set([defaultValue, ...treasuries.map((treasury) => treasury.name)])].map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>; })}</section> : null}
      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><input type="checkbox" checked={autoCreateAccounts} onChange={(event) => { setAutoCreateAccounts(event.target.checked); setPreview(null); }} /><span><b>إنشاء الحسابات غير الموجودة تلقائياً</b> عند وجود حساب عميل أو مورد جديد.</span></label>
      {preview ? <section className="space-y-2"><div className="grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg border border-bmw-cardBorder p-2 text-center">الإجمالي: {preview.total}</div><div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-center text-emerald-300">مطابق: {preview.valid}</div><div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-center text-rose-300">غير مطابق: {preview.invalid.length}</div></div>{preview.invalid.length ? <label className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)} />تخطي الصفوف غير الصالحة ومتابعة الترحيل.</label> : null}<div className="max-h-48 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead><tr className="bg-bmw-carbon text-bmw-muted"><th className="p-2">الصف</th><th className="p-2">المرجع</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الحالة</th></tr></thead><tbody>{preview.rows.slice(0, 160).map((row) => <tr key={`${row.row}-${row.reference}`} className="border-t border-bmw-cardBorder"><td className="p-2">{row.row}</td><td className="p-2 font-mono" dir="ltr">{row.reference}</td><td className="p-2">{kindLabel(row.kind)}</td><td className="p-2">{row.amount.toLocaleString("ar-EG")}</td><td className={`p-2 ${row.isValid ? "text-emerald-400" : "text-bmw-mRed"}`}>{row.isValid ? row.reason || "مطابق" : row.reason}</td></tr>)}</tbody></table></div></section> : null}
    </div>
  </Modal>;
}
