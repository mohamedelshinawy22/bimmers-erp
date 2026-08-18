import { prisma } from "@/lib/prisma";
import { requirePermission, requireUser } from "@/lib/auth";
import { listUsers } from "@/server/services/audit.service";
import { UsersManagementClient } from "./users-management-client";

export default async function UsersPage() {
  await requirePermission("user.manage");
  const currentUser = await requireUser();
  const [users, treasuries, bins] = await Promise.all([
    listUsers(),
    prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    prisma.warehouseBin.findMany({ distinct: ["warehouseName"], orderBy: { warehouseName: "asc" }, select: { warehouseName: true } }),
  ]);
  return <UsersManagementClient users={users} currentUserId={currentUser.id} treasuries={treasuries} warehouses={bins.map((bin) => bin.warehouseName)} />;
}
