import { formatDateTime, formatMoney } from "@/lib/utils";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { InvoiceQrCode } from "../qr-code";

export function Sales57mmTemplate({ data }: { data: InvoicePrintData }) {
  return <article className="invoice-print-page invoice-thermal invoice-thermal-57" dir="rtl"><header className="thermal-center"><strong>{data.company.name}</strong><p>{data.company.phone}</p><hr/><b>فاتورة #{data.invoice.invoiceNumber}</b><p>{formatDateTime(data.invoice.createdAt)}</p></header><p>العميل: {data.account.name}</p><table className="thermal-lines"><thead><tr><th>الصنف</th><th>ك</th><th>إجمالي</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id}><td>{line.nameAr}<small dir="ltr">{line.oemNumber}</small></td><td>{line.quantity}</td><td>{formatMoney(line.totalPrice)}</td></tr>)}</tbody></table><div className="thermal-totals"><p>الإجمالي: <b>{formatMoney(data.invoice.grandTotal)}</b></p><p>المدفوع: <b>{formatMoney(data.invoice.paidAmount)}</b></p><p>الباقي: <b>{formatMoney(data.invoice.remainingAmount)}</b></p></div><div className="thermal-center"><InvoiceQrCode value={data.invoice.verificationUrl}/><p>{data.company.footer}</p></div></article>;
}
