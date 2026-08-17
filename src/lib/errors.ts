/**
 * Framework-free domain error types.
 *
 * Deliberately dependency-free so that anything importing them (the ACID
 * services, the verification suite, future cron jobs) does not transitively
 * pull in `next/headers`, React, or the session layer.
 */

/** Not authenticated, or the session is no longer valid. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Authenticated, but the role lacks the required permission. */
export class ForbiddenError extends Error {
  constructor(message = "ليس لديك صلاحية لتنفيذ هذه العملية.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Server misconfiguration (missing/invalid environment variable). */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Business rule violation — the message is safe to display verbatim. */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
