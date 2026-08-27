import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("fresh tenant system settings", () => {
  it("uses the explicit tenant client and upserts company settings on the first save", () => {
    const actions = source("src/server/actions/settings.actions.ts");
    expect(actions).not.toContain('import { prisma } from "@/lib/prisma"');
    expect(actions).toContain("const tenant = await getTenantDbFromSession()");
    expect(actions).toContain("tenant.prisma.$transaction");
    expect(actions).toContain("tx.systemSetting.upsert");
    expect(actions).toContain("serializeData(result.settings)");
  });

  it("does not let a failed audit write roll back a successful settings update", () => {
    const actions = source("src/server/actions/settings.actions.ts");
    expect(actions).toContain("audit write failed after settings save");
    expect(actions).toContain("await tenant.run(() => writeAudit(tenant.prisma");
  });

  it("loads the settings page from the same tenant-scoped settings store", () => {
    const page = source("src/app/(app)/settings/page.tsx");
    expect(page).toContain("getSettingsGrouped(tenant.prisma)");
    expect(page).toContain("getCompanyProfile(tenant.prisma)");
    expect(page).toContain("listUsers(tenant.prisma)");
    expect(page).toContain("getTenantSubscriptionDetails(tenant.context.route)");
  });

  it("replaces infrastructure disclosures with the privacy-safe subscription card", () => {
    const form = source("src/app/(app)/settings/settings-form.tsx");
    const card = source("src/components/settings/license-subscription-card.tsx");
    expect(form).toContain('<LicenseSubscriptionCard subscription={subscription} />');
    expect(form).not.toContain("معلومات البنية التحتية");
    expect(form).not.toContain("PostgreSQL 16");
    expect(card).toContain("بيانات ترخيص واشتراك النظام");
    expect(card).toContain("مرجع الترخيص:");
    expect(card).toContain("حصة المستخدمين");
    expect(card).toContain("الأجهزة المعتمدة");
    expect(card).not.toContain("4144 يوم متبقي");
    expect(card).not.toContain("31 ديسمبر 2037");
  });
});
