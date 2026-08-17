import { Prisma } from "@prisma/client";
import type { TxClient } from "./prisma";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE" | "LOGIN" | "LOGIN_FAILED" | "LOGOUT" | "VOID";

interface AuditInput {
  tableName: string;
  recordId: string;
  action: AuditAction;
  oldData?: unknown;
  newData?: unknown;
  performedBy: string;
}

/** Prisma Decimal / Date / BigInt are not JSON-safe — normalise before persisting. */
export function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val instanceof Date) return val.toISOString();
      if (typeof val === "bigint") return val.toString();
      if (val instanceof Prisma.Decimal) return val.toString();
      return val;
    }),
  ) as Prisma.InputJsonValue;
}

/**
 * Best-effort client IP.
 *
 * `next/headers` is resolved lazily rather than imported at module scope so this
 * module stays usable from non-request contexts (seed scripts, cron jobs, the
 * ACID verification suite) without dragging React into the import graph.
 */
function requestIp(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { headers } = require("next/headers") as typeof import("next/headers");
    const h = headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim();
    return h.get("x-real-ip") ?? undefined;
  } catch {
    // Outside a request scope, or headers() is unavailable.
    return undefined;
  }
}

/**
 * Row-level audit write. Always call with the *transaction* client so the audit
 * row commits atomically with the change it describes — an audit trail that can
 * drift from the data it audits is worthless.
 */
export async function writeAudit(tx: TxClient, input: AuditInput): Promise<void> {
  await tx.systemAuditTrail.create({
    data: {
      tableName: input.tableName,
      recordId: input.recordId,
      action: input.action,
      oldData: input.oldData === undefined ? undefined : toJsonSafe(input.oldData),
      newData: input.newData === undefined ? undefined : toJsonSafe(input.newData),
      performedBy: input.performedBy,
      ipAddress: requestIp(),
    },
  });
}
