/** A password-change audit event invalidates any signed session issued at or before that event. */
export function isSessionInvalidatedByPasswordChange(sessionIssuedAtMs: number, latestPasswordChangedAt: Date | null): boolean {
  return Boolean(latestPasswordChangedAt && latestPasswordChangedAt.getTime() >= sessionIssuedAtMs);
}
