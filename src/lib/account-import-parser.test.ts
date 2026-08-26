import { describe, expect, it } from "vitest";
import { parseAccountImportMatrix } from "./account-import-parser";

describe("dynamic Accounts workbook parser", () => {
  it("finds a non-leading Arabic header row, ignores a serial column, and derives debit and credit balances", () => {
    const rows = parseAccountImportMatrix([
      ["شركة اختبار"],
      ["تقرير أرصدة"],
      ["م", "اسم الحساب", "موبايل", "طبيعة الحساب", "عليه - مدين", "له - دائن"],
      [1, "عميل تجريبي", "01000000000", "عميل", "1250.50", ""],
      [2, "مورد تجريبي", "01111111111", "مورد", "", 725],
    ]);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRowNumber: 4, name: "عميل تجريبي", phone: "01000000000", type: "CUSTOMER", openingBalance: -1250.5 }),
      expect.objectContaining({ sourceRowNumber: 5, name: "مورد تجريبي", phone: "01111111111", type: "SUPPLIER", openingBalance: 725 }),
    ]));
  });

  it("uses the explicit account code and the second header row in the supported standard template", () => {
    const rows = parseAccountImportMatrix([
      ["رقم الحساب", "اسم الحساب", "الرصيد الحالى", "", "طبيعة الحساب", "كود الحساب", "بيانات الاتصال"],
      ["", "", "عليه - مدين", "له - دائن", "", "", "موبايل"],
      ["LEGACY-10", "ورشة شمال", 0, 0, "ورشة BMW", "WRK-010", "01234567890"],
    ]);

    expect(rows).toEqual([expect.objectContaining({ sourceRowNumber: 3, accountNumber: "WRK-010", name: "ورشة شمال", phone: "01234567890", type: "WORKSHOP_BMW", openingBalance: "0" })]);
  });

  it("defaults a blank or absent type column to customer while retaining direct opening balances", () => {
    const rows = parseAccountImportMatrix([
      ["صف"],
      ["الاسم", "رقم الحساب", "الرصيد الافتتاحي", "الهاتف"],
      [1, "حساب بدون نوع", "ACC-900", "300", "01555555555"],
    ]);

    expect(rows).toEqual([expect.objectContaining({ sourceRowNumber: 3, name: "حساب بدون نوع", accountNumber: "ACC-900", phone: "01555555555", type: "CUSTOMER", openingBalance: "300" })]);
  });
});
