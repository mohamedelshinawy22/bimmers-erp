import { requireUser, type SessionUser } from "@/lib/auth";
import { establishTenantContext, runWithTenantContext, type TenantContext } from "@/lib/tenant-routing";
import { bootstrapTenantDatabase } from "./bootstrap-tenant";

export type SessionTenantDb = {
  user: SessionUser;
  context: TenantContext;
  prisma: TenantContext["prisma"];
  run<T>(work: () => Promise<T>): Promise<T>;
};

const bootstrapRuns = globalThis as unknown as { bimmersTenantBootstrapRuns?: Map<string, Promise<void>> };
const bootstrapByTenant = bootstrapRuns.bimmersTenantBootstrapRuns ?? new Map<string, Promise<void>>();
if (process.env.NODE_ENV !== "production") bootstrapRuns.bimmersTenantBootstrapRuns = bootstrapByTenant;

async function ensureTenantBaseline(context: TenantContext): Promise<void> {
  const existing = bootstrapByTenant.get(context.route.tenantId);
  if (existing) return existing;

  const run = (async () => {
    const [treasuries, categories, brands, chassis, engines, barcodeConfigs] = await Promise.all([
      context.prisma.treasury.count(), context.prisma.category.count(), context.prisma.brand.count(),
      context.prisma.bmwChassis.count(), context.prisma.bmwEngine.count(), context.prisma.barcodeConfig.count(),
    ]);
    if (treasuries > 0 && categories > 0 && brands > 0 && chassis > 0 && engines > 0 && barcodeConfigs > 0) return;
    await bootstrapTenantDatabase(context.prisma);
  })();
  bootstrapByTenant.set(context.route.tenantId, run);
  try {
    await run;
  } catch (error) {
    bootstrapByTenant.delete(context.route.tenantId);
    throw error;
  }
}

/**
 * Resolves exactly the tenant encoded in the authenticated session and returns
 * its scoped Prisma client. It deliberately has no primary-DB fallback: an
 * unresolved or mismatched tenant must fail safely rather than cross tenants.
 */
export async function getTenantDbFromSession(): Promise<SessionTenantDb> {
  const user = await requireUser();
  const context = await establishTenantContext(user.username, user.tenantId);
  await ensureTenantBaseline(context);
  return {
    user,
    context,
    prisma: context.prisma,
    run: <T>(work: () => Promise<T>) => runWithTenantContext(context, work),
  };
}
