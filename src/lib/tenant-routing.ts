import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createDecipheriv, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createTenantClientPool } from "./tenant-prisma-pool";

export type TenantRoute = {
  version: 1;
  tenantId: string;
  slug: string;
  licenseKey: string;
  deploymentIdentifier: string;
  databaseUrl: string;
  issuedAt: string;
  expiresAt: string;
};
export type TenantContext = { route: TenantRoute; prisma: PrismaClient };

const contextStore = new AsyncLocalStorage<TenantContext>();
const globalPool = globalThis as unknown as { bimmersTenantPrismaPool?: ReturnType<typeof createTenantClientPool<PrismaClient>> };
const tenantPool = globalPool.bimmersTenantPrismaPool ?? createTenantClientPool(databaseUrl => new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] }));
if (process.env.NODE_ENV !== "production") globalPool.bimmersTenantPrismaPool = tenantPool;

function routeKey() {
  const source = process.env.TENANT_ROUTE_ENCRYPTION_KEY;
  if (!source || source.length < 32) throw new Error("إعداد TENANT_ROUTE_ENCRYPTION_KEY غير مكتمل.");
  return createHash("sha256").update(source).digest();
}
function validTenantId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9-]{3,64}$/.test(value); }
function validateDatabaseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return (url.protocol === "postgres:" || url.protocol === "postgresql:") && Boolean(url.hostname) && url.pathname.length > 1; } catch { return false; }
}
function masterUrl() {
  const value = process.env.MASTER_CONSOLE_URL ?? process.env.NEXT_PUBLIC_MASTER_CONSOLE_URL;
  if (!value) throw new Error("إعداد MASTER_CONSOLE_URL غير مكتمل.");
  return value;
}
function masterSecret() {
  const value = process.env.LICENSE_API_SHARED_SECRET;
  if (!value) throw new Error("إعداد LICENSE_API_SHARED_SECRET غير مكتمل.");
  return value;
}

export function decryptTenantRouteEnvelope(envelope: string): TenantRoute {
  const [iv, tag, ciphertext] = envelope.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("حزمة مسار المستأجر غير صالحة.");
  const decipher = createDecipheriv("aes-256-gcm", routeKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const route = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as TenantRoute;
  if (route.version !== 1 || !validTenantId(route.tenantId) || !route.slug || !route.licenseKey || !route.deploymentIdentifier || !validateDatabaseUrl(route.databaseUrl) || Date.parse(route.expiresAt) <= Date.now()) throw new Error("مسار المستأجر غير مكتمل أو منتهي الصلاحية.");
  return route;
}

export async function resolveTenantRouteByUsername(username: string): Promise<TenantRoute> {
  const response = await fetch(new URL("/api/tenant/resolve-by-username", masterUrl()), { method: "POST", headers: { "content-type": "application/json", "x-system-secret": masterSecret() }, body: JSON.stringify({ username }), cache: "no-store" });
  const payload = await response.json().catch(() => null) as { valid?: boolean; routeEnvelope?: string; reason?: string } | null;
  if (!response.ok || !payload?.valid || !payload.routeEnvelope) throw new Error(payload?.reason || "تعذر تحديد مستأجر اسم المستخدم.");
  return decryptTenantRouteEnvelope(payload.routeEnvelope);
}

async function postTenantIndex<T>(path: string, route: TenantRoute, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(new URL(path, masterUrl()), { method: "POST", headers: { "content-type": "application/json", "x-system-secret": masterSecret() }, body: JSON.stringify({ ...body, licenseKey: route.licenseKey, deploymentIdentifier: route.deploymentIdentifier }), cache: "no-store" });
  const payload = await response.json().catch(() => null) as { accepted?: boolean; reason?: string } | null;
  if (!response.ok || !payload?.accepted) throw new Error(payload?.reason || "تعذر مزامنة دليل مستخدمي المستأجر.");
  return payload as T;
}
export async function reserveTenantUsername(route: TenantRoute, username: string, role: string) {
  return postTenantIndex<{ accepted: true; username: string }>("/api/tenant/users/reserve", route, { username, role });
}
export async function activateTenantUsername(route: TenantRoute, username: string) {
  return postTenantIndex<{ accepted: true; username: string }>("/api/tenant/users/activate", route, { username });
}
export async function releaseTenantUsername(route: TenantRoute, username: string) {
  return postTenantIndex<{ accepted: true; username: string }>("/api/tenant/users/release", route, { username });
}
export async function reportTenantSubUserUsage(route: TenantRoute, activeSubUsers: number) {
  return postTenantIndex<{ accepted: true }>("/api/tenant/usage", route, { activeSubUsers });
}

export async function getTenantPrismaClient(tenantId: string, decryptedDbUri: string): Promise<PrismaClient> {
  if (!validTenantId(tenantId) || !validateDatabaseUrl(decryptedDbUri)) throw new Error("مرجع قاعدة بيانات المستأجر غير موثوق.");
  return tenantPool.get(tenantId, decryptedDbUri);
}
export async function establishTenantContext(username: string, expectedTenantId?: string): Promise<TenantContext> {
  const route = await resolveTenantRouteByUsername(username);
  if (expectedTenantId && route.tenantId !== expectedTenantId) throw new Error("مسار المستأجر لا يطابق جلسة المستخدم.");
  const context = { route, prisma: await getTenantPrismaClient(route.tenantId, route.databaseUrl) };
  contextStore.enterWith(context);
  return context;
}
export function getTenantContext(): TenantContext {
  const context = contextStore.getStore();
  if (!context) throw new Error("لم يتم تأسيس سياق مستأجر قبل الوصول إلى البيانات.");
  return context;
}
export function runWithTenantContext<T>(context: TenantContext, callback: () => T): T { return contextStore.run(context, callback); }
export const tenantIsolationDiagnostics = { async clearClientPool() { await tenantPool.clear(); }, poolSize: () => tenantPool.size() };
