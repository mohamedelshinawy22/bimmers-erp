import { notFound, redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getSetting } from "@/server/services/settings.service";
import { getPurchaseFormOptions, getInvoiceDetail } from "@/server/services/invoices.service";
import { getPosPartsByIds } from "@/server/services/parts.service";
import { PurchaseEditClient } from "./purchase-edit-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "تعديل فاتورة شراء" };

export default async function PurchaseInvoiceEditPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!can(user.role, "invoice.purchase")) redirect("/invoices");
  const [invoice, options, taxRateRaw] = await Promise.all([
    getInvoiceDetail(params.id),
    getPurchaseFormOptions(),
    getSetting("TAX_RATE_PERCENT", "0"),
  ]);
  if (!invoice || invoice.type !== "PURCHASE" || invoice.isVoided) notFound();
  const parts = await getPosPartsByIds(invoice.items.map((item) => item.partId));
  const byId = new Map(parts.map((part) => [part.id, part]));
  const lines = invoice.items.map((item) => {
    const part = byId.get(item.partId);
    if (!part) notFound();
    const lineDiscount = Math.max(0, item.quantity * item.unitPrice - item.totalPrice);
    return { part, quantity: item.quantity, unitPrice: item.unitPrice, lineDiscount };
  });
  return <main className="space-y-3" dir="rtl"><header><h1 className="text-xl font-bold text-white">تعديل فاتورة شراء — {invoice.invoiceNumber}</h1><p className="text-sm text-bmw-muted">يُطبّق التعديل بقيود مخزون وخزينة وحساب عكسية وبديلة في معاملة واحدة.</p></header><PurchaseEditClient suppliers={options.suppliers} treasuries={options.treasuries} taxRatePercent={Math.min(100, Math.max(0, Number(taxRateRaw) || 0))} draft={{ invoiceId: invoice.id, accountId: invoice.account.id, treasuryId: invoice.treasury?.id ?? null, paymentMethod: invoice.paymentMethod as "CASH" | "VISA" | "ON_ACCOUNT", discountAmount: invoice.discountAmount, paidAmount: invoice.paidAmount, notes: invoice.notes, lines }} /></main>;
}
