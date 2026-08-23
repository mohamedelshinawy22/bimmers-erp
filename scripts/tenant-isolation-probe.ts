import assert from "node:assert/strict";
import { createTenantClientPool } from "../src/lib/tenant-prisma-pool";

type FakeClient = { url: string; disconnected: boolean; $disconnect: () => Promise<void> };

async function main() {
  const pool = createTenantClientPool<FakeClient>(url => ({ url, disconnected: false, async $disconnect() { this.disconnected = true; } }), 2);
  const alshafei = await pool.get("tenant-alshafei", "postgresql://a.example/alshafei");
  const secondRead = await pool.get("tenant-alshafei", "postgresql://a.example/alshafei");
  const otherTenant = await pool.get("tenant-other", "postgresql://b.example/other");
  assert.equal(alshafei, secondRead, "same tenant and route should reuse only its own client");
  assert.notEqual(alshafei, otherTenant, "different tenants must never share Prisma clients");
  assert.notEqual(alshafei.url, otherTenant.url, "different tenants must retain distinct database URLs");
  const expiringPool = createTenantClientPool<FakeClient>(url => ({ url, disconnected: false, async $disconnect() { this.disconnected = true; } }), 2, -1);
  const staleClient = await expiringPool.get("tenant-stale", "postgresql://stale.example/one");
  const freshClient = await expiringPool.get("tenant-stale", "postgresql://stale.example/one");
  assert.notEqual(staleClient, freshClient, "idle eviction must not reuse an expired tenant client");
  assert.equal(staleClient.disconnected, true, "idle eviction must disconnect the stale tenant client");
  console.log("Tenant Prisma isolation probe passed.");
}

void main();
