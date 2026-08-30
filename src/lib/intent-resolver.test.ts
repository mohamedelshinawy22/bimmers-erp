import { describe, expect, it, vi } from "vitest";
import { resolveDirectDbIntent } from "../server/ai/intent-resolver";

const tools = {
  getLiveDashboardMetrics: vi.fn(async () => ({
    date: "٢٨‏/٨‏/٢٠٢٦",
    todaySalesTotal: 6250,
    todayPaidTotal: 4000,
    todayInvoicesCount: 3,
    totalActiveTreasuries: 1200,
    supplierPayables: 1255162.26,
    customerReceivables: 7400,
    criticalShortagesCount: 4,
  })),
  queryProducts: vi.fn(async ({ lowStockOnly }: { query?: string; lowStockOnly?: boolean }) => lowStockOnly
    ? [{ name: "تيل فرامل F30", oem: "341168600", stock: 0, stockStatus: "نافد", location: "MAIN-A0", retailPrice: 500 }]
    : []),
  queryAccountsAndDebts: vi.fn(async () => [{ name: "مورد BMW", type: "SUPPLIER", balance: 1255162.26, balanceMeaning: "مديونية علينا / رصيد دائن للحساب" }]),
  queryUsers: vi.fn(async () => [{ name: "أحمد", username: "admin", role: "ADMIN", createdAt: "٢٨‏/٨‏/٢٠٢٦" }]),
  queryAccountStatement: vi.fn(async () => ({ name: "ورشة BMW", code: "ACC-001", type: "WORKSHOP_BMW", phone: "0100", balance: 2500, balanceMeaning: "رصيد مدين على الحساب", transactions: [] })),
};

describe("deterministic Copilot intent resolver", () => {
  it("answers a sales summary from live tool data", async () => {
    const result = await resolveDirectDbIntent("ملخص مبيعات النهاردة", tools);
    expect(result).toContain("6,250.00 ج.م");
    expect(result).toContain("3 فاتورة");
    expect(result).toContain("1,200.00 ج.م");
    expect(tools.getLiveDashboardMetrics).toHaveBeenCalledOnce();
  });

  it("answers supplier payables without embedding a fixed amount", async () => {
    const result = await resolveDirectDbIntent("علينا كام للموردين؟", tools);
    expect(result).toContain("1,255,162.26 ج.م");
    expect(result).toContain("مورد BMW");
    expect(tools.queryAccountsAndDebts).toHaveBeenCalledWith({ type: "SUPPLIER", withDebtsOnly: true });
  });

  it("answers critical shortages from the bounded live product tool", async () => {
    const result = await resolveDirectDbIntent("إيه النواقص الحرجة؟", tools);
    expect(result).toContain("تيل فرامل F30");
    expect(result).toContain("الرصيد: **0**");
    expect(tools.queryProducts).toHaveBeenCalledWith({ lowStockOnly: true });
  });

  it("answers active-user questions from the organization-scoped tool", async () => {
    const result = await resolveDirectDbIntent("عدد المستخدمين", tools);
    expect(result).toContain("أحمد");
    expect(tools.queryUsers).toHaveBeenCalledOnce();
  });

  it("answers account-statement questions without querying outside the tenant tools", async () => {
    const result = await resolveDirectDbIntent("كشف حساب ورشة BMW", tools);
    expect(result).toContain("ورشة BMW");
    expect(result).toContain("2,500.00 ج.م");
    expect(tools.queryAccountStatement).toHaveBeenCalledWith({ search: "bmw" });
  });

  it("returns null for an unsupported question instead of inventing an answer", async () => {
    await expect(resolveDirectDbIntent("ما هي توقعات السوق؟", tools)).resolves.toBeNull();
  });
});
