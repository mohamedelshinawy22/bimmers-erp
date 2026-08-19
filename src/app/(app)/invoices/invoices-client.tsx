"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  Eye,
  Printer,
  Receipt,
  Search,
  ScrollText,
  ShoppingBag,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  HandCoins,
  Trash2,
} from "lucide-react";
import type { InvoiceType, PaymentStatus } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatInt, formatMoney, formatOemNumber } from "@/lib/utils";
import type { InvoiceListRow } from "@/server/services/invoices.service";
import type { InvoiceDetail } from "@/server/services/invoices.service";
import type { CompanyProfile } from "@/server/services/settings.service";
import { createInvoiceReturnAction, purgePurchaseInvoiceAction, purgeSalesInvoiceAction, voidInvoiceAction } from "@/server/actions/invoice.actions";
import { settleInvoiceAction } from "@/server/actions/treasury.actions";
import { getInvoiceDetailAction } from "@/server/actions/invoices.read.actions";
import { InvoicePrintPreviewModal } from "@/components/print/invoice-print-preview-modal";
import { SelectionActionToolbar } from "@/components/ui/selection-action-toolbar";

interface InvoicesClientProps {
  rows: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { query: string; type: string; status: string; includeVoided: boolean };
  permissions: { canVoid: boolean; canPurge: boolean; canViewCost: boolean; canSettle: boolean };
  company: CompanyProfile;
  treasuries: Array<{ id: string; name: string }>;
}

