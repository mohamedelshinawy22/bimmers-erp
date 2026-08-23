import { redirect } from "next/navigation";
import { can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { listInvoices } from "@/server/services/invoices.service";
import { ReturnRegisterClient } from "@/components/invoices/return-register-client";

export const metadata = { title: "مرتجع المبيعات" };
export const dynamic = "force-dynamic";

export default async function SalesReturnsPage() {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  return tenant.run(async () => {
  if (!can(user.role, "invoice.read") || !can(user.role, "invoice.sale")) redirect("/");
  const [result, treasuries] = await Promise.all([
    listInvoices({ type: "SALE_RETURN", includeVoided: true, pageSize: 100 }).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 100 })),
    tenant.prisma.treasury.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }).catch(() => []),
  ]);
  return <ReturnRegisterClient type="SALE_RETURN" rows={result.rows} treasuries={treasuries} canVoid={can(user.role, "invoice.void")} canPurge={can(user.role, "invoice.purge")} />;
  });
}
