import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getSetting } from "@/server/services/settings.service";
import { getPurchaseFormOptions, getInvoiceDetail } from "@/server/services/invoices.service";
import { getPosPartsByIds } from "@/server/services/parts.service";
import { PurchaseEditClient } from "./purchase-edit-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "تعديل فاتورة شراء" };

export default async function PurchaseInvoiceEditPage({ params }: { params: { id: string } }) {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  if (!can(user.role, "invoice.purchase")) redirect("/invoices");
  let initial: { invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>; options: Awaited<ReturnType<typeof getPurchaseFormOptions>>; taxRateRaw: string; lines: Array<{ part: Awaited<ReturnType<typeof getPosPartsByIds>>[number]; quantity: number; unitPrice: number; lineDiscount: number }> } | null;
  try {
    initial = await tenant.run(async () => {
      const [invoice, options, taxRateRaw] = await Promise.all([getInvoiceDetail(params.id), getPurchaseFormOptions(tenant.prisma), getSetting("TAX_RATE_PERCENT", "0", tenant.prisma)]);
      if (!invoice || invoice.type !== "PURCHASE" || invoice.isVoided) return null;
      const catalogItems = invoice.items.filter((item): item is typeof item & { partId: string } => Boolean(item.partId));
      if (catalogItems.length !== invoice.items.length) return null;
      const parts = await getPosPartsByIds(tenant.prisma, catalogItems.map((item) => item.partId));
      const byId = new Map(parts.map((part) => [part.id, part]));
      const lines = catalogItems.map((item) => {
        const part = byId.get(item.partId);
        return part ? { part, quantity: item.quantity, unitPrice: item.unitPrice, lineDiscount: Math.max(0, item.quantity * item.unitPrice - item.totalPrice) } : null;
      });
      return lines.every(Boolean) ? { invoice, options, taxRateRaw, lines: lines as Array<{ part: Awaited<ReturnType<typeof getPosPartsByIds>>[number]; quantity: number; unitPrice: number; lineDiscount: number }> } : null;
    });
  } catch (error) {
    console.error("Unable to load tenant-scoped purchase invoice editor", { tenantId: user.tenantId, invoiceId: params.id, error });
    return <main dir="rtl"><div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">تعذر تحميل بيانات فاتورة الشراء مؤقتاً. أعد المحاولة بعد لحظات.</div></main>;
  }
  if (!initial) notFound();
  const { invoice, options, taxRateRaw, lines } = initial;
  return <main className="space-y-3" dir="rtl"><header><h1 className="text-xl font-bold text-white">تعديل فاتورة شراء — {invoice.invoiceNumber}</h1><p className="text-sm text-bmw-muted">يُطبّق التعديل بقيود مخزون وخزينة وحساب عكسية وبديلة في معاملة واحدة.</p></header><PurchaseEditClient suppliers={options.suppliers} treasuries={options.treasuries} taxRatePercent={Math.min(100, Math.max(0, Number(taxRateRaw) || 0))} draft={{ invoiceId: invoice.id, accountId: invoice.account.id, treasuryId: invoice.treasury?.id ?? null, paymentMethod: invoice.paymentMethod as "CASH" | "VISA" | "ON_ACCOUNT", discountAmount: invoice.discountAmount, paidAmount: invoice.paidAmount, notes: invoice.notes, lines }} /></main>;
}
