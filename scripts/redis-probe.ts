/**
 * Redis primitive probe.
 *
 * Verifies the Redis primitives the dashboard aggregate cache layer in
 * src/lib/redis.ts actually depends on. The lock primitives (SET … PX NX and
 * the compare-and-delete EVAL) are still asserted below so their guarantees
 * stay on record in case locking is ever reintroduced — nothing in the app
 * relies on them today. Exercised through the PROJECT'S OWN client via
 * `getRedis()`, never a locally constructed one, so the real options (TLS from
 * the rediss:// scheme, lazyConnect, enableOfflineQueue:false,
 * maxRetriesPerRequest, retryStrategy) are what get exercised.
 *
 * Run: npx tsx --conditions=react-server scripts/redis-probe.ts
 */
// tsx does not load .env for us, and getRedis() reads process.env.REDIS_URL.
import "dotenv/config";
import { getRedis } from "../src/lib/redis";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`  \u2713 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;

/**
 * Reference implementation of the compare-and-delete release step, retained here
 * only to document the atomicity guarantee it provides. Nothing in the
 * application depends on it today — stock serialisation comes entirely from
 * PostgreSQL SELECT ... FOR UPDATE row locks.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const LOCK_KEY = "bimmer:lock:probe:part:REDIS-PROBE";
const CACHE_A = "bimmer:cache:probe:alpha";
const CACHE_B = "bimmer:cache:probe:beta";
const CACHE_IDX = "bimmer:cachekeys:probe";
const ALL_KEYS = [LOCK_KEY, CACHE_A, CACHE_B, CACHE_IDX];

async function main() {
  const url = process.env.REDIS_URL ?? "";
  console.log("\u2500".repeat(74));
  console.log("Redis primitive probe \u2014 via the project's own getRedis()");
  console.log("\u2500".repeat(74));
  console.log(`  REDIS_URL set .....: ${url ? "yes" : "NO"}`);
  console.log(`  scheme ............: ${url.split("://")[0] || "(none)"}`);
  console.log(`  TLS via scheme ....: ${url.startsWith("rediss://") ? "YES (rediss://)" : "NO — ioredis will not negotiate TLS"}`);
  console.log(`  endpoint ..........: ${url ? url.replace(/\/\/.*@/, "//<redacted>@") : "(none)"}`);

  const redis = getRedis();
  if (!redis) {
    console.error(
      "\n\u2717 getRedis() returned null \u2014 REDIS_URL is unset/empty, so the dashboard cache\n" +
        "  is DISABLED and callers fall back to querying Postgres directly. Nothing to probe.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  client status .....: ${redis.status} (lazyConnect \u2192 not yet connected)`);

  try {
    /* ── 1. PING ─────────────────────────────────────────────────────────── */
    console.log("\n1) PING \u2014 connectivity + TLS handshake");
    let cold = -1;
    try {
      const t = process.hrtime.bigint();
      const pong = await redis.ping();
      cold = ms(t);
      check("cold PING replied PONG", pong === "PONG", `"${pong}" in ${cold.toFixed(1)}ms (incl. TCP+TLS+AUTH)`);
    } catch (e) {
      // lazyConnect:true + enableOfflineQueue:false rejects commands issued
      // before the socket is writable. Report it, then wait for 'ready'.
      console.error(`  ! cold PING REJECTED: ${msg(e)}`);
      console.error("    cause: lazyConnect:true + enableOfflineQueue:false in src/lib/redis.ts");
      console.error(
        "    note : Redis is now the dashboard aggregate cache ONLY \u2014 the distributed mutex was removed, so a\n" +
          "           cold-start rejection costs one wasted cache miss (the caller reads Postgres instead),\n" +
          "           not a lost lock. Correctness does not depend on this client being reachable.",
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for 'ready' after 15s")), 15_000);
        if (redis.status === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        redis.once("ready", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const t = process.hrtime.bigint();
      const pong = await redis.ping();
      cold = ms(t);
      check("PING replied PONG once connected", pong === "PONG", `"${pong}" (after awaiting 'ready')`);
    }

    /* ── 7. latency (measured warm, after the handshake is paid) ─────────── */
    const samples: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = process.hrtime.bigint();
      await redis.ping();
      samples.push(ms(t));
    }
    const sorted = [...samples].sort((a, b) => a - b);
    // ?? 0 keeps noUncheckedIndexedAccess happy; samples is never empty here.
    const pMin = sorted[0] ?? 0;
    const pMax = sorted[sorted.length - 1] ?? 0;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

    /* ── 2. SET ... PX NX on a fresh key ────────────────────────────────── */
    console.log("\n2) SET key token PX 5000 NX \u2014 lock acquisition on a fresh key");
    await redis.del(LOCK_KEY);
    const tokenMine = "probe-owner-token-AAAA";
    const tokenOther = "probe-other-token-BBBB";
    const first = await redis.set(LOCK_KEY, tokenMine, "PX", 5000, "NX");
    check('fresh SET ... PX 5000 NX returned "OK"', first === "OK", `got ${JSON.stringify(first)}`);
    const pttl = await redis.pttl(LOCK_KEY);
    check("PX applied a finite TTL (0 < pttl <= 5000)", pttl > 0 && pttl <= 5000, `pttl = ${pttl}ms`);

    /* ── 3. SET ... NX again → null (mutual exclusion) ───────────────────── */
    console.log("\n3) SET ... NX on the held key \u2014 mutual exclusion");
    const second = await redis.set(LOCK_KEY, tokenOther, "PX", 5000, "NX");
    check("second SET ... NX returned null (contender is excluded)", second === null, `got ${JSON.stringify(second)}`);
    const ownerAfter = await redis.get(LOCK_KEY);
    check("holder's token was NOT overwritten by the contender", ownerAfter === tokenMine, `owner = ${ownerAfter}`);

    /* ── 5(a). EVAL release with the WRONG token → 0 ─────────────────────── */
    console.log("\n4) EVAL compare-and-delete with a WRONG token \u2014 must refuse");
    const wrong = await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, tokenOther);
    check("EVAL with wrong token returned 0", Number(wrong) === 0, `got ${JSON.stringify(wrong)}`);
    const survived = await redis.get(LOCK_KEY);
    check("lock still held after the wrong-token release attempt", survived === tokenMine, `owner = ${survived}`);

    /* ── 4(b). EVAL release with the CORRECT token → 1 ───────────────────── */
    console.log("\n5) EVAL compare-and-delete with the CORRECT token \u2014 must release");
    const right = await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, tokenMine);
    check("EVAL with correct token returned 1", Number(right) === 1, `got ${JSON.stringify(right)}`);
    const gone = await redis.get(LOCK_KEY);
    check("key is actually deleted after release", gone === null, `GET \u2192 ${JSON.stringify(gone)}`);
    const reacquire = await redis.set(LOCK_KEY, tokenOther, "PX", 5000, "NX");
    check("lock is re-acquirable by the next contender", reacquire === "OK", `got ${JSON.stringify(reacquire)}`);
    await redis.del(LOCK_KEY);
    const noop = await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, tokenMine);
    check("EVAL on an already-expired/absent key returned 0", Number(noop) === 0, `got ${JSON.stringify(noop)}`);

    /* ── 6. SADD / SMEMBERS / DEL (cache invalidation index) ─────────────── */
    console.log("\n6) SADD / SMEMBERS / DEL \u2014 cache invalidation index");
    await redis.del(CACHE_IDX, CACHE_A, CACHE_B);
    const added = await redis.sadd(CACHE_IDX, CACHE_A, CACHE_B);
    check("SADD added 2 members", added === 2, `sadd \u2192 ${added}`);
    const members = await redis.smembers(CACHE_IDX);
    check(
      "SMEMBERS returned both tracked cache keys",
      members.length === 2 && members.includes(CACHE_A) && members.includes(CACHE_B),
      `[${members.sort().join(", ")}]`,
    );
    const dupe = await redis.sadd(CACHE_IDX, CACHE_A);
    check("SADD is idempotent for an existing member", dupe === 0, `sadd \u2192 ${dupe}`);
    // Exactly what invalidateCache() does: DEL(...keys, indexKey).
    await redis.mset(CACHE_A, "value-a", CACHE_B, "value-b");
    const deleted = await redis.del(...members, CACHE_IDX);
    check("DEL removed both cache keys + the index in one call", deleted === 3, `del \u2192 ${deleted}`);
    const emptied = await redis.smembers(CACHE_IDX);
    check("SMEMBERS on the deleted index is empty", emptied.length === 0, `[${emptied.join(", ")}]`);

    /* ── 7. latency report ──────────────────────────────────────────────── */
    console.log("\n7) Measured round-trip latency");
    console.log(`  cold PING (incl. TCP+TLS+AUTH) : ${cold.toFixed(1)}ms`);
    console.log(`  warm PING min / median / mean  : ${pMin.toFixed(1)} / ${median.toFixed(1)} / ${mean.toFixed(1)}ms`);
    console.log(`  warm PING max                 : ${pMax.toFixed(1)}ms`);
    console.log(`  samples (ms)                  : [${samples.map((s) => s.toFixed(1)).join(", ")}]`);
    // Budget context: this client caches the dashboard aggregates. There is no
    // lock-wait budget to spend any more — the only question is whether a cache
    // hit is cheaper than the aggregate query it replaces.
    console.log(
      `  \u2192 at this latency a cache HIT costs ~${median.toFixed(1)}ms RTT, which is only worth paying while it\n` +
        `    stays well below the dashboard aggregate query it stands in for. A MISS, a timeout, or a\n` +
        `    cold-start rejection costs one extra round trip and then reads Postgres \u2014 degraded latency,\n` +
        `    never a lost lock and never a correctness risk.`,
    );
  } finally {
    /* ── cleanup ─────────────────────────────────────────────────────────── */
    console.log("\ncleanup");
    try {
      const removed = await redis.del(...ALL_KEYS);
      const left = await Promise.all(ALL_KEYS.map((k) => redis.exists(k)));
      const remaining = left.reduce((a, b) => a + b, 0);
      check("probe keys removed (no residue)", remaining === 0, `del \u2192 ${removed}, still present \u2192 ${remaining}`);
    } catch (e) {
      console.error(`  \u2717 cleanup failed: ${msg(e)}`);
      fail++;
    }
    await redis.quit().catch(() => redis.disconnect());
  }

  console.log("\n" + "\u2500".repeat(74));
  console.log(`  passed: ${pass}`);
  console.log(`  failed: ${fail}`);
  if (failures.length) {
    console.log("  failing checks:");
    for (const f of failures) console.log(`    \u2717 ${f}`);
  }
  console.log("\u2500".repeat(74));
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n\u2717 PROBE ABORTED:", msg(e));
  process.exitCode = 1;
});