export function InvoicesClient({
  rows,
  total,
  page,
  pageSize,
  filters,
  permissions,
  company,
  treasuries,
}: InvoicesClientProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(filters.query);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [voidTarget, setVoidTarget] = useState<InvoiceListRow | null>(null);
  const [settlementTarget, setSettlementTarget] = useState<InvoiceListRow | null>(null);
  const [returnTarget, setReturnTarget] = useState<InvoiceListRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purgeTarget, setPurgeTarget] = useState<InvoiceListRow[] | null>(null);
  const selectedInvoices = rows.filter((invoice) => selectedIds.includes(invoice.id) && (invoice.type === "SALE" || invoice.type === "PURCHASE"));
  const selectableInvoices = rows.filter((invoice) => invoice.type === "SALE" || invoice.type === "PURCHASE");

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    router.push(`/invoices?${next.toString()}`);
  };

  const openDetail = async (id: string) => {
    setLoadingDetail(true);
    const res = await getInvoiceDetailAction(id);
    setLoadingDetail(false);
    if (res.success) setDetail(res.data);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
            <ScrollText size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">الفواتير</h1>
            <p className="text-xs text-bmw-muted">
              {formatInt(total)} فاتورة • الإلغاء يُنشئ قيوداً عكسية ولا يحذف أي بيانات
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <form
            className="relative md:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: query });
            }}
          >
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم الفاتورة أو اسم الحساب…"
              className="pr-9"
            />
          </form>

          <Select value={filters.type} onChange={(e) => push({ type: e.target.value })}>
            <option value="">كل الأنواع</option>
            <option value="SALE">فاتورة بيع</option>
            <option value="PURCHASE">فاتورة شراء</option>
          </Select>

          <Select value={filters.status} onChange={(e) => push({ status: e.target.value })}>
            <option value="">كل الحالات</option>
            <option value="PAID">مدفوعة</option>
            <option value="PARTIAL">مدفوعة جزئياً</option>
            <option value="CREDIT">آجل</option>
          </Select>

          <div className="md:col-span-4">
            <Button
              size="sm"
              variant={filters.includeVoided ? "danger" : "outline"}
              onClick={() => push({ voided: filters.includeVoided ? null : "1" })}
            >
              <Ban size={14} /> إظهار الفواتير الملغاة
            </Button>
          </div>
        </CardContent>
      </Card>

      <SelectionActionToolbar
        count={selectedInvoices.length}
        itemLabel="فاتورة"
        onEdit={selectedInvoices.length === 1 ? () => router.push(`/invoices/${selectedInvoices[0]?.type === "SALE" ? "sales" : "purchases"}/${selectedInvoices[0]?.id}/edit`) : undefined}
        onDelete={permissions.canPurge ? () => setPurgeTarget(selectedInvoices) : undefined}
        deleteLabel="حذف نهائي وعكس القيود"
        onClear={() => setSelectedIds([])}
      />

      <Card>
        <Table>
          <THead>
            <TR>
              <TH><input aria-label="تحديد كل الفواتير القابلة للحذف" type="checkbox" checked={selectableInvoices.length > 0 && selectableInvoices.every((invoice) => selectedIds.includes(invoice.id))} onChange={(event) => setSelectedIds(event.target.checked ? selectableInvoices.map((invoice) => invoice.id) : [])} /></TH>
              <TH>رقم الفاتورة</TH>
              <TH>النوع</TH>
              <TH>الحساب</TH>
              <TH>الأصناف</TH>
              <TH>الإجمالي</TH>
              <TH>المدفوع</TH>
              <TH>المتبقي</TH>
              <TH>الحالة</TH>
              <TH>المستخدم</TH>
              <TH>التاريخ</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyState
                colSpan={12}
                title="لا توجد فواتير مطابقة"
                description="عدّل معايير البحث أو أصدر فاتورة جديدة من نقطة البيع."
                icon={<Receipt size={32} />}
              />
            ) : (
              rows.map((inv) => (
                <TR key={inv.id} tabIndex={0} onDoubleClick={() => void openDetail(inv.id)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void openDetail(inv.id); } }} className={`${inv.isVoided ? "opacity-50" : ""} cursor-pointer focus:outline-none focus:ring-1 focus:ring-bmw-blue`}>
                  <TD><input aria-label={`تحديد الفاتورة ${inv.invoiceNumber}`} type="checkbox" disabled={inv.type !== "SALE" && inv.type !== "PURCHASE"} className={inv.type !== "SALE" && inv.type !== "PURCHASE" ? "cursor-not-allowed opacity-35" : undefined} checked={selectedIds.includes(inv.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, inv.id])] : current.filter((id) => id !== inv.id))} /></TD>
                  <TD className="tabular whitespace-nowrap font-bold text-white">{inv.invoiceNumber}</TD>
                  <TD>
                    <Badge variant={inv.type === "SALE" ? "blue" : "purple"}>
                      {ARABIC_LABELS.invoiceType[inv.type]}
                    </Badge>
                  </TD>
                  <TD className="max-w-[200px] truncate">{inv.accountName}</TD>
                  <TD className="tabular text-xs text-bmw-muted">{formatInt(inv.itemCount)}</TD>
                  <TD className="tabular whitespace-nowrap font-bold">{formatMoney(inv.grandTotal)}</TD>
                  <TD className="tabular whitespace-nowrap text-emerald-400">{formatMoney(inv.paidAmount)}</TD>
                  <TD
                    className={`tabular whitespace-nowrap ${inv.remainingAmount > 0 ? "text-amber-400" : "text-bmw-muted"}`}
                  >
                    {formatMoney(inv.remainingAmount)}
                  </TD>
                  <TD>
                    {inv.isVoided ? (
                      <Badge variant="danger">ملغاة</Badge>
                    ) : (
                      <Badge
                        variant={
                          inv.paymentStatus === "PAID"
                            ? "success"
                            : inv.paymentStatus === "PARTIAL"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {ARABIC_LABELS.paymentStatus[inv.paymentStatus]}
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-bmw-muted">{inv.userName}</TD>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-muted">
                    {formatDateTime(inv.createdAt)}
                  </TD>
                  <TD><InvoiceActionMenu invoice={inv} canVoid={permissions.canVoid} canSettle={permissions.canSettle} onDetail={() => void openDetail(inv.id)} onEdit={() => router.push(`/invoices/${inv.type === "SALE" ? "sales" : "purchases"}/${inv.id}/edit`)} onPrint={() => setPrintInvoiceId(inv.id)} onSettle={() => setSettlementTarget(inv)} onReturn={() => setReturnTarget(inv)} onVoid={() => setVoidTarget(inv)} /></TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-bmw-cardBorder px-4 py-3">
            <p className="text-xs text-bmw-muted">
              صفحة <span className="tabular font-bold text-white">{page}</span> من{" "}
              <span className="tabular">{pageCount}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => push({ page: String(page - 1) })}>
                السابق
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => push({ page: String(page + 1) })}
              >
                التالي
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {loadingDetail ? <Alert variant="info">جاري تحميل تفاصيل الفاتورة…</Alert> : null}

      {detail ? (
        <InvoiceDetailModal
          detail={detail}
          onClose={() => setDetail(null)}
          canViewCost={permissions.canViewCost}
          company={company}
          onPrint={() => setPrintInvoiceId(detail.id)}
        />
      ) : null}

      {printInvoiceId ? <InvoicePrintDialog invoiceId={printInvoiceId} onClose={() => setPrintInvoiceId(null)} /> : null}

      {settlementTarget ? <InvoiceSettlementModal invoice={settlementTarget} treasuries={treasuries} onClose={() => setSettlementTarget(null)} onDone={() => { setSettlementTarget(null); setDetail(null); router.refresh(); }} /> : null}

      {returnTarget ? <InvoiceReturnModal invoice={returnTarget} treasuries={treasuries} onClose={() => setReturnTarget(null)} onDone={() => { setReturnTarget(null); setDetail(null); router.refresh(); }} /> : null}

      {purgeTarget ? <PurgeInvoicesModal invoices={purgeTarget} onClose={() => setPurgeTarget(null)} onDone={() => { setPurgeTarget(null); setSelectedIds([]); router.refresh(); }} /> : null}

      {voidTarget ? (
        <VoidInvoiceModal
          invoice={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => {
            setVoidTarget(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PurgeInvoicesModal({ invoices, onClose, onDone }: { invoices: InvoiceListRow[]; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const quantity = invoices.reduce((sum, invoice) => sum + invoice.itemCount, 0);
  const cash = invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
  const balance = invoices.reduce((sum, invoice) => sum + invoice.remainingAmount, 0);
  const submit = () => startTransition(async () => {
    setError(null);
    let completed = 0;
    for (const invoice of invoices) {
      const result = invoice.type === "SALE" ? await purgeSalesInvoiceAction({ invoiceId: invoice.id }) : await purgePurchaseInvoiceAction({ invoiceId: invoice.id });
      if (!result.success) { setError(completed > 0 ? `تم حذف ${completed} فاتورة، ثم تعذر حذف ${invoice.invoiceNumber}: ${result.error}` : `تعذر حذف ${invoice.invoiceNumber}: ${result.error}`); return; }
      completed += 1;
    }
    onDone();
  });
  return <Modal open onClose={onClose} title="تأكيد الحذف النهائي واسترجاع القيم" description={`سيُعالج ${invoices.length} مستنداً ضمن عمليات عكس ذرّية مستقلة.`} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={submit} loading={pending}><Trash2 size={15} /> حذف نهائي وعكس القيود</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning">سيعكس النظام أثر المخزون والخزينة والحساب لكل فاتورة نشطة قبل حذف سجلاتها التشغيلية. الفواتير الملغاة تُنظف دون عكس ثانٍ.</Alert><div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg border border-bmw-cardBorder p-2">{quantity}<br/><span className="text-bmw-muted">بند</span></div><div className="rounded-lg border border-bmw-cardBorder p-2">{formatMoney(cash)}<br/><span className="text-bmw-muted">نقدي</span></div><div className="rounded-lg border border-bmw-cardBorder p-2">{formatMoney(balance)}<br/><span className="text-bmw-muted">آجل</span></div></div><div className="max-h-32 overflow-auto rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2 font-mono text-xs">{invoices.map((invoice) => <p key={invoice.id}>{invoice.invoiceNumber}</p>)}</div></div></Modal>;
}

function InvoiceDetailModal({
  detail,
  onClose,
  canViewCost,
  company,
  onPrint,
}: {
  detail: InvoiceDetail;
  onClose: () => void;
  canViewCost: boolean;
  company: CompanyProfile;
  onPrint: () => void;
}) {
  const margin = detail.items.reduce(
    (sum, it) => sum + (it.totalPrice - it.unitCostSnapshot * it.quantity),
    0,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`${ARABIC_LABELS.invoiceType[detail.type]} — ${detail.invoiceNumber}`}
      description={formatDateTime(detail.createdAt)}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
          <Button variant="outline" onClick={onPrint}>
            <Printer size={15} /> اختيار الطباعة
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Printable document header, driven by the company settings. */}
        <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-center">
          <p className="text-sm font-bold text-white">{company.name}</p>
          {company.address ? <p className="text-[11px] text-bmw-muted">{company.address}</p> : null}
          <p className="font-mono text-[11px] text-bmw-muted" dir="ltr">
            {[company.phone, company.taxNumber ? `TAX ${company.taxNumber}` : ""].filter(Boolean).join("  •  ")}
          </p>
        </div>

        {detail.isVoided ? (
          <Alert variant="error">
            هذه الفاتورة ملغاة{detail.voidedAt ? ` بتاريخ ${formatDateTime(detail.voidedAt)}` : ""}. السبب:{" "}
            {detail.voidReason ?? "—"}
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Info label="الحساب" value={detail.account.name} />
          <Info label="كود الحساب" value={detail.account.accountNumber} mono />
          <Info label="المستخدم" value={detail.user.fullName} />
          <Info label="الخزينة" value={detail.treasury?.name ?? "—"} />
          {detail.vehicleLabel ? <Info label="السيارة" value={detail.vehicleLabel} /> : null}
          <Info label="طريقة الدفع" value={ARABIC_LABELS.paymentMethod[detail.paymentMethod]} />
        </div>

        <Table>
          <THead>
            <TR>
              <TH>الصنف</TH>
              <TH>رقم OEM</TH>
              <TH>الموقع</TH>
              <TH>الكمية</TH>
              <TH>السعر</TH>
              {canViewCost ? <TH>التكلفة</TH> : null}
              <TH>الإجمالي</TH>
            </TR>
          </THead>
          <TBody>
            {detail.items.map((it) => (
              <TR key={it.id}>
                <TD className="max-w-[200px] truncate font-bold text-white">{it.nameAr}</TD>
                <TD className="font-mono text-[11px] text-bmw-blue">{formatOemNumber(it.oemNumber)}</TD>
                <TD className="font-mono text-[11px] text-bmw-muted">{it.binLocationSnapshot ?? "—"}</TD>
                <TD className="tabular">{it.quantity}</TD>
                <TD className="tabular">{formatMoney(it.unitPrice)}</TD>
                {canViewCost ? (
                  <TD className="tabular text-xs text-bmw-muted">{formatMoney(it.unitCostSnapshot)}</TD>
                ) : null}
                <TD className="tabular font-bold">{formatMoney(it.totalPrice)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>

        <div className="ml-auto max-w-xs space-y-1.5 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-4 text-sm">
          <SumRow label="الإجمالي قبل الخصم" value={detail.subtotal} />
          {detail.discountAmount > 0 ? <SumRow label="الخصم" value={-detail.discountAmount} /> : null}
          {detail.taxAmount > 0 ? <SumRow label="الضريبة" value={detail.taxAmount} /> : null}
          <div className="border-t border-bmw-cardBorder pt-1.5">
            <SumRow label="الإجمالي النهائي" value={detail.grandTotal} bold />
            <SumRow label="المدفوع" value={detail.paidAmount} tone="text-emerald-400" />
            {detail.remainingAmount > 0 ? (
              <SumRow label="المتبقي" value={detail.remainingAmount} tone="text-amber-400" />
            ) : null}
          </div>
          {canViewCost && detail.type === "SALE" ? (
            <div className="border-t border-bmw-cardBorder pt-1.5">
              <SumRow label="هامش الربح" value={margin} tone={margin >= 0 ? "text-emerald-400" : "text-bmw-mRed"} />
            </div>
          ) : null}
        </div>

        {detail.notes ? <p className="text-xs text-bmw-muted">ملاحظات: {detail.notes}</p> : null}
        {company.invoiceFooter ? (
          <p className="text-center text-[10px] text-bmw-muted">{company.invoiceFooter}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2">
      <p className="text-[10px] text-bmw-muted">{label}</p>
      <p className={`truncate text-xs font-bold text-white ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function SumRow({ label, value, bold, tone }: { label: string; value: number; bold?: boolean; tone?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-bmw-muted">{label}</span>
      <span className={`tabular ${bold ? "font-bold" : ""} ${tone ?? "text-white"}`}>
        {formatMoney(value)} <span className="text-[10px] text-bmw-muted">{CURRENCY}</span>
      </span>
    </div>
  );
}

function VoidInvoiceModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceListRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await voidInvoiceAction({ invoiceId: invoice.id, reason });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`إلغاء الفاتورة ${invoice.invoiceNumber}`}
      description="لا يتم حذف أي بيانات — يتم تسجيل قيود عكسية للمخزون والخزينة والحساب."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            رجوع
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={reason.trim().length < 5}>
            <Ban size={15} /> تأكيد الإلغاء
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Alert variant="warning">
          سيتم إرجاع {formatInt(invoice.itemCount)} صنف إلى المخزون
          {invoice.paidAmount > 0
            ? ` ورد مبلغ ${formatMoney(invoice.paidAmount)} ${CURRENCY} من الخزينة`
            : ""}
          {invoice.remainingAmount > 0 ? ` وإلغاء مديونية ${formatMoney(invoice.remainingAmount)} ${CURRENCY}` : ""}.
        </Alert>
        <Field label="سبب الإلغاء" required hint="٥ أحرف على الأقل — يُسجَّل في سجل التدقيق">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

export { ShoppingBag };

function InvoiceActionMenu({ invoice, canVoid, canSettle, onDetail, onEdit, onPrint, onSettle, onReturn, onVoid }: { invoice: InvoiceListRow; canVoid: boolean; canSettle: boolean; onDetail: () => void; onEdit: () => void; onPrint: () => void; onSettle: () => void; onReturn: () => void; onVoid: () => void }) {
  const [open, setOpen] = useState(false); const [position, setPosition] = useState({ top: 0, left: 0 }); const triggerRef = useRef<HTMLButtonElement>(null); const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false); }; window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close); }, [open]);
  const toggle = (event: React.MouseEvent) => { event.stopPropagation(); const rect = triggerRef.current?.getBoundingClientRect(); if (rect) setPosition({ top: rect.bottom + 6, left: Math.max(8, rect.right - 208) }); setOpen((value) => !value); };
  const item = (label: string, icon: React.ReactNode, action: () => void, danger = false) => <button type="button" className={`rounded-lg px-3 py-2 text-right text-xs hover:bg-bmw-carbon ${danger ? "text-bmw-mRed" : "text-bmw-silver"}`} onClick={(event) => { event.stopPropagation(); setOpen(false); action(); }}>{icon}{label}</button>;
  const menu = open && typeof document !== "undefined" ? createPortal(<div ref={menuRef} dir="rtl" style={{ position: "fixed", top: position.top, left: position.left }} className="z-50 grid min-w-[200px] gap-1 rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md">{item("عرض التفاصيل", <Eye className="ml-1 inline" size={14}/>, onDetail)}{item("تعديل الفاتورة", <Pencil className="ml-1 inline" size={14}/>, onEdit)}{item("طباعة الفاتورة", <Printer className="ml-1 inline" size={14}/>, onPrint)}{canSettle && invoice.remainingAmount > 0 && !invoice.isVoided ? item("سداد / تحصيل", <HandCoins className="ml-1 inline" size={14}/>, onSettle) : null}{!invoice.isVoided && (invoice.type === "SALE" || invoice.type === "PURCHASE") ? item("عمل مرتجع", <RotateCcw className="ml-1 inline" size={14}/>, onReturn) : null}{canVoid && !invoice.isVoided ? item("إلغاء الفاتورة", <Ban className="ml-1 inline" size={14}/>, onVoid, true) : null}</div>, document.body) : null;
  return <><button ref={triggerRef} type="button" aria-label="عمليات الفاتورة" onClick={toggle} className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-blue/10 hover:text-bmw-blue"><MoreHorizontal size={16}/></button>{menu}</>;
}

function InvoicePrintDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  return <InvoicePrintPreviewModal invoiceId={invoiceId} onClose={onClose} />;
}

function InvoiceSettlementModal({ invoice, treasuries, onClose, onDone }: { invoice: InvoiceListRow; treasuries: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [treasuryId, setTreasuryId] = useState("");
  const [amount, setAmount] = useState(String(invoice.remainingAmount));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isSale = invoice.type === "SALE";
  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await settleInvoiceAction({ invoiceId: invoice.id, treasuryId, amount: Number(amount), description });
      if (!result.success) { setError(result.error); return; }
      onDone();
    });
  };
  return <Modal open onClose={onClose} title={`${isSale ? "تحصيل" : "سداد"} فاتورة ${invoice.invoiceNumber}`} description={`${isSale ? "تحصيل من" : "سداد إلى"} ${invoice.accountName} — المتبقي: ${formatMoney(invoice.remainingAmount)} ${CURRENCY}`} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button onClick={submit} loading={pending} disabled={!treasuryId || !Number.isFinite(Number(amount)) || Number(amount) <= 0}><HandCoins size={15} /> تأكيد {isSale ? "التحصيل" : "السداد"}</Button></>}>
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {treasuries.length === 0 ? <Alert variant="warning">لا توجد خزينة نشطة لاستلام أو صرف المبلغ.</Alert> : null}
      <Field label="الخزينة" required><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}><option value="">اختر الخزينة</option>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field>
      <Field label="المبلغ" required hint={`الحد الأقصى ${formatMoney(invoice.remainingAmount)} ${CURRENCY}`}><Input type="number" min="0.01" max={invoice.remainingAmount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} dir="ltr" /></Field>
      <Field label="بيان السند"><Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={`${isSale ? "تحصيل" : "سداد"} فاتورة ${invoice.invoiceNumber}`} /></Field>
    </div>
  </Modal>;
}

function InvoiceReturnModal({ invoice, treasuries, onClose, onDone }: { invoice: InvoiceListRow; treasuries: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [treasuryId, setTreasuryId] = useState("");
  const [paidAmount, setPaidAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const isSale = invoice.type === "SALE";
  useEffect(() => { let active = true; void (async () => { setLoading(true); const result = await getInvoiceDetailAction(invoice.id); if (!active) return; if (result.success) { setDetail(result.data); setQuantities(Object.fromEntries(result.data.items.map((item) => [item.id, "0"]))); } else setError(result.error); setLoading(false); })(); return () => { active = false; }; }, [invoice.id]);
  const selected = detail?.items.map((item) => ({ invoiceItemId: item.id, quantity: Number(quantities[item.id] ?? 0) })).filter((line) => Number.isInteger(line.quantity) && line.quantity > 0) ?? [];
  const returnedSubtotal = detail?.items.reduce((sum, item) => sum + (Number(quantities[item.id] ?? 0) > 0 ? item.totalPrice / item.quantity * Number(quantities[item.id]) : 0), 0) ?? 0;
  const submit = () => { setError(null); startTransition(async () => { const result = await createInvoiceReturnAction({ originalInvoiceId: invoice.id, treasuryId: treasuryId || undefined, paidAmount: Number(paidAmount), notes, items: selected }); if (!result.success) { setError(result.error); return; } onDone(); }); };
  return <Modal open onClose={onClose} title={`عمل مرتجع ${isSale ? "بيع" : "شراء"} — ${invoice.invoiceNumber}`} description="اختر الكميات المرتجعة من أصناف الفاتورة الأصلية. لا يتم تعديل الفاتورة الأصلية." size="lg" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button onClick={submit} loading={pending} disabled={loading || selected.length === 0 || Number(paidAmount) < 0 || (Number(paidAmount) > 0 && !treasuryId)}><RotateCcw size={15} /> حفظ المرتجع</Button></>}>
    <div className="space-y-4">
      {loading ? <Alert variant="info">جاري تحميل أصناف الفاتورة…</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {detail ? <><Table><THead><TR><TH>الصنف</TH><TH>OEM</TH><TH>المباع / المستلم</TH><TH>الكمية المرتجعة</TH><TH>القيمة التقديرية</TH></TR></THead><TBody>{detail.items.map((item) => { const quantity = quantities[item.id] ?? "0"; const numeric = Number(quantity) || 0; return <TR key={item.id}><TD className="font-bold text-white">{item.nameAr}</TD><TD className="font-mono text-xs text-bmw-blue">{formatOemNumber(item.oemNumber)}</TD><TD className="tabular">{item.quantity}</TD><TD><Input type="number" min="0" max={item.quantity} step="1" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24" dir="ltr" /></TD><TD className="tabular">{formatMoney(item.totalPrice / item.quantity * numeric)}</TD></TR>; })}</TBody></Table>
        <div className="grid gap-3 sm:grid-cols-3"><Field label={isSale ? "مبلغ نقدي يُرد للعميل" : "مبلغ نقدي يُستلم من المورد"} hint={`حد أقصى تقريبي ${formatMoney(returnedSubtotal)} ${CURRENCY}`}><Input type="number" min="0" max={returnedSubtotal} step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} dir="ltr" /></Field><Field label="الخزينة النقدية"><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}><option value="">لا يوجد سداد نقدي</option>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field><Field label="بيان / سبب المرتجع"><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: عيب تصنيع" /></Field></div>
        <Alert variant="info">القيمة التقديرية للأصناف المحددة: <strong>{formatMoney(returnedSubtotal)} {CURRENCY}</strong>. أي رصيد غير نقدي يُرحّل تلقائياً إلى حساب {invoice.accountName}.</Alert>
      </> : null}
    </div>
  </Modal>;
}
