"use server";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { toJsonSafe } from "@/lib/audit";
import { serializeData } from "@/lib/serialize";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { createManagedUserSchema, updateManagedUserSchema, type CreateManagedUserInput, type UpdateManagedUserInput, type UserPermissionInput } from "@/lib/validations/users";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { activateTenantUsername, getTenantContext, releaseTenantUsername, reportTenantSubUserUsage, reserveTenantUsername } from "@/lib/tenant-routing";

function permissionData(input: UserPermissionInput): Prisma.UserPermissionUncheckedCreateWithoutUserInput {
  return {
    ...input,
    maxDiscountPercent: input.maxDiscountPercent,
    maxDiscountValue: input.maxDiscountValue,
  };
}

type CleanScopedResources = Pick<CreateManagedUserInput, "allowedWarehouseIds" | "allowedTreasuryIds"> & { transferToTreasuryId: string | null };

async function resolveScopedResources(
  tx: Prisma.TransactionClient,
  input: Pick<CreateManagedUserInput, "username" | "role" | "allowedWarehouseIds" | "allowedTreasuryIds" | "transferToTreasuryId">,
  existingUser?: { username: string; role: string } | null,
): Promise<CleanScopedResources> {
  const isRoot = input.role === "SUPER_ADMIN" || input.username.trim().toLowerCase() === "admin" || existingUser?.role === "SUPER_ADMIN" || existingUser?.username.trim().toLowerCase() === "admin";
  if (isRoot) return { allowedWarehouseIds: [], allowedTreasuryIds: [], transferToTreasuryId: null };
  const treasuryIds = [...new Set([...input.allowedTreasuryIds, ...(input.transferToTreasuryId ? [input.transferToTreasuryId] : [])])];
  let allowedTreasuryIds: string[] = [];
  if (treasuryIds.length) {
    const treasuries = await tx.treasury.findMany({ where: { id: { in: treasuryIds }, isActive: true }, select: { id: true } });
    const activeIds = new Set(treasuries.map((treasury) => treasury.id));
    allowedTreasuryIds = [...new Set(input.allowedTreasuryIds)].filter((id) => activeIds.has(id));
  }
  const warehouseNames = [...new Set(input.allowedWarehouseIds)];
  let allowedWarehouseIds: string[] = [];
  if (warehouseNames.length) {
    const bins = await tx.warehouseBin.findMany({ where: { warehouseName: { in: warehouseNames } }, distinct: ["warehouseName"], select: { warehouseName: true } });
    const validNames = new Set(bins.map((bin) => bin.warehouseName));
    allowedWarehouseIds = warehouseNames.filter((name) => validNames.has(name));
  }
  const transferToTreasuryId = input.transferToTreasuryId && allowedTreasuryIds.includes(input.transferToTreasuryId) ? input.transferToTreasuryId : null;
  return { allowedWarehouseIds, allowedTreasuryIds, transferToTreasuryId };
}

function revalidateUserManagement(): void {
  for (const path of ["/users", "/settings", "/pos", "/invoices", "/treasury"]) revalidatePath(path);
}

