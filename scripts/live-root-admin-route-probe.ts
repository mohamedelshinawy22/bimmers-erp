import assert from "node:assert/strict";
import { establishTenantContext, tenantIsolationDiagnostics } from "../src/lib/tenant-routing";

async function main() {
  const alias = "elshafei";
  const tenant = await establishTenantContext(alias);
  assert.equal(tenant.route.deploymentIdentifier, "alshafei-main", "the username route must select the legacy deployment only");
  assert.equal(tenant.route.initialAdminUsername, alias, "the encrypted route must carry the configured root-admin alias");
  const users = await tenant.prisma.user.findMany({
    where: { username: { in: ["admin", alias] } },
    select: { id: true, username: true, role: true, isActive: true },
    orderBy: { username: "asc" },
  });
  const activeAliases = new Set(users.filter(user => user.role === "SUPER_ADMIN" && user.isActive).map(user => user.username));
  assert.equal(activeAliases.has("admin"), true, "the legacy admin root account must remain available");
  assert.equal(activeAliases.has(alias), true, "the configured root-admin alias must be present and active after reconciliation/provisioning");
  await tenantIsolationDiagnostics.clearClientPool();
  console.log("Live root-admin route probe passed without reading credentials or connection URIs.");
}

main().catch(async error => {
  await tenantIsolationDiagnostics.clearClientPool().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
