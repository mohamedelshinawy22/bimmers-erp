import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getUserAccess, hasApplicationPermission, hasPermission } from "@/lib/user-permissions";
import { getPartFormOptions, searchParts } from "@/server/services/parts.service";
import { getPurchaseFormOptions } from "@/server/services/invoices.service";
import { getCompanyProfile, getPartCategories, getSetting } from "@/server/services/settings.service";
import { InventoryClient } from "./inventory-client";

export const metadata = { title: "كتالوج البضاعة" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    q?: string;
    chassis?: string;
    engine?: string;
    category?: string;
    lowStock?: string;
    page?: string;
    new?: string;
    purchase?: string;
  };
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const access = await getUserAccess(user.id);
  if (!hasApplicationPermission(access, "part.read")) redirect("/");

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const query = searchParams.q ?? "";
  const chassisCode = searchParams.chassis ?? "";
  const category = searchParams.category ?? "";
  const lowStockOnly = searchParams.lowStock === "1";
  const canPurchase = can(user.role, "invoice.purchase");

  const [result, options, categories, purchaseOptions, taxRateRaw, company] = await Promise.all([
    searchParts({
      query,
      chassisCode: chassisCode || undefined,
      engineCode: searchParams.engine || undefined,
      category: category || undefined,
      lowStockOnly,
      page,
      pageSize: 25,
    }),
    getPartFormOptions(),
    getPartCategories(),
    canPurchase ? getPurchaseFormOptions() : Promise.resolve({ suppliers: [], treasuries: [] }),
    getSetting("TAX_RATE_PERCENT", "0"),
    getCompanyProfile(),
  ]);

  const canViewCost = can(user.role, "part.viewCost") && hasPermission(access, "canViewCostPrice");
  // Redact cost server-side. Hiding the column in the DOM still shipped
  // buyPriceAvg in the RSC payload, readable in the network response.
  const rows = canViewCost ? result.rows : result.rows.map((r) => ({ ...r, buyPriceAvg: 0 }));

  return (
    <InventoryClient
      rows={rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{ query, chassis: chassisCode, category, lowStock: lowStockOnly }}
      options={{
        brands: options.brands,
        chassis: options.chassis,
        engines: options.engines,
        bins: options.bins,
        categories,
      }}
      permissions={{
        canWrite: can(user.role, "part.write"),
        canAdjust: can(user.role, "stock.adjust"),
        canViewCost,
        canManageBins: can(user.role, "part.write"),
        canPurchase,
        canViewLedger: can(user.role, "stock.viewLedger"),
        canDelete: can(user.role, "part.deactivate"),
      }}
      purchaseOptions={{
        suppliers: purchaseOptions.suppliers,
        treasuries: purchaseOptions.treasuries,
        taxRatePercent: Math.min(100, Math.max(0, Number(taxRateRaw) || 0)),
      }}
      openNewOnMount={searchParams.new === "1" && can(user.role, "part.write")}
      openPurchaseOnMount={searchParams.purchase === "1" && canPurchase}
      company={company}
    />
  );
}
