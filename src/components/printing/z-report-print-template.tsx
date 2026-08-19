"use client";

import { QRCodeSVG } from "qrcode.react";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatMoney } from "@/lib/utils";

export type ZReportPrintData = {
  treasury: { id: string; name: string; type: string; currentBalance: number };
  shift: { id: string; shiftNumber: string; openingBalance: number; bookOpeningBalance: number; openedAt: string; openedBy: string } | null;
  periodStart: string;
  receipts: number;
  payments: number;
  transfers: number;
  openingBalance: number;
  expectedBalance: number;
  invoiceCount: number;
  byPaymentMethod: Array<{ method: string; count: number; total: number; collected: number }>;
  recentMovements: Array<{ reference: string; type: string; amount: number; description: string; createdAt: string }>;
};

export type ZReportPrintFormat = "THERMAL" | "MODERN" | "CLASSIC";

type Company = { name: string; commercialName?: string; logoUrl?: string | null; address?: string; phonePrimary?: string; taxNumber?: string };

const movementLabel = (type: string) => ARABIC_LABELS.transactionType[type as keyof typeof ARABIC_LABELS.transactionType] ?? type;
const paymentLabel = (method: string) => ARABIC_LABELS.paymentMethod[method as keyof typeof ARABIC_LABELS.paymentMethod] ?? method;

function ShiftHeader({ company, report, compact = false }: { company: Company; report: ZReportPrintData; compact?: boolean }) {
  return <header className={`border-b border-slate-300 pb-2 text-center ${compact ? "space-y-1" : "mb-4 flex items-start justify-between gap-4 text-right"}`}>
    <div className={compact ? "flex flex-col items-center" : "flex items-center gap-3"}>{company.logoUrl ? <img src={company.logoUrl} alt="" className={compact ? "h-8 w-auto object-contain" : "h-14 w-auto object-contain"} /> : null}<div><p className={compact ? "text-sm font-black" : "text-xl font-black text-slate-900"}>{company.name}</p>{company.commercialName ? <p className="text-[10px] text-slate-600">{company.commercialName}</p> : null}</div></div>
    <div className={compact ? "text-center" : "text-left"}><h1 className={compact ? "text-sm font-black" : "text-xl font-black text-slate-900"}>تقرير تقفيل وردية — Z</h1><p className="font-mono text-[10px] text-slate-600">{report.shift?.shiftNumber ?? "تقرير حركة اليوم"}</p></div>
  </header>;
}

function Reconciliation({ report, compact = false }: { report: ZReportPrintData; compact?: boolean }) {
  const variance = report.treasury.currentBalance - report.expectedBalance;
  const rows = [
    ["الرصيد الدفتري الافتتاحي", report.openingBalance, ""],
    ["إجمالي المقبوضات", report.receipts, "+"],
    ["المدفوعات / المصروفات", report.payments, "−"],
    ["صافي التحويلات / الإيداعات", report.transfers, report.transfers >= 0 ? "+" : "−"],
  ] as const;
  return <section className={compact ? "border-y border-dashed border-slate-400 py-2" : "rounded-xl border border-slate-300 p-3"}><h2 className={`font-black ${compact ? "mb-1 text-xs" : "mb-2 text-sm text-slate-800"}`}>ملخص التسوية والسيولة</h2><div className="space-y-1">{rows.map(([label, value, signal]) => <div key={label} className={`flex justify-between gap-2 ${compact ? "text-[11px]" : "text-sm"}`}><span>{signal ? `(${signal}) ` : ""}{label}</span><b className="tabular" dir="ltr">{formatMoney(Math.abs(value))} {CURRENCY}</b></div>)}<div className="my-1 border-t border-dashed border-slate-400" /><div className={`flex justify-between font-black ${compact ? "text-[12px]" : "text-base"}`}><span>الرصيد المتوقع بالدرج</span><span className="tabular" dir="ltr">{formatMoney(report.expectedBalance)} {CURRENCY}</span></div><div className={`flex justify-between font-black ${compact ? "text-[12px]" : "text-base"}`}><span>الرصد الفعلي الدفتري</span><span className="tabular" dir="ltr">{formatMoney(report.treasury.currentBalance)} {CURRENCY}</span></div><div className={`flex justify-between font-black ${Math.abs(variance) < 0.01 ? "text-emerald-700" : "text-red-700"} ${compact ? "text-[12px]" : "text-base"}`}><span>فرق المطابقة / عجز أو زيادة</span><span className="tabular" dir="ltr">{formatMoney(variance)} {CURRENCY}</span></div></div></section>;
}

