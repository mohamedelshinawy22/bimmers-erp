import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { SalesA4Template } from "./sales-a4-template";

/** Sales-return documents share the signed invoice data contract and A4 layout. */
export function SalesReturnTemplate({ data }: { data: InvoicePrintData }) {
  return <SalesA4Template data={data} />;
}
