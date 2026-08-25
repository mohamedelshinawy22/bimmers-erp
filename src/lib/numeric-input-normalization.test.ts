import { describe, expect, it } from "vitest";
import { normalizeDigits, sanitizeNumericInput } from "./utils";
import { nonNegativeMoney, positiveMoney } from "./validations/common";

describe("numeric input normalization", () => {
  it("converts Arabic-Indic and Persian digits plus decimal separators immediately", () => {
    expect(normalizeDigits("٥٠٠٠٫١٢")).toBe("5000.12");
    expect(normalizeDigits("۱۲،۵")).toBe("12.5");
    expect(sanitizeNumericInput("٥٬٠٠٠٫٢٥")).toBe("5000.25");
    expect(sanitizeNumericInput("-۱۲٫۵", { allowNegative: true })).toBe("-12.5");
  });

  it("keeps browser numeric text safe and accepts localized monetary values at the server validation boundary", () => {
    expect(sanitizeNumericInput("١٢٫٥.٧٧")).toBe("12.5");
    expect(sanitizeNumericInput("abc ٥٠٠٠ جنيه")).toBe("5000");
    expect(nonNegativeMoney.parse("٥٠٠٠٫٢٥")).toBe(5000.25);
    expect(positiveMoney.parse("۱۲،۵")).toBe(12.5);
  });
});
