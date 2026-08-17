import { NextResponse, type NextRequest } from "next/server";
// Imported from the subpath, not the "jose" barrel: the barrel re-exports the
// JWE encrypt/decrypt entrypoints, which pull in lib/deflate.js. That module
// uses CompressionStream/DecompressionStream, which the Edge Runtime does not
// support (it warns on every build), and this gate never decrypts a JWE, so
// the code is unreachable here. The subpath bundles only the verify path.
import { jwtVerify } from "jose/jwt/verify";
import { SESSION_COOKIE } from "@/lib/auth-constants";
import { LOGIN_PATH, loginRedirectUrl } from "@/lib/safe-redirect";

/**
 * Edge gate: verifies the session cookie before any page renders, and garbage-
 * collects cookies that can no longer be verified.
 *
 * WHY IT VERIFIES INSTEAD OF SNIFFING
 * It used to test only that the cookie EXISTED. For anyone holding an expired
 * cookie that produced an inescapable redirect loop:
 *
 *   GET /login → cookie present → 307 /  → (app)/layout `requireUser()` throws
 *              AuthError → redirect /login → cookie STILL present → 307 / → …
 *
 * The user could never reach the login form, so they could never recover.
 * `jose` runs on the Edge runtime, so this gate can verify the signature
 * properly and — the part that actually breaks the loop — DELETE the cookie
 * when verification fails. One redirect later the stale cookie is gone and
 * `/login` renders normally.
 *
 * VERIFICATION NOW HAPPENS IN TWO PLACES, DELIBERATELY
 * This is the fast gate: signature, algorithm, issuer, audience, expiry —
 * everything decidable without I/O — plus cookie garbage collection.
 * `requireUser()` remains THE AUTHORITY, because only it reaches the database
 * and can check `isActive`: a cryptographically perfect cookie belonging to an
 * account deactivated one second ago must still be refused, and no Edge check
 * can know that. Passing this gate is never authorisation.
 *
 * IT MUST NEVER THROW
 * An exception in middleware is a 500 on EVERY request — including `/login`
 * itself, which would take the entire app down and, again, leave no way back
 * in. Every failure path below degrades to "unauthenticated" instead.
 */
const PUBLIC_PATHS = [LOGIN_PATH];
/** Probed by Docker/orchestrators without a session — must bypass the gate entirely. */
const OPEN_PATHS = ["/api/health"];

/** `none` = no cookie; `stale` = present but unverifiable; `valid` = verified. */
type SessionState = "none" | "stale" | "valid";

async function inspectSession(token: string | undefined): Promise<SessionState> {
  if (!token) return "none";
  try {
    const secret = process.env.JWT_SECRET;
    // Mirrors `secretKey()` in src/lib/auth.ts, but degrades instead of
    // throwing: a deploy missing JWT_SECRET must still be able to serve the
    // login page rather than 500 on every route. A cookie this deployment
    // cannot verify is unusable by it, so it is treated as stale and dropped.
    if (!secret || secret.length < 32) return "stale";
    await jwtVerify(token, new TextEncoder().encode(secret), {
      // Pinned explicitly: refuses `alg` substitution outright.
      algorithms: ["HS256"],
      issuer: "bimmer-erp",
      audience: "bimmer-erp-web",
    });
    return "valid";
  } catch {
    // Expired, tampered, wrong secret, wrong alg, malformed — indistinguishable
    // here and treated identically. Never rethrow (see the doc comment).
    return "stale";
  }
}

/**
 * Deletes the dead cookie. This is the line that ends the loop.
 *
 * `secure` is OMITTED on purpose: browsers reject a `Secure` cookie delivered
 * over plain HTTP ("Strict Secure Cookies"), so including it would make the
 * deletion silently fail — and the loop survive — on the self-hosted HTTP
 * deployment path from the Dockerfile. The value is empty; there is nothing
 * left to protect.
 *
 * `path: "/"` MUST match what `createSession()` used. A Set-Cookie without an
 * explicit path inherits the request's default path (`/inventory` for a request
 * to `/inventory/parts`), which would not overwrite the `Path=/` cookie and the
 * stale value would stay put. Both `Max-Age=0` and `Expires=<epoch>` are sent
 * for the benefit of clients that honour only one of them.
 */
function clearStaleCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (OPEN_PATHS.some((p) => pathname === p)) return NextResponse.next();

  const state = await inspectSession(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /** Attaches the cookie deletion to whatever response we return. */
  const finish = (response: NextResponse): NextResponse =>
    state === "stale" ? clearStaleCookie(response) : response;

  // A Server Action POSTs to the URL it was invoked from and identifies itself
  // with the `Next-Action` header. Answering it with a 3xx aborts the action —
  // the client gets a broken navigation instead of a result, and whatever the
  // user had typed is lost. So never redirect one; let it through, still
  // dropping a dead cookie on the way out.
  //
  // This is safe because Server Actions do not depend on this gate for
  // authorisation: every one of them calls `requireUser()` / `requirePermission()`,
  // which throws AuthError/ForbiddenError and is converted into a proper
  // `{ success: false, error }` result the form renders inline. For an expired
  // session mid-action that error IS the correct outcome, and strictly better
  // than a redirect.
  if (request.method === "POST" && request.headers.get("next-action")) {
    return finish(NextResponse.next());
  }

  if (state !== "valid" && !isPublic) {
    // `next` is attached only if the shared sanitiser approves the path, and
    // never for `/`. See src/lib/safe-redirect.ts.
    return finish(NextResponse.redirect(loginRedirectUrl(new URL(request.url), pathname)));
  }

  if (state === "valid" && isPublic) {
    const url = new URL(request.url);
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return finish(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
