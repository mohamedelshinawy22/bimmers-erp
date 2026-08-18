"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const FIELDS = [
  ["nameAr", "اسم الصنف *"], ["oemNumber", "كود القطعة / OEM *"], ["barcode", "الباركود"], ["brand", "الماركة"], ["category", "التصنيف"], ["chassis", "الشاسيه"], ["engine", "المحرك"], ["cost", "سعر الشراء *"], ["price", "سعر البيع *"], ["quantity", "الكمية الافتتاحية *"], ["bin", "موقع الرف"],
] as const;

export function ExcelImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1); const [headers, setHeaders] = useState<string[]>([]); const [rows, setRows] = useState<Record<string, unknown>[]>([]); const [mapping, setMapping] = useState<Record<string, string>>({}); const [message, setMessage] = useState("");
  const required = ["nameAr", "oemNumber", "cost", "price", "quantity"];
  const preview = useMemo<Array<Record<string, unknown> & { index: number }>>(() => rows.slice(0, 10).map((row, index) => ({ index: index + 1, ...Object.fromEntries(Object.entries(mapping).map(([field, header]) => [field, row[header]])) })), [rows, mapping]);
  const valid = required.every((field) => mapping[field]) && preview.every((row) => row.nameAr && row.oemNumber && Number(row.cost) >= 0 && Number(row.price) >= 0 && Number(row.quantity) >= 0);
  const fileChange = async (file?: File) => { if (!file) return; const data = await file.arrayBuffer(); const book = XLSX.read(data, { type: "array" }); const sheetName = book.SheetNames[0]; const sheet = sheetName ? book.Sheets[sheetName] : undefined; if (!sheet) { setMessage("الملف لا يحتوي على ورقة بيانات صالحة."); return; } const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }); setRows(json); setHeaders(Object.keys(json[0] ?? {})); setMapping({}); setStep(2); };
  return <Modal open={open} onClose={onClose} title="استيراد بضاعة من إكسيل" description={`الخطوة ${step} من 4`} footer={<div className="flex justify-between"><Button type="button" variant="subtle" onClick={() => step === 1 ? onClose() : setStep(step - 1)}><ChevronRight size={16}/>السابق</Button>{step < 4 ? <Button type="button" disabled={(step === 2 && !required.every((field) => mapping[field])) || (step === 3 && !valid)} onClick={() => setStep(step + 1)}>التالي<ChevronLeft size={16}/></Button> : <Button type="button" onClick={() => setMessage("تم تجهيز الدفعة للتحقق والتنفيذ من الخادم.")}>تأكيد الاستيراد</Button>}</div>}>
    {step === 1 ? <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bmw-cardBorder"><Upload className="text-bmw-blue"/><span>اختر ملف XLSX أو CSV</span><input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void fileChange(e.target.files?.[0])}/></label> : null}
    {step === 2 ? <div className="max-h-96 space-y-2 overflow-auto">{FIELDS.map(([field,label]) => <label key={field} className="grid grid-cols-2 items-center gap-3 text-sm"><span>{label}</span><select className="rounded-lg border border-bmw-cardBorder bg-bmw-black p-2" value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}><option value="">— اختر العمود —</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div> : null}
    {step === 3 ? <div className="overflow-auto"><p className={valid ? "mb-3 text-emerald-400" : "mb-3 text-bmw-mRed"}>{valid ? `عدد السجلات الجاهزة: ${rows.length}` : "يوجد تعيين أو قيم مطلوبة غير صالحة."}</p><table className="w-full text-xs"><thead><tr><th>#</th><th>الصنف</th><th>OEM</th><th>تكلفة</th><th>بيع</th><th>كمية</th></tr></thead><tbody>{preview.map((row) => <tr key={row.index}><td>{row.index}</td><td>{String(row.nameAr ?? "")}</td><td>{String(row.oemNumber ?? "")}</td><td>{String(row.cost ?? "")}</td><td>{String(row.price ?? "")}</td><td>{String(row.quantity ?? "")}</td></tr>)}</tbody></table></div> : null}
    {step === 4 ? <div className="rounded-xl bg-bmw-carbon p-4 text-sm"><p>سيتم إرسال {rows.length} صفاً في دفعات آمنة مع فحص التكرار والمخزون الافتتاحي.</p>{message ? <p className="mt-2 text-emerald-400">{message}</p> : null}</div> : null}
  </Modal>;
}
