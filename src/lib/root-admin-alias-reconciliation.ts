import "server-only";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type { TenantContext } from "./tenant-routing";
import { toJsonSafe } from "./audit";

type LoginUser = { id: string; username: string; fullName: string; role: "SUPER_ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER"; isActive: boolean; passwordHash: string };

/**
 * Creates the configured root-admin alias only after the supplied login secret
 * successfully verifies against the existing active legacy `admin` root. The
 * password hash is copied, never returned by Master Console or re-exposed.
 */
export async function reconcileConfiguredRootAdminAlias(input: {
  tenant: TenantContext;
  username: string;
  password: string;
  ipAddress?: string | null;
}): Promise<LoginUser | null> {
  const configured = input.tenant.route.initialAdminUsername?.trim().toLowerCase();
  if (!configured || configured !== input.username || input.username === "admin") return null;

  try {
    return await input.tenant.prisma.$transaction(async (tx) => {
      const alreadyPresent = await tx.user.findUnique({
        where: { username: input.username },
        select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
      });
      if (alreadyPresent) return alreadyPresent;

      const legacyAdmin = await tx.user.findFirst({
        where: { username: "admin", role: "SUPER_ADMIN", isActive: true },
        select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
      });
      if (!legacyAdmin || !await bcrypt.compare(input.password, legacyAdmin.passwordHash)) return null;

      const alias = await tx.user.create({
        data: { username: input.username, fullName: legacyAdmin.fullName, passwordHash: legacyAdmin.passwordHash, role: "SUPER_ADMIN", isActive: true },
        select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
      });
      await tx.systemAuditTrail.create({
        data: {
          tableName: "User",
          recordId: alias.id,
          action: "ROOT_ADMIN_ALIAS_RECONCILED",
          oldData: toJsonSafe({ legacyUserId: legacyAdmin.id, legacyUsername: legacyAdmin.username }),
          newData: toJsonSafe({ username: alias.username, role: alias.role, source: "LEGACY_ADMIN_PASSWORD_VERIFIED" }),
          performedBy: legacyAdmin.id,
          ipAddress: input.ipAddress ?? null,
        },
      });
      return alias;
    });
  } catch (error) {
    // A concurrent first login may create the alias between the select and
    // insert. Resolve it once rather than turning that race into a login crash.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return input.tenant.prisma.user.findUnique({
        where: { username: input.username },
        select: { id: true, username: true, fullName: true, role: true, isActive: true, passwordHash: true },
      });
    }
    throw error;
  }
}
