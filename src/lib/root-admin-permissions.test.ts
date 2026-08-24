import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("root administrator permission recovery", () => {
  it("keeps the root bypass in granular application and treasury permission paths", () => {
    const helpers = source("src/lib/user-permissions.ts");
    expect(helpers).toContain('user.username.trim().toLowerCase() === "admin"');
    expect(helpers).toContain("if (isRootAccess(user)) return true;");
    expect(helpers).toContain("return isRootAccess(access) || access.allowedTreasuryIds.length === 0");
  });

  it("returns root users before context-dependent granular access queries in server actions", () => {
    const auth = source("src/lib/auth.ts");
    expect(auth).toContain('if (role === "SUPER_ADMIN" || role === "ADMIN" || user.username.trim().toLowerCase() === "admin") return user;');
    expect(auth).toContain("runWithTenantContext(context, () => getUserAccess(user.id))");
  });
});
