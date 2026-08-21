"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Eye, Plus, Printer, RotateCcw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt, formatMoney, formatOemNumber } from "@/lib/utils";
import type { InvoiceDetail, InvoiceListRow } from "@/server/services/invoices.service";
import {
  getInvoiceDetailAction,
  getReturnSourceInvoiceAction,
  searchReturnSourceInvoicesAction,
} from "@/server/actions/invoices.read.actions";
import { createPurchaseReturnAction, createSalesReturnAction, purgePurchaseReturnAction, purgeSalesReturnAction, voidInvoiceAction } from "@/server/actions/invoice.actions";
import { useInvoicePrint } from "@/hooks/use-invoice-print";
import { PrintContainer } from "@/components/print/print-container";
import { SelectionActionToolbar } from "@/components/ui/selection-action-toolbar";

type ReturnDocumentType = "SALE_RETURN" | "PURCHASE_RETURN";
type SourceType = "SALE" | "PURCHASE";
type SourceSearchRow = { id: string; invoiceNumber: string; createdAt: string; grandTotal: number; paidAmount: number; remainingAmount: number; paymentStatus: string; account: { name: string; phone: string | null; accountNumber: string } };
type ReturnSource = {
  id: string; invoiceNumber: string; type: SourceType; createdAt: string;
  subtotal: number; discountAmount: number; taxAmount: number;
  account: { id: string; name: string; phone: string | null; accountNumber: string; currentBalance: number };
  items: Array<{ id: string; partId: string | null; nameAr: string; oemNumber: string; quantity: number; unitPrice: number; totalPrice: number; stockQuantity: number; previouslyReturnedQuantity: number; availableQuantity: number }>;
};

