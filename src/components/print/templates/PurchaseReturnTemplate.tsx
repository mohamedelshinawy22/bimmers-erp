import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { ReturnInvoiceTemplate } from "./return-invoice-template";

/** Formal Arabic debit note for returned purchase items. */
export function PurchaseReturnTemplate({ data }: { data: InvoicePrintData }) {
  return <ReturnInvoiceTemplate data={data} kind="PURCHASE_RETURN" />;
}
