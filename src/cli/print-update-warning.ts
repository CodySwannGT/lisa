import type { UpdateCheckResult } from "./update-check.js";

/**
 * Print the user-facing npm update warning for outdated Lisa installs.
 * @param result - Completed update-check result
 */
export function printUpdateWarning(result: UpdateCheckResult): void {
  if (!result.isOutdated || result.latest === null) {
    return;
  }

  console.error(
    [
      `Lisa ${result.latest} is available; you are running ${result.current}.`,
      "Update with: npm install -g @codyswann/lisa@latest",
      "Continuing with the installed version.",
    ].join("\n")
  );
}
