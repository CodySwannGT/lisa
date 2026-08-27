/** Supported platform boundary for birth-bound process-group authority. */

/**
 * Reject unsupported platforms before any scratch root or companion exists.
 * @param platform - Runtime platform
 */
export function assertTestRunPlatform(
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `lisa-test-run requires Darwin or Linux process-group authority; received ${platform}`
    );
  }
}
