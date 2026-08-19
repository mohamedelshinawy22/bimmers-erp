"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InventoryMovementPrintTemplate, type InventoryMovementFilters, type InventoryMovementPrintData, type InventoryMovementPrintTab } from "@/components/printing/inventory-movement-print-template";

type Orientation = "portrait" | "landscape";
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function StandaloneInventoryMovementPrint({ data, company, tab, filters, orientation }: { data: InventoryMovementPrintData; company: { name: string; commercialName?: string; logoUrl?: string | null; address?: string; phonePrimary?: string }; tab: InventoryMovementPrintTab; filters: InventoryMovementFilters; orientation: Orientation }) {
  const areaRef = useRef<HTMLElement | null>(null);
  const [preparing, setPreparing] = useState(true);
  const rows = tab === "TOP" ? data.topSelling : tab === "DEAD" ? data.deadStock : data.ledger;
  const execute = async () => {
    if (!areaRef.current || rows.length === 0) return;
    setPreparing(true);
    await frame();
    await frame();
    await sleep(350);
    await window.document.fonts?.ready;
    const images = Array.from(areaRef.current.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
    await frame();
    await sleep(250);
    if (areaRef.current.querySelectorAll("tbody tr").length !== rows.length || areaRef.current.getBoundingClientRect().height <= 0) return;
    window.addEventListener("afterprint", () => setPreparing(false), { once: true });
    window.print();
    window.setTimeout(() => setPreparing(false), 60_000);
  };
  useEffect(() => { void execute(); }, []); // Auto-print only after the server-delivered report is fully laid out.
  const css = `@media print { @page { size:A4 ${orientation}; margin:10mm 8mm 12mm 8mm; } html,body { overflow:visible!important; height:auto!important; min-height:100%!important; position:static!important; background:#fff!important; color:#000!important; } body * { visibility:hidden!important; } #report-print-area, #report-print-area * { visibility:visible!important; } #report-print-area { position:absolute!important; left:0!important; top:0!important; display:block!important; width:100%!important; height:auto!important; margin:0!important; padding:0!important; overflow:visible!important; background:#fff!important; color:#000!important; } .inventory-movement-print { font-size:9px!important; } .inventory-movement-print .print-table { width:100%!important; table-layout:fixed!important; border-collapse:collapse!important; } .inventory-movement-print thead { display:table-header-group!important; } .inventory-movement-print tfoot { display:table-footer-group!important; } .inventory-movement-print tr { page-break-inside:avoid!important; break-inside:avoid!important; } .inventory-movement-print .print-table th, .inventory-movement-print .print-table td { border:1px solid #cbd5e1!important; padding:3px!important; box-sizing:border-box!important; vertical-align:top!important; overflow:hidden!important; } .inventory-movement-print .print-table th { background:#e2e8f0!important; } .inventory-movement-print .print-table td[dir=ltr] { white-space:nowrap!important; } .no-print, button, nav, header, aside { display:none!important; } }`;
  return <><style>{css}</style><div className="no-print mx-auto flex max-w-5xl items-center justify-between gap-3 p-4" dir="rtl"><div><b className="text-white">نافذة الطباعة المستقلة</b><p className="text-xs text-bmw-muted">{preparing ? "يتم انتظار اكتمال صفوف التقرير قبل فتح الطباعة…" : "اكتملت التجهيزات. يمكنك الطباعة مرة أخرى عند الحاجة."}</p></div><Button onClick={() => void execute()} disabled={preparing || rows.length === 0}><Printer size={16}/>طباعة التقرير</Button></div><main ref={areaRef} id="report-print-area" className="mx-auto w-full max-w-[297mm] bg-white p-4 text-slate-900" dir="rtl"><InventoryMovementPrintTemplate data={data} company={company} tab={tab} filters={filters}/></main></>;
}
