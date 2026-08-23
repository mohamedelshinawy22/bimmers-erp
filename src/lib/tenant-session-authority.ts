import { isSessionInvalidatedByPasswordChange } from "./password-session-invalidation";

export type TenantSessionAuthorityClaims = { id: string; issuedAtMs: number };
export type TenantSessionAuthorityUser = { id: string; username: string; fullName: string; role: unknown; isActive: boolean };

/**
 * The authoritative tenant-local half of `requireUser()`. It is deliberately
 * dependency-injected so the same production rule can be exercised against a
 * fake tenant repository without importing request-only Next APIs.
 */
export async function resolveTenantSessionAuthority<T extends TenantSessionAuthorityUser>(
  session: TenantSessionAuthorityClaims,
  repository: {
    findUser(userId: string): Promise<T | null>;
    findLatestPasswordChange(userId: string): Promise<Date | null>;
  },
): Promise<T | null> {
  const user = await repository.findUser(session.id);
  if (!user || !user.isActive) return null;
  const changedAt = await repository.findLatestPasswordChange(session.id);
  return isSessionInvalidatedByPasswordChange(session.issuedAtMs, changedAt) ? null : user;
}
