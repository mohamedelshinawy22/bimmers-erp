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
  try {
    const actor = await requirePermission("user.manage");
    const input = createUserSchema.parse(raw);
    const username = input.username.toLowerCase();
    const tenant = getTenantContext();
    await reserveTenantUsername(tenant.route, username, input.role);
    reservation = { username, route: tenant.route };

    const created = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
      if (input.role !== "SUPER_ADMIN") {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bimmers:sub-user-quota:${tenant.route.tenantId}`}))`;
        const activeSubUsers = await tx.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } });
        if (activeSubUsers >= tenant.route.maxSubUsers) throw new BusinessRuleError(`تم الوصول إلى الحد الأقصى للمستخدمين الفرعيين المسموح به (${tenant.route.maxSubUsers}).`);
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
    }, TX_OPTIONS));
    createdId = created.id;
    await activateTenantUsername(tenant.route, username);
    await reportTenantSubUserUsage(tenant.route, await tenant.prisma.user.count({ where: { isActive: true, role: { not: "SUPER_ADMIN" } } }));

    revalidatePath("/settings");
    return ok({ id: created.id, username: created.username });
  } catch (error) {
    if (createdId) await prisma.user.delete({ where: { id: createdId } }).catch(() => undefined);
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
): Promise<ActionResult<{ isActive: boolean }>> {
  try {
    const actor = await requirePermission("user.manage");
    if (actor.id === userId) {
      return fail("لا يمكنك إيقاف حسابك الخاص.");
    }

    const next = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, role: true, username: true },
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
      return updated.isActive;
    });

    revalidatePath("/settings");
    revalidatePath("/users");
    return ok({ isActive: next });
  } catch (error) {
    return toActionError(error, "toggleUserActiveAction");
  }
}
