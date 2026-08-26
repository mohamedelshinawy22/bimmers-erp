"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Alert, Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { parseAccountImportMatrix, type ParsedAccountImportRow } from "@/lib/account-import-parser";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { downloadAccountsImportTemplateAction, importAccountsAction, previewAccountsImportAction } from "@/server/actions/account-excel.actions";

type ImportRow = ParsedAccountImportRow;
const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/[\s_\-]/g, "");
const expectedType = (value: string) => ["customer", "عميل", "عملاء", "عميلقطاعي", "workshop", "workshopbmw", "ورشه", "ورشة", "ورش", "supplier", "مورد", "موردون", "expense", "مصروف", "مصروفات"].includes(normalized(value));
const downloadBase64 = (base64: string, fileName: string, mimeType: string) => { const raw = atob(base64); const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: mimeType })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); };

export function AccountImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<"SKIP" | "UPDATE">("SKIP");
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [existingDuplicateRows, setExistingDuplicateRows] = useState<number[]>([]);
  const [pending, startTransition] = useTransition();
  const checks = useMemo(() => rows.map((row) => ({ ...row, valid: row.name.trim().length >= 2 && expectedType(row.type), duplicateInFile: Boolean(row.accountNumber && rows.some((other) => other.sourceRowNumber !== row.sourceRowNumber && other.accountNumber && other.accountNumber === row.accountNumber)) || Boolean(row.phone && rows.some((other) => other.sourceRowNumber !== row.sourceRowNumber && other.phone && other.phone === row.phone)) || Boolean(row.name && rows.some((other) => other.sourceRowNumber !== row.sourceRowNumber && other.name && normalized(other.name) === normalized(row.name))), duplicateExisting: existingDuplicateRows.includes(row.sourceRowNumber) })), [rows, existingDuplicateRows]);
  const invalidCount = checks.filter((row) => !row.valid).length;
  const duplicateCount = checks.filter((row) => row.duplicateInFile || row.duplicateExisting).length;

  const template = () => startTransition(async () => { setError(""); const result = await downloadAccountsImportTemplateAction(); if (!result.success) { setError(result.error); return; } downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType); });
  const parse = async (file: File) => {
    setError(""); setSummary("");
    try {
      const buffer = await file.arrayBuffer(); const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: true }); const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("لم يتم العثور على ورقة بيانات في الملف.");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
      const mapped = parseAccountImportMatrix(matrix);
      if (!mapped.length) throw new Error("الملف لا يحتوي صفوف حسابات قابلة للقراءة.");
      setRows(mapped); setFileName(file.name); setExistingDuplicateRows([]); setStep(3);
      const preview = await previewAccountsImportAction({ rows: mapped.map((row) => ({ sourceRowNumber: row.sourceRowNumber, accountNumber: row.accountNumber, phone: row.phone, name: row.name })) });
      if (preview.success) setExistingDuplicateRows(preview.data.duplicateRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
  };
  const execute = () => startTransition(async () => {
    setError(""); const result = await importAccountsAction({ rows, duplicateMode, skipInvalidRows });
    if (!result.success) { setError(result.error); return; }
    setSummary(`تمت معالجة ${result.data.valid} صف: إضافة ${result.data.created}، تحديث ${result.data.updated}، تخطي ${result.data.skipped}.`); setStep(4); onDone();
  });
  return <Modal open onClose={onClose} size="xl" title="استيراد حسابات من Excel" description="يكتشف صف العناوين تلقائياً ضمن أول خمسة صفوف ويدعم ترويسة مفردة أو مزدوجة، مع احتساب المدين والدائن تلقائياً." footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{step === 3 ? <Button onClick={execute} loading={pending} disabled={!rows.length || (!skipInvalidRows && invalidCount > 0)}><Upload size={16}/>تنفيذ الاستيراد</Button> : null}</>}>
    <div className="space-y-4" dir="rtl">{error ? <Alert variant="error">{error}</Alert> : null}{summary ? <Alert variant="success">{summary}</Alert> : null}<div className="grid grid-cols-4 gap-2 text-center text-xs">{["النموذج", "رفع الملف", "المراجعة", "النتيجة"].map((label, index) => <div key={label} className={`rounded-lg px-2 py-2 ${step >= index + 1 ? "bg-bmw-blue/20 text-white" : "bg-bmw-carbon text-bmw-muted"}`}>{index + 1}. {label}</div>)}</div>{step === 1 ? <section className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-4"><FileSpreadsheet size={30} className="mb-3 text-emerald-400"/><h3 className="font-bold text-white">نموذج الحسابات القياسي</h3><p className="mt-1 text-xs leading-5 text-bmw-muted">يتضمن النموذج القياسي 18 عموداً وترويسة مزدوجة وصيغ إجماليات. أدخل قيمة «عليه - مدين» للحساب المدين لنا، أو «له - دائن» للحساب الدائن علينا.</p><div className="mt-4 flex gap-2"><Button variant="outline" onClick={template} loading={pending}><Download size={16}/>تحميل النموذج</Button><Button onClick={() => setStep(2)}>التالي</Button></div></section> : null}{step === 2 ? <section className="rounded-xl border border-dashed border-bmw-blue/50 bg-bmw-blue/5 p-6 text-center"><Upload size={32} className="mx-auto mb-3 text-bmw-blue"/><p className="font-bold text-white">ارفع ملف Excel أو CSV</p><p className="mt-1 text-xs text-bmw-muted">الملفات المدعومة: XLSX وXLS وCSV</p><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parse(file); }}/><Button className="mt-4" onClick={() => inputRef.current?.click()}><Upload size={16}/>اختيار الملف</Button></section> : null}{step === 3 ? <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-3 text-xs"><span>الملف: <b className="text-white">{fileName}</b> · الصفوف: <b className="text-white">{rows.length}</b></span><div className="flex gap-2"><Badge variant={invalidCount ? "danger" : "success"}>غير صالح: {invalidCount}</Badge><Badge variant={duplicateCount ? "warning" : "muted"}>مكرر بالملف: {duplicateCount}</Badge></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="التعامل مع الحساب الموجود"><Select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as "SKIP" | "UPDATE")}><option value="SKIP">تخطي الحساب المكرر</option><option value="UPDATE">تحديث بيانات الحساب الموجود</option></Select></Field><label className="mt-7 flex items-center gap-2 text-sm text-bmw-silver"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)}/>تخطي الصفوف غير الصالحة ومتابعة السليمة</label></div><div className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-right text-xs"><thead className="sticky top-0 bg-bmw-card text-bmw-muted"><tr><th className="p-2">صف</th><th className="p-2">الاسم</th><th className="p-2">النوع</th><th className="p-2">الكود/الهاتف</th><th className="p-2">الرصيد الافتتاحي</th><th className="p-2">الحالة</th></tr></thead><tbody>{checks.slice(0, 100).map((row) => <tr key={row.sourceRowNumber} className={!row.valid ? "bg-bmw-mRed/10" : row.duplicateInFile || row.duplicateExisting ? "bg-amber-400/10" : ""}><td className="p-2">{row.sourceRowNumber}</td><td className="p-2 font-bold text-white">{row.name || "—"}</td><td className="p-2">{row.type || "—"}</td><td className="p-2 font-mono" dir="ltr">{row.accountNumber || row.phone || "—"}</td><td className={`p-2 font-mono ${Number(row.openingBalance) < 0 ? "text-amber-300" : Number(row.openingBalance) > 0 ? "text-purple-300" : "text-bmw-muted"}`}>{Number(row.openingBalance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td className="p-2">{!row.valid ? <span className="text-bmw-mRed">تحقق من الاسم/النوع</span> : row.duplicateInFile ? <span className="text-amber-300">تكرار داخل الملف</span> : row.duplicateExisting ? <span className="text-amber-300">موجود بالنظام</span> : <span className="text-emerald-400">سليم</span>}</td></tr>)}</tbody></table></div>{rows.length > 100 ? <p className="text-xs text-bmw-muted">تظهر أول 100 صف للمعاينة؛ سيُعالج كامل الملف.</p> : null}</section> : null}{step === 4 ? <section className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-center"><p className="font-bold text-emerald-200">اكتمل الاستيراد بنجاح</p><p className="mt-2 text-xs text-bmw-silver">تم تحديث سجل الحسابات ومراجعة الملخصات وفق البيانات المستوردة.</p></section> : null}</div>
  </Modal>;
}
