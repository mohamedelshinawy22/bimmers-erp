import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("managed user scope pruning", () => {
  it("filters inactive treasury and missing warehouse references instead of rejecting the save", () => {
    const action = source("src/server/actions/users.actions.ts");
    expect(action).toContain("async function resolveScopedResources");
    expect(action).toContain("isActive: true");
    expect(action).toContain("allowedTreasuryIds = [...new Set(input.allowedTreasuryIds)].filter");
    expect(action).toContain("allowedWarehouseIds = warehouseNames.filter");
    expect(action).not.toContain("تتضمن صلاحيات المستخدم خزينة غير موجودة أو معطلة.");
  });

  it("gives protected root accounts all-scope access and removes stale ids from modal state", () => {
    const action = source("src/server/actions/users.actions.ts");
    const modal = source("src/components/users/user-permissions-modal.tsx");
    expect(action).toContain('input.username.trim().toLowerCase() === "admin"');
    expect(action).toContain("return { allowedWarehouseIds: [], allowedTreasuryIds: [], transferToTreasuryId: null }");
    expect(modal).toContain("allowedTreasuryIds: current.allowedTreasuryIds.filter");
    expect(modal).toContain("allowedWarehouseIds: current.allowedWarehouseIds.filter");
  });
});
