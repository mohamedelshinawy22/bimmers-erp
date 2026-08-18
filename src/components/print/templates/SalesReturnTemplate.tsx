import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { ReturnInvoiceTemplate } from "./return-invoice-template";

/** Formal Arabic credit note for returned sales items. */
export function SalesReturnTemplate({ data }: { data: InvoicePrintData }) {
  return <ReturnInvoiceTemplate data={data} kind="SALE_RETURN" />;
}
