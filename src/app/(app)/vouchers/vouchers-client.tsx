"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Download, Eye, MoreHorizontal, Printer, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Card, CardContent, KpiCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { VoucherDetailsModal } from "@/components/treasury/voucher-details-modal";
import { createTreasuryTransactionAction } from "@/server/actions/treasury.actions";
import { exportVouchersAction, hardDeleteCancelledVoucherAction } from "@/server/actions/vouchers.actions";
import type { CompanyProfile } from "@/server/services/settings.service";
import type { VoucherRegisterRow } from "@/server/services/vouchers.service";
import { CURRENCY, formatDateTime, formatMoney } from "@/lib/utils";

type VoucherType = "RECEIPT" | "PAYMENT";
type Filters = { type: "ALL" | VoucherType; status: "ALL" | "ACTIVE" | "VOIDED"; treasuryId: string; q: string; from: string; to: string };

type Props = {
  rows: VoucherRegisterRow[];
  summary: { receipts: number; payments: number; netCashflow: number; activeCount: number; voidedCount: number; totalCount: number };
  filters: Filters;
  treasuries: Array<{ id: string; name: string; currentBalance: number; isDefault: boolean }>;
  accounts: Array<{ id: string; name: string; accountNumber: string; type: string; phone: string | null }>;
  openInvoices: Array<{ id: string; invoiceNumber: string; type: string; accountId: string; accountName: string; accountNumber: string; remainingAmount: number }>;
  company: CompanyProfile;
  permissions: { canTransact: boolean; canManage: boolean; canPurge: boolean };
  initialAction: VoucherType | null;
};

const asLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const asIso = (input: string) => input ? new Date(input).toISOString() : "";

function downloadBase64(file: { fileName: string; mimeType: string; base64: string }) {
  const binary = atob(file.base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(url);
}

function ledgerHtml(rows: VoucherRegisterRow[], summary: Props["summary"], company: CompanyProfile) {
  const rowHtml = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.transactionNumber}</td><td>${formatDateTime(row.createdAt)}</td><td>${row.type === "RECEIPT" ? "سند قبض" : "سند صرف"}</td><td>${row.account ? `${row.account.accountNumber} — ${row.account.name}` : "—"}</td><td>${row.treasury.name}</td><td class="amount ${row.type === "RECEIPT" ? "in" : "out"}">${formatMoney(row.amount)} ${CURRENCY}</td><td>${row.status === "ACTIVE" ? "معتمد" : "ملغي"}</td><td>${row.description}</td></tr>`).join("");
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>سجل السندات</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#000;font-size:11px;margin:0}header{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}h1{font-size:20px;margin:0 0 3px}p{margin:0;color:#444}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.metric{border:1px solid #555;padding:7px}.metric b{display:block;font-size:14px;margin-top:3px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:5px;vertical-align:top;text-align:right}th{background:#eee}.amount{font-weight:bold;white-space:nowrap}.in{color:#087c42}.out{color:#a61b1b}tfoot td{font-weight:bold;background:#f3f3f3}@media print{html,body{height:auto!important;overflow:visible!important}}</style></head><body><header><div><h1>${company.name || "الشافعي لقطع غيار BMW"}</h1><p>${company.commercialName || "سجل وإدارة السندات والتحصيلات"}</p></div><div><b>سجل السندات المالية</b><p>تاريخ الطباعة: ${formatDateTime(new Date().toISOString())}</p></div></header><section class="metrics"><div class="metric">إجمالي المقبوضات<b>${formatMoney(summary.receipts)} ${CURRENCY}</b></div><div class="metric">إجمالي المدفوعات<b>${formatMoney(summary.payments)} ${CURRENCY}</b></div><div class="metric">صافي الحركة<b>${formatMoney(summary.netCashflow)} ${CURRENCY}</b></div><div class="metric">نشطة / ملغاة<b>${summary.activeCount} / ${summary.voidedCount}</b></div></section><table><thead><tr><th>#</th><th>المرجع</th><th>التاريخ</th><th>النوع</th><th>الحساب</th><th>الخزينة</th><th>المبلغ</th><th>الحالة</th><th>البيان</th></tr></thead><tbody>${rowHtml || "<tr><td colspan=9>لا توجد سندات ضمن المرشحات.</td></tr>"}</tbody></table></body></html>`;
}

