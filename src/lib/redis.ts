import Redis from "ioredis";

/**
 * Redis 7 connection + dashboard aggregate cache.
 *
 * Redis is NOT on any correctness path. Stock and invoice consistency is
 * enforced entirely by PostgreSQL `SELECT … FOR UPDATE` row locks (see
 * inventory.service.ts). Those locks are held in the database, so they already
 * serialise every app instance against every other one.
 *
 * An application-level mutex used to wrap those transactions. It was removed:
 * it was a second queue in front of an already-correct one, it protected
 * nothing PostgreSQL was not already protecting, and its short acquisition
 * budget threw away work the database would have completed (measured under
 * 14-way contention: 1/10 units sold with the mutex, 10/10 without it).
 *
 * What is left is a non-authoritative cache for read-heavy dashboard
 * aggregates. Losing Redis costs cache hits, never correctness.
 */
const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
  redisInit: boolean | undefined;
};

/** True while `next build` is collecting page data — no runtime services exist yet. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function createClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    // Nothing to refuse: Redis is only the dashboard cache now, so its absence
    // degrades performance, not correctness. (Silent during `next build`, which
    // sets NODE_ENV=production and imports every route with no services up.)
    if (!isBuildPhase()) console.info("[redis] REDIS_URL not set — dashboard aggregate cache disabled.");
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    // With `lazyConnect` the socket is not opened until the first command is
    // issued, so that first command MUST be allowed to queue until the
    // connection is ready. With `enableOfflineQueue: false` it was rejected
    // outright ("Stream isn't writeable"), so the first Redis call of every
    // process failed. On serverless a cold process is the common case, not the
    // edge case, so that was a guaranteed wasted cache miss per invocation.
    enableOfflineQueue: true,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on("error", (err) => {
    // Never let a Redis outage crash the process; DB locks remain authoritative.
    console.error("[redis] connection error:", err.message);
  });
  return client;
}

/**
 * Lazily resolved Redis client.
 *
 * Created on first actual use rather than at module import, so importing this
 * module (which every server action does, transitively) does not open a
 * connection — including during `next build`, which imports every route.
 */
export function getRedis(): Redis | null {
  if (!globalForRedis.redisInit) {
    globalForRedis.redisClient = createClient();
    globalForRedis.redisInit = true;
  }
  return globalForRedis.redisClient ?? null;
}

/** Cache helper for read-heavy dashboard aggregates. */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return loader();
  const fullKey = `bimmer:cache:${key}`;
  try {
    const hit = await redis.get(fullKey);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return loader();
  }
  const value = await loader();
  try {
    // Track the key so invalidation never needs a blocking KEYS scan.
    await redis
      .multi()
      .set(fullKey, JSON.stringify(value), "EX", ttlSeconds)
      .sadd(`bimmer:cachekeys:${key.split(":")[0]}`, fullKey)
      .exec();
  } catch {
    /* non-fatal */
  }
  return value;
}

/**
 * Invalidates a cache namespace.
 *
 * Uses a tracked key set rather than `KEYS bimmer:cache:<prefix>*`. `KEYS` is
 * O(keyspace) and blocks the Redis event loop, and it ran on every invoice,
 * receipt, payment and transfer — while nothing was populating the cache at all,
 * so it could never even match.
 */
export async function invalidateCache(namespace: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const indexKey = `bimmer:cachekeys:${namespace}`;
  try {
    const keys = await redis.smembers(indexKey);
    if (keys.length) await redis.del(...keys, indexKey);
    else await redis.del(indexKey);
  } catch {
    /* non-fatal */
  }
}
