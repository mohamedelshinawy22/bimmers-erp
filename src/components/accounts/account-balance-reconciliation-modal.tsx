"use client";

import { useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Alert, Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { parseAccountImportMatrix, type ParsedAccountImportRow } from "@/lib/account-import-parser";
import { reconcileAccountBalancesAction } from "@/server/actions/account-reconciliation.actions";
import { FileSpreadsheet, RotateCcw, Upload } from "lucide-react";

const CONFIRMATION_PHRASE = "مطابقة أرصدة الحسابات";

export function AccountBalanceReconciliationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"TRANSACTIONS" | "EXCEL">("TRANSACTIONS");
  const [rows, setRows] = useState<ParsedAccountImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = confirmation.trim() === CONFIRMATION_PHRASE && reason.trim().length >= 10 && (mode === "TRANSACTIONS" || rows.length > 0);

  const readExcel = async (file: File) => {
    setError(""); setNotice("");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("لم يتم العثور على ورقة بيانات في الملف.");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
      const parsed = parseAccountImportMatrix(matrix);
      if (!parsed.length) throw new Error("لا يحتوي الملف على حسابات قابلة للمطابقة.");
      setRows(parsed); setFileName(file.name); setNotice(`تمت قراءة ${parsed.length} حساباً؛ ستتم مطابقة أرقام الحسابات أولاً ثم الأسماء.`);
    } catch (cause) { setRows([]); setFileName(""); setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel."); }
  };

  const execute = () => startTransition(async () => {
    setError(""); setNotice("");
    const result = mode === "TRANSACTIONS"
      ? await reconcileAccountBalancesAction({ mode, confirmation, reason })
      : await reconcileAccountBalancesAction({ mode, confirmation, reason, rows: rows.map((row) => ({ sourceRowNumber: row.sourceRowNumber, accountNumber: row.accountNumber, name: row.name, openingBalance: Number(row.openingBalance) || 0 })) });
    if (!result.success) { setError(result.error); return; }
    setNotice(`اكتملت المطابقة: تم تعديل ${result.data.affected} حساباً، ولم يتغير ${result.data.unchanged} حساباً.`);
    onDone();
  });

  return <Modal open onClose={onClose} size="lg" title="إعادة احتساب ومطابقة الأرصدة" description="إجراء صيانة مالي محمي. لا يغيّر فواتير أو سندات أو خزائن؛ يحدّث الرصيد الدفتري للحسابات فقط ويُنشئ سجل تدقيق لكل تغيير." footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={execute} loading={pending} disabled={!ready}><RotateCcw size={16} />تنفيذ المطابقة المحمية</Button></>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">اختر وضعاً واحداً فقط. لا تستخدم «من السجلات المرحلة» إذا كانت الفواتير أو السندات التاريخية غير مكتملة. ولا تستخدم «من ملف Excel» إلا بعد مراجعة المعاينة والتأكد من أن الملف يمثل الرصيد المطلوب اعتماده.</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => { setMode("TRANSACTIONS"); setError(""); }} className={`rounded-xl border p-4 text-right transition-colors ${mode === "TRANSACTIONS" ? "border-bmw-blue/70 bg-bmw-blue/10" : "border-bmw-cardBorder bg-bmw-carbon/50 hover:bg-bmw-card"}`}>
          <p className="font-bold text-white">إعادة البناء من السجلات المرحلة</p>
          <p className="mt-1 text-xs leading-5 text-bmw-muted">يعيد حساب الالتزام الحالي من المتبقي في الفواتير النشطة والمرتجعات والسندات المستقلة فقط، دون جمع السندات المرتبطة بالفاتورة مرتين.</p>
        </button>
        <button type="button" onClick={() => { setMode("EXCEL"); setError(""); }} className={`rounded-xl border p-4 text-right transition-colors ${mode === "EXCEL" ? "border-bmw-blue/70 bg-bmw-blue/10" : "border-bmw-cardBorder bg-bmw-carbon/50 hover:bg-bmw-card"}`}>
          <p className="font-bold text-white">اعتماد أرصدة Excel كأساس</p>
          <p className="mt-1 text-xs leading-5 text-bmw-muted">يعيّن الرصيد الدفتري لكل حساب مطابق إلى الرقم الوارد في ملف Excel، دون إضافته إلى الرصيد السابق.</p>
        </button>
      </div>
      {mode === "EXCEL" ? <section className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-4"><p className="text-sm font-bold text-white">ملف أرصدة الحسابات</p><p className="mt-1 text-xs text-bmw-muted">يدعم الترويسة المفردة أو المزدوجة. المطابقة برقم الحساب أولاً ثم الاسم.</p><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readExcel(file); }} /><div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}><Upload size={16} />اختيار ملف Excel</Button>{fileName ? <Badge variant="success"><FileSpreadsheet size={14} />{fileName} · {rows.length} حساب</Badge> : null}</div></section> : null}
      <Field label="سبب المطابقة للتدقيق المالي (10 أحرف على الأقل)"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="مثال: إزالة التكرار بين الرصيد المستورد والسجلات التاريخية المرحلة" disabled={pending} /></Field>
      <Field label={`اكتب العبارة التالية للتأكيد: ${CONFIRMATION_PHRASE}`}><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-lg border border-bmw-cardBorder bg-bmw-carbon px-3 py-2 text-sm text-white outline-none focus:border-bmw-blue" placeholder={CONFIRMATION_PHRASE} disabled={pending} /></Field>
    </div>
  </Modal>;
}
