"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, requirePermission } from "@/lib/auth";
import { fail, ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { createUserSchema, loginSchema, type LoginInput } from "@/lib/validations/accounts";
import { toJsonSafe } from "@/lib/audit";
import { headers } from "next/headers";

/** Constant-time-ish decoy hash so a missing username costs the same as a wrong password. */
const DECOY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.q8n0PtPYQhbP8Yq9m8kK1lYQ0lM3z2i";

export async function loginAction(raw: LoginInput): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const input = loginSchema.parse(raw);

    const user = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
    });

    const hash = user?.passwordHash ?? DECOY_HASH;
    const passwordOk = await bcrypt.compare(input.password, hash);

    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    if (!user || !passwordOk || !user.isActive) {
      await prisma.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: user?.id ?? "unknown",
          action: "LOGIN_FAILED",
          newData: toJsonSafe({ username: input.username, reason: !user ? "NO_USER" : !passwordOk ? "BAD_PASSWORD" : "INACTIVE" }),
          performedBy: "anonymous",
          ipAddress: ip,
        },
      });
      // Never disclose which of the two was wrong.
      return fail("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }

    await createSession({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    });

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      prisma.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: user.id,
          action: "LOGIN",
          newData: toJsonSafe({ username: user.username, role: user.role }),
          performedBy: user.id,
          ipAddress: ip,
        },
      }),
    ]);

    return ok({ redirectTo: "/" });
  } catch (error) {
    return toActionError(error, "loginAction");
  }
}

export async function logoutAction(): Promise<void> {
  destroySession();
  redirect("/login");
}

/** Creates an operator account. Surfaced in Settings behind `user.manage`. */
export async function createUserAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; username: string }>> {
  try {
    const actor = await requirePermission("user.manage");
    const input = createUserSchema.parse(raw);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
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
    });

    revalidatePath("/settings");
    return ok({ id: created.id, username: created.username });
  } catch (error) {
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
    return ok({ isActive: next });
  } catch (error) {
    return toActionError(error, "toggleUserActiveAction");
  }
}