export function ReturnRegisterClient({ type, rows, treasuries, canVoid, canPurge }: { type: ReturnDocumentType; rows: InvoiceListRow[]; treasuries: Array<{ id: string; name: string }>; canVoid: boolean; canPurge: boolean }) {
  const router = useRouter();
  const isSaleReturn = type === "SALE_RETURN";
  const [createOpen, setCreateOpen] = useState(false);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceListRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<InvoiceListRow[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purgeSuccess, setPurgeSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const visibleRows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase("ar-EG");
    if (!query) return rows;
    return rows.filter((row) => `${row.invoiceNumber} ${row.sourceInvoiceNumber ?? ""} ${row.accountName}`.toLocaleLowerCase("ar-EG").includes(query));
  }, [filter, rows]);
  const selectedRows = visibleRows.filter((row) => selectedIds.includes(row.id));

  return <div className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue"><RotateCcw size={22} /></div><div><h1 className="text-lg font-bold text-white">{isSaleReturn ? "مرتجع المبيعات" : "مرتجع المشتريات"}</h1><p className="text-xs text-bmw-muted">سجل إشعارات {isSaleReturn ? "الدائنة" : "المدينة"} المرتبطة بالفواتير الأصلية.</p></div></div>
      <Button onClick={() => setCreateOpen(true)}><Plus size={16} /> {isSaleReturn ? "إنشاء مرتجع بيع جديد" : "إنشاء مرتجع شراء جديد"}</Button>
    </div>

    <Card><CardContent className="p-4"><div className="relative max-w-xl"><Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" /><Input value={filter} onChange={(event) => setFilter(event.target.value)} className="pr-9" placeholder={isSaleReturn ? "ابحث برقم المرتجع أو فاتورة البيع أو العميل…" : "ابحث برقم المرتجع أو فاتورة الشراء أو المورد…"} /></div></CardContent></Card>

    {purgeSuccess ? <Alert variant="success">{purgeSuccess}</Alert> : null}
    <SelectionActionToolbar count={selectedRows.length} itemLabel="مرتجع" onDelete={canPurge ? () => setPurgeTarget(selectedRows) : undefined} deleteLabel="حذف نهائي وعكس القيود" onClear={() => setSelectedIds([])} />
    <Card><Table><THead><TR><TH><input aria-label="تحديد كل المرتجعات الظاهرة" type="checkbox" checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.id))} onChange={(event) => setSelectedIds(event.target.checked ? visibleRows.map((row) => row.id) : [])} /></TH><TH>رقم المرتجع</TH><TH>الفاتورة الأصلية</TH><TH>{isSaleReturn ? "العميل" : "المورد"}</TH><TH>تاريخ المرتجع</TH><TH>إجمالي المرتجع</TH><TH>طريقة التسوية</TH><TH>المنشئ</TH><TH>الحالة</TH><TH /></TR></THead><TBody>{visibleRows.length === 0 ? <EmptyState colSpan={10} title="لا توجد مرتجعات مطابقة" description="استخدم زر الإنشاء لبدء مرتجع من فاتورة أصلية." icon={<RotateCcw size={30} />} /> : visibleRows.map((row) => <TR key={row.id} className={row.isVoided ? "opacity-50" : ""}><TD><input aria-label={`تحديد المرتجع ${row.invoiceNumber}`} type="checkbox" checked={selectedIds.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /></TD><TD className="font-mono font-bold text-white">{row.invoiceNumber}</TD><TD className="font-mono text-bmw-blue">{row.sourceInvoiceNumber || "—"}</TD><TD>{row.accountName}</TD><TD className="text-xs text-bmw-muted">{formatDateTime(row.createdAt)}</TD><TD className="tabular font-bold">{formatMoney(row.grandTotal)}</TD><TD><Badge variant={row.paidAmount > 0 ? "success" : "purple"}>{row.paidAmount > 0 ? (isSaleReturn ? "رد نقدي" : "استلام نقدي") : (isSaleReturn ? "إضافة للحساب" : "خصم من المورد")}</Badge></TD><TD className="text-xs text-bmw-muted">{row.userName}</TD><TD>{row.isVoided ? <Badge variant="danger">ملغى</Badge> : <Badge variant="success">مُعتمد</Badge>}</TD><TD><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)} title="عرض التفاصيل"><Eye size={15} /></Button><Button size="sm" variant="ghost" onClick={() => setPrintInvoiceId(row.id)} title="طباعة الإشعار"><Printer size={15} /></Button>{canVoid && !row.isVoided ? <Button size="sm" variant="ghost" className="text-bmw-mRed" onClick={() => setVoidTarget(row)} title="إلغاء المرتجع"><Ban size={15} /></Button> : null}{canPurge ? <Button size="sm" variant="ghost" className="text-bmw-mRed" onClick={() => setPurgeTarget([row])} title="حذف نهائي"><Trash2 size={15} /></Button> : null}</div></TD></TR>)}</TBody></Table></Card>

    {createOpen ? <ReturnCreationModal type={type} treasuries={treasuries} onClose={() => setCreateOpen(false)} onCreated={(invoiceId) => { setCreateOpen(false); setPrintInvoiceId(invoiceId); router.refresh(); }} /> : null}
    {printInvoiceId ? <ReturnPrintDialog invoiceId={printInvoiceId} onClose={() => setPrintInvoiceId(null)} /> : null}
    {detailId ? <ReturnDetailModal invoiceId={detailId} onClose={() => setDetailId(null)} /> : null}
    {voidTarget ? <VoidReturnModal invoice={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); router.refresh(); }} /> : null}
    {purgeTarget ? <PurgeReturnModal invoices={purgeTarget} type={type} onClose={() => setPurgeTarget(null)} onDone={(count) => { setPurgeTarget(null); setSelectedIds([]); setPurgeSuccess(`تم الحذف النهائي لـ ${count} مرتجع بنجاح.`); router.refresh(); }} /> : null}
  </div>;
}