export function VouchersClient({ rows, summary, filters, treasuries, accounts, openInvoices, company, permissions, initialAction }: Props) {
  const router = useRouter();
  const [createType, setCreateType] = useState<VoucherType | null>(initialAction);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<VoucherRegisterRow | null>(null);
  const [query, setQuery] = useState(filters.q);
  const [exporting, setExporting] = useState(false);

  useEffect(() => setCreateType(initialAction), [initialAction]);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "F8" && permissions.canTransact) { event.preventDefault(); setCreateType("RECEIPT"); }
      if (event.key === "F9" && permissions.canTransact) { event.preventDefault(); setCreateType("PAYMENT"); }
    };
    window.addEventListener("keydown", keyDown); return () => window.removeEventListener("keydown", keyDown);
  }, [permissions.canTransact]);

  const push = (patch: Partial<Record<keyof Filters, string | null>>) => {
    const next = new URLSearchParams();
    const merged = { ...filters, q: query, ...patch };
    Object.entries(merged).forEach(([key, value]) => { if (value) next.set(key, value); });
    router.push(`/vouchers?${next.toString()}`);
  };
  const setPeriod = (preset: "TODAY" | "WEEK" | "MONTH" | "ALL") => {
    if (preset === "ALL") { push({ from: null, to: null }); return; }
    const now = new Date(); const from = new Date(now);
    if (preset === "TODAY") from.setHours(0, 0, 0, 0);
    if (preset === "WEEK") from.setDate(now.getDate() - 6), from.setHours(0, 0, 0, 0);
    if (preset === "MONTH") from.setDate(1), from.setHours(0, 0, 0, 0);
    push({ from: from.toISOString(), to: now.toISOString() });
  };
  const exportXlsx = async () => { setExporting(true); const result = await exportVouchersAction({ ...filters, q: query }); setExporting(false); if (!result.success) { window.alert(result.error); return; } downloadBase64(result.data); };
  const printLedger = () => { const ref = window.open("", "_blank", "width=1200,height=800"); if (!ref) return; ref.opener = null; ref.document.open(); ref.document.write(ledgerHtml(rows, summary, company)); ref.document.close(); };
  const filteredRows = useMemo(() => query.trim() === filters.q.trim() ? rows : rows.filter((row) => `${row.transactionNumber} ${row.description} ${row.account?.name ?? ""} ${row.account?.accountNumber ?? ""}`.toLocaleLowerCase("ar-EG").includes(query.trim().toLocaleLowerCase("ar-EG"))), [rows, query, filters.q]);

  return <div className="space-y-4" dir="rtl">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue"><ArrowDownLeft size={22} /></div><div><h1 className="text-lg font-bold text-white">سجل وإدارة السندات والتحصيلات</h1><p className="text-xs text-bmw-muted">إدارة سندات القبض والصرف، دورة الإلغاء والاستعادة، والطباعة المحاسبية.</p></div></div><div className="flex flex-wrap gap-2">{permissions.canTransact ? <><Button variant="success" onClick={() => setCreateType("RECEIPT")}><ArrowDownLeft size={16} /> سند قبض جديد <span className="mr-1 text-[10px] opacity-70">F8</span></Button><Button variant="danger" onClick={() => setCreateType("PAYMENT")}><ArrowUpRight size={16} /> سند صرف جديد <span className="mr-1 text-[10px] opacity-70">F9</span></Button></> : null}<Button variant="outline" onClick={exportXlsx} loading={exporting}><Download size={16} /> تصدير إكسيل</Button><Button variant="outline" onClick={printLedger}><Printer size={16} /> طباعة السجل</Button></div></header>

    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"><KpiCard label="إجمالي المقبوضات" value={formatMoney(summary.receipts)} unit={CURRENCY} accent="green" /><KpiCard label="إجمالي المدفوعات والمصروفات" value={formatMoney(summary.payments)} unit={CURRENCY} accent="red" /><KpiCard label="صافي الحركة النقدية" value={formatMoney(summary.netCashflow)} unit={CURRENCY} accent="blue" /><KpiCard label="السندات النشطة / الملغاة" value={`${summary.activeCount} / ${summary.voidedCount}`} unit={`من ${summary.totalCount} سند`} accent="purple" /></section>

    <Card><CardContent className="space-y-3 p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Field label="بحث فوري"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") push({ q: query || null }); }} placeholder="المرجع، الحساب، أو البيان" /></Field><Field label="نوع السند"><Select value={filters.type} onChange={(event) => push({ type: event.target.value === "ALL" ? null : event.target.value })}><option value="ALL">كل السندات</option><option value="RECEIPT">سندات قبض</option><option value="PAYMENT">سندات صرف</option></Select></Field><Field label="الحالة"><Select value={filters.status} onChange={(event) => push({ status: event.target.value === "ALL" ? null : event.target.value })}><option value="ALL">كافة الحالات</option><option value="ACTIVE">السارية فقط</option><option value="VOIDED">الملغاة فقط</option></Select></Field><Field label="الخزينة"><Select value={filters.treasuryId} onChange={(event) => push({ treasuryId: event.target.value || null })}><option value="">كافة الخزائن</option>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field><Field label="نطاق مخصص"><div className="flex gap-1"><Input type="datetime-local" value={filters.from ? asLocalInput(new Date(filters.from)) : ""} onChange={(event) => push({ from: event.target.value ? asIso(event.target.value) : null })} dir="ltr" /><Input type="datetime-local" value={filters.to ? asLocalInput(new Date(filters.to)) : ""} onChange={(event) => push({ to: event.target.value ? asIso(event.target.value) : null })} dir="ltr" /></div></Field></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setPeriod("TODAY")}>اليوم</Button><Button size="sm" variant="ghost" onClick={() => setPeriod("WEEK")}>هذا الأسبوع</Button><Button size="sm" variant="ghost" onClick={() => setPeriod("MONTH")}>هذا الشهر</Button><Button size="sm" variant="ghost" onClick={() => setPeriod("ALL")}>كل الفترات</Button>{query !== filters.q ? <Button size="sm" onClick={() => push({ q: query || null })}>تطبيق البحث</Button> : null}</div></CardContent></Card>

    <Card><CardContent className="p-0"><Table><THead><TR><TH>المرجع</TH><TH>التاريخ والوقت</TH><TH>النوع</TH><TH>الحساب / الجهة</TH><TH>الخزينة</TH><TH>المبلغ</TH><TH>البيان والملاحظات</TH><TH>المسؤول</TH><TH>الحالة</TH><TH>الإجراءات</TH></TR></THead><TBody>{filteredRows.length === 0 ? <EmptyState colSpan={10} title="لا توجد سندات ضمن المرشحات الحالية" icon={<ArrowDownLeft size={32} />} /> : filteredRows.map((row) => <TR key={row.id} className={row.status === "VOIDED" ? "opacity-60" : ""}><TD><button type="button" onClick={() => setDetailsId(row.id)} className="font-mono text-xs font-bold text-bmw-blue hover:underline">{row.transactionNumber}</button></TD><TD className="tabular whitespace-nowrap text-xs text-bmw-muted">{formatDateTime(row.createdAt)}</TD><TD><Badge variant={row.type === "RECEIPT" ? "success" : "danger"}>{row.type === "RECEIPT" ? "سند قبض" : "سند صرف"}</Badge></TD><TD className="max-w-[180px] text-xs">{row.account ? <><p className="truncate text-white">{row.account.name}</p><p className="font-mono text-[10px] text-bmw-muted">{row.account.accountNumber}</p></> : "—"}</TD><TD className="text-xs">{row.treasury.name}</TD><TD className={`tabular whitespace-nowrap font-bold ${row.type === "RECEIPT" ? "text-emerald-400" : "text-bmw-mRed"}`}>{formatMoney(row.amount)} {CURRENCY}</TD><TD className="max-w-[260px] truncate text-xs text-bmw-muted" title={row.description}>{row.description}</TD><TD className="text-xs text-bmw-muted">{row.createdByName ?? "—"}</TD><TD><Badge variant={row.status === "ACTIVE" ? "success" : "danger"}>{row.status === "ACTIVE" ? "معتمد" : "ملغي"}</Badge></TD><TD><VoucherActions row={row} canPurge={permissions.canPurge} onDetails={() => setDetailsId(row.id)} onPurge={() => setPurgeTarget(row)} /></TD></TR>)}</TBody></Table></CardContent></Card>
    {createType ? <CreateVoucherModal type={createType} treasuries={treasuries} accounts={accounts} openInvoices={openInvoices} onClose={() => setCreateType(null)} /> : null}
    {detailsId ? <VoucherDetailsModal voucherId={detailsId} onClose={() => setDetailsId(null)} onChanged={() => { setDetailsId(null); router.refresh(); }} /> : null}
    {purgeTarget ? <PurgeVoucherModal voucher={purgeTarget} onClose={() => setPurgeTarget(null)} onDone={() => { setPurgeTarget(null); router.refresh(); }} /> : null}
  </div>;
}

