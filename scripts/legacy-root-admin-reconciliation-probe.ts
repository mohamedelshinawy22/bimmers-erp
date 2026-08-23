import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { reconcileConfiguredRootAdminAlias } from "../src/lib/root-admin-alias-reconciliation";

type User = { id: string; username: string; fullName: string; role: "SUPER_ADMIN"; isActive: boolean; passwordHash: string };
type FakeClient = {
  user: {
    findUnique: (input: { where: { username: string } }) => Promise<User | null>;
    findFirst: () => Promise<User>;
    create: (input: { data: Omit<User, "id"> }) => Promise<User>;
  };
  systemAuditTrail: { create: (input: { data: unknown }) => Promise<void> };
  $transaction: <T>(callback: (tx: FakeClient) => Promise<T>) => Promise<T>;
};

function createTenantHarness(legacy: User) {
  const created: User[] = [];
  const audits: unknown[] = [];
  const users = new Map<string, User>([[legacy.username, legacy]]);
  const client: FakeClient = {
    user: {
      findUnique: async ({ where }: { where: { username: string } }) => users.get(where.username) ?? null,
      findFirst: async () => legacy,
      create: async ({ data }: { data: Omit<User, "id"> }) => { const alias = { ...data, id: "alias-1" }; users.set(alias.username, alias); created.push(alias); return alias; },
    },
    systemAuditTrail: { create: async ({ data }: { data: unknown }) => { audits.push(data); } },
    $transaction: async <T>(callback: (tx: typeof client) => Promise<T>) => callback(client),
  };
  return { tenant: { route: { initialAdminUsername: "elshafei" }, prisma: client }, created, audits };
}

async function main() {
  const password = "LegacyPassword123";
  const legacy: User = { id: "admin-1", username: "admin", fullName: "مدير النظام", role: "SUPER_ADMIN", isActive: true, passwordHash: await bcrypt.hash(password, 12) };
  const success = createTenantHarness(legacy);
  const alias = await reconcileConfiguredRootAdminAlias({ tenant: success.tenant as never, username: "elshafei", password, ipAddress: "127.0.0.1" });
  assert.equal(alias?.username, "elshafei", "the configured alias must be reconciled from an authenticated legacy root admin");
  assert.equal(success.created.length, 1);
  assert.equal(await bcrypt.compare(password, success.created[0]!.passwordHash), true, "the tenant keeps a BCrypt hash and never a plaintext password");
  assert.equal(success.audits.length, 1, "alias reconciliation must be audited");

  const rejected = createTenantHarness(legacy);
  assert.equal(await reconcileConfiguredRootAdminAlias({ tenant: rejected.tenant as never, username: "elshafei", password: "WrongPassword123", ipAddress: null }), null, "an unverified password must not create an alias");
  assert.equal(rejected.created.length, 0);
  assert.equal(await reconcileConfiguredRootAdminAlias({ tenant: rejected.tenant as never, username: "admin", password, ipAddress: null }), null, "the legacy admin account remains an independently supported login");
  console.log("Legacy root-admin alias reconciliation probe passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
