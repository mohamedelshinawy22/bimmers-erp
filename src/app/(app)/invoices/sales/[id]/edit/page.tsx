import { notFound, redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { can } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getPosAccounts } from "@/server/services/accounts.service";
import { getSetting } from "@/server/services/settings.service";
import { getInvoiceDetail } from "@/server/services/invoices.service";
import { getPosPartsByIds } from "@/server/services/parts.service";
import { PosTerminal } from "@/app/(app)/pos/pos-terminal";

export const dynamic = "force-dynamic";
export const metadata = { title: "تعديل فاتورة بيع" };

export default async function SalesInvoiceEditPage({ params }: { params: { id: string } }) {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  if (!can(user.role, "invoice.sale")) redirect("/invoices");
  let initial: { invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>; accounts: Awaited<ReturnType<typeof getPosAccounts>>; treasuries: Array<{ id: string; name: string; type: string }>; taxRateRaw: string; companyName: string; enforceCredit: string; allowNegative: string; receiptFooter: string; lines: Array<{ part: Awaited<ReturnType<typeof getPosPartsByIds>>[number]; quantity: number; unitPrice: number; lineDiscount: number }> } | null;
  try {
    initial = await tenant.run(async () => {
      const [invoice, accounts, treasuries, taxRateRaw, companyName, enforceCredit, allowNegative, receiptFooter] = await Promise.all([
        getInvoiceDetail(params.id), getPosAccounts(), tenant.prisma.treasury.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }), getSetting("TAX_RATE_PERCENT", "0"), getSetting("COMPANY_NAME", "BimmerERP"), getSetting("ENFORCE_CREDIT_LIMIT", "true"), getSetting("ALLOW_NEGATIVE_STOCK", "false"), getSetting("INVOICE_FOOTER", ""),
      ]);
      if (!invoice || invoice.type !== "SALE" || invoice.isVoided) return null;
      const catalogItems = invoice.items.filter((item): item is typeof item & { partId: string } => Boolean(item.partId));
      if (catalogItems.length !== invoice.items.length) return null;
      const parts = await getPosPartsByIds(catalogItems.map((item) => item.partId));
      const byId = new Map(parts.map((part) => [part.id, part]));
      const lines = catalogItems.map((item) => {
        const part = byId.get(item.partId);
        return part ? { part, quantity: item.quantity, unitPrice: item.unitPrice, lineDiscount: Math.max(0, item.quantity * item.unitPrice - item.totalPrice) } : null;
      });
      return lines.every(Boolean) ? { invoice, accounts, treasuries, taxRateRaw, companyName, enforceCredit, allowNegative, receiptFooter, lines: lines as Array<{ part: Awaited<ReturnType<typeof getPosPartsByIds>>[number]; quantity: number; unitPrice: number; lineDiscount: number }> } : null;
    });
  } catch (error) {
    console.error("Unable to load tenant-scoped sales invoice editor", { tenantId: user.tenantId, invoiceId: params.id, error });
    return <main dir="rtl"><div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">تعذر تحميل بيانات الفاتورة مؤقتاً. أعد المحاولة بعد لحظات.</div></main>;
  }
  if (!initial) notFound();
  const { invoice, accounts, treasuries, taxRateRaw, companyName, enforceCredit, allowNegative, receiptFooter, lines } = initial;
  return <div className="space-y-4" dir="rtl"><header className="flex items-center gap-3"><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue"><Receipt size={22} /></div><div><h1 className="text-lg font-bold text-white">تعديل فاتورة بيع — {invoice.invoiceNumber}</h1><p className="text-xs text-bmw-muted">يتم عكس أثر المستند السابق وتطبيق السلة الجديدة في معاملة مالية واحدة.</p></div></header><PosTerminal accounts={accounts} treasuries={treasuries} defaultAccountId={invoice.account.id} defaultTreasuryId={invoice.treasury?.id ?? null} canOverrideMinPrice={can(user.role, "invoice.belowMinPrice")} taxRatePercent={Math.min(100, Math.max(0, Number(taxRateRaw) || 0))} companyName={companyName} enforceCreditLimit={enforceCredit === "true"} allowNegativeStock={allowNegative === "true"} receiptFooter={receiptFooter} initialDraft={{ invoiceId: invoice.id, accountId: invoice.account.id, treasuryId: invoice.treasury?.id ?? null, vehicleId: invoice.vehicle?.id ?? null, paymentMethod: invoice.paymentMethod, discountAmount: invoice.discountAmount, paidAmount: invoice.paidAmount, notes: invoice.notes, lines }} /></div>;
}
