import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("responsive ERP table layout contracts", () => {
  it.each([
    ["app/(app)/accounts/accounts-client.tsx", "accounts"],
    ["app/(app)/invoices/invoices-client.tsx", "invoices"],
    ["app/(app)/inventory/inventory-client.tsx", "inventory"],
    ["components/invoices/return-register-client.tsx", "returns"],
  ])("keeps %s horizontally and vertically scrollable with a sticky header", (relativePath) => {
    const source = read(relativePath);
    expect(source).toMatch(/(?:containerClassName|overflow-x-auto)/);
    expect(source).toMatch(/overflow-y-auto/);
    expect(source).toMatch(/(?:sticky top-0|sticky top-0 z-)/);
    expect(source).toMatch(/max-h-\[calc\(100vh-300px\)\]/);
  });

  it("keeps the Copilot above bottom pagination and selection controls", () => {
    const source = read("components/ai/copilot-floating-widget.tsx");
    expect(source).toContain("fixed bottom-20 left-5");
    expect(source).not.toContain("fixed bottom-5 left-5");
  });

  it("preserves footer clearance for paginated accounts and invoices", () => {
    expect(read("app/(app)/accounts/accounts-client.tsx")).toContain("rtl:pl-44");
    expect(read("app/(app)/invoices/invoices-client.tsx")).toContain("rtl:pl-44");
  });
});

it("does not introduce data mutations while changing table layout", () => {
  for (const relativePath of [
    "app/(app)/accounts/accounts-client.tsx",
    "app/(app)/invoices/invoices-client.tsx",
    "app/(app)/inventory/inventory-client.tsx",
    "components/invoices/return-register-client.tsx",
    "components/ai/copilot-floating-widget.tsx",
  ]) {
    const source = read(relativePath);
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("$transaction");
  }
});

it("keeps Table container styling optional for existing consumers", () => {
  const source = read("components/ui/table.tsx");
  expect(source).toContain("containerClassName?: string");
  expect(source).toContain("overflow-x-auto");
});
