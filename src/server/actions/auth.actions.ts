"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, requirePermission, requireUser } from "@/lib/auth";
import { fail, ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { changeOwnPasswordSchema, createUserSchema, loginSchema, tenantDeviceIdentitySchema, type ChangeOwnPasswordInput, type LoginInput } from "@/lib/validations/accounts";
import { toJsonSafe } from "@/lib/audit";
import { headers } from "next/headers";
import { activateTenantUsername, authorizeTenantDevice, establishTenantContext, getTenantContext, releaseTenantUsername, reportTenantSubUserUsage, reserveTenantUsername, TenantRoutingError } from "@/lib/tenant-routing";
import { reconcileConfiguredRootAdminAlias } from "@/lib/root-admin-alias-reconciliation";
import { toLoginActionFailure } from "@/lib/login-action-failure";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";

/** Constant-time-ish decoy hash so a missing username costs the same as a wrong password. */
const DECOY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.q8n0PtPYQhbP8Yq9m8kK1lYQ0lM3z2i";

export async function loginAction(raw: LoginInput): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const input = loginSchema.parse(raw);

    const username = input.username.toLowerCase();
    const tenant = await establishTenantContext(username);
    await authorizeTenantDevice(tenant.route, { deviceId: input.deviceId, deviceName: input.deviceName, browserInfo: input.browserInfo, os: input.os });
    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    let user = await tenant.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
    });
    if (!user) user = await reconcileConfiguredRootAdminAlias({ tenant, username, password: input.password, ipAddress: ip });

    const hash = user?.passwordHash ?? DECOY_HASH;
    const passwordOk = await bcrypt.compare(input.password, hash);

    if (!user || !passwordOk || !user.isActive) {
      await tenant.prisma.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: user?.id ?? "unknown",
          action: "LOGIN_FAILED",
          newData: toJsonSafe({ username, reason: !user ? "NO_USER" : !passwordOk ? "BAD_PASSWORD" : "INACTIVE" }),
          performedBy: "anonymous",
          ipAddress: ip,
        },
      }).catch((auditError) => console.error("[loginAction] failed-login audit:", auditError));
      // Never disclose which of the two was wrong.
      return fail("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }

    await createSession({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      tenantId: tenant.route.tenantId,
    });

    await tenant.prisma.$transaction([
      tenant.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      tenant.prisma.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: user.id,
          action: "LOGIN",
          newData: toJsonSafe({ username: user.username, role: user.role }),
          performedBy: user.id,
          ipAddress: ip,
        },
      }),
    ]).catch((auditError) => console.error("[loginAction] successful-login audit:", auditError));
    await reportTenantSubUserUsage(tenant.route, await tenant.prisma.user.count({ where: { isActive: true } })).catch((usageError) => console.error("[loginAction] active-user usage report:", usageError));

    return ok({ redirectTo: "/" });
  } catch (error) {
    return toLoginActionFailure(error);
  }
}

export async function logoutAction(): Promise<void> {
  destroySession();
  redirect("/login");
}

/** Refreshes the approved device presence using the authenticated session's tenant route only. */
export async function tenantDeviceHeartbeatAction(raw: unknown): Promise<ActionResult<{ authorized: true }>> {
  try {
    const user = await requireUser();
    const device = tenantDeviceIdentitySchema.parse(raw);
    const tenant = await establishTenantContext(user.username, user.tenantId);
    await authorizeTenantDevice(tenant.route, device, "heartbeat");
    await reportTenantSubUserUsage(tenant.route, await tenant.prisma.user.count({ where: { isActive: true } })).catch((usageError) => console.error("[tenantDeviceHeartbeatAction] active-user usage report:", usageError));
    return ok({ authorized: true });
  } catch (error) {
    return toActionError(error, "tenantDeviceHeartbeatAction");
  }
}

