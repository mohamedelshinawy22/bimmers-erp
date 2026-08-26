import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Treasury deletion safeguards", () => {
  it("uses the active tenant client and never physically deletes a default treasury", () => {
    const actions = source("src/server/actions/treasury.actions.ts");
    const deletion = actions.slice(actions.indexOf("export async function deleteTreasuryAction"), actions.indexOf("export async function getTreasuryReportAction"));
    expect(deletion).toContain("const tenant = await getTenantDbFromSession()");
    expect(deletion).toContain("tenant.run(() => withTxRetry(() => tenant.prisma.$transaction");
    expect(deletion).not.toContain("withTxRetry(() => prisma.$transaction");
    expect(deletion).toContain("if (treasury.isDefault)");
    expect(deletion).toContain("لا يمكن حذف الخزينة الافتراضية");
    expect(deletion).toContain("TREASURY_ARCHIVED_WITH_LINKED_HISTORY");
    expect(deletion).toContain('action: "ARCHIVED"');
    expect(deletion).toContain('action: "DELETED"');
    expect(deletion).toContain("lockTreasuriesForUpdate(tx, [treasuryId])");
  });

  it("disables default-treasury deletion and displays server archive or delete outcomes in the active modal", () => {
    const modal = source("src/app/(app)/treasury/treasury-client.tsx");
    expect(modal).toContain("disabled={treasury.isDefault}");
    expect(modal).toContain("الخزينة الافتراضية محمية");
    expect(modal).toContain("هذه هي الخزينة الافتراضية للمنشأة");
    expect(modal).toContain("setNotice(result.data.message)");
  });
});
