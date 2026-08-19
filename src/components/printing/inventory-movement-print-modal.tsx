"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { InventoryMovementPrintTemplate, type InventoryMovementFilters, type InventoryMovementPrintData, type InventoryMovementPrintTab } from "./inventory-movement-print-template";

type Orientation = "portrait" | "landscape";
type PrintInput = { fromDate: string; toDate: string; chassisId?: string; categoryId?: string; brandId?: string; warehouseName?: string };

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function InventoryMovementPrintModal({ data, company, tab, filters, sourceFilters, onClose }: { data: InventoryMovementPrintData; company: { name: string; commercialName?: string; logoUrl?: string | null; address?: string; phonePrimary?: string }; tab: InventoryMovementPrintTab; filters: InventoryMovementFilters; sourceFilters: PrintInput; onClose: () => void }) {
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>(tab === "TOP" ? "portrait" : "landscape");
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const rowCount = tab === "TOP" ? data.topSelling.length : tab === "DEAD" ? data.deadStock.length : data.ledger.length;
  const document = useMemo(() => <InventoryMovementPrintTemplate data={data} company={company} tab={tab} filters={filters}/>, [company, data, filters, tab]);

  useEffect(() => {
    if (!isPreparingPrint || rowCount === 0) return;
    let cancelled = false;
    const prepareAndPrint = async () => {
      // The report portal is mounted by isPreparingPrint before this effect runs.
      // Two paint frames plus a settled layout window reliably cover long WebKit tables.
      await nextFrame();
      await nextFrame();
      await sleep(320);
      const area = printAreaRef.current;
      if (!area || cancelled) return;
      await window.document.fonts?.ready;
      const images = Array.from(area.querySelectorAll<HTMLImageElement>("img"));
      await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
      await nextFrame();
      await sleep(220);
      const renderedRows = area.querySelectorAll("tbody tr").length;
      if (cancelled || renderedRows !== rowCount || area.getBoundingClientRect().height <= 0) return;
      window.addEventListener("afterprint", () => setIsPreparingPrint(false), { once: true });
      window.print();
      window.setTimeout(() => setIsPreparingPrint(false), 60_000);
    };
    void prepareAndPrint();
    return () => { cancelled = true; };
  }, [isPreparingPrint, rowCount]);

  const startPrint = () => { if (!isPreparingPrint && rowCount > 0) setIsPreparingPrint(true); };
  const openStandalone = () => {
    const params = new URLSearchParams({ from: sourceFilters.fromDate, to: sourceFilters.toDate, tab, orientation });
    if (sourceFilters.chassisId) params.set("chassisId", sourceFilters.chassisId);
    if (sourceFilters.categoryId) params.set("categoryId", sourceFilters.categoryId);
    if (sourceFilters.brandId) params.set("brandId", sourceFilters.brandId);
    if (sourceFilters.warehouseName) params.set("warehouse", sourceFilters.warehouseName);
    window.open(`/reports/inventory-movement/print?${params.toString()}`, "_blank", "noopener,noreferrer");
  };
  const css = `@media print { @page { size:A4 ${orientation}; margin:10mm 8mm 12mm 8mm; } html, body, #__next, [data-radix-portal], [role=dialog] { overflow:visible!important; height:auto!important; min-height:100%!important; position:static!important; background:#fff!important; color:#000!important; } body * { visibility:hidden!important; } #report-print-area, #report-print-area * { visibility:visible!important; } #report-print-area { position:absolute!important; left:0!important; top:0!important; width:100%!important; height:auto!important; min-height:auto!important; display:block!important; margin:0!important; padding:0!important; overflow:visible!important; opacity:1!important; background:#fff!important; color:#000!important; z-index:2147483647!important; } .inventory-movement-print { box-sizing:border-box!important; font-size:9px!important; } .inventory-movement-print thead { display:table-header-group!important; } .inventory-movement-print tfoot { display:table-footer-group!important; } .inventory-movement-print tr, .inventory-movement-print .print-row { page-break-inside:avoid!important; break-inside:avoid!important; } .inventory-movement-print .summary-metric-cards { page-break-inside:avoid!important; break-inside:avoid!important; } .inventory-movement-print .print-table { width:100%!important; table-layout:fixed!important; border-collapse:collapse!important; } .inventory-movement-print .print-table th, .inventory-movement-print .print-table td { border:1px solid #cbd5e1!important; box-sizing:border-box!important; padding:3px!important; vertical-align:top!important; overflow:hidden!important; } .inventory-movement-print .print-table th { background:#e2e8f0!important; font-weight:800!important; } .inventory-movement-print .print-table td[dir=ltr] { white-space:nowrap!important; } .inventory-movement-print small { display:block!important; color:#475569!important; font-size:8px!important; } .inventory-movement-print .inventory-print-header { display:flex!important; align-items:flex-start!important; justify-content:space-between!important; gap:12px!important; border-bottom:2px solid #0f172a!important; padding-bottom:8px!important; } .inventory-movement-print .inventory-print-header h1, .inventory-movement-print .inventory-print-header h2 { margin:0!important; font-size:14px!important; font-weight:900!important; } .inventory-movement-print .inventory-print-header p, .inventory-movement-print .print-filter-line { color:#475569!important; font-size:8px!important; } .inventory-movement-print .print-filter-line { display:flex!important; flex-wrap:wrap!important; gap:8px!important; padding:6px 0!important; } .inventory-movement-print .page-footer { position:fixed!important; bottom:0!important; left:0!important; width:100%!important; text-align:center!important; font-size:8px!important; color:#64748b!important; } .inventory-movement-print .page-number::after { content:'صفحة ' counter(page); } .no-print, button, nav, body > header, body > aside, .modal-backdrop { display:none!important; } }`;
  return <><style>{css}</style><Modal open onClose={onClose} title="معاينة وطباعة التقرير الكامل" description="تنتظر الطباعة اكتمال جميع صفوف التقرير فعلياً قبل فتح مربع الطباعة، لتفادي الصفحات الفارغة في Safari." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={isPreparingPrint}>إغلاق</Button><Button variant="outline" onClick={openStandalone} disabled={isPreparingPrint || rowCount === 0}><ExternalLink size={16}/>فتح في نافذة طباعة مستقلة</Button><Button onClick={startPrint} disabled={isPreparingPrint || rowCount === 0}><Printer size={16}/>{isPreparingPrint ? "يتم تجهيز جميع الصفوف…" : "طباعة الآن / حفظ PDF"}</Button></>}><div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><div className="flex items-center gap-2 text-xs text-bmw-silver"><span className="font-bold">اتجاه الورق:</span><Button size="sm" variant={orientation === "portrait" ? "primary" : "subtle"} onClick={() => setOrientation("portrait")} disabled={isPreparingPrint}>رأسي</Button><Button size="sm" variant={orientation === "landscape" ? "primary" : "subtle"} onClick={() => setOrientation("landscape")} disabled={isPreparingPrint}>أفقي — مستحسن للتفاصيل</Button></div><span className="text-[11px] text-bmw-muted">A4 {orientation === "landscape" ? "أفقي" : "رأسي"}</span></div><div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"><span className="h-2 w-2 rounded-full bg-emerald-400"/>سيتم طباعة كافة النتائج المصفاة: <strong>{rowCount.toLocaleString("ar-EG")} سجل</strong> (يشمل جميع الصفحات)</div><div className="max-h-[65vh] overflow-auto rounded-xl bg-slate-200 p-4"><div className={`mx-auto shadow-xl ${orientation === "landscape" ? "min-w-[1000px] max-w-[1120px]" : "max-w-[790px]"}`}>{document}</div></div></Modal>{isPreparingPrint ? <div ref={printAreaRef} id="report-print-area" aria-hidden="true" className="pointer-events-none fixed -left-[20000px] top-0" style={{ width: orientation === "landscape" ? "297mm" : "210mm" }}>{document}</div> : null}</>;
}
