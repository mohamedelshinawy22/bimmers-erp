"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Alert, Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { downloadAccountsImportTemplateAction, importAccountsAction, previewAccountsImportAction } from "@/server/actions/account-excel.actions";

type ImportRow = { sourceRowNumber: number; accountNumber: string; name: string; type: string; phone: string; email: string; taxNumber: string; address: string; category: string; creditLimit: string | number; defaultPriceTier: string; openingBalance: string | number; isActive: string | boolean };
const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/[\s_\-]/g, "");
const aliases: Record<keyof Omit<ImportRow, "sourceRowNumber">, string[]> = {
  accountNumber: ["كودالحساب", "رقمالحساب", "accountcode", "accountnumber", "code"],
  name: ["اسمالحساب", "الاسم", "name", "accountname"],
  type: ["نوعالحساب", "النوع", "type", "accounttype"],
  phone: ["رقمالهاتف", "التليفون", "الهاتف", "phone", "mobile"],
  email: ["البريدالالكتروني", "email"],
  taxNumber: ["الرقمالضريبيالسجل", "الرقمالضريبي", "taxid", "taxnumber"],
  address: ["العنوان", "address"],
  category: ["التصنيف", "category"],
  creditLimit: ["حدالائتمان", "creditlimit"],
  defaultPriceTier: ["شريحهالتسعير", "شريحةالتسعير", "pricetier", "defaultpricetier"],
  openingBalance: ["الرصيدالافتتاحي", "openingbalance", "balance"],
  isActive: ["الحاله", "الحالة", "نشط", "active", "status"],
};
const expectedType = (value: string) => ["customer", "customer", "عميل", "عملاء", "workshop", "workshopbmw", "ورشه", "ورشة", "ورش", "supplier", "مورد", "موردون", "expense", "مصروف", "مصروفات"].includes(normalized(value));
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
  const checks = useMemo(() => rows.map((row) => ({ ...row, valid: row.name.trim().length >= 2 && expectedType(row.type), duplicateInFile: Boolean(row.accountNumber && rows.some((other) => other.sourceRowNumber !== row.sourceRowNumber && other.accountNumber && other.accountNumber === row.accountNumber)) || Boolean(row.phone && rows.some((other) => other.sourceRowNumber !== row.sourceRowNumber && other.phone && other.phone === row.phone)), duplicateExisting: existingDuplicateRows.includes(row.sourceRowNumber) })), [rows, existingDuplicateRows]);
  const invalidCount = checks.filter((row) => !row.valid).length;
  const duplicateCount = checks.filter((row) => row.duplicateInFile || row.duplicateExisting).length;

  const template = () => startTransition(async () => { setError(""); const result = await downloadAccountsImportTemplateAction(); if (!result.success) { setError(result.error); return; } downloadBase64(result.data.base64, result.data.fileName, result.data.mimeType); });
  const parse = async (file: File) => {
    setError(""); setSummary("");
    try {
      const buffer = await file.arrayBuffer(); const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: true }); const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("لم يتم العثور على ورقة بيانات في الملف.");
      const toNumber = (value: unknown) => { const number = Number(String(value ?? "").replace(/[٬,\s]/g, "").replace(/[جج]\.?م?\.?/gi, "")); return Number.isFinite(number) ? number : 0; };
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
      const first = matrix[0] ?? []; const second = matrix[1] ?? [];
      const isStandardTwoRowLayout = normalized(first[0]).includes("رقمالحساب") && normalized(first[1]).includes("اسمالحساب") && normalized(first[2]).includes("الرصيدالحالي") && normalized(second[2]).includes("عليهمدين") && normalized(second[3]).includes("لهدائن");
      const mapped: ImportRow[] = isStandardTwoRowLayout
        ? matrix.slice(2).map((record, index) => {
            const name = String(record[1] ?? "").trim();
            const nameKey = normalized(name);
            const debit = toNumber(record[2]); const credit = toNumber(record[3]);
            const priceTier = String(record[12] ?? "").trim();
            const customCode = String(record[8] ?? "").trim();
            const accountNumber = customCode || String(record[0] ?? "").trim();
            return { sourceRowNumber: index + 3, accountNumber, name, type: String(record[6] ?? "").trim(), phone: String(record[9] ?? "").trim(), email: "", taxNumber: "", address: String(record[10] ?? "").trim(), category: String(record[7] ?? "").trim(), creditLimit: "0", defaultPriceTier: /جمله|wholesale/i.test(priceTier) ? "WHOLESALE" : "RETAIL", openingBalance: String(debit > 0 ? -debit : credit > 0 ? credit : 0), isActive: "true", _isSummary: nameKey.includes("الاجمالي") || nameKey.includes("total") } as ImportRow & { _isSummary: boolean };
          }).filter((row) => !row._isSummary && Object.values(row).some((value) => String(value).trim() !== "" && value !== row.sourceRowNumber))
        : XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).map((record, index) => {
            const entries = Object.entries(record).map(([key, value]) => [normalized(key), value] as const);
            const get = (field: keyof Omit<ImportRow, "sourceRowNumber">) => entries.find(([key]) => aliases[field].includes(key))?.[1] ?? "";
            return { sourceRowNumber: index + 2, accountNumber: String(get("accountNumber") ?? ""), name: String(get("name") ?? ""), type: String(get("type") ?? ""), phone: String(get("phone") ?? ""), email: String(get("email") ?? ""), taxNumber: String(get("taxNumber") ?? ""), address: String(get("address") ?? ""), category: String(get("category") ?? ""), creditLimit: String(get("creditLimit") ?? ""), defaultPriceTier: String(get("defaultPriceTier") ?? ""), openingBalance: String(get("openingBalance") ?? ""), isActive: String(get("isActive") ?? "") };
          }).filter((row) => Object.values(row).some((value) => String(value).trim() !== "" && value !== row.sourceRowNumber));
      if (!mapped.length) throw new Error("الملف لا يحتوي صفوف حسابات قابلة للقراءة.");
      setRows(mapped); setFileName(file.name); setExistingDuplicateRows([]); setStep(3);
      const preview = await previewAccountsImportAction({ rows: mapped.map((row) => ({ sourceRowNumber: row.sourceRowNumber, accountNumber: row.accountNumber, phone: row.phone })) });
      if (preview.success) setExistingDuplicateRows(preview.data.duplicateRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
  };
  const execute = () => startTransition(async () => {
    setError(""); const result = await importAccountsAction({ rows, duplicateMode, skipInvalidRows });
    if (!result.success) { setError(result.error); return; }
    setSummary(`تمت معالجة ${result.data.valid} صف: إضافة ${result.data.created}، تحديث ${result.data.updated}، تخطي ${result.data.skipped}.`); setStep(4); onDone();
  });
  return <Modal open onClose={onClose} size="xl" title="استيراد حسابات من Excel" description="يدعم النموذج القياسي ذو صفَّي الترويسة؛ تبدأ بيانات الحسابات من الصف الثالث وتُحتسب أعمدة المدين والدائن تلقائياً." footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{step === 3 ? <Button onClick={execute} loading={pending} disabled={!rows.length || (!skipInvalidRows && invalidCount > 0)}><Upload size={16}/>تنفيذ الاستيراد</Button> : null}</>}>
    <div className="space-y-4" dir="rtl">{error ? <Alert variant="error">{error}</Alert> : null}{summary ? <Alert variant="success">{summary}</Alert> : null}<div className="grid grid-cols-4 gap-2 text-center text-xs">{["النموذج", "رفع الملف", "المراجعة", "النتيجة"].map((label, index) => <div key={label} className={`rounded-lg px-2 py-2 ${step >= index + 1 ? "bg-bmw-blue/20 text-white" : "bg-bmw-carbon text-bmw-muted"}`}>{index + 1}. {label}</div>)}</div>{step === 1 ? <section className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-4"><FileSpreadsheet size={30} className="mb-3 text-emerald-400"/><h3 className="font-bold text-white">نموذج الحسابات القياسي</h3><p className="mt-1 text-xs leading-5 text-bmw-muted">يتضمن النموذج القياسي 18 عموداً وترويسة مزدوجة وصيغ إجماليات. أدخل قيمة «عليه - مدين» للحساب المدين لنا، أو «له - دائن» للحساب الدائن علينا.</p><div className="mt-4 flex gap-2"><Button variant="outline" onClick={template} loading={pending}><Download size={16}/>تحميل النموذج</Button><Button onClick={() => setStep(2)}>التالي</Button></div></section> : null}{step === 2 ? <section className="rounded-xl border border-dashed border-bmw-blue/50 bg-bmw-blue/5 p-6 text-center"><Upload size={32} className="mx-auto mb-3 text-bmw-blue"/><p className="font-bold text-white">ارفع ملف Excel أو CSV</p><p className="mt-1 text-xs text-bmw-muted">الملفات المدعومة: XLSX وXLS وCSV</p><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parse(file); }}/><Button className="mt-4" onClick={() => inputRef.current?.click()}><Upload size={16}/>اختيار الملف</Button></section> : null}{step === 3 ? <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-3 text-xs"><span>الملف: <b className="text-white">{fileName}</b> · الصفوف: <b className="text-white">{rows.length}</b></span><div className="flex gap-2"><Badge variant={invalidCount ? "danger" : "success"}>غير صالح: {invalidCount}</Badge><Badge variant={duplicateCount ? "warning" : "muted"}>مكرر بالملف: {duplicateCount}</Badge></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="التعامل مع الحساب الموجود"><Select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as "SKIP" | "UPDATE")}><option value="SKIP">تخطي الحساب المكرر</option><option value="UPDATE">تحديث بيانات الحساب الموجود</option></Select></Field><label className="mt-7 flex items-center gap-2 text-sm text-bmw-silver"><input type="checkbox" checked={skipInvalidRows} onChange={(event) => setSkipInvalidRows(event.target.checked)}/>تخطي الصفوف غير الصالحة ومتابعة السليمة</label></div><div className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-right text-xs"><thead className="sticky top-0 bg-bmw-card text-bmw-muted"><tr><th className="p-2">صف</th><th className="p-2">الاسم</th><th className="p-2">النوع</th><th className="p-2">الكود/الهاتف</th><th className="p-2">الرصيد الافتتاحي</th><th className="p-2">الحالة</th></tr></thead><tbody>{checks.slice(0, 100).map((row) => <tr key={row.sourceRowNumber} className={!row.valid ? "bg-bmw-mRed/10" : row.duplicateInFile || row.duplicateExisting ? "bg-amber-400/10" : ""}><td className="p-2">{row.sourceRowNumber}</td><td className="p-2 font-bold text-white">{row.name || "—"}</td><td className="p-2">{row.type || "—"}</td><td className="p-2 font-mono" dir="ltr">{row.accountNumber || row.phone || "—"}</td><td className={`p-2 font-mono ${Number(row.openingBalance) < 0 ? "text-amber-300" : Number(row.openingBalance) > 0 ? "text-purple-300" : "text-bmw-muted"}`}>{Number(row.openingBalance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td className="p-2">{!row.valid ? <span className="text-bmw-mRed">تحقق من الاسم/النوع</span> : row.duplicateInFile ? <span className="text-amber-300">تكرار داخل الملف</span> : row.duplicateExisting ? <span className="text-amber-300">موجود بالنظام</span> : <span className="text-emerald-400">سليم</span>}</td></tr>)}</tbody></table></div>{rows.length > 100 ? <p className="text-xs text-bmw-muted">تظهر أول 100 صف للمعاينة؛ سيُعالج كامل الملف.</p> : null}</section> : null}{step === 4 ? <section className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-center"><p className="font-bold text-emerald-200">اكتمل الاستيراد بنجاح</p><p className="mt-2 text-xs text-bmw-silver">تم تحديث سجل الحسابات ومراجعة الملخصات وفق البيانات المستوردة.</p></section> : null}</div>
  </Modal>;
}
