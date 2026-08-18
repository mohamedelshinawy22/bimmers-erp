import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { PurchaseA4Template } from "./purchase-a4-template";

/** Purchase-return documents share the signed purchase invoice data contract and A4 layout. */
export function PurchaseReturnTemplate({ data }: { data: InvoicePrintData }) {
  return <PurchaseA4Template data={data} />;
}
