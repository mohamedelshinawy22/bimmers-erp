import { requirePermission, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { listUsers } from "@/server/services/audit.service";
import { UsersManagementClient } from "./users-management-client";

export default async function UsersPage() {
  await requirePermission("user.manage");
  const tenant = await getTenantDbFromSession();
  const currentUser = tenant.user;
  return tenant.run(async () => {
  const [users, treasuries, bins] = await Promise.all([
    listUsers(tenant.prisma),
    tenant.prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    tenant.prisma.warehouseBin.findMany({ distinct: ["warehouseName"], orderBy: { warehouseName: "asc" }, select: { warehouseName: true } }),
  ]);
  return <UsersManagementClient users={users} currentUserId={currentUser.id} treasuries={treasuries} warehouses={bins.map((bin) => bin.warehouseName)} />;
  });
}
