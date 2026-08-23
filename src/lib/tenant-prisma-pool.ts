import "server-only";
import { createHash } from "node:crypto";

export type DisconnectableClient = { $disconnect: () => Promise<unknown> };

type Entry<T extends DisconnectableClient> = { client: T; urlFingerprint: string; lastUsedAt: number };

function fingerprint(url: string) { return createHash("sha256").update(url).digest("hex"); }

/**
 * Bounded, tenant-keyed client cache. A tenant identity is always paired with
 * the exact resolved database URL fingerprint; a client is never reused for a
 * different tenant or stale connection target.
 */
export function createTenantClientPool<T extends DisconnectableClient>(create: (databaseUrl: string) => T, maxClients = 30, maxIdleMs = 10 * 60_000) {
  const entries = new Map<string, Entry<T>>();
  async function evictIdle() {
    const cutoff = Date.now() - maxIdleMs;
    for (const [tenantId, entry] of entries) {
      if (entry.lastUsedAt > cutoff) continue;
      entries.delete(tenantId);
      await entry.client.$disconnect();
    }
  }
  return {
    async get(tenantId: string, databaseUrl: string): Promise<T> {
      await evictIdle();
      const current = entries.get(tenantId);
      const urlFingerprint = fingerprint(databaseUrl);
      if (current?.urlFingerprint === urlFingerprint) {
        current.lastUsedAt = Date.now();
        return current.client;
      }
      if (current) {
        entries.delete(tenantId);
        await current.client.$disconnect();
      }
      if (entries.size >= maxClients) {
        const oldest = [...entries.entries()].sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)[0];
        if (oldest) {
          entries.delete(oldest[0]);
          await oldest[1].client.$disconnect();
        }
      }
      const client = create(databaseUrl);
      entries.set(tenantId, { client, urlFingerprint, lastUsedAt: Date.now() });
      return client;
    },
    async clear() {
      await Promise.all([...entries.values()].map(entry => entry.client.$disconnect()));
      entries.clear();
    },
    size() { return entries.size; },
  };
}
