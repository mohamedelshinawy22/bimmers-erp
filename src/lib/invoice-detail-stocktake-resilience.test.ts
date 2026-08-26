import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("invoice detail and Excel stocktake resilience", () => {
  it("keeps invoice details and permission lookup in one tenant context and tolerates orphaned part brands", () => {
    const action = source("src/server/actions/invoices.read.actions.ts");
    const service = source("src/server/services/invoices.service.ts");
    const section = action.slice(action.indexOf("export async function getInvoiceDetailAction"), action.indexOf("export async function getStockLedgerAction"));
    expect(section).toContain("const tenant = await getTenantDbFromSession()");
    expect(section).toContain("const { detail, access } = await tenant.run(async () =>");
    expect(section).toContain("access: await getUserAccess(user.id)");
    expect(service).toContain("it.part?.brand?.name ?? \"غير مربوط بالمخزن\"");
  });

  it("requires an all-or-nothing confirmed stocktake and writes immutable STOCKTAKE movements using the tenant client", () => {
    const action = source("src/server/actions/stocktake-reconciliation.actions.ts");
    const modal = source("src/components/inventory/stocktake-reconciliation-modal.tsx");
    expect(action).toContain("const tenant = await getTenantDbFromSession()");
    expect(action).toContain("tenant.run(() => withTxRetry(() => tenant.prisma.$transaction");
    expect(action).toContain('reason: "STOCKTAKE"');
    expect(action).toContain("await lockPartsForUpdate");
    expect(action).toContain("if (input.confirmation !== CONFIRMATION_PHRASE)");
    expect(modal).toContain("STOCKTAKE_CONFIRMATION_PHRASE");
    expect(modal).toContain("previewStocktakeReconciliationAction");
    expect(modal).toContain("executeStocktakeReconciliationAction");
    expect(modal).toContain("لا يمكن تنفيذ التسوية قبل معالجة كل الصفوف");
    expect(modal).toContain("allowPartial");
    expect(modal).toContain("downloadUnmatchedReport");
    expect(modal).toContain("تسوية الأصناف المتطابقة فقط");
  });
});
