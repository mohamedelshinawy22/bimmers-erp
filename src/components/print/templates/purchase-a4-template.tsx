import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { SalesA4Template } from "./sales-a4-template";

export function PurchaseA4Template({ data }: { data: InvoicePrintData }) {
  return <SalesA4Template data={data} purchase />;
}
