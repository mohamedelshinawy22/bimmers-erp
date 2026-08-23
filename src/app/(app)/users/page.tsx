import { prisma } from "@/lib/prisma";
import { requirePermission, requireUser } from "@/lib/auth";
import { establishTenantContext, runWithTenantContext } from "@/lib/tenant-routing";
import { listUsers } from "@/server/services/audit.service";
import { UsersManagementClient } from "./users-management-client";

export default async function UsersPage() {
  await requirePermission("user.manage");
  const currentUser = await requireUser();
  const context = await establishTenantContext(currentUser.username, currentUser.tenantId);
  return runWithTenantContext(context, async () => {
  const [users, treasuries, bins] = await Promise.all([
    listUsers(),
    prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    prisma.warehouseBin.findMany({ distinct: ["warehouseName"], orderBy: { warehouseName: "asc" }, select: { warehouseName: true } }),
  ]);
  return <UsersManagementClient users={users} currentUserId={currentUser.id} treasuries={treasuries} warehouses={bins.map((bin) => bin.warehouseName)} />;
  });
}
