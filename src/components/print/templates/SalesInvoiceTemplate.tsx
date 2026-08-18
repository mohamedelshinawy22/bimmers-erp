import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { SalesA4Template } from "./sales-a4-template";

/** Modular sales invoice template entry point for A4 print routing. */
export function SalesInvoiceTemplate({ data }: { data: InvoicePrintData }) {
  return <SalesA4Template data={data} />;
}
