import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { updatePartSchema } from "./validations/parts";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

const validUpdate = {
  id: "1f52ac6f-098c-4609-85d2-025f797a7089",
  nameAr: "بليه بمسمار ستيرن",
  nameEn: "",
  brandId: "13ca11b6-d0c3-4cda-b176-9b642501317b",
  brandName: "",
  brandPartNumber: "",
  barcode: "",
  category: "تعليق",
  categoryId: "",
  categoryName: "",
  sidePosition: "",
  binLocationId: "",
  sellPriceRetail: 200,
  sellPriceWholesale: 180,
  sellPriceMin: 160,
  minReorderLevel: 2,
  isActive: true,
  chassisIds: [],
  engineIds: [],
  chassisCodes: [],
  engineCodes: [],
  imageKey: "",
  imageUrl: "",
};

describe("manual product purchase-cost correction", () => {
  it("accepts a nonnegative cost correction and rejects negative or loss-making values", () => {
    expect(updatePartSchema.parse({ ...validUpdate, costPrice: 120 }).costPrice).toBe(120);
    expect(() => updatePartSchema.parse({ ...validUpdate, costPrice: -1 })).toThrow();
    expect(() => updatePartSchema.parse({ ...validUpdate, costPrice: 170, sellPriceMin: 160 })).toThrow();
  });

  it("restricts the dedicated cost-edit permission to system administrators and managers", () => {
    expect(can("SUPER_ADMIN", "part.editCost")).toBe(true);
    expect(can("MANAGER", "part.editCost")).toBe(true);
    expect(can("STOREKEEPER", "part.editCost")).toBe(false);
    expect(can("CASHIER", "part.editCost")).toBe(false);
    expect(source("src/lib/user-permissions.ts")).toContain('"part.editCost": hasPermission(access, "canViewCostPrice")');
  });

  it("updates both persisted cost fields inside the tenant transaction and writes a dedicated audit event", () => {
    const action = source("src/server/actions/parts.actions.ts");
    expect(action).toContain('await requirePermission("part.editCost")');
    expect(action).toContain('buyPriceLast: manualCost, buyPriceAvg: manualCost');
    expect(action).toContain('event: "PRODUCT_COST_UPDATED"');
    expect(action).toContain("oldCostPrice: before.buyPriceAvg");
    expect(action).toContain("newCostPrice: manualCost");
    expect(action).toContain("await writeAudit(tx");
    expect(action).toContain("tenant.prisma.$transaction");
  });

  it("exposes an editable management cost input while retaining a safe read-only field for unauthorized editors", () => {
    const modal = source("src/app/(app)/inventory/components/add-part-modal.tsx");
    const page = source("src/app/(app)/inventory/page.tsx");
    const client = source("src/app/(app)/inventory/inventory-client.tsx");
    expect(modal).toContain("سعر الشراء / التكلفة (ج.م)");
    expect(modal).toContain("يمكن لمدير النظام تعديل سعر الشراء الأساسي مباشرة.");
    expect(modal).toContain("disabled={isEdit && !canEditCost}");
    expect(modal).toContain("costPrice: numeric(form.costPrice)");
    expect(page).toContain('hasApplicationPermission(access, "part.editCost")');
    expect(client).toContain("canEditCost={permissions.canEditCost}");
  });
});
