import { formatDateTime, formatMoney, ARABIC_LABELS } from "@/lib/utils";
import { tafqeetEgyptianPounds } from "@/lib/arabic-tafqeet";
import type { InvoicePrintData } from "@/lib/invoice-print-types";
import { InvoiceQrCode } from "../qr-code";

/** Formal A4 supplier purchase invoice with a replayable supplier-balance summary. */
export function PurchaseInvoiceTemplate({ data }: { data: InvoicePrintData }) {
  const issued = new Date(data.invoice.createdAt);
  const totalQuantity = data.lines.reduce((total, line) => total + line.quantity, 0);
  const paymentLabel = data.invoice.remainingAmount > 0 ? "آجل" : "نقدي";
  const dueDate = data.invoice.remainingAmount > 0 ? "غير محدد" : issued.toLocaleDateString("ar-EG");
  const phones = [data.company.phonePrimary, data.company.phoneSecondary].filter(Boolean).join(" - ") || "غير محدد";
  const supplierPrevious = data.invoice.accountBalanceBefore ?? 0;
  const supplierCurrent = data.invoice.accountBalanceAfter ?? supplierPrevious + data.invoice.remainingAmount;

  return (
    <article className="invoice-print-page invoice-a4 purchase-print" dir="rtl">
      {data.invoice.isVoided ? <div className="invoice-void-watermark">ملغاة</div> : null}
      <header className="invoice-header border-b-2 border-slate-700 pb-3">
        <div className="flex items-start gap-3">
          {data.company.logoUrl ? <img src={data.company.logoUrl} alt="شعار المنشأة" className="h-16 w-16 rounded object-contain" /> : null}
          <div>
            <h1>{data.company.name}</h1>
            {data.company.commercialName ? <p>{data.company.commercialName}</p> : null}
            <p>{data.company.address || "العنوان غير محدد"}</p>
            <p>{phones}</p>
            <p>رقم ضريبي: {data.company.taxNumber || "غير محدد"}{data.company.commercialRegister ? ` • س.ت: ${data.company.commercialRegister}` : ""}</p>
          </div>
        </div>
        <div className="invoice-title text-left">
          <h2>فاتورة شراء</h2>
          <p className="font-mono">#{data.invoice.invoiceNumber}</p>
          <p>{formatDateTime(data.invoice.createdAt)}</p>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded border border-slate-500 p-3">
          <h3 className="mb-2 border-b border-slate-300 pb-1 font-bold">بيانات الفاتورة</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>رقم الفاتورة</span><b className="font-mono">{data.invoice.invoiceNumber}</b>
            <span>نوع الفاتورة</span><b>{paymentLabel}</b>
            <span>التاريخ</span><b>{issued.toLocaleDateString("ar-EG")}</b>
            <span>الوقت</span><b>{issued.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</b>
            <span>تاريخ الاستحقاق</span><b>{dueDate}</b>
            <span>المستلم / الكاشير</span><b>{data.invoice.cashierName || "—"}</b>
            <span>الخزينة</span><b>{data.invoice.treasuryName || "—"}</b>
            <span>طريقة الدفع</span><b>{ARABIC_LABELS.paymentMethod[data.invoice.paymentMethod as keyof typeof ARABIC_LABELS.paymentMethod] ?? data.invoice.paymentMethod}</b>
          </div>
        </div>
        <div className="rounded border border-slate-500 p-3">
          <h3 className="mb-2 border-b border-slate-300 pb-1 font-bold">بيانات المورد</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span>المورد</span><b>{data.account.name}</b>
            <span>كود الحساب</span><b className="font-mono">{data.account.accountNumber}</b>
            <span>رقم الهاتف</span><b dir="ltr">{data.account.phone || "غير محدد"}</b>
            <span>الرقم الضريبي</span><b>{data.account.taxNumber || "غير محدد"}</b>
          </div>
        </div>
      </section>

      <section className="mt-3 overflow-hidden rounded border border-slate-500">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100"><tr><th className="border border-slate-400 p-2">#</th><th className="border border-slate-400 p-2">رقم الصنف / OEM</th><th className="border border-slate-400 p-2">اسم الصنف</th><th className="border border-slate-400 p-2">الوحدة</th><th className="border border-slate-400 p-2">الكمية</th><th className="border border-slate-400 p-2">السعر</th><th className="border border-slate-400 p-2">الإجمالي</th></tr></thead>
          <tbody>{data.lines.map((line, index) => <tr key={line.id} className="even:bg-slate-50 print:break-inside-avoid"><td className="border border-slate-300 p-2 text-center">{index + 1}</td><td className="border border-slate-300 p-2 font-mono text-xs" dir="ltr">{line.oemNumber}</td><td className="border border-slate-300 p-2"><b>{line.nameAr}</b>{line.brandName ? <small className="mr-2 text-slate-500">{line.brandName}</small> : null}</td><td className="border border-slate-300 p-2 text-center">قطعة</td><td className="border border-slate-300 p-2 text-center tabular">{line.quantity}</td><td className="border border-slate-300 p-2 text-left tabular" dir="ltr">{formatMoney(line.unitPrice)}</td><td className="border border-slate-300 p-2 text-left tabular font-bold" dir="ltr">{formatMoney(line.totalPrice)}</td></tr>)}</tbody>
          <tfoot className="bg-slate-100 font-bold"><tr><td colSpan={4} className="border border-slate-400 p-2">إجمالي الكميات</td><td className="border border-slate-400 p-2 text-center tabular">{totalQuantity}</td><td className="border border-slate-400 p-2">الإجمالي</td><td className="border border-slate-400 p-2 text-left tabular" dir="ltr">{formatMoney(data.invoice.grandTotal)}</td></tr></tfoot>
        </table>
      </section>

      <section className="mt-3 grid grid-cols-[1.2fr_0.8fr] gap-3 text-sm">
        <div className="rounded border border-slate-500 p-3">
          <h3 className="mb-2 font-bold">البيان المالي وحساب المورد</h3>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
            <span>الإجمالي</span><b className="text-left tabular" dir="ltr">{formatMoney(data.invoice.subtotal)}</b>
            <span>ضريبة القيمة المضافة</span><b className="text-left tabular" dir="ltr">{formatMoney(data.invoice.taxAmount)}</b>
            <span className="font-bold">الإجمالي بالضريبة</span><b className="text-left tabular text-base" dir="ltr">{formatMoney(data.invoice.grandTotal)}</b>
            <span>المدفوع</span><b className="text-left tabular" dir="ltr">{formatMoney(data.invoice.paidAmount)}</b>
            <span>الآجل</span><b className="text-left tabular" dir="ltr">{formatMoney(data.invoice.remainingAmount)}</b>
            <span>الرصيد السابق للمورد</span><b className="text-left tabular" dir="ltr">{formatMoney(supplierPrevious)}</b>
            <span className="font-bold">الرصيد الحالي للمورد</span><b className="text-left tabular text-base" dir="ltr">{formatMoney(supplierCurrent)}</b>
          </div>
          <p className="mt-3 border-t border-slate-300 pt-2"><b>المطلوب كتابةً:</b> {tafqeetEgyptianPounds(data.invoice.grandTotal)}</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded border border-slate-500 p-3 text-center"><InvoiceQrCode value={data.invoice.qrPayload} /><p className="mt-2 font-mono text-xs">{data.invoice.invoiceNumber}</p><p className="mt-2 text-xs text-slate-600">رمز التحقق يتضمن بيانات المورد والفاتورة والمنشأة.</p></div>
      </section>

      {data.invoice.notes ? <p className="mt-3 rounded border border-slate-300 p-2 text-sm"><b>ملاحظات:</b> {data.invoice.notes}</p> : null}
      <footer className="mt-5 flex justify-between border-t border-slate-400 pt-3 text-xs"><span>{data.company.footer || "شكراً لتعاملكم معنا"}</span><span>توقيع المستلم: ____________</span><span>توقيع المورد: ____________</span></footer>
    </article>
  );
}
