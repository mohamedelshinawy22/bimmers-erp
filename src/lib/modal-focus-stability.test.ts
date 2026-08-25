import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("modal focus stability", () => {
  it("focuses the dialog once per open cycle instead of on every onClose callback change", () => {
    const modal = source("src/components/ui/modal.tsx");
    expect(modal).toContain("const onCloseRef = React.useRef(onClose)");
    expect(modal).toContain("const focusedForOpenRef = React.useRef(false)");
    expect(modal).toContain("React.useEffect(() => { onCloseRef.current = onClose; }, [onClose])");
    expect(modal).toContain("if (!focusedForOpenRef.current)");
    expect(modal).toContain("focusedForOpenRef.current = true");
    expect(modal).toContain("focusedForOpenRef.current = false");
    expect(modal).toContain("}, [open]);");
  });

  it("keeps account create and edit controls as controlled fields without dynamic form keys", () => {
    const accounts = source("src/app/(app)/accounts/accounts-client.tsx");
    expect(accounts).toContain('value={form.name}');
    expect(accounts).toContain('onChange={(e) => setForm({ ...form, name: e.target.value })}');
    expect(accounts).not.toContain("key={form.name}");
  });
});
