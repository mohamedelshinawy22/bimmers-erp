/**
 * End-to-end login probe — exercises the REAL `loginAction` against the live
 * database, plus the environment invariants the login path depends on.
 *
 *   npx tsx --conditions=react-server scripts/login-probe.ts
 *   npx tsx scripts/login-probe.ts            (also works)
 *
 * WHY THIS IS NOT A UNIT TEST
 * Login had never actually been executed: earlier verification minted JWTs by
 * hand and never called `loginAction`, so the parse → lookup → bcrypt → cookie
 * chain was unproven as a whole.
 *
 * Importing `loginAction` from a plain script is a catch-22:
 *   • with `--conditions=react-server`, `react` resolves to `react.shared-subset`,
 *     which throws "entry point is not yet supported outside of experimental
 *     channels" as soon as `next/headers` loads;
 *   • without that condition, `src/lib/auth.ts`'s `import "server-only"` throws.
 * `neutraliseHostileModules()` resolves both by seeding the CJS module cache, so
 * the probe behaves identically under either invocation.
 *
 * `loginAction` also calls `cookies()` and `headers()`, which throw outside a
 * request scope. Rather than settling for "we reached the cookie stage", the
 * probe supplies a REAL request scope through Next's own `requestAsyncStorage`
 * and `actionAsyncStorage`, backed by a genuine `ResponseCookies` sink — so
 * `createSession()` truly runs and the Set-Cookie it emits is captured and
 * cryptographically verified.
 *
 * WHAT IT WRITES
 * This is a read/write probe against whatever DATABASE_URL points at. A
 * successful login updates `User.lastLoginAt` and appends `LOGIN` /
 * `LOGIN_FAILED` rows to `SystemAuditTrail` — that is the behaviour under test,
 * not an avoidable side effect. Nothing else is created or deleted.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const requireCjs = createRequire(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function section(title: string): void {
  console.log(`\n──────── ${title} ────────`);
}

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function info(text: string): void {
  console.log(`        · ${text}`);
}

function errText(e: unknown): string {
  const m = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  return m.split("\n")[0] ?? m;
}

/**
 * Makes `server-only` and (under the react-server condition) `react` importable
 * from a bare Node process by pre-seeding `require.cache`, and installs the
 * `AsyncLocalStorage` global that Next's server runtime normally provides.
 */
function neutraliseHostileModules(): void {
  // Next reads `globalThis.AsyncLocalStorage` ONCE, at the top of
  // client/components/async-local-storage.js, and silently substitutes a
  // FakeAsyncLocalStorage whose `.run()` throws "Invariant: AsyncLocalStorage
  // accessed in runtime where it is not available" when it is missing. Plain
  // Node keeps the class in `node:async_hooks`, not on globalThis, so this must
  // be set before any Next module is loaded.
  const g = globalThis as { AsyncLocalStorage?: unknown };
  g.AsyncLocalStorage ??= AsyncLocalStorage;

  const seed = (resolved: string, exports: unknown): void => {
    requireCjs.cache[resolved] = {
      id: resolved,
      filename: resolved,
      path: path.dirname(resolved),
      loaded: true,
      exports,
      children: [],
      paths: [],
    } as unknown as NodeModule;
  };

  const serverOnly = requireCjs.resolve("server-only");
  if (!serverOnly.endsWith("empty.js")) seed(serverOnly, {});

  const react = requireCjs.resolve("react");
  if (react.includes("shared-subset")) {
    const full: unknown = requireCjs(
      path.join(path.dirname(react), "cjs", "react.development.js"),
    );
    seed(react, full);
  }
}

/** Minimal shape of Next's per-request store that `headers()`/`cookies()` read. */
interface MutableCookies {
  get(name: string): { name: string; value: string } | undefined;
  set(...args: unknown[]): unknown;
  delete(...args: unknown[]): unknown;
}

interface AsyncStore<T> {
  run<R>(store: T, fn: () => R): R;
}

