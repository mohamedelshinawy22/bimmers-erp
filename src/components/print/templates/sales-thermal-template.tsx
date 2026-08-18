import { formatDateTime, formatMoney } from "@/lib/utils";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { InvoiceQrCode } from "../qr-code";

export function SalesThermalTemplate({ data }: { data: InvoicePrintData }) {
  return <article className="invoice-print-page invoice-thermal" dir="rtl">
    {data.invoice.isVoided ? <div className="invoice-void-watermark">ملغاة</div> : null}
    <header className="thermal-center"><h1>{data.company.name}</h1><p>{data.company.phone}</p><p>ضريبي: {data.company.taxNumber || "—"}</p><hr/><strong>فاتورة بيع #{data.invoice.invoiceNumber}</strong><p>{formatDateTime(data.invoice.createdAt)}</p><p>الكاشير: {data.invoice.cashierName || "—"}</p></header>
    <div className="thermal-party"><p>العميل: {data.account.name}</p><p>{data.account.phone || ""}</p>{data.account.vehicleLabel ? <p>{data.account.vehicleLabel}</p> : null}</div>
    <table className="thermal-lines"><thead><tr><th>الصنف</th><th>كم</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id}><td>{line.nameAr}<small dir="ltr">{line.oemNumber}</small></td><td>{line.quantity}</td><td>{formatMoney(line.unitPrice)}</td><td>{formatMoney(line.totalPrice)}</td></tr>)}</tbody></table>
    <div className="thermal-totals"><p>الإجمالي: <b>{formatMoney(data.invoice.grandTotal)}</b></p><p>المدفوع: <b>{formatMoney(data.invoice.paidAmount)}</b></p><p>الآجل: <b>{formatMoney(data.invoice.remainingAmount)}</b></p></div>
    <div className="thermal-center"><InvoiceQrCode value={data.invoice.verificationUrl}/><p>{data.company.footer}</p></div>
  </article>;
}