/** Changes only the authenticated tenant-local account and invalidates all earlier signed sessions. */
export async function changeOwnPasswordAction(raw: ChangeOwnPasswordInput): Promise<ActionResult<{ signedOut: true }>> {
  try {
    const actor = await requireUser();
    const input = changeOwnPasswordSchema.parse(raw);
    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const account = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, username: true, passwordHash: true } });
    if (!account || !await bcrypt.compare(input.currentPassword, account.passwordHash)) return fail("كلمة المرور الحالية غير صحيحة.");
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } });
      await tx.systemAuditTrail.create({ data: { tableName: "User", recordId: actor.id, action: "PASSWORD_CHANGED", newData: toJsonSafe({ username: account.username, sessionsInvalidated: true }), performedBy: actor.id, ipAddress: ip } });
    });
    destroySession();
    revalidatePath("/");
    revalidatePath("/settings");
    return ok({ signedOut: true });
  } catch (error) {
    return toActionError(error, "changeOwnPasswordAction");
  }
}

/** Creates an operator account. Surfaced in Settings behind `user.manage`. */
export async function createUserAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; username: string }>> {
  let reservation: { username: string; route: ReturnType<typeof getTenantContext>["route"] } | null = null;
  let createdId: string | null = null;
  let scopedTenant: Awaited<ReturnType<typeof getTenantDbFromSession>> | null = null;
  try {
    const actor = await requirePermission("user.manage");
    const input = createUserSchema.parse(raw);
    const username = input.username.toLowerCase();
    const tenant = await getTenantDbFromSession();
    scopedTenant = tenant;
    await reserveTenantUsername(tenant.context.route, username, input.role);
    reservation = { username, route: tenant.context.route };

    const created = await tenant.run(() => withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      if (input.role !== "SUPER_ADMIN") {
        await tx.documentCounter.upsert({
          where: { scope: "USER_QUOTA_GATE" },
          create: { scope: "USER_QUOTA_GATE", lastValue: 1 },
          update: { lastValue: { increment: 1 } },
        });
        const activeSubUsers = await tx.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } });
        if (activeSubUsers >= tenant.context.route.maxSubUsers) throw new BusinessRuleError(`تم الوصول إلى الحد الأقصى للمستخدمين الفرعيين المسموح به (${tenant.context.route.maxSubUsers}).`);
      }
      const user = await tx.user.create({
        data: {
          username,
          fullName: input.fullName,
          passwordHash: await bcrypt.hash(input.password, 12),
          role: input.role,
        },
        select: { id: true, username: true, role: true, fullName: true },
      });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: user.id,
          action: "INSERT",
          // Never persist the password hash into the audit trail.
          newData: toJsonSafe({ username: user.username, fullName: user.fullName, role: user.role }),
          performedBy: actor.id,
        },
      });
      return user;
    }, TX_OPTIONS)));
    createdId = created.id;
    await activateTenantUsername(tenant.context.route, username);
    await reportTenantSubUserUsage(tenant.context.route, await tenant.prisma.user.count({ where: { isActive: true } }));

    revalidatePath("/settings");
    return ok({ id: created.id, username: created.username });
  } catch (error) {
    if (createdId && scopedTenant) await scopedTenant.prisma.user.delete({ where: { id: createdId } }).catch(() => undefined);
    if (reservation) await releaseTenantUsername(reservation.route, reservation.username).catch(() => undefined);
    return toActionError(error, "createUserAction");
  }
}


/**
 * Deactivate / reactivate a user.
 *
 * Deactivation takes effect on the next request because the `(app)` layout and
 * every mutating action resolve the session through `requireUser()`, which
 * re-checks `isActive` against the database.
 */