/** Builds a request scope and runs `fn` inside it, as a Server Action would. */
function withRequestScope<R>(
  forwardedFor: string,
  fn: (cookieSink: MutableCookies) => R,
): R {
  const { HeadersAdapter } = requireCjs(
    "next/dist/server/web/spec-extension/adapters/headers",
  ) as { HeadersAdapter: { seal(h: Headers): Headers } };
  const { RequestCookies, ResponseCookies } = requireCjs(
    "next/dist/server/web/spec-extension/cookies",
  ) as {
    RequestCookies: new (h: Headers) => unknown;
    ResponseCookies: new (h: Headers) => MutableCookies;
  };
  const { requestAsyncStorage } = requireCjs(
    "next/dist/client/components/request-async-storage.external",
  ) as { requestAsyncStorage: AsyncStore<unknown> };
  const { actionAsyncStorage } = requireCjs(
    "next/dist/client/components/action-async-storage.external",
  ) as { actionAsyncStorage: AsyncStore<unknown> };

  const responseHeaders = new Headers();
  const cookieSink = new ResponseCookies(responseHeaders);
  const store = {
    headers: HeadersAdapter.seal(new Headers({ "x-forwarded-for": forwardedFor })),
    cookies: new RequestCookies(new Headers()),
    mutableCookies: cookieSink,
    draftMode: { isEnabled: false },
  };

  // `isAction` makes `cookies()` hand back the *mutable* jar, which is what
  // `createSession()` needs in order to call `.set()`.
  return requestAsyncStorage.run(store, () =>
    actionAsyncStorage.run({ isAction: true, isAppRoute: false }, () => fn(cookieSink)),
  );
}

interface ActionFailure {
  success: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}
interface ActionSuccess {
  success: true;
  data: { redirectTo: string };
}
type LoginResult = ActionSuccess | ActionFailure;

