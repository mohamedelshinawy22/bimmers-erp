import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("tenant factory reset resilience", () => {
  it("uses the active tenant client and bounded dependency-aware wipe phases", () => {
    const reset = source("src/server/actions/system-reset.actions.ts");
    expect(reset).toContain('const tenant = await getTenantDbFromSession()');
    expect(reset).toContain('const result = await tenant.run(async () =>');
    expect(reset).toContain('const phase = async (name: string, work: () => Promise<unknown>)');
    expect(reset).toContain('await phase("الحركات المالية"');
    expect(reset).toContain('await phase("مستندات البيع والشيكات"');
    expect(reset).toContain('await phase("المخزون والاستيراد"');
    expect(reset).toContain('await phase("البيانات الأساسية"');
    expect(reset).toContain('await bootstrapTenantDatabase(db)');
    expect(reset).toContain('mode: "PHASED_TENANT_WIPE"');
    expect(reset).not.toContain('db.$transaction(async (tx) =>');
  });

  it("retains destructive-action safeguards and clear action-result failures", () => {
    const reset = source("src/server/actions/system-reset.actions.ts");
    expect(reset).toContain('const RESET_CONFIRMATION_PHRASE = "مسح شامل وتصفير النظام"');
    expect(reset).toContain('actor.role !== "SUPER_ADMIN"');
    expect(reset).toContain('bcrypt.compare(input.adminPassword, administrator.passwordHash)');
    expect(reset).toContain('return toActionError(error, "purgeAllSystemDataAction")');
  });
});
