"use client";

import { useMemo, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { executeInventoryImportAction } from "@/server/actions/import.actions";
import { parseSpreadsheetNumber, validateInventoryImportRow } from "@/lib/inventory-import";

const FIELDS = [["nameAr", "اسم الصنف *"], ["oemNumber", "كود القطعة / OEM *"], ["barcode", "الباركود"], ["brand", "الماركة (اختياري)"], ["category", "التصنيف (اختياري)"], ["chassis", "الشاسيه"], ["engine", "المحرك"], ["cost", "سعر الشراء *"], ["price", "سعر البيع *"], ["quantity", "الكمية الافتتاحية *"], ["bin", "موقع الرف"]] as const;
type MappedRow = { nameAr: string; oemNumber: string; barcode: string; brand: string; category: string; chassis: string; engine: string; cost: string; price: string; quantity: string; bin: string };

export function ExcelImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const required = ["nameAr", "oemNumber", "cost", "price", "quantity"];
  const requiredMapped = required.every((field) => mapping[field]);

  const mappedRows = useMemo<MappedRow[]>(() => {
    const cell = (row: Record<string, unknown>, field: keyof MappedRow) => {
      const column = mapping[field];
      return column ? String(row[column] ?? "").trim() : "";
    };
    return rows.map((row) => ({
      nameAr: cell(row, "nameAr"), oemNumber: cell(row, "oemNumber"), barcode: cell(row, "barcode"),
      brand: cell(row, "brand"), category: cell(row, "category"), chassis: cell(row, "chassis"), engine: cell(row, "engine"),
      cost: cell(row, "cost"), price: cell(row, "price"), quantity: cell(row, "quantity"), bin: cell(row, "bin"),
    }));
  }, [rows, mapping]);

  const rowChecks = useMemo(() => mappedRows.map((row, index) => ({ index: index + 1, row, issues: validateInventoryImportRow(row) })), [mappedRows]);
  const preview = rowChecks.slice(0, 10);
  const invalidCount = rowChecks.filter((check) => check.issues.length > 0).length;
  const valid = requiredMapped && invalidCount === 0;

  const fileChange = async (file?: File) => {
    if (!file) return;
    const data = await file.arrayBuffer();
    const book = XLSX.read(data, { type: "array" });
    const sheetName = book.SheetNames[0];
    const sheet = sheetName ? book.Sheets[sheetName] : undefined;
    if (!sheet) { setMessage("الملف لا يحتوي على ورقة بيانات صالحة."); return; }
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (json.length === 0) { setMessage("الورقة لا تحتوي على صفوف بيانات للاستيراد."); return; }
    setRows(json); setHeaders(Object.keys(json[0] ?? {})); setMapping({}); setMessage(""); setStep(2);
  };

  const confirm = () => startTransition(async () => {
    setMessage("");
    const result = await executeInventoryImportAction({
      mapping,
      rows: mappedRows.map((row) => ({
        ...row,
        cost: parseSpreadsheetNumber(row.cost) ?? Number.NaN,
        price: parseSpreadsheetNumber(row.price) ?? Number.NaN,
        quantity: parseSpreadsheetNumber(row.quantity) ?? Number.NaN,
      })),
    });
    if (!result.success) { setMessage(result.error); return; }
    setMessage(result.data.duplicate ? "سبق تنفيذ هذا الملف؛ لم تُنشأ أصناف إضافية." : `تم استيراد ${result.data.created} صنف وتخطي ${result.data.skipped} صنف مكرر.`);
  });

  return <Modal open={open} onClose={onClose} title="استيراد بضاعة من إكسيل" description={`الخطوة ${step} من 4`} footer={<div className="flex justify-between"><Button type="button" variant="subtle" disabled={pending} onClick={() => step === 1 ? onClose() : setStep(step - 1)}><ChevronRight size={16} />السابق</Button>{step < 4 ? <Button type="button" disabled={(step === 2 && !requiredMapped) || (step === 3 && !valid)} onClick={() => setStep(step + 1)}>التالي<ChevronLeft size={16} /></Button> : <Button type="button" loading={pending} disabled={!valid} onClick={confirm}>تأكيد الاستيراد</Button>}</div>}>
    {step === 1 ? <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bmw-cardBorder"><Upload className="text-bmw-blue" /><span>اختر ملف XLSX أو CSV</span><input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void fileChange(event.target.files?.[0])} /></label> : null}
    {step === 2 ? <div className="max-h-96 space-y-2 overflow-auto"><p className="rounded-lg bg-bmw-blue/10 p-2 text-xs text-bmw-silver">حقول الماركة والتصنيف اختيارية؛ سيُستخدم <b>عام</b> و<b>بدون تصنيف</b> عند تركهما فارغين.</p>{FIELDS.map(([field, label]) => <label key={field} className="grid grid-cols-2 items-center gap-3 text-sm"><span>{label}</span><select className="rounded-lg border border-bmw-cardBorder bg-bmw-black p-2" value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}><option value="">— اختر العمود —</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div> : null}
    {step === 3 ? <div className="overflow-auto"><div className={`mb-3 flex items-center gap-2 ${valid ? "text-emerald-400" : "text-bmw-mRed"}`}>{valid ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{valid ? `عدد السجلات الجاهزة: ${rows.length}` : !requiredMapped ? "أكمل تعيين الحقول المطلوبة أولاً." : `يوجد ${invalidCount} صف غير صالح. مرر المؤشر فوق رمز التحذير لمعرفة الحقل المطلوب.`}</div><table className="w-full text-xs"><thead><tr><th>#</th><th>الصنف</th><th>OEM</th><th>تكلفة</th><th>بيع</th><th>كمية</th><th>التحقق</th></tr></thead><tbody>{preview.map(({ index, row, issues }) => { const issueText = issues.map((issue) => issue.message).join(" • "); return <tr key={index} className={issues.length ? "bg-bmw-mRed/15 text-bmw-silver" : ""}><td>{index}</td><td>{row.nameAr || "—"}</td><td>{row.oemNumber || "—"}</td><td>{row.cost}</td><td>{row.price}</td><td>{row.quantity}</td><td>{issues.length ? <span title={issueText} aria-label={issueText} className="inline-flex cursor-help items-center gap-1 text-bmw-mRed"><AlertCircle size={16} /><span>خطأ</span></span> : <CheckCircle2 size={16} className="text-emerald-400" />}</td></tr>; })}</tbody></table>{rowChecks.length > 10 ? <p className="mt-2 text-xs text-bmw-muted">تُعرض أول 10 صفوف فقط؛ تم فحص جميع {rowChecks.length} صفاً قبل المتابعة.</p> : null}</div> : null}
    {step === 4 ? <div className="rounded-xl bg-bmw-carbon p-4 text-sm"><p>سيتم إرسال {rows.length} صفاً في دفعات آمنة من 100 صف مع فحص تكرار OEM والمخزون الافتتاحي. تقبل الأرقام الفواصل والرموز النقدية والمسافات، ويسمح OEM بالشرطة والشرطة المائلة مثل <span className="font-mono">51117111741/742</span>.</p>{message ? <p className={`mt-2 ${message.includes("تم") || message.includes("سبق") ? "text-emerald-400" : "text-bmw-mRed"}`}>{message}</p> : null}</div> : null}
  </Modal>;
}
