import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listInvoices } from "@/server/services/invoices.service";
import { ReturnRegisterClient } from "@/components/invoices/return-register-client";

export const metadata = { title: "مرتجع المبيعات" };
export const dynamic = "force-dynamic";

export default async function SalesReturnsPage() {
  const user = await requireUser();
  if (!can(user.role, "invoice.read") || !can(user.role, "invoice.sale")) redirect("/");
  const [result, treasuries] = await Promise.all([
    listInvoices({ type: "SALE_RETURN", includeVoided: true, pageSize: 100 }),
    prisma.treasury.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <ReturnRegisterClient type="SALE_RETURN" rows={result.rows} treasuries={treasuries} canVoid={can(user.role, "invoice.void")} canPurge={can(user.role, "invoice.purge")} />;
}
