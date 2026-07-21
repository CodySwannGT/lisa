/** Finite, sanitized public reasons for standards-proof read failures. */

export const MALFORMED_STANDARDS_PROOF_REASON = "malformed standards proof";

/**
 * Classify only errors emitted after strict contract validation begins.
 * @param error - Strict validator failure
 * @returns Finite public validation reason
 */
export function safeStandardsValidationReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (message === "Invalid standards proof schemaVersion: expected 1") {
    return "unsupported standards proof schema";
  }
  if (
    message === "Invalid standards proof artifact identity" ||
    message.startsWith("Invalid repository")
  ) {
    return "invalid standards proof identity";
  }
  if (
    message.startsWith("Invalid projectTypes") ||
    message.startsWith("Invalid applicableChecks")
  ) {
    return "invalid standards proof check membership";
  }
  if (
    message ===
      "Invalid standards proof results: checks must exactly match applicableChecks" ||
    message.startsWith("Invalid results:") ||
    /^Invalid results\[\d+\](?: fields|:|\.(?:check|category|status):)/u.test(
      message
    )
  ) {
    return "invalid standards proof check results";
  }
  if (
    message.startsWith("Invalid capturedAt:") ||
    /^Invalid results\[\d+\]\.(?:startedAt|completedAt):/u.test(message) ||
    /^Invalid results\[\d+\] timestamp order$/u.test(message)
  ) {
    return "invalid standards proof timestamps";
  }
  return MALFORMED_STANDARDS_PROOF_REASON;
}

/**
 * Classify only failures from confined bounded filesystem operations.
 * @param error - Storage read failure
 * @returns Finite public storage reason
 */
export function safeStandardsStorageReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (message.includes("128 KiB")) return "standards proof exceeds size limit";
  if (message.includes("Unsafe") || message.includes("changed during read")) {
    return "unsafe standards proof storage";
  }
  return MALFORMED_STANDARDS_PROOF_REASON;
}