async function main(): Promise<void> {
  console.log("login probe — real loginAction against the live database");

  neutraliseHostileModules();

  // Dynamic imports: these must happen AFTER the cache seeding above.
  const bcrypt = (await import("bcryptjs")).default;
  const { SignJWT, jwtVerify } = await import("jose");
  const { prisma } = await import("../src/lib/prisma");
  const { SESSION_COOKIE } = await import("../src/lib/auth-constants");
  const actions = await import("../src/server/actions/auth.actions");
  const loginAction = actions.loginAction as (i: {
    username: string;
    password: string;
  }) => Promise<LoginResult>;

  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;

  section("0 · preconditions");
  check("SEED_ADMIN_PASSWORD is set in .env", Boolean(adminPassword));
  check("JWT_SECRET is set and >= 32 chars", Boolean(jwtSecret && jwtSecret.length >= 32));
  if (!adminPassword || !jwtSecret) {
    console.log("\nCannot continue without SEED_ADMIN_PASSWORD and JWT_SECRET.");
    failed++;
    return;
  }

  const admin = await prisma.user.findUnique({
    where: { username: adminUsername },
    select: { id: true, username: true, passwordHash: true, isActive: true, role: true },
  });
  check(`seeded admin "${adminUsername}" exists in the database`, Boolean(admin));
  if (!admin) {
    console.log("\nCannot continue: run `npm run db:seed` first.");
    return;
  }
  info(`id=${admin.id} role=${admin.role} isActive=${admin.isActive}`);

  // ── 1 & 2 · bcrypt against the real stored hash ─────────────────────────────
  section("1/2 · bcrypt.compare against the stored passwordHash");
  info(`stored hash: ${admin.passwordHash.slice(0, 7)}… (${admin.passwordHash.length} chars)`);
  const rightPw = await bcrypt.compare(adminPassword, admin.passwordHash);
  check("correct SEED_ADMIN_PASSWORD compares TRUE", rightPw === true, `got ${rightPw}`);

  const wrongPw = await bcrypt.compare(`${adminPassword}-wrong`, admin.passwordHash);
  check("wrong password compares FALSE", wrongPw === false, `got ${wrongPw}`);

  // ── 3 · DECOY_HASH must be a well-formed bcrypt string ──────────────────────
  section("3 · DECOY_HASH (unknown-username path)");
  const DECOY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.q8n0PtPYQhbP8Yq9m8kK1lYQ0lM3z2i";
  const wellFormed = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(DECOY_HASH);
  check(
    "DECOY_HASH is a well-formed bcrypt hash",
    wellFormed,
    `len=${DECOY_HASH.length} (must be 60), prefix=${DECOY_HASH.slice(0, 7)}`,
  );
  let decoyOk = false;
  try {
    const decoyResult = await bcrypt.compare("anything", DECOY_HASH);
    decoyOk = decoyResult === false;
    check("bcrypt.compare(…, DECOY_HASH) resolves false without throwing", decoyOk, `got ${decoyResult}`);
  } catch (e) {
    check("bcrypt.compare(…, DECOY_HASH) resolves false without throwing", false, errText(e));
    info("REAL BUG: a malformed decoy makes every unknown-username login throw → 500.");
  }

  // ── 4 · JWT sign + verify round-trip ────────────────────────────────────────
  section("4 · JWT round-trip with the configured JWT_SECRET");
  try {
    const key = new TextEncoder().encode(jwtSecret);
    const token = await new SignJWT({ sub: admin.id, username: admin.username })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("bimmer-erp")
      .setAudience("bimmer-erp-web")
      .setExpirationTime("12h")
      .sign(key);
    const { payload } = await jwtVerify(token, key, {
      issuer: "bimmer-erp",
      audience: "bimmer-erp-web",
    });
    check("sign → verify round-trip succeeds", payload.sub === admin.id, `sub=${String(payload.sub)}`);
  } catch (e) {
    check("sign → verify round-trip succeeds", false, errText(e));
  }

  // ── 6 · the REAL loginAction, inside a real request scope ───────────────────
  // (numbered 6 in output order; item 5 runs last because it swaps .env aside)
  section("6 · loginAction end-to-end (real request scope, real DB writes)");

  // 6a · wrong password
  try {
    const res = await withRequestScope("203.0.113.11", () =>
      loginAction({ username: adminUsername, password: `${adminPassword}-wrong` }),
    );
    const ok = res.success === false && !res.error.includes("غير متوقع");
    check("wrong password → clean non-disclosing failure", ok, JSON.stringify(res));
  } catch (e) {
    check("wrong password → clean non-disclosing failure", false, errText(e));
  }

  // 6b · unknown username (exercises DECOY_HASH through the real action)
  try {
    const res = await withRequestScope("203.0.113.12", () =>
      loginAction({ username: "definitely-not-a-user", password: "irrelevant-but-long" }),
    );
    const ok = res.success === false && !res.error.includes("غير متوقع");
    check("unknown username → clean failure (DECOY_HASH path)", ok, JSON.stringify(res));
  } catch (e) {
    check("unknown username → clean failure (DECOY_HASH path)", false, errText(e));
  }

  // 6c · invalid input → zod field errors
  try {
    const res = await withRequestScope("203.0.113.13", () =>
      loginAction({ username: "ab", password: "short" }),
    );
    const ok = res.success === false && Boolean(res.fieldErrors);
    check("invalid input → zod fieldErrors, not a crash", ok, JSON.stringify(res));
  } catch (e) {
    check("invalid input → zod fieldErrors, not a crash", false, errText(e));
  }

  // 6d · the real thing: correct credentials, cookie captured and verified
  try {
    let capturedToken: string | undefined;
    const res = await withRequestScope("203.0.113.10", async (cookieSink) => {
      const r = await loginAction({ username: adminUsername, password: adminPassword });
      capturedToken = cookieSink.get(SESSION_COOKIE)?.value;
      return r;
    });
    check("correct credentials → success", res.success === true, JSON.stringify(res));
    check(`session cookie "${SESSION_COOKIE}" was actually set`, Boolean(capturedToken));
    if (capturedToken) {
      const { payload } = await jwtVerify(capturedToken, new TextEncoder().encode(jwtSecret), {
        issuer: "bimmer-erp",
        audience: "bimmer-erp-web",
      });
      check(
        "cookie JWT verifies and identifies the admin",
        payload.sub === admin.id,
        `sub=${String(payload.sub)} username=${String(payload.username)} role=${String(payload.role)}`,
      );
    }
    const after = await prisma.user.findUnique({
      where: { id: admin.id },
      select: { lastLoginAt: true },
    });
    check("lastLoginAt was written by the login transaction", Boolean(after?.lastLoginAt),
      `lastLoginAt=${after?.lastLoginAt?.toISOString() ?? "null"}`);
  } catch (e) {
    check("correct credentials → success", false, errText(e));
  }

  await prisma.$disconnect();

  // ── 5 · PrismaClient with DIRECT_URL genuinely absent (child process) ───────
  section("5 · PrismaClient with DIRECT_URL deleted (isolated child process)");
  runDirectUrlChild(process.env.DATABASE_URL ?? "", jwtSecret);
}

/**
 * Runs the DIRECT_URL check in a child process so it cannot contaminate this one.
 *
 * `.env` must be moved aside for the duration: Prisma Client re-reads it (via the
 * `schemaEnvPath` baked into the generated client) both on require AND inside the
 * PrismaClient constructor, which would silently put DIRECT_URL back and make the
 * check pass for the wrong reason. Moving it reproduces the Vercel case exactly —
 * platform env vars only, no .env file on disk. Restored in `finally`.
 */
