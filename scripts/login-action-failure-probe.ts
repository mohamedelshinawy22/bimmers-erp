import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TenantRoutingError } from "../src/lib/tenant-routing";
import { toLoginActionFailure } from "../src/lib/login-action-failure";

function main() {
  const suspended = toLoginActionFailure(new TenantRoutingError("SUSPENDED", "تم تعليق ترخيص هذه النسخة من قبل المورد."));
  assert.deepEqual(suspended, { success: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة", fieldErrors: undefined }, "the login action must return a uniform safe authentication error instead of exposing routing state");
  const unavailable = toLoginActionFailure(new TenantRoutingError("MASTER_UNREACHABLE", "تعذر الاتصال ببوابة التراخيص. أعد المحاولة لاحقاً."));
  assert.equal(unavailable.success, false);
  if (!unavailable.success) assert.equal(unavailable.error, "اسم المستخدم أو كلمة المرور غير صحيحة");
  const deviceLimit = "عفواً، لقد تم الوصول إلى الحد الأقصى لعدد الأجهزة المعتمدة المسموح بها لهذا الاشتراك (2). يرجى تسجيل الخروج من أحد الأجهزة أو طلب ترقية الخطة.";
  const limited = toLoginActionFailure(new TenantRoutingError("DEVICE_LIMIT", deviceLimit));
  assert.equal(limited.success, false);
  if (!limited.success) assert.equal(limited.error, deviceLimit, "device quota denial must preserve the exact Master Console message");
  const missingConfiguration = toLoginActionFailure(new Error("TENANT_ROUTE_ENCRYPTION_KEY is absent"));
  assert.equal(missingConfiguration.success, false);
  if (!missingConfiguration.success) assert.equal(missingConfiguration.error, "اسم المستخدم أو كلمة المرور غير صحيحة");
  const loginSource = readFileSync(resolve(process.cwd(), "src/server/actions/auth.actions.ts"), "utf8");
  assert.ok(loginSource.includes("await establishTenantContext(username)"), "login must route centrally before querying a tenant database");
  assert.ok(!loginSource.includes("legacyPrisma"), "login must never fall back broadly to the primary database after tenant routing fails");
  assert.ok(!loginSource.includes("DATABASE_URL"), "login must not derive tenant authorization from a deployment database URL");
  console.log("Login action routing-error translation probe passed.");
}

main();
