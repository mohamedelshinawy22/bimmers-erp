import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Bimmers AI Copilot security and grounding contracts", () => {
  it("uses the authenticated tenant context and exposes only bounded read tools", () => {
    const route = source("src/app/api/ai/copilot/route.ts");
    const tools = source("src/server/ai/copilot-tools.ts");
    expect(route).toContain("getTenantDbFromSession()");
    expect(route).toContain("tenant.run(async () =>");
    expect(route).toContain("invokeLLM");
    expect(route).not.toContain("OPENAI_API_KEY");
    expect(tools).toContain("createScopedCopilotTools");
    expect(tools).toContain("db.invoice");
    expect(tools).toContain("db.partItem");
    expect(tools).toContain("db.account");
    expect(tools).toContain("db.treasuryTransaction");
    expect(tools).not.toContain("db.invoice.create");
    expect(tools).not.toContain("db.account.update");
    expect(tools).not.toContain("db.treasury.update");
  });

  it("enforces manager-only financial visibility and hides cost data from staff results", () => {
    const tools = source("src/server/ai/copilot-tools.ts");
    expect(tools).toContain("const manager = isManager(user.role)");
    expect(tools).toContain("if (!manager) return { error: \"هذا الملخص المالي متاح لمدير النظام فقط.\" }");
    expect(tools).toContain("...(manager ? {} : { userId: user.userId })");
    expect(tools).toContain("costPrice: manager ? money(part.buyPriceAvg) : undefined");
    expect(tools).toContain("createdByUser: user.userId");
    expect(tools).toContain("allowedTreasuryIds");
  });

  it("mounts the Arabic Copilot only in the authenticated application shell", () => {
    const layout = source("src/app/(app)/layout.tsx");
    const widget = source("src/components/ai/copilot-floating-widget.tsx");
    expect(layout).toContain("CopilotFloatingWidget");
    expect(widget).toContain("/api/ai/copilot");
    expect(widget).toContain("المساعد الذكي");
    expect(widget).toContain("اكتب سؤالك بالمصري أو بالعربية");
    expect(widget).toContain("setError");
  });
});
