import { notFound, redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getPartById, getStockLedger } from "@/server/services/parts.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { PartLedgerClient } from "./part-ledger-client";

export const dynamic = "force-dynamic";

export default async function PartLedgerPage({ params }: { params: { id: string } }) {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  if (!can(user.role, "stock.viewLedger")) redirect("/inventory");
  let part: Awaited<ReturnType<typeof getPartById>>;
  let rows: Awaited<ReturnType<typeof getStockLedger>>;
  let company: Awaited<ReturnType<typeof getCompanyProfile>>;
  try {
    [part, rows, company] = await tenant.run(async () => Promise.all([getPartById(tenant.prisma, params.id), getStockLedger(tenant.prisma, params.id, 1000), getCompanyProfile(tenant.prisma)]));
  } catch (error) {
    console.error("Unable to load tenant-scoped part ledger", { tenantId: user.tenantId, partId: params.id, error });
    return <main className="space-y-4" dir="rtl"><div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">تعذر تحميل دفتر حركة الصنف مؤقتاً. أعد المحاولة بعد لحظات.</div></main>;
  }
  if (!part) notFound();
  return <PartLedgerClient part={{ id: part.id, nameAr: part.nameAr, oemNumber: part.oemNumber, stockQuantity: part.stockQuantity, duplicateOemCount: part.duplicateOemCount, duplicateNameCount: part.duplicateNameCount, duplicateBrands: part.duplicateBrands, brandName: part.brandName, category: part.category, chassisCodes: part.chassisCodes, barcode: part.barcode, sellPriceRetail: part.sellPriceRetail }} company={company} rows={rows} canVoid={can(user.role, "invoice.void")} />;
}
