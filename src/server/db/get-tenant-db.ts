import { requireUser, type SessionUser } from "@/lib/auth";
import { establishTenantContext, runWithTenantContext, type TenantContext } from "@/lib/tenant-routing";

export type SessionTenantDb = {
  user: SessionUser;
  context: TenantContext;
  prisma: TenantContext["prisma"];
  run<T>(work: () => Promise<T>): Promise<T>;
};

/**
 * Resolves exactly the tenant encoded in the authenticated session and returns
 * its scoped Prisma client. It deliberately has no primary-DB fallback: an
 * unresolved or mismatched tenant must fail safely rather than cross tenants.
 */
export async function getTenantDbFromSession(): Promise<SessionTenantDb> {
  const user = await requireUser();
  const context = await establishTenantContext(user.username, user.tenantId);
  return {
    user,
    context,
    prisma: context.prisma,
    run: <T>(work: () => Promise<T>) => runWithTenantContext(context, work),
  };
}
