import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getInventoryMovementReportAction } from "@/server/actions/inventory-report.actions";
import { getCompanyProfile } from "@/server/services/settings.service";
import { StandaloneInventoryMovementPrint } from "./standalone-inventory-movement-print";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const tabFrom = (value: string | undefined) => value === "DEAD" || value === "LEDGER" || value === "TOP" ? value : "TOP";
const orientationFrom = (value: string | undefined) => value === "portrait" ? "portrait" : "landscape";

export default async function InventoryMovementStandalonePrintPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requirePermission("reports.dailyMovement");
  } catch {
    redirect("/");
  }
  const tenant = await getTenantDbFromSession();
  const from = first(searchParams.from) ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = first(searchParams.to) ?? new Date().toISOString();
  const tab = tabFrom(first(searchParams.tab));
  const orientation = orientationFrom(first(searchParams.orientation));
  let result: Awaited<ReturnType<typeof getInventoryMovementReportAction>>;
  let company: Awaited<ReturnType<typeof getCompanyProfile>>;
  try {
    [result, company] = await tenant.run(async () => Promise.all([
      getInventoryMovementReportAction({ fromDate: from, toDate: to, chassisId: first(searchParams.chassisId) || undefined, categoryId: first(searchParams.categoryId) || undefined, brandId: first(searchParams.brandId) || undefined, warehouseName: first(searchParams.warehouse) || undefined }),
      getCompanyProfile(),
    ]));
  } catch (error) {
    console.error("Unable to load tenant-scoped inventory movement print data", { tenantId: tenant.user.tenantId, error });
    return <main className="p-6" dir="rtl"><p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-950">تعذر تجهيز تقرير الطباعة مؤقتاً. أعد المحاولة بعد لحظات.</p></main>;
  }
  if (!result.success) redirect("/reports/inventory-movement");
  const filters = { chassis: result.data.options.chassis.find((item) => item.id === first(searchParams.chassisId))?.code, category: result.data.options.categories.find((item) => item.id === first(searchParams.categoryId))?.name, brand: result.data.options.brands.find((item) => item.id === first(searchParams.brandId))?.name, warehouse: first(searchParams.warehouse) };
  return <StandaloneInventoryMovementPrint data={result.data} company={company} tab={tab} filters={filters} orientation={orientation}/>;
}
