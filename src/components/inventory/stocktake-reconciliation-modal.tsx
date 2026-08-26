"use client";

import { useMemo, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatInt, formatOemNumber } from "@/lib/utils";
import { parsePhysicalCountMatrix, type PhysicalCountRow } from "@/lib/stocktake-excel-parser";
import { executeStocktakeReconciliationAction, previewStocktakeReconciliationAction } from "@/server/actions/stocktake-reconciliation.actions";

const STOCKTAKE_CONFIRMATION_PHRASE = "تسوية جرد المخزون";

type PreviewRow = PhysicalCountRow & { status: "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "INVALID"; message: string; partId: string | null; matchedBy: "OEM" | "NAME" | null; bookQuantity: number | null; delta: number | null; partName: string | null; partOemNumber: string | null };
type Preview = { rows: PreviewRow[]; matched: number; unmatched: number; ambiguous: number; invalid: number };

export function StocktakeReconciliationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const changed = useMemo(() => preview?.rows.filter((row) => row.status === "MATCHED" && row.delta !== 0) ?? [], [preview]);
  const hasIssues = Boolean(preview && (preview.unmatched || preview.ambiguous || preview.invalid));
  const canExecute = changed.length > 0 && changed.length <= 500 && !hasIssues && reason.trim().length >= 5 && confirmation.trim() === STOCKTAKE_CONFIRMATION_PHRASE;

  const loadFile = async (file?: File) => {
    if (!file) return;
    setError(""); setPreview(null); setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.SheetNames[0] ? workbook.Sheets[workbook.SheetNames[0]] : undefined;
      if (!sheet) { setError("الملف لا يحتوي على ورقة بيانات صالحة."); return; }
      const parsed = parsePhysicalCountMatrix(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }) as unknown[][]);
      if (parsed.error) { setError(parsed.error); return; }
      startTransition(async () => {
        const result = await previewStocktakeReconciliationAction({ rows: parsed.rows });
        if (!result.success) { setError(result.error); return; }
        setPreview(result.data);
      });
    } catch {
      setError("تعذر قراءة ملف Excel. تأكد من أنه XLSX أو XLS صحيح.");
    }
  };

  const execute = () => startTransition(async () => {
    setError("");
    const result = await executeStocktakeReconciliationAction({ adjustments: changed.map((row) => ({ partId: row.partId!, sourceRowNumber: row.sourceRowNumber, actualQuantity: row.actualQuantity! })), reason, confirmation });
    if (!result.success) { setError(result.error); return; }
    onDone();
  });

  return <Modal open onClose={onClose} title="جرد وتسوية كميات المخزون من Excel" description="يطابق النظام رقم OEM أولاً ثم الاسم العربي المطبع، ويكتب حركة جرد مدققة لكل فرق من دون تعديل الفواتير السابقة." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button onClick={execute} loading={pending} disabled={!canExecute}><FileSpreadsheet size={16} /> اعتماد تسوية الجرد</Button></>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Alert variant="info">يلزم أن يحتوي الملف على <b>الكمية الفعلية</b> أو <b>الرصيد الفعلي</b> أو <b>العدد</b>، مع رقم OEM أو اسم الصنف. تُراجع الترويسة في أول خمسة صفوف، وتُتجاهل أعمدة الترقيم تلقائياً.</Alert>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-bmw-cardBorder bg-bmw-carbon/40 p-5 text-sm text-bmw-silver hover:border-bmw-blue/60"><Upload size={18} className="text-bmw-blue" />{fileName || "رفع ملف الجرد الفعلي (XLSX / XLS)"}<input className="sr-only" type="file" accept=".xlsx,.xls" onChange={(event) => void loadFile(event.target.files?.[0])} /></label>
      {preview ? <>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><Stat label="مطابق" value={preview.matched} tone="text-emerald-300" /><Stat label="فروق تحتاج تسوية" value={changed.length} tone="text-amber-300" /><Stat label="غير مطابق" value={preview.unmatched} tone="text-bmw-mRed" /><Stat label="ملتبس" value={preview.ambiguous} tone="text-bmw-mRed" /><Stat label="غير صالح" value={preview.invalid} tone="text-bmw-mRed" /></div>
        {hasIssues ? <Alert variant="error">لا يمكن تنفيذ التسوية قبل معالجة كل الصفوف غير المطابقة أو الملتبسة أو غير الصالحة. لا ينفذ النظام تسوية جزئية من ملف به أخطاء.</Alert> : null}
        {changed.length > 500 ? <Alert variant="warning">تحتوي المعاينة على {formatInt(changed.length)} فرقاً. للحفاظ على معاملة واحدة مدققة وآمنة، قسّم الملف إلى دفعات لا تتجاوز 500 فرق.</Alert> : null}
        {changed.length === 0 && !hasIssues ? <Alert variant="success">كل الأرصدة المطابقة في الملف تساوي الرصيد الدفتري؛ لا توجد حركة جرد مطلوب إنشاؤها.</Alert> : null}
        <div className="max-h-64 overflow-auto rounded-xl border border-bmw-cardBorder"><table className="w-full text-xs"><thead className="sticky top-0 bg-bmw-carbon"><tr><th className="p-2 text-right">صف</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">OEM</th><th className="p-2 text-right">الدفتري</th><th className="p-2 text-right">الفعلي</th><th className="p-2 text-right">الفارق</th><th className="p-2 text-right">المطابقة</th></tr></thead><tbody>{preview.rows.slice(0, 100).map((row) => <tr key={row.sourceRowNumber} className={row.status === "MATCHED" ? "border-t border-bmw-cardBorder/60" : "border-t border-bmw-mRed/30 bg-bmw-mRed/5"}><td className="p-2 tabular">{row.sourceRowNumber}</td><td className="p-2">{(row.partName ?? row.nameAr) || "—"}</td><td className="p-2 font-mono">{formatOemNumber((row.partOemNumber ?? row.oemNumber) || "—")}</td><td className="p-2 tabular">{row.bookQuantity ?? "—"}</td><td className="p-2 tabular">{row.actualQuantity ?? "—"}</td><td className={`p-2 tabular font-bold ${(row.delta ?? 0) > 0 ? "text-emerald-300" : (row.delta ?? 0) < 0 ? "text-bmw-mRed" : "text-bmw-muted"}`}>{row.delta === null ? "—" : `${row.delta > 0 ? "+" : ""}${row.delta}`}</td><td className="p-2">{row.status === "MATCHED" ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={14} />{row.matchedBy === "OEM" ? "OEM" : "الاسم"}</span> : <span className="inline-flex items-center gap-1 text-bmw-mRed"><AlertCircle size={14} />{row.message}</span>}</td></tr>)}</tbody></table></div>
        {preview.rows.length > 100 ? <p className="text-xs text-bmw-muted">تُعرض أول 100 صفوف؛ جرى التحقق من جميع {formatInt(preview.rows.length)} صف.</p> : null}
        {changed.length > 0 && !hasIssues ? <><Field label="سبب الجرد والتسوية" required><Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: جرد نهاية الشهر بعد مراجعة مواقع الرفوف" /></Field><Field label={`اكتب عبارة التأكيد: ${STOCKTAKE_CONFIRMATION_PHRASE}`} required><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={STOCKTAKE_CONFIRMATION_PHRASE} /></Field></> : null}
      </> : null}
    </div>
  </Modal>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className="rounded-lg border border-bmw-cardBorder bg-bmw-carbon/50 p-2"><p className="text-bmw-muted">{label}</p><p className={`mt-1 text-lg font-bold tabular ${tone}`}>{formatInt(value)}</p></div>; }
