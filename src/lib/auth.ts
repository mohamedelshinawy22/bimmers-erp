import "server-only";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { establishTenantContext } from "./tenant-routing";
import { SESSION_COOKIE } from "./auth-constants";
import { AuthError, ConfigurationError, ForbiddenError } from "./errors";
import { can, PERMISSIONS, type Permission } from "./permissions";
import { getUserAccess, hasApplicationPermission } from "./user-permissions";
import { sessionSecretKey, verifySessionToken } from "./session-token";

// Re-exported so server code has one import site for auth + authorisation.
export { SESSION_COOKIE, AuthError, ForbiddenError, can, PERMISSIONS };
export type { Permission };

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  tenantId: string;
  issuedAtMs: number;
}

function ttlHours(): number {
  const parsed = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

export async function createSession(user: Omit<SessionUser, "issuedAtMs">): Promise<void> {
  const hours = ttlHours();
  const token = await new SignJWT({
    sub: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    tenantId: user.tenantId,
    issuedAtMs: Date.now(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("bimmer-erp")
    .setAudience("bimmer-erp-web")
    .setExpirationTime(`${hours}h`)
    .sign(sessionSecretKey());

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: hours * 60 * 60,
  });
}

export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  const session = await verifySessionToken(token);
  return session ? { ...session, role: session.role as Role } : null;
}

/** Cheap read: trusts the signed cookie, no DB round-trip. */
export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Authoritative read used by every mutating server action: re-checks the user
 * still exists and is active, so deactivating an account invalidates it
 * immediately instead of waiting for the JWT to expire.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("الجلسة منتهية. يرجى تسجيل الدخول من جديد.");
  await establishTenantContext(session.username, session.tenantId);

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, username: true, fullName: true, role: true, isActive: true },
  });
  const passwordChanged = user ? await prisma.systemAuditTrail.findFirst({ where: { tableName: "User", recordId: session.id, action: "PASSWORD_CHANGED" }, orderBy: { timestamp: "desc" }, select: { timestamp: true } }) : null;
  if (!user || !user.isActive || (passwordChanged && passwordChanged.timestamp.getTime() >= session.issuedAtMs)) {
    throw new AuthError("هذا الحساب موقوف أو غير موجود.");
  }
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role, tenantId: session.tenantId, issuedAtMs: session.issuedAtMs };
}



/** Authenticate + authorise in one call. Throws on failure. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  const access = await getUserAccess(user.id);
  if (!hasApplicationPermission(access, permission)) {
    throw new ForbiddenError(
      `ليس لديك صلاحية (${permission}) — دورك أو إعداداتك التفصيلية لا تسمح بهذا الإجراء.`,
    );
  }
  return user;
}