function runDirectUrlChild(databaseUrl: string, jwtSecret: string): void {
  const envPath = path.join(PROJECT_ROOT, ".env");
  const backupPath = path.join(PROJECT_ROOT, ".env.login-probe-backup");

  if (fs.existsSync(backupPath)) {
    check("temporarily move .env aside", false, `${backupPath} already exists — refusing to overwrite`);
    return;
  }

  const childSource = [
    'const out = {};',
    'out.absentAtStart = !("DIRECT_URL" in process.env);',
    'const run = async () => {',
    '  try {',
    '    const { PrismaClient } = require("@prisma/client");',
    '    out.absentAfterRequire = !("DIRECT_URL" in process.env);',
    '    const bare = new PrismaClient();',
    '    out.absentAfterConstruct = !("DIRECT_URL" in process.env);',
    '    await bare.$queryRawUnsafe("SELECT 1");',
    '    out.bare = "ok";',
    '    await bare.$disconnect();',
    '  } catch (e) { out.bare = "THREW " + e.constructor.name + ": " + String(e.message).split("\\n")[0]; }',
    '  try {',
    '    const mod = require("./src/lib/prisma.ts");',
    '    out.guardFired = process.env.DIRECT_URL === process.env.DATABASE_URL;',
    '    await mod.prisma.$queryRawUnsafe("SELECT 1");',
    '    out.app = "ok";',
    '    await mod.prisma.$disconnect();',
    '  } catch (e) { out.app = "THREW " + e.constructor.name + ": " + String(e.message).split("\\n")[0]; }',
    '  console.log("__PROBE__" + JSON.stringify(out));',
    '};',
    'run();',
  ].join("\n");

  // Exactly the three variables the Vercel deployment had — no DIRECT_URL.
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    NEXT_PUBLIC_CURRENCY: process.env.NEXT_PUBLIC_CURRENCY ?? "ج.م",
  };

  let moved = false;
  try {
    if (fs.existsSync(envPath)) {
      fs.renameSync(envPath, backupPath);
      moved = true;
    }
    const res = spawnSync(process.execPath, ["-r", "tsx/cjs", "-e", childSource], {
      cwd: PROJECT_ROOT,
      env: childEnv,
      encoding: "utf8",
      timeout: 60_000,
    });
    const stdout = res.stdout ?? "";
    const marker = stdout.split("__PROBE__")[1];
    if (!marker) {
      check("child process reported a result", false, errText(res.error ?? (res.stderr || "no output")));
      if (res.stderr) info(res.stderr.split("\n").slice(0, 4).join(" | "));
      return;
    }
    const out = JSON.parse(marker.trim()) as Record<string, unknown>;
    check("DIRECT_URL is genuinely absent in the child", out.absentAtStart === true);
    check(
      "DIRECT_URL stays absent after requiring/constructing @prisma/client",
      out.absentAfterRequire === true && out.absentAfterConstruct === true,
      `afterRequire=${String(out.absentAfterRequire)} afterConstruct=${String(out.absentAfterConstruct)}`,
    );
    check(
      "bare new PrismaClient() constructs AND queries without DIRECT_URL",
      out.bare === "ok",
      String(out.bare),
    );
    check(
      "src/lib/prisma.ts (FIX 1) constructs AND queries without DIRECT_URL",
      out.app === "ok",
      String(out.app),
    );
    check("FIX 1 guard set DIRECT_URL = DATABASE_URL", out.guardFired === true);
    if (out.bare === "ok") {
      info("NOTE: the bare client also works, so Prisma Client never resolves");
      info("`directUrl`. A missing DIRECT_URL was therefore NOT the cause of the 500.");
    }
  } finally {
    if (moved) {
      fs.renameSync(backupPath, envPath);
      info(".env restored");
    }
  }
}

main()
  .catch((e) => {
    failed++;
    console.error("\nprobe crashed:", e);
  })
  .finally(() => {
    section("SUMMARY");
    console.log(`  passed: ${passed}`);
    console.log(`  failed: ${failed}`);
    if (failed > 0) process.exitCode = 1;
    // ioredis is never touched here, but be explicit rather than relying on an
    // empty event loop to end the process.
    process.exit(failed > 0 ? 1 : 0);
  });
