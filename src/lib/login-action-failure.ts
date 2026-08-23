import { fail, toActionError, type ActionResult } from "./action-result";
import { TenantRoutingError } from "./tenant-routing";
import { ZodError } from "zod";

const INVALID_CREDENTIALS = "اسم المستخدم أو كلمة المرور غير صحيحة";

/** The sole error translation path used by the public username/password action. */
export function toLoginActionFailure(error: unknown): ActionResult<never> {
  if (error instanceof TenantRoutingError) {
    // Route, decryption, and configuration errors are diagnostic events, never
    // authorization hints. Do not fall back to the primary tenant database:
    // that would make a Master Console outage a cross-tenant authentication path.
    console.warn("[loginAction] tenant routing rejected", { code: error.code });
    return fail(INVALID_CREDENTIALS);
  }
  if (error instanceof ZodError) return toActionError(error, "loginAction");
  // Login must never reveal environment, database, or infrastructure details.
  // The full exception remains in platform logs under a stable context label.
  console.error("[loginAction] unexpected authentication failure:", error);
  return fail(INVALID_CREDENTIALS);
}
