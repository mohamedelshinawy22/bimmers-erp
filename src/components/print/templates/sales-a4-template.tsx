import { formatDateTime, formatMoney, ARABIC_LABELS } from "@/lib/utils";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { InvoiceQrCode } from "../qr-code";

export function SalesA4Template({ data, purchase = false }: { data: InvoicePrintData; purchase?: boolean }) {
  const party = purchase ? "المورد" : "العميل";
  return <article className="invoice-print-page invoice-a4" dir="rtl">
    {data.invoice.isVoided ? <div className="invoice-void-watermark">ملغاة</div> : null}
    <header className="invoice-header"><div><h1>{data.company.name}</h1><p>{data.company.address} — {data.company.phone}</p><p>رقم ضريبي: {data.company.taxNumber || "—"}</p></div><div className="invoice-title"><h2>{purchase ? "فاتورة شراء" : "فاتورة بيع"}</h2><p>#{data.invoice.invoiceNumber}</p><p>{formatDateTime(data.invoice.createdAt)}</p></div></header>
    <section className="invoice-meta-grid"><div><strong>{party}</strong><p>{data.account.name} ({data.account.accountNumber})</p><p>{data.account.phone || "—"}</p><p>{data.account.taxNumber || "—"}</p></div><div><strong>بيانات التشغيل</strong><p>الكاشير: {data.invoice.cashierName || "—"}</p><p>الخزينة: {data.invoice.treasuryName || "—"}</p><p>الدفع: {ARABIC_LABELS.paymentMethod[data.invoice.paymentMethod as keyof typeof ARABIC_LABELS.paymentMethod] ?? data.invoice.paymentMethod}</p></div>{!purchase ? <div><strong>السيارة</strong><p>{data.account.vehicleLabel || "—"}</p></div> : null}</section>
    <table className="invoice-lines"><thead><tr><th>#</th><th>اسم الصنف</th><th>كود القطعة</th><th>الشاسيه</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>{data.lines.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td>{line.nameAr}<small>{line.brandName}</small></td><td dir="ltr">{line.oemNumber}</td><td>{line.chassisLabel || "—"}</td><td>{line.quantity}</td><td>{formatMoney(line.unitPrice)}</td><td>{formatMoney(line.lineDiscount)}</td><td>{formatMoney(line.totalPrice)}</td></tr>)}</tbody></table>
    <section className="invoice-bottom"><div className="invoice-totals"><p>الإجمالي قبل الخصم <b>{formatMoney(data.invoice.subtotal)}</b></p><p>الخصم <b>{formatMoney(data.invoice.discountAmount)}</b></p><p>الضريبة <b>{formatMoney(data.invoice.taxAmount)}</b></p><p className="grand-total">الإجمالي <b>{formatMoney(data.invoice.grandTotal)}</b></p><p>المدفوع <b>{formatMoney(data.invoice.paidAmount)}</b></p><p>المتبقي <b>{formatMoney(data.invoice.remainingAmount)}</b></p></div><div className="invoice-qr"><InvoiceQrCode value={data.invoice.verificationUrl}/><small dir="ltr">{data.invoice.invoiceNumber}</small></div></section>
    {data.invoice.notes ? <p className="invoice-notes">ملاحظات: {data.invoice.notes}</p> : null}
    <footer>{data.company.footer || "سياسة الاستبدال والاسترجاع حسب الشروط المعلنة."}</footer>
  </article>;
}