function ShiftInfo({ report, compact = false }: { report: ZReportPrintData; compact?: boolean }) {
  const info = [
    ["رقم الوردية", report.shift?.shiftNumber ?? "من بداية اليوم"],
    ["الخزينة / الدرج", report.treasury.name],
    ["الكاشير المسؤول", report.shift?.openedBy ?? "—"],
    ["تاريخ الفتح", formatDateTime(report.periodStart)],
    ["تاريخ الطباعة", formatDateTime(new Date().toISOString())],
  ];
  return <section className={compact ? "space-y-0.5 text-[10px]" : "grid grid-cols-2 gap-x-5 gap-y-2 rounded-xl bg-slate-100 p-3 text-sm"}>{info.map(([label, value]) => <div key={label} className="flex justify-between gap-2"><span className="text-slate-600">{label}</span><b className="max-w-[65%] truncate text-left">{value}</b></div>)}</section>;
}

function PaymentBreakdown({ report, compact = false }: { report: ZReportPrintData; compact?: boolean }) {
  return <section><h2 className={`font-black ${compact ? "mb-1 text-xs" : "mb-2 text-sm text-slate-800"}`}>تفصيل طرق الدفع — {report.invoiceCount} فاتورة</h2>{report.byPaymentMethod.length ? <table className="w-full border-collapse text-right"><thead><tr className={compact ? "text-[9px]" : "bg-slate-100 text-xs"}><th className="border border-slate-300 p-1">الطريقة</th><th className="border border-slate-300 p-1">العدد</th><th className="border border-slate-300 p-1">الإجمالي</th><th className="border border-slate-300 p-1">المحصّل</th></tr></thead><tbody>{report.byPaymentMethod.map((method) => <tr key={method.method} className={compact ? "text-[10px]" : "text-xs"}><td className="border border-slate-300 p-1">{paymentLabel(method.method)}</td><td className="border border-slate-300 p-1 text-center tabular">{method.count}</td><td className="border border-slate-300 p-1 text-left tabular" dir="ltr">{formatMoney(method.total)}</td><td className="border border-slate-300 p-1 text-left tabular" dir="ltr">{formatMoney(method.collected)}</td></tr>)}</tbody></table> : <p className="text-xs text-slate-500">لا توجد فواتير خلال هذه الفترة.</p>}</section>;
}

function RecentMovements({ report, compact = false }: { report: ZReportPrintData; compact?: boolean }) {
  return <section><h2 className={`font-black ${compact ? "mb-1 text-xs" : "mb-2 text-sm text-slate-800"}`}>آخر حركات الوردية</h2>{report.recentMovements.length ? <table className="w-full border-collapse text-right"><thead><tr className={compact ? "text-[9px]" : "bg-slate-100 text-xs"}><th className="border border-slate-300 p-1">المستند</th><th className="border border-slate-300 p-1">النوع</th><th className="border border-slate-300 p-1">المبلغ</th><th className="border border-slate-300 p-1">الوقت</th></tr></thead><tbody>{report.recentMovements.map((movement, index) => <tr key={`${movement.reference}-${index}`} className={compact ? "text-[10px]" : "text-xs"}><td className="max-w-[95px] truncate border border-slate-300 p-1 font-mono" dir="ltr">{movement.reference}</td><td className="border border-slate-300 p-1">{movementLabel(movement.type)}</td><td className="border border-slate-300 p-1 text-left tabular" dir="ltr">{formatMoney(Math.abs(movement.amount))}</td><td className="border border-slate-300 p-1 text-left tabular" dir="ltr">{new Date(movement.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</td></tr>)}</tbody></table> : <p className="text-xs text-slate-500">لا توجد حركات مسجلة خلال الوردية.</p>}</section>;
}

function Signatures({ compact = false }: { compact?: boolean }) { return <footer className={`grid grid-cols-2 gap-6 text-center ${compact ? "mt-4 text-[10px]" : "mt-8 text-sm"}`}><div className="border-t border-slate-500 pt-2">توقيع الكاشير</div><div className="border-t border-slate-500 pt-2">اعتماد مدير الفرع / المراجع</div></footer>; }

export function ZReportPrintTemplate({ company, report, format }: { company: Company; report: ZReportPrintData; format: ZReportPrintFormat }) {
  if (format === "THERMAL") return <article className="print-thermal z-report-document mx-auto bg-white p-[2mm] text-black" dir="rtl"><ShiftHeader company={company} report={report} compact /><ShiftInfo report={report} compact /><div className="my-2" /><Reconciliation report={report} compact /><div className="my-2" /><PaymentBreakdown report={report} compact /><div className="my-2" /><RecentMovements report={report} compact /><Signatures compact /><div className="mt-3 flex justify-center"><QRCodeSVG value={JSON.stringify({ type: "Z_REPORT", shift: report.shift?.shiftNumber ?? "DAY", treasury: report.treasury.name, balance: report.treasury.currentBalance })} size={46} includeMargin={false} /></div></article>;
  return <article className={`z-report-document bg-white p-8 text-slate-900 ${format === "CLASSIC" ? "font-serif" : ""}`} dir="rtl"><ShiftHeader company={company} report={report} /><ShiftInfo report={report} /><div className="mt-4 grid grid-cols-2 gap-4"><Reconciliation report={report} /><PaymentBreakdown report={report} /></div><div className="mt-4"><RecentMovements report={report} /></div><Signatures /></article>;
}
