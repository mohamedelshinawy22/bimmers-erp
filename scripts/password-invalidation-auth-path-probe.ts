import assert from "node:assert/strict";
import { resolveTenantSessionAuthority } from "../src/lib/tenant-session-authority";

async function main() {
  const issuedAtMs = 1_700_000_000_000;
  const user = { id: "user-1", username: "admin", fullName: "مدير النظام", role: "SUPER_ADMIN", isActive: true };
  const repository = (passwordChangedAt: Date | null) => ({
    findUser: async () => user,
    findLatestPasswordChange: async () => passwordChangedAt,
  });
  assert.deepEqual(await resolveTenantSessionAuthority({ id: user.id, issuedAtMs }, repository(null)), user, "an active tenant session must be accepted before a password change");
  assert.equal(await resolveTenantSessionAuthority({ id: user.id, issuedAtMs }, repository(new Date(issuedAtMs + 1))), null, "the same authority path used by requireUser must reject a session issued before PASSWORD_CHANGED");
  assert.deepEqual(await resolveTenantSessionAuthority({ id: user.id, issuedAtMs: issuedAtMs + 2 }, repository(new Date(issuedAtMs + 1))), user, "a newly issued tenant session must remain accepted after the prior password-change audit");
  console.log("Tenant password invalidation auth-path probe passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