function VoucherActions({ row, canPurge, onDetails, onPurge }: { row: VoucherRegisterRow; canPurge: boolean; onDetails: () => void; onPurge: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setPosition({ top: rect.bottom + 6, left: Math.max(8, rect.left - 188) }); setOpen((value) => !value); };
  const menu = open ? <><button type="button" aria-label="إغلاق قائمة إجراءات السند" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} /><div style={{ top: position.top, left: position.left }} className="fixed z-50 min-w-52 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-1.5 shadow-2xl"><button type="button" onClick={() => { setOpen(false); onDetails(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs text-bmw-silver hover:bg-bmw-card hover:text-white"><Eye size={14} /> عرض وتفاصيل السند</button><button type="button" onClick={() => { setOpen(false); onDetails(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs text-bmw-silver hover:bg-bmw-card hover:text-white"><Printer size={14} /> طباعة أو تعديل السند</button>{row.status === "VOIDED" && canPurge ? <button type="button" onClick={() => { setOpen(false); onPurge(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs text-bmw-mRed hover:bg-bmw-mRed/10"><Trash2 size={14} /> حذف نهائي من قاعدة البيانات</button> : null}{row.status === "VOIDED" ? <p className="px-3 py-2 text-[10px] text-bmw-muted"><RotateCcw className="ml-1 inline" size={11} /> الاستعادة متاحة من تفاصيل السند لمدير النظام.</p> : null}</div></> : null;
  return <div><button type="button" onClick={toggle} className="rounded-lg p-1.5 text-bmw-muted hover:bg-bmw-card hover:text-white" aria-label="إجراءات السند"><MoreHorizontal size={18} /></button>{typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}</div>;
}

function CreateVoucherModal({ type, treasuries, accounts, openInvoices, onClose }: { type: VoucherType; treasuries: Props["treasuries"]; accounts: Props["accounts"]; openInvoices: Props["openInvoices"]; onClose: () => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  const [voucherType, setVoucherType] = useState<VoucherType>(type); const [treasuryId, setTreasuryId] = useState(treasuries.find((item) => item.isDefault)?.id ?? treasuries[0]?.id ?? ""); const [accountId, setAccountId] = useState(""); const [accountQuery, setAccountQuery] = useState(""); const [invoiceId, setInvoiceId] = useState(""); const [amount, setAmount] = useState(""); const [category, setCategory] = useState("CASH"); const [description, setDescription] = useState(""); const [createdAt, setCreatedAt] = useState(asLocalInput(new Date()));
  const selectedTreasury = treasuries.find((item) => item.id === treasuryId); const selectedInvoice = openInvoices.find((item) => item.id === invoiceId); const parsedAmount = Number(amount) || 0; const relevantInvoices = openInvoices.filter((invoice) => voucherType === "RECEIPT" ? invoice.type === "SALE" : invoice.type === "PURCHASE"); const matchedAccounts = accounts.filter((account) => `${account.name} ${account.accountNumber} ${account.phone ?? ""}`.toLocaleLowerCase("ar-EG").includes(accountQuery.trim().toLocaleLowerCase("ar-EG"))).slice(0, 100);
  const chooseInvoice = (id: string) => { setInvoiceId(id); const invoice = openInvoices.find((item) => item.id === id); if (invoice) { setAccountId(invoice.accountId); setAmount(String(invoice.remainingAmount)); setDescription(`${voucherType === "RECEIPT" ? "تحصيل" : "سداد"} فاتورة ${invoice.invoiceNumber}`); } };
  const submit = () => startTransition(async () => { setError(null); const result = await createTreasuryTransactionAction({ treasuryId, accountId: accountId || undefined, invoiceId: invoiceId || undefined, type: voucherType, amount: parsedAmount, category: category as "CASH" | "BANK" | "WALLET" | "CHEQUE" | "INSTAPAY" | "OTHER", createdAt: asIso(createdAt), description }); if (!result.success) { setError(result.error); return; } onClose(); router.refresh(); });
  const insufficient = voucherType === "PAYMENT" && !!selectedTreasury && parsedAmount > selectedTreasury.currentBalance;
  return <Modal open onClose={onClose} title={voucherType === "RECEIPT" ? "سند قبض جديد" : "سند صرف جديد"} description="يتم قيد الخزينة والحساب وتسوية الفاتورة المرتبطة في عملية مالية ذرية واحدة." size="md" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button variant={voucherType === "RECEIPT" ? "success" : "danger"} onClick={submit} loading={pending} disabled={!treasuryId || parsedAmount <= 0 || description.trim().length < 3 || insufficient}>{voucherType === "RECEIPT" ? "تسجيل سند القبض" : "تسجيل سند الصرف"}</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<div className="grid grid-cols-2 gap-2"><Button variant={voucherType === "RECEIPT" ? "success" : "outline"} onClick={() => { setVoucherType("RECEIPT"); setInvoiceId(""); }}><ArrowDownLeft size={15} /> سند قبض</Button><Button variant={voucherType === "PAYMENT" ? "danger" : "outline"} onClick={() => { setVoucherType("PAYMENT"); setInvoiceId(""); }}><ArrowUpRight size={15} /> سند صرف</Button></div><div className="grid gap-3 sm:grid-cols-2"><Field label="الخزينة" required><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name} — {formatMoney(treasury.currentBalance)} {CURRENCY}</option>)}</Select></Field><Field label="الحساب / الجهة" hint="ابحث بالاسم أو الكود أو الهاتف"><div className="space-y-1"><Input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} placeholder="بحث في الحسابات…" /><Select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">بدون حساب</option>{matchedAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumber} — {account.name}{account.phone ? ` — ${account.phone}` : ""}</option>)}</Select></div></Field><Field label="ربط بفاتورة (اختياري)"><Select value={invoiceId} onChange={(event) => chooseInvoice(event.target.value)}><option value="">بدون فاتورة</option>{relevantInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.accountName} — متبقي {formatMoney(invoice.remainingAmount)}</option>)}</Select></Field><Field label="طريقة الدفع"><Select value={category} onChange={(event) => setCategory(event.target.value)}><option value="CASH">نقدي</option><option value="BANK">تحويل بنكي</option><option value="WALLET">محفظة / فودافون كاش</option><option value="INSTAPAY">إنستاباي</option><option value="CHEQUE">شيك</option><option value="OTHER">أخرى</option></Select></Field><Field label="المبلغ" required error={insufficient ? `السيولة المتاحة ${formatMoney(selectedTreasury!.currentBalance)} فقط` : undefined}><Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus dir="ltr" /></Field><Field label="تاريخ ووقت السند"><Input type="datetime-local" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} dir="ltr" /></Field></div>{selectedInvoice ? <Alert variant="info">سيتم تسوية الفاتورة <strong>{selectedInvoice.invoiceNumber}</strong> بحد أقصى {formatMoney(selectedInvoice.remainingAmount)} {CURRENCY}.</Alert> : null}<Field label="البيان والملاحظات" required><Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="اكتب وصفاً واضحاً للحركة المالية" /></Field></div></Modal>;
}

function PurgeVoucherModal({ voucher, onClose, onDone }: { voucher: VoucherRegisterRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => { setError(null); const result = await hardDeleteCancelledVoucherAction({ voucherId: voucher.id, reason }); if (!result.success) { setError(result.error); return; } onDone(); });
  return <Modal open onClose={onClose} title="حذف نهائي للسند الملغى" description="لا يمكن التراجع عن حذف السجل بعد التأكيد." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={submit} loading={pending} disabled={reason.trim().length < 5}><Trash2 size={15} /> حذف نهائي</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning">يُسمح بالحذف النهائي لسند يدوي ملغى فقط؛ لا يُسمح بحذف سند فاتورة أو تحويل أو تسوية شيك/قسط. الأثر المالي لهذا السند عُكس بالفعل أثناء الإلغاء.</Alert><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><p className="font-bold text-white">{voucher.transactionNumber}</p><p className="mt-1 text-bmw-muted">{formatMoney(voucher.amount)} {CURRENCY} — {voucher.description}</p></div><Field label="سبب الحذف النهائي" required><Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus placeholder="مثال: سند تجريبي تم إلغاؤه" /></Field></div></Modal>;
}
