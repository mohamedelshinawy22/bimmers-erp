import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decryptTenantRouteEnvelope, TenantRoutingError } from "../src/lib/tenant-routing";

function encryptRoute(route: Record<string, unknown>, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(route), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
}

function main() {
  const secret = "tenant-route-test-key-with-at-least-thirty-two-characters";
  process.env.TENANT_ROUTE_ENCRYPTION_KEY = secret;
  const route = { version: 1, tenantId: "tenant-alpha", slug: "alpha", licenseKey: "BL-ALPHA", deploymentIdentifier: "alpha-prod", databaseUrl: "postgresql://user:pass@db.example.test:5432/tenant_alpha", initialAdminUsername: "elshafei", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.deepEqual(decryptTenantRouteEnvelope(encryptRoute(route, secret)), route, "a valid server envelope must decrypt to a usable PostgreSQL route");
  assert.throws(() => decryptTenantRouteEnvelope("not.a.valid-envelope"), (error: unknown) => error instanceof TenantRoutingError && error.code === "ROUTE_DECRYPTION_FAILED");
  console.log("Tenant route encryption configuration probe passed.");
}

main();
