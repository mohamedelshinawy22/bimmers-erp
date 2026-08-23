import { fail, toActionError, type ActionResult } from "./action-result";
import { TenantRoutingError } from "./tenant-routing";

/** The sole error translation path used by the public username/password action. */
export function toLoginActionFailure(error: unknown): ActionResult<never> {
  if (error instanceof TenantRoutingError) return fail(error.safeMessage);
  return toActionError(error, "loginAction");
}
