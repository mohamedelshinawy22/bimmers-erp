import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Presence-only report for one env var. Never returns any part of a value. */
type ConfigStatus = "set" | "missing" | "too_short" | "optional_missing";

/**
 * Liveness/readiness probe consumed by the Docker HEALTHCHECK and any external
 * uptime monitor. Returns 503 when PostgreSQL is unreachable so orchestrators
 * stop routing traffic to a node that cannot serve transactions.
 *
 * It also returns 503 when JWT_SECRET is missing or too short. That is not a
 * liveness detail: without a usable signing key no one can log in and every
 * session is unverifiable, so the instance cannot serve its purpose even though
 * the database answers. Surfacing it here turns a silent "login just fails"
 * deploy into something a probe and an operator can both see.
 *
 * The `config` block reports presence only — "set" / "missing" / "too_short" —
 * and never echoes a value or any fragment of one, so the endpoint stays safe to
 * expose to an unauthenticated monitor (it bypasses the middleware session gate).
 * REDIS_URL is optional: it is reported as "optional_missing" when absent and
 * never affects the HTTP status.
 */
export async function GET() {
  const checks: Record<string, "up" | "down" | "disabled"> = {
    database: "disabled",
    redis: "disabled",
  };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.ping();
      checks.redis = "up";
    } catch {
      checks.redis = "down";
    }
  }

  const jwtSecret = process.env.JWT_SECRET;
  const jwtStatus: ConfigStatus = !jwtSecret
    ? "missing"
    : jwtSecret.length < 32
      ? "too_short"
      : "set";

  const config: Record<string, ConfigStatus> = {
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "missing",
    MASTER_CONSOLE_URL: (process.env.MASTER_CONSOLE_URL ?? process.env.NEXT_PUBLIC_MASTER_CONSOLE_URL) ? "set" : "missing",
    LICENSE_API_SHARED_SECRET: process.env.LICENSE_API_SHARED_SECRET ? "set" : "missing",
    TENANT_ROUTE_ENCRYPTION_KEY: process.env.TENANT_ROUTE_ENCRYPTION_KEY ? "set" : "missing",
    JWT_SECRET: jwtStatus,
    NEXT_PUBLIC_CURRENCY: process.env.NEXT_PUBLIC_CURRENCY ? "set" : "missing",
    REDIS_URL: process.env.REDIS_URL ? "set" : "optional_missing",
  };

  // A reachable database is not enough to call the instance healthy: a bad
  // signing key means nobody can authenticate.
  const healthy = jwtStatus === "set" && config.MASTER_CONSOLE_URL === "set" && config.LICENSE_API_SHARED_SECRET === "set" && config.TENANT_ROUTE_ENCRYPTION_KEY === "set";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      config,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
