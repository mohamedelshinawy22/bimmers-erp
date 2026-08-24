import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getUserAccess, hasApplicationPermission, hasPermission } from "@/lib/user-permissions";
import { getPartFormOptions, searchParts } from "@/server/services/parts.service";
import { getPurchaseFormOptions } from "@/server/services/invoices.service";
import { getCompanyProfile, getPartCategories, getSetting } from "@/server/services/settings.service";
import { serializeData } from "@/lib/serialize";
import { InventoryClient } from "./inventory-client";
import { CatalogRecovery } from "./catalog-recovery";

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
  try {
    const tenant = await getTenantDbFromSession();
    const user = tenant.user;
    return tenant.run(async () => {
      const access = await getUserAccess(user.id);
      if (!hasApplicationPermission(access, "part.read")) redirect("/");

      const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
      const query = searchParams.q ?? "";
      const chassisCode = searchParams.chassis ?? "";
      const category = searchParams.category ?? "";
      const lowStockOnly = searchParams.lowStock === "1";
      const canPurchase = can(user.role, "invoice.purchase");

      const [result, options, categories, purchaseOptions, taxRateRaw, company] = await Promise.all([
    searchParts(tenant.prisma, {
      query,
      chassisCode: chassisCode || undefined,
      engineCode: searchParams.engine || undefined,
      category: category || undefined,
      lowStockOnly,
      page,
      pageSize: 25,
    }).catch(() => ({ rows: [], total: 0, page, pageSize: 25 })),
    getPartFormOptions(tenant.prisma).catch(() => ({ brands: [], chassis: [], engines: [], bins: [] })),
    getPartCategories(tenant.prisma).catch(() => []),
    (canPurchase ? getPurchaseFormOptions(tenant.prisma) : Promise.resolve({ suppliers: [], treasuries: [] })).catch(() => ({ suppliers: [], treasuries: [] })),
    getSetting("TAX_RATE_PERCENT", "0", tenant.prisma),
    getCompanyProfile(tenant.prisma),
  ]);

      const canViewCost = can(user.role, "part.viewCost") && hasPermission(access, "canViewCostPrice");
  // Redact cost server-side. Hiding the column in the DOM still shipped
  // buyPriceAvg in the RSC payload, readable in the network response.
      const rows = canViewCost ? result.rows : result.rows.map((r) => ({ ...r, buyPriceAvg: 0 }));

      return (
        <InventoryClient
      rows={serializeData(rows)}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{ query, chassis: chassisCode, category, lowStock: lowStockOnly }}
      options={{
        brands: serializeData(options.brands),
        chassis: serializeData(options.chassis),
        engines: serializeData(options.engines),
        bins: serializeData(options.bins),
        categories: serializeData(categories),
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
        suppliers: serializeData(purchaseOptions.suppliers),
        treasuries: serializeData(purchaseOptions.treasuries),
        taxRatePercent: Math.min(100, Math.max(0, Number(taxRateRaw) || 0)),
      }}
      openNewOnMount={searchParams.new === "1" && can(user.role, "part.write")}
      openPurchaseOnMount={searchParams.purchase === "1" && canPurchase}
      company={serializeData(company)}
        />
      );
    });
  } catch (error) {
    console.error("Unable to load tenant-scoped Catalog", error);
    return <CatalogRecovery />;
  }
}
