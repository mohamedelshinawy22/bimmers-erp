"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Printer, RefreshCw, Search } from "lucide-react";
import { UniversalDateTimePicker, type DateRangeValue } from "@/components/ui/universal-date-time-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getDailyMovementReportAction } from "@/server/actions/reports.actions";

type ReportData = Extract<Awaited<ReturnType<typeof getDailyMovementReportAction>>, { success: true }> ["data"];
type Tab = "ملخص" | "بيع" | "مرتجع بيع" | "شراء" | "مرتجع شراء" | "صرف" | "قبض" | "جرد مخزن";
type DetailRow = { id: string; documentId: string | null; reference: string; at: string; party: string; description: string; total: number; paid: number; remaining: number; treasury: string; warehouse: string; user: string; source: string; itemCount?: number; quantityDelta?: number };

const tabs: Tab[] = ["ملخص", "بيع", "مرتجع بيع", "شراء", "مرتجع شراء", "صرف", "قبض", "جرد مخزن"];
const money = (amount: number) => `${amount.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const initialRange = (): DateRangeValue => { const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(); to.setHours(23, 59, 59, 999); const iso = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16); return { from: iso(from), to: iso(to), preset: "TODAY", pinned: false }; };

function rowClass(total: number) { return total < 0 ? "text-bmw-mRed" : total > 0 ? "text-emerald-400" : "text-white"; }

export default function DailyMovementPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ملخص");
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [operatorId, setOperatorId] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [treasuryId, setTreasuryId] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!range?.from || !range?.to) return;
    setLoading(true); setError("");
    const result = await getDailyMovementReportAction({ fromDate: new Date(range.from), toDate: new Date(range.to), operatorId, warehouseName, treasuryIds: treasuryId ? [treasuryId] : [] });
    if (result.success) setData(result.data); else setError(result.error);
    setLoading(false);
  }, [range, operatorId, warehouseName, treasuryId]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<DetailRow[]>(() => {
    if (!data) return [];
    const register = tab === "بيع" ? data.drillDowns.sales : tab === "مرتجع بيع" ? data.drillDowns.saleReturns : tab === "شراء" ? data.drillDowns.purchases : tab === "مرتجع شراء" ? data.drillDowns.purchaseReturns : tab === "صرف" ? data.drillDowns.payments : tab === "قبض" ? data.drillDowns.receipts : tab === "جرد مخزن" ? data.drillDowns.stocktakes : [];
    return register as DetailRow[];
  }, [data, tab]);

  const exportCsv = () => {
    const reportRows = tab === "ملخص" ? (data?.operations ?? []).map((row) => [row.label, String(row.count), String(row.total), String(row.paid), String(row.remaining)]) : rows.map((row) => [row.reference, new Date(row.at).toLocaleString("ar-EG"), row.party, row.description, String(row.total), String(row.paid), String(row.remaining), row.treasury, row.warehouse, row.user]);
    const headings = tab === "ملخص" ? ["نوع الحركة", "عدد المستندات", "الإجمالي", "نقدي", "آجل"] : ["المستند", "التاريخ والوقت", "الطرف", "البيان", "الإجمالي", "نقدي", "آجل", "الخزينة", "المخزن", "المستخدم المسؤول"];
    const csv = `\uFEFF${[headings, ...reportRows].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")}`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `تقرير-الحركة-${tab}-${range?.from?.slice(0, 10) ?? ""}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const openDocument = (row: DetailRow) => { if (row.documentId) router.push(`/invoices?search=${encodeURIComponent(row.reference)}`); };
  const options = data?.filterOptions;

  return <main className="space-y-5" dir="rtl">
    <header className="no-print flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-white">تقرير الحركة اليومية</h1><p className="text-sm text-bmw-muted">ملخص مالي وتشغيلي مدقق بحسب الوقت، المستخدم، المخزن، والخزينة.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="subtle" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? "animate-spin" : ""} />تحديث</Button><Button type="button" variant="outline" onClick={exportCsv} disabled={!data}><Download size={16} />تصدير CSV</Button><Button type="button" onClick={() => window.print()} disabled={!data}><Printer size={16} />طباعة</Button></div></header>

    <Card className="no-print"><CardHeader><CardTitle><Search size={17} className="text-bmw-blue" /> نطاق التقرير</CardTitle><Button size="sm" onClick={() => void load()} loading={loading}>عرض التقرير</Button></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><div className="xl:col-span-2"><UniversalDateTimePicker value={range} onChange={setRange} syncToUrl storageKey="bimmererp:daily-movement-range" /></div><Field label="المستخدم / الكاشير"><Select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}><option value="">الكل</option>{options?.users.map((user) => <option key={user.id} value={user.id}>{user.fullName} (@{user.username})</option>)}</Select></Field><Field label="المخزن"><Select value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)}><option value="">كل المخازن</option>{options?.warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}</Select></Field><Field label="الخزينة"><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}><option value="">كل الخزائن</option>{options?.treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field></CardContent></Card>

    <div className="no-print flex flex-wrap gap-2">{tabs.map((item) => <Button key={item} type="button" variant={tab === item ? "primary" : "subtle"} onClick={() => setTab(item)}>{item}</Button>)}</div>
    {error ? <div className="rounded-xl border border-bmw-mRed/30 bg-bmw-mRed/10 p-3 text-sm text-bmw-mRed">{error}</div> : null}

    <section id="printable-area" className="hidden print:block invoice-print-page invoice-a4" dir="rtl"><header className="invoice-header"><div><h1>الشافعي لقطع غيار BMW</h1><p>تقرير الحركة اليومية</p></div><div className="invoice-title"><h2>{range?.from?.slice(0, 10)} إلى {range?.to?.slice(0, 10)}</h2><p>{operatorId ? "مستخدم محدد" : "كل المستخدمين"} • {warehouseName || "كل المخازن"}</p></div></header><table className="invoice-lines"><thead><tr><th>نوع الحركة</th><th>العدد</th><th>الإجمالي</th><th>نقدي</th><th>آجل</th></tr></thead><tbody>{data?.operations.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.count}</td><td>{money(row.total)}</td><td>{money(row.paid)}</td><td>{money(row.remaining)}</td></tr>)}</tbody></table><div className="mt-5"><h3>ملخص حركة الخزينة</h3>{data?.treasurySummary.map((row) => <p key={row.key}>{row.label}: <b>{money(row.amount)}</b></p>)}</div></section>

    {tab === "ملخص" ? <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>جدول ملخص الفواتير والعمليات</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><Table><THead><TR><TH>نوع الحركة</TH><TH>عدد المستندات</TH><TH>الإجمالي</TH><TH>نقدي</TH><TH>آجل</TH></TR></THead><TBody>{data ? data.operations.map((row) => <TR key={row.key}><TD className="font-bold">{row.label}</TD><TD className="tabular text-center">{row.count}</TD><TD className={`tabular text-center ${rowClass(row.total)}`}>{money(row.total)}</TD><TD className="tabular text-center text-emerald-400">{money(row.paid)}</TD><TD className="tabular text-center text-amber-400">{money(row.remaining)}</TD></TR>) : <EmptyState colSpan={5} title="جارٍ تحميل التقرير…" />}</TBody></Table></CardContent></Card><Card><CardHeader><CardTitle>جدول ملخص حركة الخزينة</CardTitle></CardHeader><CardContent className="space-y-2">{data?.treasurySummary.map((row) => <div key={row.key} className={`flex items-center justify-between rounded-xl p-3 text-sm ${row.key === "closing" ? "border border-amber-400/40 bg-amber-400/10 font-bold text-amber-200" : row.key === "net" ? "bg-bmw-carbon font-bold" : "bg-bmw-black/20"}`}><span>{row.label}</span><span className={`tabular ${row.amount < 0 ? "text-bmw-mRed" : "text-white"}`}>{money(row.amount)}</span></div>) ?? <p className="text-sm text-bmw-muted">جارٍ تحميل تسوية الخزينة…</p>}</CardContent></Card></div> : <Card><CardHeader><CardTitle>{tab} — سجل التفاصيل <Badge variant="muted" mono>{rows.length}</Badge></CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><Table><THead><TR><TH>#</TH><TH>الوقت والتاريخ</TH><TH>رقم المستند / الفاتورة</TH><TH>الطرف الثاني</TH><TH>البيان / الوصف</TH><TH>الإجمالي</TH><TH>نقداً</TH><TH>آجل</TH><TH>الخزينة / المخزن</TH><TH>المستخدم المسؤول</TH></TR></THead><TBody>{rows.length ? rows.map((row, index) => <TR key={row.id}><TD className="tabular text-bmw-muted">{index + 1}</TD><TD className="tabular whitespace-nowrap text-xs">{new Date(row.at).toLocaleString("ar-EG")}</TD><TD><button type="button" disabled={!row.documentId} onClick={() => openDocument(row)} className="font-mono text-xs font-bold text-bmw-blue hover:underline disabled:cursor-default disabled:text-white">{row.reference}</button></TD><TD className="text-xs">{row.party}</TD><TD className="max-w-[260px] truncate text-xs text-bmw-muted" title={row.description}>{row.description || "—"}{row.itemCount ? <span className="mr-1 text-bmw-blue">({row.itemCount})</span> : null}</TD><TD className={`tabular ${rowClass(row.total)}`}>{money(row.total)}</TD><TD className="tabular text-emerald-400">{money(row.paid)}</TD><TD className="tabular text-amber-400">{money(row.remaining)}</TD><TD className="text-xs">{row.treasury !== "—" ? row.treasury : row.warehouse}</TD><TD className="text-xs">{row.user}</TD></TR>) : <EmptyState colSpan={10} title="لا توجد عمليات ضمن نطاق التقرير." icon={<FileText size={30} />} />}</TBody></Table></CardContent></Card>}
  </main>;
}
