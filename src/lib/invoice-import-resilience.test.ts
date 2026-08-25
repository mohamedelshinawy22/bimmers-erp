import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeInvoiceImportDate } from "./invoice-excel-parser";

describe("invoice import resilience", () => {
  it("normalizes Excel serial dates and common Arabic report date strings", () => {
    expect(normalizeInvoiceImportDate(45528)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normalizeInvoiceImportDate("2026/08/24")).toBe("2026-08-24");
    expect(normalizeInvoiceImportDate("24-08-2026")).toBe("2026-08-24");
  });

  it("uses tenant-scoped bulk matching, serialized previews, and bounded execution batches", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/actions/invoice-import.actions.ts"), "utf8");
    expect(source).not.toContain('import { prisma } from "@/lib/prisma"');
    expect(source).toContain("const IMPORT_BATCH_SIZE = 25");
    expect(source).toContain("matchLines(tenant.prisma");
    expect(source).toContain("serializeData({ total: input.rows.length");
    expect(source).toContain("for (let batchStart = 0; batchStart < documentGroups.length; batchStart += IMPORT_BATCH_SIZE)");
    expect(source).toContain("partStatus: \"UNLINKED_TEXT_ITEM\"");
    expect(source).toContain("matched[index] ?? emptyImportMatch()");
  });

  it("keeps Accounts SSR scoped to the resolved tenant and renders an empty fallback for corrupt legacy rows", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/(app)/accounts/page.tsx"), "utf8");
    const service = readFileSync(resolve(process.cwd(), "src/server/services/accounts.service.ts"), "utf8");
    expect(page).toContain("listAccounts(tenant.prisma");
    expect(page).toContain("getVehicleFormOptions(tenant.prisma)");
    expect(page).toContain("return <AccountsClient rows={[]} total={0}");
    expect(service).toContain("export async function listAccounts(db: PrismaClient");
    expect(service).toContain('name: String(a.name ?? "حساب بدون اسم")');
    expect(service).toContain("vehicleCount: a._count?.vehicles ?? 0");
  });

  it("bulk-resolves voucher preview accounts and checks account import collisions by name as well as codes", () => {
    const vouchers = readFileSync(resolve(process.cwd(), "src/server/actions/voucher-import.actions.ts"), "utf8");
    const accounts = readFileSync(resolve(process.cwd(), "src/server/actions/account-excel.actions.ts"), "utf8");
    const preview = vouchers.slice(vouchers.indexOf("export async function previewVoucherImportAction"), vouchers.indexOf("export async function executeVoucherImportChunkAction"));
    expect(preview).toContain("findAccountsForPreview(tenant.prisma, previewLines)");
    expect(preview).toContain("previewAccountsByName.get(normalizeName(target))");
    expect(preview).not.toContain("findAccount(tenant.prisma, line, kind)");
    expect(accounts).toContain('name: { equals: row.name, mode: "insensitive" }');
    expect(accounts).toContain('name: { in: names, mode: "insensitive" as const }');
    expect(accounts).toContain("const ACCOUNT_IMPORT_BATCH_SIZE = 25");
    expect(accounts).toContain("await applyAccountImportRows(tenant.prisma, [row]");
    expect(accounts).toContain("parseImportNumber(value) ?? 0");
  });
});
