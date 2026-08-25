import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildTenantWorkbook, tenantFileToken } from "./workbook";

describe("tenant workbook builder", () => {
  it("writes a tenant-branded RTL workbook with supplied headers and records", () => {
    const result = buildTenantWorkbook({ tenantName: "بافاريا AN", reportTitle: "تصدير المخزون", sheetName: "المخزون", headers: ["اسم الصنف", "OEM"], records: [{ "اسم الصنف": "فلتر", OEM: "1142" }], widths: [28, 16], format: "XLSX" });
    const workbook = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
    const sheet = workbook.Sheets["المخزون"]!;
    expect(sheet.A1?.v).toBe("بافاريا AN");
    expect(sheet.A2?.v).toBe("تصدير المخزون");
    expect(sheet.A4?.v).toBe("اسم الصنف");
    expect(sheet.A5?.v).toBe("فلتر");
    expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true);
  });

  it("keeps filename tokens deterministic for Arabic and Latin tenant identities", () => {
    expect(tenantFileToken("Bavaria AN")).toBe("bavaria-an");
    expect(tenantFileToken("  الشافعي لقطع BMW  ")).toBe("الشافعي-لقطع-bmw");
  });
});
