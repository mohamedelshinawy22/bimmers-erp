import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { changeOwnPasswordSchema } from "../src/lib/validations/accounts";
import { isSessionInvalidatedByPasswordChange } from "../src/lib/password-session-invalidation";

async function main() {
  const valid = { currentPassword: "CurrentPassword123", newPassword: "NewPassword456", confirmPassword: "NewPassword456" };
  assert.deepEqual(changeOwnPasswordSchema.parse(valid), valid, "valid password changes must pass the shared policy");
  assert.throws(() => changeOwnPasswordSchema.parse({ ...valid, confirmPassword: "DifferentPassword456" }), /تأكيد كلمة المرور/);
  assert.throws(() => changeOwnPasswordSchema.parse({ ...valid, newPassword: "letters-only-password", confirmPassword: "letters-only-password" }), /أرقام/);
  const oldHash = await bcrypt.hash(valid.currentPassword, 12);
  const newHash = await bcrypt.hash(valid.newPassword, 12);
  assert.equal(await bcrypt.compare(valid.currentPassword, oldHash), true, "the supplied current password must verify against its stored BCrypt hash");
  assert.equal(await bcrypt.compare(valid.currentPassword, newHash), false, "a replacement BCrypt hash must reject the previous password");
  const issuedBeforeChange = 1_700_000_000_000;
  assert.equal(isSessionInvalidatedByPasswordChange(issuedBeforeChange, new Date(issuedBeforeChange + 1)), true, "a password-change audit must reject a previously issued session");
  assert.equal(isSessionInvalidatedByPasswordChange(issuedBeforeChange, new Date(issuedBeforeChange - 1)), false, "a later session must remain valid after the earlier audit event");
  console.log("Tenant password-change contract probe passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