function ReturnCreationModal({ type, treasuries, onClose, onCreated }: { type: ReturnDocumentType; treasuries: Array<{ id: string; name: string }>; onClose: () => void; onCreated: (invoiceId: string) => void }) {
  const isSaleReturn = type === "SALE_RETURN";
  const sourceType: SourceType = isSaleReturn ? "SALE" : "PURCHASE";
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SourceSearchRow[]>([]);
  const [source, setSource] = useState<ReturnSource | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [settlement, setSettlement] = useState<"ACCOUNT" | "CASH">("ACCOUNT");
  const [treasuryId, setTreasuryId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [pending, startTransition] = useTransition();

  const search = () => startSearch(async () => { setError(null); const result = await searchReturnSourceInvoicesAction(sourceType, query); if (!result.success) { setError(result.error); return; } setMatches(result.data); });
  useEffect(() => { void (async () => { const result = await searchReturnSourceInvoicesAction(sourceType); if (result.success) setMatches(result.data); })(); }, [sourceType]);
  const choose = async (invoiceId: string) => { setError(null); const result = await getReturnSourceInvoiceAction(invoiceId); if (!result.success) { setError(result.error); return; } if (result.data.type !== sourceType) { setError("نوع الفاتورة الأصلية غير متوافق مع هذا المرتجع."); return; } setSource(result.data); setQuantities(Object.fromEntries(result.data.items.map((item) => [item.id, "0"]))); };
  const selected = source?.items.map((item) => ({ invoiceItemId: item.id, quantity: Number(quantities[item.id] ?? 0), item })).filter((line) => Boolean(line.item.partId) && Number.isInteger(line.quantity) && line.quantity > 0) ?? [];
  const selectionError = selected.find(({ item, quantity }) => quantity > item.availableQuantity || (!isSaleReturn && quantity > item.stockQuantity));
  const selectedSubtotal = selected.reduce((sum, { item, quantity }) => sum + (item.totalPrice / item.quantity) * quantity, 0);
  const estimatedGrandTotal = source && source.subtotal > 0 ? Math.round((selectedSubtotal - source.discountAmount * (selectedSubtotal / source.subtotal) + source.taxAmount * (selectedSubtotal / source.subtotal)) * 100) / 100 : selectedSubtotal;
  const submit = () => {
    if (!source || selected.length === 0 || selectionError) return;
    setError(null);
    startTransition(async () => {
      const payload = { originalInvoiceId: source.id, treasuryId: settlement === "CASH" ? treasuryId : undefined, paidAmount: settlement === "CASH" ? estimatedGrandTotal : 0, notes, items: selected.map(({ invoiceItemId, quantity }) => ({ invoiceItemId, quantity })) };
      const result = isSaleReturn ? await createSalesReturnAction(payload) : await createPurchaseReturnAction(payload);
      if (!result.success) { setError(result.error); return; }
      onCreated(result.data.invoiceId);
    });
  };

  return <Modal open onClose={onClose} title={isSaleReturn ? "إنشاء مرتجع بيع" : "إنشاء مرتجع شراء"} description="اختر فاتورة أصلية، حدّد الكميات المتاحة، ثم اختر تسوية المرتجع. جميع القيود تُسجّل ذرّياً." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button onClick={submit} loading={pending} disabled={!source || selected.length === 0 || !!selectionError || (settlement === "CASH" && !treasuryId)}><RotateCcw size={15} /> اعتماد المرتجع وطباعة الإشعار</Button></>}><div className="space-y-4">
    {error ? <Alert variant="error">{error}</Alert> : null}
    <section className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3"><p className="mb-2 text-sm font-bold text-white">١. ابحث واختر الفاتورة الأصلية</p><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} placeholder={isSaleReturn ? "رقم الفاتورة أو العميل أو الهاتف أو التاريخ" : "رقم فاتورة الشراء أو المورد أو التاريخ"} /><Button variant="outline" onClick={search} loading={searching}><Search size={15} /> بحث</Button></div><div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-bmw-cardBorder">{matches.length === 0 ? <p className="p-3 text-xs text-bmw-muted">لا توجد فواتير مطابقة.</p> : matches.map((match) => <button key={match.id} type="button" onClick={() => void choose(match.id)} className={`flex w-full items-center justify-between gap-3 border-b border-bmw-cardBorder px-3 py-2 text-right text-xs last:border-0 ${source?.id === match.id ? "bg-bmw-blue/15" : "hover:bg-bmw-card"}`}><span><b className="font-mono text-white">{match.invoiceNumber}</b> — {match.account.name} <small className="mr-1 text-bmw-muted">{match.account.phone || ""}</small></span><span className="tabular text-bmw-muted">{formatMoney(match.grandTotal)} • {formatDateTime(match.createdAt)}</span></button>)}</div></section>
    {source ? <><section className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><p className="font-bold text-white">٢. أصناف الفاتورة {source.invoiceNumber} — {source.account.name}</p><p className="mt-1 text-xs text-bmw-muted">أدخل الكمية ضمن الحد المتاح. {isSaleReturn ? "سيزداد المخزون بالكمية المقبولة." : "يجب أن يتوفر بالمخزون ما يكفي من الكمية لإخراجها إلى المورد."}</p><div className="mt-3 overflow-x-auto"><Table><THead><TR><TH>الصنف</TH><TH>OEM</TH><TH>{isSaleReturn ? "الكمية المباعة" : "الكمية المستلمة"}</TH><TH>مرتجع سابق</TH><TH>المتاح للمرتجع</TH>{!isSaleReturn ? <TH>المتاح بالمخزون</TH> : null}<TH>سعر الوحدة</TH><TH>كمية المرتجع</TH></TR></THead><TBody>{source.items.map((item) => { const quantity = quantities[item.id] ?? "0"; const invalid = Number(quantity) > item.availableQuantity || (!isSaleReturn && Number(quantity) > item.stockQuantity); return <TR key={item.id}><TD className="font-bold text-white">{item.nameAr}</TD><TD className="font-mono text-xs text-bmw-blue">{formatOemNumber(item.oemNumber)}</TD><TD className="tabular">{item.quantity}</TD><TD className="tabular text-bmw-muted">{item.previouslyReturnedQuantity}</TD><TD className="tabular text-emerald-400">{item.availableQuantity}</TD>{!isSaleReturn ? <TD className="tabular text-amber-400">{item.stockQuantity}</TD> : null}<TD className="tabular">{formatMoney(item.unitPrice)}</TD><TD><Input type="number" min="0" max={Math.min(item.availableQuantity, isSaleReturn ? item.availableQuantity : item.stockQuantity)} step="1" dir="ltr" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className={`w-24 ${invalid ? "border-bmw-mRed" : ""}`} /></TD></TR>; })}</TBody></Table></div>{selectionError ? <Alert variant="error" className="mt-3">إحدى الكميات تتجاوز المتاح للمرتجع أو الرصيد الفعلي بالمخزون.</Alert> : null}</section>
      <section className="grid gap-3 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 sm:grid-cols-3"><Field label="٣. طريقة التسوية" required><Select value={settlement} onChange={(event) => { setSettlement(event.target.value as "ACCOUNT" | "CASH"); setTreasuryId(""); }}><option value="ACCOUNT">{isSaleReturn ? "إضافة إلى رصيد حساب العميل" : "خصم من مستحقات المورد"}</option><option value="CASH">{isSaleReturn ? "رد نقدي من الخزينة" : "استلام نقدي إلى الخزينة"}</option></Select></Field>{settlement === "CASH" ? <Field label="الخزينة" required><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}><option value="">اختر الخزينة</option>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field> : <div className="rounded-xl border border-bmw-cardBorder p-3 text-xs text-bmw-muted">سيُسوّى كامل المرتجع تلقائياً على حساب {source.account.name}.</div>}<Field label="سبب / ملاحظات"><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: عيب تصنيع أو تسوية بالاتفاق" /></Field><div className="sm:col-span-3"><Alert variant="info">القيمة التقديرية للمرتجع: <b className="tabular">{formatMoney(estimatedGrandTotal)}</b>. {settlement === "CASH" ? (isSaleReturn ? "سيُصرف هذا المبلغ من الخزينة." : "سيُضاف هذا المبلغ إلى الخزينة.") : "سيُرحّل هذا المبلغ للحساب."}</Alert></div></section></> : null}
  </div></Modal>;
}

function ReturnPrintDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, state, error, prepare, print, onAfterPrint } = useInvoicePrint(invoiceId);
  useEffect(() => { void prepare(); }, [prepare]);
  const loading = state === "loading" || state === "printing";
  return <><Modal open onClose={onClose} title="طباعة إشعار المرتجع" description="سيُستخدم نموذج المرتجع الرسمي A4 المرتبط بنوع المستند." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={loading}>إغلاق</Button><Button onClick={() => void print()} loading={loading} disabled={!data}><Printer size={15} /> طباعة الإشعار</Button></>}><div className="space-y-3">{state === "loading" ? <Alert variant="info">جاري تجهيز الإشعار…</Alert> : null}{error ? <Alert variant="error">{error}</Alert> : null}{data ? <Alert variant="success">{data.invoice.invoiceNumber} — {data.account.name}</Alert> : null}</div></Modal>{data && state === "printing" ? <PrintContainer data={data} format="A4_STANDARD" autoPrint onAfterPrint={onAfterPrint} /> : null}</>;
}

function ReturnDetailModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void getInvoiceDetailAction(invoiceId).then((result) => { if (!active) return; if (result.success) setDetail(result.data); else setError(result.error); }); return () => { active = false; }; }, [invoiceId]);
  return <Modal open onClose={onClose} title={detail ? `تفاصيل المرتجع — ${detail.invoiceNumber}` : "تفاصيل المرتجع"} size="lg" footer={<Button variant="ghost" onClick={onClose}>إغلاق</Button>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}{!detail && !error ? <Alert variant="info">جاري تحميل التفاصيل…</Alert> : null}{detail ? <><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div>الفاتورة الأصلية: <b className="font-mono">{detail.sourceInvoiceNumber || "—"}</b></div><div>الحساب: <b>{detail.account.name}</b></div><div>المدفوع: <b>{formatMoney(detail.paidAmount)}</b></div><div>المتبقي: <b>{formatMoney(detail.remainingAmount)}</b></div></div><Table><THead><TR><TH>الصنف</TH><TH>OEM</TH><TH>الكمية</TH><TH>سعر الوحدة</TH><TH>الإجمالي</TH></TR></THead><TBody>{detail.items.map((item) => <TR key={item.id}><TD>{item.nameAr}</TD><TD className="font-mono">{item.oemNumber}</TD><TD className="tabular">{item.quantity}</TD><TD className="tabular">{formatMoney(item.unitPrice)}</TD><TD className="tabular">{formatMoney(item.totalPrice)}</TD></TR>)}</TBody></Table></> : null}</div></Modal>;
}

