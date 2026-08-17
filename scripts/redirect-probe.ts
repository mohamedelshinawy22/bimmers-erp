/**
 * Redirect-loop probe — proves the infinite `/login ↔ /` redirect loop is dead.
 *
 *   npx tsx --conditions=react-server scripts/redirect-probe.ts
 *
 * WHAT WAS BROKEN
 * The Edge middleware used to test only that `bimmer_session` EXISTED. A holder
 * of an expired-but-well-formed cookie was therefore trapped:
 *
 *   GET /login → cookie present → 307 /  → (app)/layout requireUser() throws
 *              AuthError → redirect /login → cookie STILL present → 307 / → …
 *
 * Nothing in that cycle could delete the cookie, so the user could never reach
 * the login form and never recover. Production also emitted
 * `/login?next=%2Flogin%5D(https%3A%2F%2Fx.com)` — a hostile `next` that both
 * fed the recursion and carried an absolute URL.
 *
 * TWO PARTS
 * PART 1 exercises `src/lib/safe-redirect.ts` directly as a table test: the
 * shared sanitiser is the single allow-list both the Edge middleware and the
 * client login form import, so its verdicts are the whole contract.
 *
 * PART 2 refuses to take the middleware's word for anything and drives a REAL
 * production server over REAL HTTP with REAL forged cookies, signed with the
 * deployment's own JWT_SECRET and the exact claims `src/lib/auth.ts` mints. The
 * central assertion is item 4: `curl -L --max-redirs 5` carrying an expired
 * cookie must terminate. Before the fix that chain never ended.
 *
 * READ-ONLY. Forges cookies locally, never logs in, writes nothing to the
 * database, and touches no application code.
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { LOGIN_PATH, loginRedirectUrl, safeNextPath } from "../src/lib/safe-redirect";

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

/** `JSON.stringify` that renders `undefined` instead of dropping it. */
function show(v: unknown): string {
  return v === undefined ? "undefined" : JSON.stringify(v);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 1 — safeNextPath / loginRedirectUrl table test
// ════════════════════════════════════════════════════════════════════════════

/** `[label, input]` — the label exists because several inputs are unprintable. */
type Case = [label: string, input: string | null | undefined];

const LONG_PATH = `/${"a".repeat(599)}`; // 600 chars, over MAX_LENGTH (512)

const MUST_REJECT: Case[] = [
  ["//evil.com (protocol-relative)", "//evil.com"],
  ["/\\evil.com (backslash-disguised protocol-relative)", "/\\evil.com"],
  ["https://evil.com (absolute)", "https://evil.com"],
  ["http://evil.com (absolute)", "http://evil.com"],
  ["/login (recursion seed)", "/login"],
  ["/login?x=1", "/login?x=1"],
  ["/login/reset", "/login/reset"],
  ["/login](https://x.com) (the production payload)", "/login](https://x.com)"],
  ["%2Flogin%5D(https%3A%2F%2Fx.com) (encoded payload)", "%2Flogin%5D(https%3A%2F%2Fx.com)"],
  ["%2F%2Fevil.com (encoded protocol-relative)", "%2F%2Fevil.com"],
  ["/path\\nX (embedded newline)", "/path\nX"],
  ["/a://b (scheme smuggled into a path)", "/a://b"],
  ['"" (empty)', ""],
  ['"   " (whitespace only)', "   "],
  ["null", null],
  ["undefined", undefined],
  ['"pos" (no leading slash)', "pos"],
  [`600-char path (/${"a".repeat(6)}… len=${LONG_PATH.length})`, LONG_PATH],
  ["/%zz (malformed escape)", "/%zz"],
];

const MUST_ACCEPT: string[] = [
  "/",
  "/pos",
  "/inventory",
  "/inventory?chassis=E46",
  "/accounts?type=SUPPLIER&page=2",
  "/treasury?voucher=RECEIPT",
];

function partOne(): void {
  section("PART 1.a · safeNextPath MUST return null");
  for (const [label, input] of MUST_REJECT) {
    let actual: string | null | undefined;
    try {
      actual = safeNextPath(input);
      check(`reject ${label}`, actual === null, `returned ${show(actual)}`);
    } catch (e) {
      // Throwing is itself a defect: the sanitiser is called on every
      // unauthenticated request and must never be able to 500 the Edge.
      check(`reject ${label}`, false, `THREW ${errText(e)}`);
    }
  }

  section("PART 1.b · safeNextPath MUST return the input unchanged");
  for (const input of MUST_ACCEPT) {
    try {
      const actual = safeNextPath(input);
      check(`accept ${input}`, actual === input, `returned ${show(actual)}`);
    } catch (e) {
      check(`accept ${input}`, false, `THREW ${errText(e)}`);
    }
  }

  section("PART 1.c · loginRedirectUrl");
  {
    const u = loginRedirectUrl(new URL("https://x.tld/pos"), "/pos");
    info(`loginRedirectUrl("https://x.tld/pos", "/pos") → ${u.toString()}`);
    check(`pathname is ${LOGIN_PATH}`, u.pathname === LOGIN_PATH, `got ${show(u.pathname)}`);
    check("next=/pos is present", u.searchParams.get("next") === "/pos", `next=${show(u.searchParams.get("next"))}`);
  }
  {
    const u = loginRedirectUrl(new URL("https://x.tld/"), "/");
    info(`loginRedirectUrl("https://x.tld/", "/") → ${u.toString()}`);
    check(`pathname is ${LOGIN_PATH}`, u.pathname === LOGIN_PATH, `got ${show(u.pathname)}`);
    check(
      "NO next param for the root path",
      !u.searchParams.has("next"),
      `search=${show(u.search)}`,
    );
  }
  {
    const u = loginRedirectUrl(new URL("https://x.tld/a?b=c"), "//evil.com");
    info(`loginRedirectUrl("https://x.tld/a?b=c", "//evil.com") → ${u.toString()}`);
    check(`pathname is ${LOGIN_PATH}`, u.pathname === LOGIN_PATH, `got ${show(u.pathname)}`);
    check("NO next param for a hostile value", !u.searchParams.has("next"), `search=${show(u.search)}`);
    check(
      "the original ?b=c is GONE",
      !u.searchParams.has("b") && !u.search.includes("b=c"),
      `search=${show(u.search)}`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PART 2 — real HTTP against a real production server
// ════════════════════════════════════════════════════════════════════════════

/** Verbatim from the task: a syntactically plausible but bogus action id. */
const NEXT_ACTION_ID = "00000000000000000000000000000000000000";

interface Curl {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function curl(args: string[]): Curl {
  // `-g` (globoff) because probe URLs contain `(`/`)` and encoded brackets that
  // curl would otherwise treat as its own URL-glob syntax.
  const res = spawnSync("curl", ["-sS", "-g", ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return { exitCode: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const META = "\n__META__";

interface HeadProbe extends Curl {
  status: number;
  headers: string;
}

/** One request, headers captured, body discarded, redirects NOT followed. */
function headProbe(url: string, extra: string[] = []): HeadProbe {
  const r = curl(["-o", "/dev/null", "-D", "-", "-w", `${META}%{http_code}`, ...extra, url]);
  const idx = r.stdout.lastIndexOf(META);
  const headers = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
  const status = idx >= 0 ? Number(r.stdout.slice(idx + META.length).trim()) : NaN;
  return { ...r, headers, status };
}

/** All values of one header from a raw dump, in order. Case-insensitive. */
function headerValues(dump: string, name: string): string[] {
  const out: string[] = [];
  for (const line of dump.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    if (line.slice(0, at).trim().toLowerCase() === name.toLowerCase()) {
      out.push(line.slice(at + 1).trim());
    }
  }
  return out;
}

function headerValue(dump: string, name: string): string | undefined {
  return headerValues(dump, name)[0];
}

async function freePort(from: number): Promise<number> {
  for (let port = from; port < from + 40; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`no free port in ${from}..${from + 39}`);
}

function portHolders(port: number): string[] {
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let supervisor: ChildProcess | null = null;
let serverPort = 0;

/**
 * Tears the server down. Sends SIGTERM to the supervisor's whole process GROUP
 * (the shell created it with setsid via `detached`), which fires the shell's
 * `trap` and takes npm and Next with it. Anything still holding the port
 * afterwards is killed by pid. Safe to call repeatedly.
 */
function stopServerSync(): void {
  if (supervisor?.pid) {
    for (const sig of ["SIGTERM", "SIGKILL"] as const) {
      try {
        process.kill(-supervisor.pid, sig);
      } catch {
        /* group already gone */
      }
      if (sig === "SIGTERM") spawnSync("sleep", ["0.4"]);
    }
    supervisor = null;
  }
  if (serverPort) {
    const holders = portHolders(serverPort);
    if (holders.length) spawnSync("kill", ["-9", ...holders]);
  }
}

process.on("exit", stopServerSync);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    stopServerSync();
    process.exit(130);
  });
}

/**
 * The `trap` the task asks for lives here, in the supervising shell, because a
 * trap is the only teardown that also fires when this probe is killed outright.
 * `wait` keeps the shell alive as the group leader for as long as Next runs.
 */
const SUPERVISOR = `#!/usr/bin/env bash
set -uo pipefail
PORT="$1"
LOG="$2"
cleanup() {
  trap - EXIT INT TERM HUP
  kill -TERM -$$ 2>/dev/null || true
  sleep 0.4
  kill -KILL -$$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP
npm run start -- -H 127.0.0.1 -p "$PORT" >>"$LOG" 2>&1 &
wait $!
`;

async function partTwo(): Promise<void> {
  // ── build ────────────────────────────────────────────────────────────────
  section("PART 2.0 · production build");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: 15 * 60_000,
  });
  const buildOut = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  check("npm run build exits 0", build.status === 0, `exit=${String(build.status)}`);
  if (build.status !== 0) {
    for (const line of buildOut.split("\n").slice(-25)) console.log(`        ${line}`);
    return;
  }
  const mw = /^.*?Middleware\s+([\d.]+)\s*(kB|MB)/m.exec(buildOut);
  info(mw ? `Middleware bundle: ${mw[1]} ${mw[2]}` : "Middleware size line not found in build output");

  // ── forge cookies ────────────────────────────────────────────────────────
  section("PART 2.1 · forged session cookies (real JWT_SECRET, real claims)");
  const jwtSecret = process.env.JWT_SECRET;
  check("JWT_SECRET is set and >= 32 chars", Boolean(jwtSecret && jwtSecret.length >= 32));
  if (!jwtSecret || jwtSecret.length < 32) return;

  const { prisma } = await import("../src/lib/prisma");
  const { SESSION_COOKIE } = await import("../src/lib/auth-constants");
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const admin = await prisma.user.findUnique({
    where: { username: adminUsername },
    select: { id: true, username: true, fullName: true, role: true, isActive: true },
  });
  check(`seeded admin "${adminUsername}" exists`, Boolean(admin));
  if (!admin) {
    info("run `npm run db:seed` first");
    return;
  }
  info(`id=${admin.id} role=${admin.role} isActive=${admin.isActive}`);

  const key = new TextEncoder().encode(jwtSecret);
  /** Same claim set as `createSession()` in src/lib/auth.ts. */
  const forge = (exp: string) =>
    new SignJWT({
      sub: admin.id,
      username: admin.username,
      fullName: admin.fullName,
      role: admin.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("bimmer-erp")
      .setAudience("bimmer-erp-web")
      .setExpirationTime(exp)
      .sign(key);

  const expiredToken = await forge("-1h");
  const validToken = await forge("1h");
  check("expired cookie signed (exp = -1h)", expiredToken.length > 0, `${expiredToken.slice(0, 24)}… (${expiredToken.length} chars)`);
  check("valid cookie signed (exp = +1h)", validToken.length > 0, `${validToken.slice(0, 24)}… (${validToken.length} chars)`);
  const expiredCookie = `${SESSION_COOKIE}=${expiredToken}`;
  const validCookie = `${SESSION_COOKIE}=${validToken}`;

  // ── start the server ─────────────────────────────────────────────────────
  section("PART 2.2 · production server");
  serverPort = await freePort(3210);
  const base = `http://127.0.0.1:${serverPort}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-probe-"));
  const supPath = path.join(tmp, "serve.sh");
  const logPath = path.join(tmp, "server.log");
  fs.writeFileSync(supPath, SUPERVISOR, { mode: 0o755 });

  supervisor = spawn("bash", [supPath, String(serverPort), logPath], {
    cwd: PROJECT_ROOT,
    detached: true, // own process group, so the trap can kill the whole tree
    stdio: "ignore",
  });
  supervisor.unref();
  info(`supervisor pid=${supervisor.pid} port=${serverPort} log=${logPath}`);

  try {
    let ready = false;
    let healthBody = "";
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const r = curl(["-m", "5", "-w", `${META}%{http_code}`, `${base}/api/health`]);
      const idx = r.stdout.lastIndexOf(META);
      const code = idx >= 0 ? r.stdout.slice(idx + META.length).trim() : "000";
      if (code !== "000" && code !== "") {
        ready = true;
        healthBody = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
        info(`/api/health responded ${code}`);
        info(`body: ${healthBody.slice(0, 300)}`);
        break;
      }
      await sleep(500);
    }
    check("server became ready on /api/health", ready, `${base}/api/health`);
    if (!ready) {
      info("server log tail:");
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "(no log)";
      for (const line of log.split("\n").slice(-25)) console.log(`        ${line}`);
      return;
    }
    check(
      "health reports JWT_SECRET set (server shares the probe's secret source)",
      healthBody.includes('"JWT_SECRET":"set"'),
      healthBody.includes('"JWT_SECRET"') ? "see body above" : "JWT_SECRET not reported",
    );

    // ── 1 ── GET / with no cookie ─────────────────────────────────────────
    section("PART 2.3 · [1] GET / with NO cookie");
    {
      const r = headProbe(`${base}/`);
      const loc = headerValue(r.headers, "location");
      info(`status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      check("status is 307", r.status === 307, `got ${r.status}`);
      const ok = typeof loc === "string";
      const u = ok ? new URL(loc, base) : null;
      check("Location path ends in /login", u?.pathname === LOGIN_PATH, `path=${show(u?.pathname)}`);
      check("Location carries NO next= parameter", ok && !loc.includes("next="), `Location=${show(loc)}`);
    }

    // ── 2 ── GET /pos with no cookie ──────────────────────────────────────
    section("PART 2.4 · [2] GET /pos with NO cookie");
    {
      const r = headProbe(`${base}/pos`);
      const loc = headerValue(r.headers, "location");
      info(`status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      check("status is 307", r.status === 307, `got ${r.status}`);
      const u = typeof loc === "string" ? new URL(loc, base) : null;
      check("Location path is /login", u?.pathname === LOGIN_PATH, `path=${show(u?.pathname)}`);
      check("next IS present", u?.searchParams.has("next") === true, `search=${show(u?.search)}`);
      check("next decodes to /pos", u?.searchParams.get("next") === "/pos", `next=${show(u?.searchParams.get("next"))}`);
      check(
        "Location is literally /login?next=%2Fpos",
        typeof loc === "string" && loc.endsWith("/login?next=%2Fpos"),
        `Location=${show(loc)}`,
      );
    }

    // ── 3 ── THE LOOP: expired cookie, single request ─────────────────────
    section("PART 2.5 · [3] LOOP TEST — GET / with an EXPIRED but correctly signed cookie");
    {
      const r = headProbe(`${base}/`, ["-b", expiredCookie]);
      const loc = headerValue(r.headers, "location");
      const cookies = headerValues(r.headers, "set-cookie");
      info(`status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      if (cookies.length === 0) info("Set-Cookie: (absent)");
      for (const c of cookies) info(`Set-Cookie: ${c}`);
      check("(a) status is 307", r.status === 307, `got ${r.status}`);
      const u = typeof loc === "string" ? new URL(loc, base) : null;
      check("(a) redirect target is /login", u?.pathname === LOGIN_PATH, `path=${show(u?.pathname)}`);
      const cleared = cookies.filter(
        (c) =>
          c.startsWith(`${SESSION_COOKIE}=;`) ||
          (c.includes(SESSION_COOKIE) &&
            (/max-age=0\b/i.test(c) || /expires=thu,\s*01\s*jan\s*1970/i.test(c))),
      );
      check(
        `(b) Set-Cookie CLEARS ${SESSION_COOKIE} — the line that ends the loop`,
        cleared.length > 0,
        cleared.length ? `verbatim: ${cleared.join(" || ")}` : `saw ${cookies.length} Set-Cookie header(s)`,
      );
    }

    // ── 4 ── THE CENTRAL ASSERTION: the chain must terminate ──────────────
    section("PART 2.6 · [4] LOOP TEST — expired cookie, curl -L --max-redirs 5");
    for (const variant of ["static cookie header (client ignores the deletion)", "cookie jar (client honours Set-Cookie)"] as const) {
      const jar = path.join(tmp, `jar-${variant.startsWith("cookie jar") ? "honour" : "ignore"}.txt`);
      const cookieArgs = variant.startsWith("cookie jar")
        ? (() => {
            // Netscape jar: domain, tailmatch, path, secure, expiry, name, value
            fs.writeFileSync(jar, `127.0.0.1\tFALSE\t/\tFALSE\t0\t${SESSION_COOKIE}\t${expiredToken}\n`);
            return ["-b", jar, "-c", jar];
          })()
        : ["-b", expiredCookie];
      const r = curl([
        "-o",
        "/dev/null",
        "-L",
        "--max-redirs",
        "5",
        "-w",
        `${META}%{http_code} %{url_effective} redirects=%{num_redirects}`,
        ...cookieArgs,
        `${base}/`,
      ]);
      const idx = r.stdout.lastIndexOf(META);
      const meta = idx >= 0 ? r.stdout.slice(idx + META.length).trim() : "(no meta)";
      info(`variant: ${variant}`);
      info(`curl exit=${r.exitCode}  ${meta}`);
      if (r.stderr.trim()) info(`stderr: ${r.stderr.trim()}`);
      const looped = /maximum\s*\(?\d*\)?\s*redirects? followed/i.test(r.stderr) || r.exitCode === 47;
      check(
        `chain TERMINATES — no "Maximum (5) redirects followed" [${variant}]`,
        !looped,
        looped ? `curl exit=${r.exitCode} stderr=${r.stderr.trim()}` : `final: ${meta}`,
      );
      check(`curl exits 0 [${variant}]`, r.exitCode === 0, `exit=${r.exitCode}`);
    }

    // ── 5 ── the production payload as a next value ───────────────────────
    section("PART 2.7 · [5] GET /login?next=%2Flogin%5D(https%3A%2F%2Fx.com)");
    {
      const url = `${base}/login?next=%2Flogin%5D(https%3A%2F%2Fx.com)`;
      const r = headProbe(url);
      const loc = headerValue(r.headers, "location");
      info(`status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      const redirects = r.status >= 300 && r.status < 400;
      check(
        "does NOT redirect to anything containing x.com",
        !(redirects && (loc ?? "").includes("x.com")),
        `status=${r.status} Location=${show(loc)}`,
      );
      check(
        "does NOT redirect to a nested /login?next=",
        !(redirects && /\/login\?next=/i.test(loc ?? "")),
        `status=${r.status} Location=${show(loc)}`,
      );
      check("login page renders (200, no redirect at all)", r.status === 200 && loc === undefined, `status=${r.status} Location=${show(loc)}`);
    }

    // ── 6 ── sanity with a valid cookie ──────────────────────────────────
    section("PART 2.8 · [6] sanity with a VALID freshly signed cookie");
    {
      const r = headProbe(`${base}/login`, ["-b", validCookie]);
      const loc = headerValue(r.headers, "location");
      info(`GET /login  status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      check("GET /login → 307", r.status === 307, `got ${r.status}`);
      const u = typeof loc === "string" ? new URL(loc, base) : null;
      check("GET /login → redirects to /", u?.pathname === "/", `path=${show(u?.pathname)}`);
      check("GET /login → NO next param", !(u?.searchParams.has("next") ?? false), `search=${show(u?.search)}`);
      const cleared = headerValues(r.headers, "set-cookie").filter((c) => c.includes(`${SESSION_COOKIE}=;`));
      check("a VALID cookie is NOT cleared", cleared.length === 0, cleared.join(" || ") || "no clearing Set-Cookie");
    }
    {
      const r = headProbe(`${base}/pos`, ["-b", validCookie]);
      info(`GET /pos  status=${r.status}`);
      const loc = headerValue(r.headers, "location");
      if (loc) info(`Location: ${loc}`);
      check("GET /pos → 200", r.status === 200, `got ${r.status}${loc ? ` Location=${loc}` : ""}`);
    }

    // ── 7 ── Server Action pass-through ──────────────────────────────────
    section("PART 2.9 · [7] Server Action POST must NOT be redirected");
    {
      const r = headProbe(`${base}/login`, [
        "-X",
        "POST",
        "-H",
        `Next-Action: ${NEXT_ACTION_ID}`,
        "-H",
        "Content-Type: text/plain;charset=UTF-8",
        "--data-raw",
        "[]",
      ]);
      const loc = headerValue(r.headers, "location");
      info(`status=${r.status}`);
      info(`Location: ${loc ?? "(absent)"}`);
      check(
        "status is NOT 307/308 — middleware let the Server Action through",
        r.status !== 307 && r.status !== 308,
        `got ${r.status}${loc ? ` Location=${loc}` : ""}`,
      );
    }

    section("PART 2.10 · server log (last 15 lines)");
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "(no log)";
    for (const line of log.split("\n").filter(Boolean).slice(-15)) console.log(`        ${line}`);
  } finally {
    stopServerSync();
    let free = false;
    for (let i = 0; i < 20 && !free; i++) {
      if (portHolders(serverPort).length === 0) free = true;
      else spawnSync("sleep", ["0.25"]);
    }
    section("PART 2.11 · teardown");
    check(`port ${serverPort} released`, free, free ? "no listener remains" : `still held by ${portHolders(serverPort).join(",")}`);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("redirect probe — safeNextPath table test + real-HTTP proof the login loop is gone");
  partOne();
  await partTwo();
}

main()
  .catch((e) => {
    failed++;
    console.error("\nprobe crashed:", e);
  })
  .finally(() => {
    stopServerSync();
    section("SUMMARY");
    console.log(`  passed: ${passed}`);
    console.log(`  failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  });
