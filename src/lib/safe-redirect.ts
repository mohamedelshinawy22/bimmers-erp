/**
 * Strict same-origin redirect sanitiser, shared by the Edge middleware and the
 * client login form.
 *
 * MUST STAY DEPENDENCY-FREE — no `server-only`, no Node builtins, no Prisma —
 * so the Edge runtime can import it. Same contract as `auth-constants.ts`.
 *
 * WHY THIS EXISTS
 * Production emitted `/login?next=%2Flogin%5D(https%3A%2F%2F…)`, which decodes
 * to `/login](https://…` — markdown link syntax that leaked into the request
 * path and was then interpolated into `next=` by nothing stronger than
 * `encodeURIComponent`. Encoding is not validation: it made a hostile value
 * transport-safe while leaving it semantically hostile. The value also began
 * with `/login`, which is the shape that feeds a recursive
 * `/login?next=/login` redirect.
 *
 * A single allow-list, imported by every producer AND consumer of `next`, is
 * the only arrangement in which the client and the edge cannot drift apart.
 * Everything not provably a local path is discarded — the caller then falls
 * back to `/`, so over-strictness costs a redirect, never an error.
 */

export const LOGIN_PATH = "/login";

/** Longer than any route in this app; bounds per-request work on hostile input. */
const MAX_LENGTH = 512;

/**
 * Control characters (`\x00`-`\x1F`, `\x7F`), backslash, and any whitespace
 * (space, `\n`, `\r`, `\t`, unicode spaces).
 *
 * Backslash earns its place twice: browsers normalise `\` to `/` while parsing
 * URLs, so `/\evil.tld` is a protocol-relative URL in a disguise that a naive
 * `startsWith("//")` test walks straight past. Control characters enable
 * header/log splitting.
 */
const FORBIDDEN = /[\u0000-\u001F\u007F\\\s]/;

/** Every rule, applied to one concrete string. Called once raw, once decoded. */
function passes(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > MAX_LENGTH) return false;

  // Must be a local path, and exactly one leading slash.
  if (candidate[0] !== "/") return false;

  // `//host` and `/\host` resolve to a FOREIGN origin — a textbook open
  // redirect, which on a login page is a credential-phishing primitive.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return false;

  // Bouncing back to the login page is never a useful destination, and is the
  // exact shape behind the recursive `/login?next=/login`. Rejecting the whole
  // `/login…` prefix — not just the exact path — also kills `/login?x=1` and
  // `/login](https://x.com)`. Deliberately broader than strictly necessary: no
  // route in this app begins with those six characters, so nothing legitimate
  // is lost.
  if (candidate.startsWith(LOGIN_PATH)) return false;

  if (FORBIDDEN.test(candidate)) return false;

  // An absolute URL smuggled inside something claiming to be a path — exactly
  // how `/login](https://x.com)` arrived. A genuine path never needs a scheme.
  if (candidate.includes("://")) return false;

  return true;
}

/**
 * @param raw the untrusted `next` value (query param, or a path being proposed
 *            as one).
 * @returns the value, trimmed and otherwise unchanged, when it is a safe
 *          same-origin destination; otherwise `null`, meaning "attach no
 *          `next` param at all / navigate to the default".
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (!passes(candidate)) return null;

  // ONE decode pass, then re-apply every rule. The value observed in
  // production was percent-encoded, so `%2F%2Fevil.tld` has to be judged as
  // the `//evil.tld` it becomes rather than the inert literal it looks like.
  // A single pass is the right depth: browsers decode once, so a value needing
  // two passes to look hostile is not a working attack — but it is also not a
  // path this app ever generates, and the whitespace/backslash rules below
  // reject the residue anyway.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Malformed escape (`%zz`, a trailing `%`). Input we cannot even parse is
    // input we do not trust.
    return null;
  }
  if (!passes(decoded)) return null;

  return candidate;
}

/**
 * Builds the canonical login redirect target.
 *
 * Sets the pathname to `/login` and CLEARS the query string first, so nothing
 * the hostile request carried can survive; only then is a `next` added, and
 * only when `safeNextPath` approves it.
 *
 * @param base any absolute URL from the current request — used solely for
 *             origin/protocol; its path and query are discarded.
 * @param from the path the user was trying to reach.
 */
export function loginRedirectUrl(base: URL, from?: string | null): URL {
  const url = new URL(base.toString());
  url.pathname = LOGIN_PATH;
  url.search = "";

  const next = safeNextPath(from);
  // `/` is already the post-login destination, so `next=/` is pure noise on
  // every anonymous hit of the root — never emit it.
  if (next !== null && next !== "/") {
    url.searchParams.set("next", next);
  }
  return url;
}
