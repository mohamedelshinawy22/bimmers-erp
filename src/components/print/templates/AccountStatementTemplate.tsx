import { formatDateTime, formatMoney } from "@/lib/utils";

export interface AccountStatementPrintData {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyTaxNumber?: string;
  companyCommercialRegister?: string;
  companyLogoUrl?: string | null;
  accountName: string;
  accountNumber: string;
  phone?: string | null;
  from?: string;
  to?: string;
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
  rows: Array<{ id: string; createdAt: string; reference: string; type: string; debit: number; credit: number; runningBalance: number; treasury?: string | null; note?: string | null }>;
}

export function AccountStatementTemplate({ data }: { data: AccountStatementPrintData }) {
  return <section id="printable-area" className="invoice-print-page invoice-a4 statement-modern-print" dir="rtl">
    <header className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="h-2 bg-gradient-to-l from-[#0066b3] via-[#6c7c92] to-[#e53935]" /><div className="flex items-start justify-between gap-5 p-5"><div className="flex items-start gap-3">{data.companyLogoUrl ? <img src={data.companyLogoUrl} alt="شعار المنشأة" className="h-14 w-14 rounded-xl border border-slate-200 object-contain" /> : null}<div><h1 className="text-xl font-black text-slate-900">{data.companyName}</h1><p className="text-xs text-slate-500">{data.companyAddress || ""}</p><p className="text-xs text-slate-500">{data.companyPhone || ""}</p><p className="text-[10px] text-slate-500">ضريبي: {data.companyTaxNumber || "—"} • س.ت: {data.companyCommercialRegister || "—"}</p></div></div><div className="rounded-xl bg-slate-900 px-4 py-3 text-left text-white"><p className="text-xs text-slate-300">كشف حساب تفصيلي</p><h2 className="text-sm font-bold">{data.accountName}</h2><p className="font-mono text-xs">{data.accountNumber}</p></div></div></header>
    <section className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><div className="flex items-center justify-between"><span><b>الحساب:</b> {data.accountName} • {data.phone || "لا يوجد هاتف"}</span><span><b>الفترة:</b> {data.from ? formatDateTime(data.from) : "بداية الحساب"} إلى {data.to ? formatDateTime(data.to) : "الآن"}</span></div></section>
    <section className="mb-4 grid grid-cols-4 gap-3"><Metric label="الرصيد الافتتاحي" value={data.openingBalance} tone="text-slate-700" /><Metric label="إجمالي المدين" value={data.debit} tone="text-rose-700" /><Metric label="إجمالي الدائن" value={data.credit} tone="text-emerald-700" /><Metric label="صافي الرصيد الحالي" value={data.closingBalance} tone="text-[#0066b3]" strong /></section>
    <table className="w-full overflow-hidden rounded-xl border border-slate-200 text-right text-xs"><thead className="bg-slate-900 text-white"><tr><th className="p-2">التاريخ</th><th className="p-2">رقم الحركة / الفاتورة</th><th className="p-2">البيان</th><th className="p-2 text-left">مدين (+)</th><th className="p-2 text-left">دائن (-)</th><th className="p-2 text-left">الرصيد التراكمي</th></tr></thead><tbody>{data.rows.map((row, index) => <tr key={row.id} className={index % 2 ? "bg-slate-50" : "bg-white"}><td className="p-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td><td className="p-2 font-mono text-[#0066b3]" dir="ltr">{row.reference}</td><td className="p-2"><b>{row.type}</b>{row.note ? <span className="mr-1 text-slate-500">— {row.note}</span> : null}{row.treasury ? <small className="mr-1 text-slate-400">({row.treasury})</small> : null}</td><td className="p-2 text-left tabular text-rose-700" dir="ltr">{formatMoney(row.debit)}</td><td className="p-2 text-left tabular text-emerald-700" dir="ltr">{formatMoney(row.credit)}</td><td className="p-2 text-left font-bold tabular text-slate-900" dir="ltr">{formatMoney(row.runningBalance)}</td></tr>)}</tbody></table>
    <footer className="mt-5 flex justify-between border-t border-slate-200 pt-4 text-xs text-slate-600"><span>توقيع المستلم: __________________</span><span>توقيع المحاسب: __________________</span></footer>
  </section>;
}

function Metric({ label, value, tone, strong = false }: { label: string; value: number; tone: string; strong?: boolean }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-3 ${strong ? "border-[#0066b3]/30 bg-blue-50" : ""}`}><p className="text-[10px] font-bold text-slate-400">{label}</p><p className={`mt-1 tabular text-sm ${strong ? "font-black" : "font-bold"} ${tone}`} dir="ltr">{formatMoney(value)}</p></div>;
}
