import assert from "node:assert/strict";
import { SignJWT } from "jose";

async function main() {
  process.env.JWT_SECRET = "tenant-session-test-secret-must-be-at-least-thirty-two-characters";
  const { verifySessionToken } = await import("../src/lib/session-token");
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const issue = (claims: Record<string, unknown>) => new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("bimmer-erp")
    .setAudience("bimmer-erp-web")
    .setExpirationTime("1h")
    .sign(key);

  const boundToken = await issue({ sub: "user-123", username: "operator", fullName: "Operator", role: "SUPER_ADMIN", tenantId: "tenant-alpha", issuedAtMs: 1_700_000_000_000 });
  const boundSession = await verifySessionToken(boundToken);
  assert.equal(boundSession?.tenantId, "tenant-alpha", "a valid session must retain its resolved tenant identifier");
  assert.equal(boundSession?.issuedAtMs, 1_700_000_000_000, "a valid session must retain its password-invalidation issue marker");

  const legacyToken = await issue({ sub: "user-123", username: "operator", fullName: "Operator", role: "SUPER_ADMIN", tenantId: "tenant-alpha" });
  assert.equal(await verifySessionToken(legacyToken), null, "a token without a password-invalidation issue marker must be rejected");

  console.log("Tenant-bound session probe passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
