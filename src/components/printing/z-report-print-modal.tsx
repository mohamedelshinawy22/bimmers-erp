"use client";

import { useEffect, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ZReportPrintTemplate, type ZReportPrintData, type ZReportPrintFormat } from "./z-report-print-template";

const STORAGE_KEY = "bimmer_print_template_z_report";
const formats: Array<{ id: ZReportPrintFormat; label: string; description: string }> = [
  { id: "THERMAL", label: "حراري 80 مم", description: "إيصال تقفيل سريع للكاشير" },
  { id: "MODERN", label: "عصري A4", description: "ملخص تنفيذي وتدقيق وردية" },
  { id: "CLASSIC", label: "كلاسيكي A4", description: "نموذج محاسبي رسمي" },
];

export function ZReportPrintModal({ report, company, onClose }: { report: ZReportPrintData; company: { name: string; commercialName?: string; logoUrl?: string | null; address?: string; phonePrimary?: string; taxNumber?: string }; onClose: () => void }) {
  const [format, setFormat] = useState<ZReportPrintFormat>("THERMAL");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "THERMAL" || saved === "MODERN" || saved === "CLASSIC") setFormat(saved);
    } catch { /* browser storage can be unavailable in private contexts */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, format); } catch { /* non-blocking preference write */ }
  }, [format]);

  useEffect(() => {
    if (!printing) return;
    const complete = () => setPrinting(false);
    window.addEventListener("afterprint", complete);
    return () => window.removeEventListener("afterprint", complete);
  }, [printing]);

  const print = () => {
    setPrinting(true);
    requestAnimationFrame(() => {
      window.setTimeout(async () => {
        try {
          await document.fonts?.ready;
          const images = Array.from(document.querySelectorAll<HTMLImageElement>("#z-report-print-portal img"));
          await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
          window.print();
        } finally {
          window.setTimeout(() => setPrinting(false), 800);
        }
      }, 350);
    });
  };

  const thermal = format === "THERMAL";
  const css = `@media print { @page { size: ${thermal ? "80mm auto" : "A4 portrait"}; margin: ${thermal ? "0" : "8mm"}; } body * { visibility: hidden !important; } #z-report-print-portal, #z-report-print-portal * { visibility: visible !important; } #z-report-print-portal { position: fixed !important; inset: 0 !important; display: block !important; width: ${thermal ? "76mm" : "auto"} !important; min-height: auto !important; height: auto !important; overflow: visible !important; margin: ${thermal ? "0 auto !important" : "0 !important"}; background: #fff !important; color: #000 !important; z-index: 2147483647 !important; } #z-report-print-portal .print-thermal { width: 76mm !important; max-width: 76mm !important; margin: 0 auto !important; font-size: 12px !important; } #z-report-print-portal .z-report-document { box-sizing: border-box !important; break-inside: avoid !important; page-break-inside: avoid !important; } }`;

  return <><style>{css}</style><Modal open onClose={onClose} title="معاينة وطباعة تقرير تقفيل الوردية" description="اختر تنسيق تقرير Z ثم اطبع بعد اكتمال معاينة المستند." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={printing}>إغلاق</Button><Button onClick={print} disabled={printing}>{printing ? <FileText size={16} className="animate-pulse" /> : <Printer size={16} />}{printing ? "يتم تجهيز التقرير…" : "طباعة الآن / حفظ PDF"}</Button></>}><div className="space-y-4" dir="rtl"><div className="grid gap-2 sm:grid-cols-3">{formats.map((item) => <button key={item.id} type="button" onClick={() => setFormat(item.id)} className={`rounded-xl border p-3 text-right transition-colors ${format === item.id ? "border-bmw-blue bg-bmw-blue/10" : "border-bmw-cardBorder bg-bmw-carbon hover:bg-bmw-card"}`}><b className="block text-sm text-white">{item.label}</b><span className="mt-1 block text-[11px] text-bmw-muted">{item.description}</span></button>)}</div><div className="max-h-[58vh] overflow-auto rounded-xl bg-slate-200 p-4"><div className={thermal ? "mx-auto w-fit shadow-xl" : "mx-auto max-w-[210mm] shadow-xl"}><ZReportPrintTemplate company={company} report={report} format={format} /></div></div></div></Modal>{printing ? <div id="z-report-print-portal" aria-hidden="true" className="pointer-events-none fixed -left-[10000px] top-0 h-px w-px overflow-hidden opacity-0"><ZReportPrintTemplate company={company} report={report} format={format} /></div> : null}</>;
}
