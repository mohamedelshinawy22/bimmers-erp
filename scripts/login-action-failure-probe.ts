import assert from "node:assert/strict";
import { TenantRoutingError } from "../src/lib/tenant-routing";
import { toLoginActionFailure } from "../src/lib/login-action-failure";

function main() {
  const suspended = toLoginActionFailure(new TenantRoutingError("SUSPENDED", "تم تعليق ترخيص هذه النسخة من قبل المورد."));
  assert.deepEqual(suspended, { success: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة", fieldErrors: undefined }, "the login action must return a uniform safe authentication error instead of exposing routing state");
  const unavailable = toLoginActionFailure(new TenantRoutingError("MASTER_UNREACHABLE", "تعذر الاتصال ببوابة التراخيص. أعد المحاولة لاحقاً."));
  assert.equal(unavailable.success, false);
  if (!unavailable.success) assert.equal(unavailable.error, "اسم المستخدم أو كلمة المرور غير صحيحة");
  const missingConfiguration = toLoginActionFailure(new Error("TENANT_ROUTE_ENCRYPTION_KEY is absent"));
  assert.equal(missingConfiguration.success, false);
  if (!missingConfiguration.success) assert.equal(missingConfiguration.error, "اسم المستخدم أو كلمة المرور غير صحيحة");
  console.log("Login action routing-error translation probe passed.");
}

main();
