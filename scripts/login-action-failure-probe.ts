import assert from "node:assert/strict";
import { TenantRoutingError } from "../src/lib/tenant-routing";
import { toLoginActionFailure } from "../src/lib/login-action-failure";

function main() {
  const suspended = toLoginActionFailure(new TenantRoutingError("SUSPENDED", "تم تعليق ترخيص هذه النسخة من قبل المورد."));
  assert.deepEqual(suspended, { success: false, error: "تم تعليق ترخيص هذه النسخة من قبل المورد.", fieldErrors: undefined }, "the login action must return the safe tenant-routing explanation instead of a generic failure");
  const unavailable = toLoginActionFailure(new TenantRoutingError("MASTER_UNREACHABLE", "تعذر الاتصال ببوابة التراخيص. أعد المحاولة لاحقاً."));
  assert.equal(unavailable.success, false);
  if (!unavailable.success) assert.equal(unavailable.error, "تعذر الاتصال ببوابة التراخيص. أعد المحاولة لاحقاً.");
  console.log("Login action routing-error translation probe passed.");
}

main();
