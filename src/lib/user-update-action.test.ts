import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("managed user update safeguards", () => {
  it("uses the session tenant client and does not hash an empty optional password", () => {
    const action = source("src/server/actions/users.actions.ts");
    expect(action).toContain('import { getTenantDbFromSession }');
    expect(action).toContain('const password = input.password?.trim() ?? "";');
    expect(action).toContain('...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),');
    expect(action).toContain("tenant.prisma.$transaction");
    expect(action).toContain("createdAt: result.createdAt.toISOString()");
    expect(action).not.toContain("passwordHash: true");
  });

  it("keeps save failures inside the permissions modal instead of rejecting the transition", () => {
    const modal = source("src/components/users/user-permissions-modal.tsx");
    expect(modal).toContain("try {");
    expect(modal).toContain('setError(result?.error ?? "فشل في حفظ التعديلات.")');
    expect(modal).toContain('setError("فشل في حفظ التعديلات. أعد المحاولة.")');
    expect(modal).toContain("password: form.password.trim()");
  });
});