export async function createManagedUserAction(raw: CreateManagedUserInput): Promise<ActionResult<{ id: string; username: string }>> {
  let reservation: { username: string; route: ReturnType<typeof getTenantContext>["route"] } | null = null;
  let createdId: string | null = null;
  let scopedTenant: Awaited<ReturnType<typeof getTenantDbFromSession>> | null = null;
  try {
    const actor = await requirePermission("user.manage");
    const input = createManagedUserSchema.parse(raw);
    const username = input.username.toLowerCase();
    const tenant = await getTenantDbFromSession();
    scopedTenant = tenant;
    await reserveTenantUsername(tenant.context.route, username, input.role);
    reservation = { username, route: tenant.context.route };
    const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      if (input.isActive && input.role !== "SUPER_ADMIN") {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bimmers:sub-user-quota:${tenant.context.route.tenantId}`}))`;
        const activeSubUsers = await tx.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } });
        if (activeSubUsers >= tenant.context.route.maxSubUsers) throw new BusinessRuleError(`تم الوصول إلى الحد الأقصى للمستخدمين الفرعيين المسموح به (${tenant.context.route.maxSubUsers}).`);
      }
      const scopes = await resolveScopedResources(tx, input);
      const created = await tx.user.create({
        data: {
          username,
          fullName: input.fullName,
          passwordHash: await bcrypt.hash(input.password, 12),
          role: input.role,
          isActive: input.isActive,
          allowedWarehouseIds: scopes.allowedWarehouseIds,
          allowedTreasuryIds: scopes.allowedTreasuryIds,
          transferToTreasuryId: scopes.transferToTreasuryId,
          permissions: { create: permissionData(input.permissions) },
        },
        select: { id: true, username: true, fullName: true, role: true, isActive: true },
      });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: created.id,
          action: "INSERT",
          newData: toJsonSafe({ ...created, ...scopes, permissions: input.permissions }),
          performedBy: actor.id,
        },
      });
      return created;
    }, TX_OPTIONS));
    createdId = result.id;
    await activateTenantUsername(tenant.context.route, username);
    await reportTenantSubUserUsage(tenant.context.route, await tenant.prisma.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } }));
    revalidateUserManagement();
    return ok({ id: result.id, username: result.username });
  } catch (error) {
    if (createdId && scopedTenant) await scopedTenant.prisma.user.delete({ where: { id: createdId } }).catch(() => undefined);
    if (reservation) await releaseTenantUsername(reservation.route, reservation.username).catch(() => undefined);
    return toActionError(error, "createManagedUserAction");
  }
}

export async function updateManagedUserAction(raw: UpdateManagedUserInput): Promise<ActionResult<{ id: string; user: { id: string; username: string; fullName: string; role: string; isActive: boolean; permissions: unknown; createdAt: string } }>> {
  try {
    const actor = await requirePermission("user.manage");
    const input = updateManagedUserSchema.parse(raw);
    const tenant = await getTenantDbFromSession();
    const password = input.password?.trim() ?? "";
    const result = await tenant.run(() => withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: input.id }, include: { permissions: true } });
      if (!before) throw new BusinessRuleError("المستخدم غير موجود.");
      if (before.username !== input.username.toLowerCase()) throw new BusinessRuleError("لا يمكن تغيير اسم المستخدم بعد ربطه بالمستأجر.");
      if (actor.id === before.id && !input.isActive) throw new BusinessRuleError("لا يمكنك إيقاف حسابك الخاص.");
      if (before.role === "SUPER_ADMIN" && before.isActive && (!input.isActive || input.role !== "SUPER_ADMIN")) {
        const remaining = await tx.user.count({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: before.id } } });
        if (remaining === 0) throw new BusinessRuleError("لا يمكن إيقاف أو تخفيض آخر مدير نظام نشط.");
      }
      const scopes = await resolveScopedResources(tx, input, before);
      const updated = await tx.user.update({
        where: { id: before.id },
        data: {
          username: input.username,
          fullName: input.fullName,
          role: input.role,
          isActive: input.isActive,
          allowedWarehouseIds: scopes.allowedWarehouseIds,
          allowedTreasuryIds: scopes.allowedTreasuryIds,
          transferToTreasuryId: scopes.transferToTreasuryId,
          ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
          permissions: { upsert: { create: permissionData(input.permissions), update: permissionData(input.permissions) } },
        },
        select: { id: true, username: true, fullName: true, role: true, isActive: true, permissions: true, createdAt: true },
      });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: before.id,
          action: password ? "PASSWORD_CHANGED" : "UPDATE",
          oldData: toJsonSafe({ username: before.username, fullName: before.fullName, role: before.role, isActive: before.isActive, allowedWarehouseIds: before.allowedWarehouseIds, allowedTreasuryIds: before.allowedTreasuryIds, transferToTreasuryId: before.transferToTreasuryId, permissions: before.permissions }),
          newData: toJsonSafe({ ...updated, ...scopes, permissions: input.permissions, passwordChanged: Boolean(password) }),
          performedBy: actor.id,
        },
      });
      return updated;
    }, TX_OPTIONS)));
    revalidateUserManagement();
    return ok({ id: result.id, user: serializeData({ ...result, createdAt: result.createdAt.toISOString() }) });
  } catch (error) {
    return toActionError(error, "updateManagedUserAction");
  }
}
