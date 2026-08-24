import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { serializeData } from "./serialize";
import { formatDate, formatDateTime } from "./utils";

describe("Server Action serialization and date display", () => {
  it("converts nested Prisma decimals, bigint values, and dates to action-safe data", () => {
    const result = serializeData({ amount: new Prisma.Decimal("42.75"), count: 3n, createdAt: new Date("2026-08-22T10:30:00.000Z"), nested: [{ balance: new Prisma.Decimal("1.5") }] });
    expect(result).toEqual({ amount: 42.75, count: 3, createdAt: "2026-08-22T10:30:00.000Z", nested: [{ balance: 1.5 }] });
  });

  it("never displays a leading plus sign or an invalid date in invoice-facing date helpers", () => {
    expect(formatDate(new Date("2026-08-22T10:30:00.000Z"))).not.toMatch(/^\+/);
    expect(formatDateTime(new Date("2026-08-22T10:30:00.000Z"))).not.toMatch(/^\+/);
    expect(formatDate("not-a-date")).toBe("—");
  });
});
