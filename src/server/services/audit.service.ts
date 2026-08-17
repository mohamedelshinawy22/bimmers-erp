import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface AuditRow {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  performedBy: string;
  performedByName: string | null;
  ipAddress: string | null;
  timestamp: string;
  oldData: unknown;
  newData: unknown;
}

/**
 * Audit trail reader.
 *
 * The trail was written from day one but never readable, while the UI told
 * operators their adjustments were being recorded. This backs the `audit.read`
 * permission with an actual screen.
 */
export async function listAuditTrail(options: {
  tableName?: string;
  action?: string;
  recordId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 40));

  const and: Prisma.SystemAuditTrailWhereInput[] = [];
  if (options.tableName) and.push({ tableName: options.tableName });
  if (options.action) and.push({ action: options.action });
  if (options.recordId) and.push({ recordId: options.recordId });
  if (options.query) and.push({ recordId: { contains: options.query, mode: "insensitive" } });

  const where: Prisma.SystemAuditTrailWhereInput = and.length ? { AND: and } : {};

  const [rows, total] = await Promise.all([
    prisma.systemAuditTrail.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.systemAuditTrail.count({ where }),
  ]);

  // Resolve actor ids to names in one query rather than per row.
  const actorIds = [...new Set(rows.map((r) => r.performedBy).filter((v) => v && v !== "anonymous"))];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      tableName: r.tableName,
      recordId: r.recordId,
      action: r.action,
      performedBy: r.performedBy,
      performedByName: nameById.get(r.performedBy) ?? null,
      ipAddress: r.ipAddress,
      timestamp: r.timestamp.toISOString(),
      oldData: r.oldData,
      newData: r.newData,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getAuditFilters() {
  const [tables, actions] = await Promise.all([
    prisma.systemAuditTrail.groupBy({ by: ["tableName"], _count: { _all: true } }),
    prisma.systemAuditTrail.groupBy({ by: ["action"], _count: { _all: true } }),
  ]);
  return {
    tables: tables.map((t) => ({ name: t.tableName, count: t._count._all })).sort((a, b) => b.count - a.count),
    actions: actions.map((a) => ({ name: a.action, count: a._count._all })).sort((a, b) => b.count - a.count),
  };
}

export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  invoiceCount: number;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { username: "asc" }],
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { invoices: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    invoiceCount: u._count.invoices,
  }));
}