function PurgeReturnModal({ invoices, type, onClose, onDone }: { invoices: InvoiceListRow[]; type: ReturnDocumentType; onClose: () => void; onDone: (count: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeCount = invoices.filter((invoice) => !invoice.isVoided).length;
  const submit = () => startTransition(async () => {
    setError(null);
    let completed = 0;
    for (const invoice of invoices) {
      const result = type === "SALE_RETURN" ? await purgeSalesReturnAction({ invoiceId: invoice.id }) : await purgePurchaseReturnAction({ invoiceId: invoice.id });
      if (!result.success) { setError(completed > 0 ? `تم حذف ${completed} مرتجع، ثم تعذر حذف ${invoice.invoiceNumber}: ${result.error}` : `تعذر حذف ${invoice.invoiceNumber}: ${result.error}`); return; }
      completed += 1;
    }
    onDone(completed);
  });
  return <Modal open onClose={onClose} title="تأكيد الحذف النهائي للمستند" description={`سيُعالج ${invoices.length} مرتجعاً.`} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={submit} loading={pending}><Trash2 size={15} /> حذف نهائي</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning">{activeCount > 0 ? `يوجد ${activeCount} مرتجع مُعتمد؛ سيعكس النظام كميات المخزون والأثر النقدي/الحسابي أولاً، ثم يحذف المستند وسجلاته التشغيلية.` : "كل المرتجعات المحددة ملغاة بالفعل؛ سيُحذف سجلها التشغيلي دون تطبيق عكس ثانٍ على مخزون أو خزينة أو حساب."}</Alert><p className="text-xs text-bmw-muted">لا يمكن التراجع عن الحذف النهائي. يتطلب هذا الإجراء صلاحية مدير النظام أو مدير تنفيذي.</p></div></Modal>;
}

function VoidReturnModal({ invoice, onClose, onDone }: { invoice: InvoiceListRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => { const result = await voidInvoiceAction({ invoiceId: invoice.id, reason }); if (!result.success) { setError(result.error); return; } onDone(); });
  return <Modal open onClose={onClose} title={`إلغاء المرتجع ${invoice.invoiceNumber}`} description="سيُنشئ النظام قيوداً عكسية للمخزون والخزينة والحساب دون حذف أي بيانات." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button variant="danger" loading={pending} disabled={reason.trim().length < 5} onClick={submit}><Ban size={15} /> تأكيد الإلغاء</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Field label="سبب الإلغاء" required hint="خمسة أحرف على الأقل"><Textarea rows={3} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} /></Field></div></Modal>;
}
