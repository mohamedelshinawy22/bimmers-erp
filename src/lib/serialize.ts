import { Prisma } from "@prisma/client";

/** Converts Prisma and JavaScript values into Server Action-safe plain data. */
export function serializeData<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return Number(data) as T;
  if (data instanceof Date) return data.toISOString() as T;
  if (data instanceof Prisma.Decimal) return data.toNumber() as T;
  if (Array.isArray(data)) return data.map((value) => serializeData(value)) as T;
  if (typeof data === "object") {
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, serializeData(value)])) as T;
  }
  return data;
}
