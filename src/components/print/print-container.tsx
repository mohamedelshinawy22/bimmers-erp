"use client";

import { useEffect } from "react";
import type { InvoicePrintData, InvoicePrintFormat } from "@/lib/invoice-print-types";
import { SalesA4Template } from "./templates/sales-a4-template";
import { PurchaseInvoiceTemplate } from "./templates/PurchaseInvoiceTemplate";
import { SalesThermalTemplate } from "./templates/sales-thermal-template";
import { Sales57mmTemplate } from "./templates/sales-57mm-template";
import { SalesA5Template } from "./templates/sales-a5-template";
import { EInvoiceTemplate } from "./templates/e-invoice-template";

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
  const documentNode = format === "THERMAL_80" ? <SalesThermalTemplate data={data} /> : format === "THERMAL_57" ? <Sales57mmTemplate data={data} /> : format === "A5" ? <SalesA5Template data={data} /> : format === "E_INVOICE" ? <EInvoiceTemplate data={data} /> : data.invoice.type === "PURCHASE" ? <PurchaseInvoiceTemplate data={data} /> : <SalesA4Template data={data} />;
  return <div className={`invoice-print-root print-format-${format.toLowerCase()}`}>{documentNode}</div>;
}
