"use client";

import { useEffect, useState, useTransition } from "react";
import { Ban, CheckCircle2, Printer, RotateCcw, Save, X } from "lucide-react";
import { getVoucherDetailsAction, restoreCancelledVoucherAction, updateVoucherAction, voidVoucherAction } from "@/server/actions/voucher.actions";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CURRENCY, formatDateTime, formatMoney } from "@/lib/utils";

type VoucherDetails = {
  voucher: { id: string; transactionNumber: string; type: "RECEIPT" | "PAYMENT"; amount: number; description: string; paymentMethod: string | null; createdAt: string; status: string; voidedAt: string | null; voidedByUser: string | null; voidReason: string | null; account: { id: string; name: string; accountNumber: string } | null; treasury: { id: string; name: string; currentBalance: number }; invoiceNumber: string | null; createdByName: string | null };
  treasuries: Array<{ id: string; name: string; currentBalance: number }>;
  canManage: boolean;
  canRestore: boolean;
  timeline: Array<{ id: string; action: string; event: string | null; performedBy: string; timestamp: string }>;
};

function receiptHtml(voucher: VoucherDetails["voucher"], format: "THERMAL" | "A4") {
  const typeLabel = voucher.type === "RECEIPT" ? "سند قبض" : "سند صرف";
  const thermal = format === "THERMAL";
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${typeLabel} ${voucher.transactionNumber}</title><style>@page{size:${thermal ? "80mm auto" : "A4"};margin:${thermal ? "3mm" : "16mm"}}*{box-sizing:border-box}html,body{height:auto!important;overflow:visible!important}body{margin:0;font-family:Arial,sans-serif;color:#000;font-size:${thermal ? "12px" : "14px"}}.wrap{width:${thermal ? "74mm" : "180mm"};margin:auto;text-align:right;border:${thermal ? "0" : "1px solid #222"};padding:${thermal ? "0" : "10mm"}}.head{text-align:center;border-bottom:1px ${thermal ? "dashed" : "solid"} #000;padding-bottom:8px;margin-bottom:8px}h1{font-size:${thermal ? "18px" : "24px"};margin:0 0 5px}.row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:${thermal ? "0" : "1px solid #ddd"}}.sum{font-weight:700;font-size:${thermal ? "18px" : "22px"};border-top:1px ${thermal ? "dashed" : "solid"} #000;margin-top:8px;padding-top:8px}.note{border-top:1px ${thermal ? "dashed" : "solid"} #000;margin-top:8px;padding-top:8px;white-space:pre-wrap}.footer{text-align:center;margin-top:15px;font-size:10px}</style></head><body><main class="wrap"><section class="head"><h1>${typeLabel}</h1><strong>${voucher.transactionNumber}</strong></section><div class="row"><span>التاريخ</span><span>${formatDateTime(voucher.createdAt)}</span></div><div class="row"><span>الحساب</span><span>${voucher.account ? `${voucher.account.accountNumber} — ${voucher.account.name}` : "—"}</span></div><div class="row"><span>الخزينة</span><span>${voucher.treasury.name}</span></div><div class="row"><span>طريقة الدفع</span><span>${voucher.paymentMethod || "نقدي"}</span></div><div class="sum">المبلغ: ${formatMoney(voucher.amount)} ${CURRENCY}</div><div class="note">البيان: ${voucher.description}</div><p class="footer">تمت الطباعة من BimmerERP</p></main><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`;
}

export function VoucherDetailsModal({ voucherId, onClose, onChanged }: { voucherId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<VoucherDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [treasuryId, setTreasuryId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [createdAt, setCreatedAt] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreReason, setRestoreReason] = useState("");

  const load = async () => {
    setError(null);
    try {
      const result = await getVoucherDetailsAction({ voucherId });
      if (!result?.success) { setError(result?.error ?? "تعذر تحميل السند حالياً."); return; }
      const next = result.data as VoucherDetails;
      const timestamp = new Date(next.voucher.createdAt);
      setData(next); setAmount(String(next.voucher.amount)); setTreasuryId(next.voucher.treasury.id); setDescription(next.voucher.description); setPaymentMethod(next.voucher.paymentMethod || "CASH"); setCreatedAt(Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString().slice(0, 16));
    } catch {
      setError("تعذر تحميل السند حالياً. أعد المحاولة.");
    }
  };

  useEffect(() => { void load(); }, [voucherId]);
  const closeAfterChange = () => { onChanged(); onClose(); };
  const resolvedVoucherId = data?.voucher.id ?? voucherId;
  const save = () => startTransition(async () => {
    setError(null);
    try {
      const result = await updateVoucherAction({ voucherId: resolvedVoucherId, amount: Number(amount), treasuryId, description, paymentMethod, createdAt: createdAt ? new Date(createdAt).toISOString() : undefined });
      if (!result?.success) { setError(result?.error ?? "تعذر حفظ تعديلات السند."); return; }
      closeAfterChange();
    } catch { setError("تعذر حفظ تعديلات السند. أعد المحاولة."); }
  });
  const voidVoucher = () => startTransition(async () => {
    setError(null);
    try {
      const result = await voidVoucherAction({ voucherId: resolvedVoucherId, reason: voidReason });
      if (!result?.success) { setError(result?.error ?? "تعذر إلغاء السند."); return; }
      closeAfterChange();
    } catch { setError("تعذر إلغاء السند. أعد المحاولة."); }
  });
  const restoreVoucher = () => startTransition(async () => {
    setError(null);
    try {
      const result = await restoreCancelledVoucherAction({ voucherId: resolvedVoucherId, reason: restoreReason });
      if (!result?.success) { setError(result?.error ?? "تعذر استعادة السند."); return; }
      closeAfterChange();
    } catch { setError("تعذر استعادة السند. أعد المحاولة."); }
  });
  const print = (format: "THERMAL" | "A4") => {
    if (!data) return;
    const windowRef = window.open("", "_blank", format === "THERMAL" ? "width=460,height=720" : "width=1100,height=800");
    if (!windowRef) { setError("تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة."); return; }
    windowRef.opener = null;
    windowRef.document.open(); windowRef.document.write(receiptHtml(data.voucher, format)); windowRef.document.close();
  };

  const voucher = data?.voucher;
  const title = voucher ? `${voucher.type === "RECEIPT" ? "سند قبض" : "سند صرف"} — ${voucher.transactionNumber}` : "إدارة السند";
  return <Modal open onClose={onClose} title={title} description="عرض وتعديل أو إلغاء أو استعادة السند مع انعكاس فوري ومؤمّن للأرصدة." size="md" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button>{voucher ? <><Button variant="outline" onClick={() => print("THERMAL")} disabled={!data}><Printer size={15}/>طباعة 80mm</Button><Button variant="outline" onClick={() => print("A4")} disabled={!data}><Printer size={15}/>طباعة A4</Button></> : null}{voucher?.status === "VOIDED" && data?.canRestore ? <Button variant="success" onClick={() => setRestoring(true)} disabled={pending}><RotateCcw size={15}/>استعادة وتفعيل السند</Button> : null}{voucher?.status === "ACTIVE" && data?.canManage ? <><Button variant="danger" onClick={() => setVoiding(true)} disabled={pending}><Ban size={15}/>إلغاء السند</Button><Button onClick={save} loading={pending} disabled={!amount || Number(amount) <= 0 || !treasuryId || !description.trim()}><Save size={15}/>حفظ التعديلات</Button></> : null}</>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {!data && !error ? <p className="text-xs text-bmw-muted">جاري تحميل السند…</p> : null}
      {voucher && data ? <>{voucher.status === "VOIDED" ? <Alert variant="warning">هذا السند ملغى في {voucher.voidedAt ? formatDateTime(voucher.voidedAt) : "وقت سابق"}. السبب: {voucher.voidReason || "غير محدد"}. ستؤدي استعادته إلى إعادة مزامنة الخزينة والحساب وتسوية الفاتورة المرتبطة عند وجودها.</Alert> : null}<section className="grid gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3 sm:grid-cols-2"><div><p className="text-[11px] text-bmw-muted">الحالة</p><Badge variant={voucher.status === "ACTIVE" ? "success" : "danger"}>{voucher.status === "ACTIVE" ? "معتمد ونشط" : "ملغي"}</Badge></div><div><p className="text-[11px] text-bmw-muted">المنشئ</p><p className="text-sm text-white">{voucher.createdByName || "—"}</p></div><div><p className="text-[11px] text-bmw-muted">الحساب</p><p className="text-sm text-white">{voucher.account ? `${voucher.account.accountNumber} — ${voucher.account.name}` : "غير مرتبط بحساب"}</p></div><div><p className="text-[11px] text-bmw-muted">الفاتورة المرتبطة</p><p className="font-mono text-sm text-bmw-blue">{voucher.invoiceNumber || "—"}</p></div></section><section className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-3"><p className="mb-2 text-xs font-bold text-white">سجل دورة حياة السند</p>{data.timeline.length ? <div className="space-y-2">{data.timeline.map((entry) => <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-bmw-cardBorder/60 pb-2 last:border-0 last:pb-0"><div><p className="text-xs text-bmw-silver">{entry.event || entry.action}</p><p className="font-mono text-[10px] text-bmw-muted">{entry.performedBy}</p></div><p className="tabular whitespace-nowrap text-[10px] text-bmw-muted">{formatDateTime(entry.timestamp)}</p></div>)}</div> : <p className="text-xs text-bmw-muted">لا توجد أحداث تدقيق متاحة لهذا السند.</p>}</section>{voucher.status === "ACTIVE" && data.canManage ? <><div className="grid gap-3 sm:grid-cols-2"><Field label="المبلغ" required><Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} dir="ltr" /></Field><Field label="تاريخ ووقت السند"><Input type="datetime-local" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} dir="ltr" /></Field><Field label="الخزينة" required><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}>{data.treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name} — {formatMoney(treasury.currentBalance)} {CURRENCY}</option>)}</Select></Field><Field label="طريقة الدفع"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="CASH">نقدي</option><option value="BANK">تحويل / بنك</option><option value="INSTAPAY">إنستاباي</option><option value="VISA">فيزا / POS</option><option value="OTHER">أخرى</option></Select></Field></div><Field label="البيان والملاحظات" required><Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field></> : <section className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-3"><p className="text-xs text-bmw-muted">المبلغ</p><p className="tabular text-lg font-bold text-white">{formatMoney(voucher.amount)} {CURRENCY}</p><p className="mt-3 text-xs text-bmw-muted">البيان</p><p className="whitespace-pre-wrap text-sm text-bmw-silver">{voucher.description}</p></section>}{voiding ? <section className="rounded-xl border border-bmw-mRed/40 bg-bmw-mRed/10 p-3"><p className="mb-2 text-sm font-bold text-bmw-mRed">تأكيد إلغاء السند</p><p className="mb-3 text-xs text-bmw-silver">سيُعكس رصيد الخزينة والحساب، وتُفتح تسوية الفاتورة المرتبطة عند وجودها. لا يمكن التراجع عن الإلغاء.</p><Field label="سبب الإلغاء" required><Textarea rows={2} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} autoFocus placeholder="اكتب سبب الإلغاء بوضوح" /></Field><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setVoiding(false); setVoidReason(""); }} disabled={pending}>تراجع</Button><Button variant="danger" onClick={voidVoucher} loading={pending} disabled={voidReason.trim().length < 3}><X size={15}/>تأكيد الإلغاء والعكس</Button></div></section> : null}{restoring ? <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3"><p className="mb-2 text-sm font-bold text-emerald-400">تأكيد استعادة وتفعيل السند</p><p className="mb-3 text-xs text-bmw-silver">ستُعاد قيمة السند إلى الخزينة والحساب، وتُحدّث تسوية الفاتورة المرتبطة. عند استعادة سند صرف، يتحقق النظام أولاً من كفاية رصيد الخزينة.</p><Field label="سبب الاستعادة" hint="اختياري — يُسجل في سجل التدقيق"><Textarea rows={2} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} autoFocus placeholder="مثال: تم الإلغاء بالخطأ" /></Field><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setRestoring(false); setRestoreReason(""); }} disabled={pending}>تراجع</Button><Button variant="success" onClick={restoreVoucher} loading={pending}><RotateCcw size={15}/>تأكيد الاستعادة والتفعيل</Button></div></section> : null}</> : null}
    </div>
  </Modal>;
}