export async function toggleUserActiveAction(
  userId: string,
): Promise<ActionResult<{ isActive: boolean; action: "DEACTIVATED" | "REACTIVATED"; message: string }>> {
  try {
    const actor = await requirePermission("user.manage");
    if (actor.id === userId) {
      return fail("لا يمكنك إيقاف حسابك الخاص.");
    }
    const tenant = await getTenantDbFromSession();

    const next = await tenant.run(() => withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, role: true, username: true, fullName: true },
      });
      if (!target) throw new BusinessRuleError("المستخدم غير موجود.");

      // Never leave the system without a way in.
      if (target.isActive && target.role === "SUPER_ADMIN") {
        const remaining = await tx.user.count({
          where: { role: "SUPER_ADMIN", isActive: true, id: { not: userId } },
        });
        if (remaining === 0) {
          throw new BusinessRuleError("لا يمكن إيقاف آخر مدير نظام نشط.");
        }
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: !target.isActive },
        select: { isActive: true },
      });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: userId,
          action: "UPDATE",
          oldData: toJsonSafe({ isActive: target.isActive, username: target.username }),
          newData: toJsonSafe({ isActive: updated.isActive, username: target.username }),
          performedBy: actor.id,
        },
      });
      return { isActive: updated.isActive, fullName: target.fullName };
    }, TX_OPTIONS)));

    await reportTenantSubUserUsage(tenant.context.route, await tenant.prisma.user.count({ where: { isActive: true } })).catch((usageError) => console.error("[toggleUserActiveAction] active-user usage report:", usageError));
    revalidatePath("/settings");
    revalidatePath("/users");
    const action = next.isActive ? "REACTIVATED" as const : "DEACTIVATED" as const;
    return ok({ isActive: next.isActive, action, message: next.isActive ? `تم تنشيط حساب المستخدم ${next.fullName} بنجاح.` : `تم تعطيل حساب المستخدم ${next.fullName} بنجاح لحماية سجلاته المالية والتدقيقية.` });
  } catch (error) {
    return toActionError(error, "toggleUserActiveAction");
  }
}

/**
 * Permanently removes only a tenant-local, non-primary user with no financial
 * or operational records. UserPermission is configured to cascade; every
 * other concrete User relation is counted and blocks deletion to preserve the
 * accounting trail and avoid foreign-key failures.
 */
export async function deleteManagedUserPermanentlyAction(
  userId: string,
): Promise<ActionResult<{ id: string; username: string; message: string }>> {
  try {
    const actor = await requirePermission("user.manage");
    if (actor.id === userId) return fail("لا يمكنك حذف حسابك المسجل به حالياً.");
    const tenant = await getTenantDbFromSession();
    const deleted = await tenant.run(() => withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          _count: { select: { invoices: true, stockMoves: true, shifts: true, heldSales: true, transfers: true, importJobs: true } },
        },
      });
      if (!target) throw new BusinessRuleError("المستخدم غير موجود أو تم حذفه مسبقاً.");
      if (target.role === "SUPER_ADMIN") throw new BusinessRuleError("لا يمكن حذف الحساب الرئيسي للمنشأة نهائياً.");

      const voucherCount = await tx.treasuryTransaction.count({ where: { createdByUser: target.id } });
      const linkedRecords = target._count.invoices + target._count.stockMoves + target._count.shifts + target._count.heldSales + target._count.transfers + target._count.importJobs + voucherCount;
      if (linkedRecords > 0) {
        throw new BusinessRuleError(`لا يمكن حذف هذا المستخدم نهائياً لوجود (${linkedRecords}) سجل مالي أو تشغيلي مرتبط به. يرجى إيقاف الحساب بدلاً من الحذف لحماية القيود المحاسبية.`);
      }

      await tx.user.delete({ where: { id: target.id } });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: target.id,
          action: "DELETE",
          oldData: toJsonSafe({ username: target.username, fullName: target.fullName, role: target.role, linkedRecords: 0 }),
          performedBy: actor.id,
        },
      });
      return target;
    }, TX_OPTIONS)));

    await releaseTenantUsername(tenant.context.route, deleted.username).catch((releaseError) => console.error("[deleteManagedUserPermanentlyAction] tenant username release:", releaseError));
    await reportTenantSubUserUsage(tenant.context.route, await tenant.prisma.user.count({ where: { isActive: true } })).catch((usageError) => console.error("[deleteManagedUserPermanentlyAction] active-user usage report:", usageError));
    revalidatePath("/settings");
    revalidatePath("/users");
    return ok({ id: deleted.id, username: deleted.username, message: `تم حذف المستخدم ${deleted.fullName} نهائياً من قاعدة بيانات هذا المستأجر.` });
  } catch (error) {
    return toActionError(error, "deleteManagedUserPermanentlyAction");
  }
}
