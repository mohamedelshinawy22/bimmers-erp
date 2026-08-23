import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant-routing";

/**
 * Singleton Prisma client.
 * Next.js dev mode hot-reloads modules; without the global cache every reload
 * would open a brand new connection pool and exhaust PostgreSQL max_connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Keep `DIRECT_URL` resolvable when only `DATABASE_URL` is configured.
 *
 * `directUrl` in schema.prisma exists for `prisma migrate` only: DDL must not
 * traverse PgBouncer. Prisma Client itself reads `url` and never resolves
 * `directUrl`, so a runtime with only DATABASE_URL set does NOT crash here
 * (verified against @prisma/client 5.19.1: constructing and querying with
 * DIRECT_URL absent from process.env succeeds).
 *
 * This default therefore is not what keeps request handling alive; it is here so
 * that any Prisma *CLI* invocation sharing this process env (`migrate deploy`,
 * `db push`, `prisma studio`) does not fail with "Environment variable not
 * found: DIRECT_URL" on a deploy configured with a single URL. A real
 * DIRECT_URL, when present, always takes precedence.
 */
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export const legacyPrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = legacyPrisma;
}

/**
 * Request-scoped tenant Prisma facade. It refuses database access before the
 * signed session has resolved a tenant; there is intentionally no fallback to
 * the legacy database. Use `legacyPrisma` only for explicit maintenance paths.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getTenantContext().prisma;
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Transaction client type — what `prisma.$transaction(async (tx) => …)` yields. */
export type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
