import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { PurchaseA4Template } from "./purchase-a4-template";

/** Modular purchase invoice template entry point for A4 print routing. */
export function PurchaseInvoiceTemplate({ data }: { data: InvoicePrintData }) {
  return <PurchaseA4Template data={data} />;
}
