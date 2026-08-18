"use client";

import { useEffect } from "react";
import type { InvoicePrintData, InvoicePrintFormat } from "@/lib/invoice-print-types";
import { SalesA4Template } from "./templates/sales-a4-template";
import { PurchaseA4Template } from "./templates/purchase-a4-template";
import { SalesThermalTemplate } from "./templates/sales-thermal-template";

interface PrintContainerProps { data: InvoicePrintData; format: InvoicePrintFormat; autoPrint?: boolean; onAfterPrint?: () => void; }

export function PrintContainer({ data, format, autoPrint = false, onAfterPrint }: PrintContainerProps) {
  useEffect(() => {
    if (!autoPrint) return;
    let active = true;
    const print = async () => {
      await document.fonts?.ready;
      if (!active) return;
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".invoice-print-root img"));
      await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); })));
      window.print();
    };
    const after = () => onAfterPrint?.();
    window.addEventListener("afterprint", after);
    void print();
    return () => { active = false; window.removeEventListener("afterprint", after); };
  }, [autoPrint, onAfterPrint, data.invoice.id, format]);
  const documentNode = format === "THERMAL_80" ? <SalesThermalTemplate data={data} /> : data.invoice.type === "PURCHASE" ? <PurchaseA4Template data={data} /> : <SalesA4Template data={data} />;
  return <div className={`invoice-print-root print-format-${format.toLowerCase()}`}>{documentNode}</div>;
}
