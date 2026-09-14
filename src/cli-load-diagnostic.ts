/** A bounded startup diagnostic that remains loadable when CLI dependencies fail. */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const DEPENDENCY = "brace-expansion";

/**
 * Read a manifest without evaluating the package's executable entrypoint.
 * @param filename - Manifest path
 * @returns Parsed object
 */
async function readManifest(
  filename: string
): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Manifest is not an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Render version/range text without exposing credentials from URL overrides.
 * @param value - A version or override value
 * @returns Safe diagnostic text
 */
function rangeText(value: unknown): string {
  return typeof value === "string" &&
    value.length <= 100 &&
    /^[0-9xXv*~^<>=|.\s+-]+$/u.test(value)
    ? value
    : "unverified non-version value (withheld)";
}

/**
 * Identify direct host overrides; unsupported selectors stay explicitly unverified.
 * @returns Human-readable current-directory override evidence
 */
async function describeHostOverride(): Promise<string> {
  try {
    const manifest = await readManifest(path.resolve("package.json"));
    const matches = ["overrides", "resolutions"].flatMap(section => {
      const entries = manifest[section];
      if (!entries || typeof entries !== "object" || Array.isArray(entries))
        return [];
      const value = (entries as Record<string, unknown>)[DEPENDENCY];
      return value === undefined
        ? []
        : [`${section}.${DEPENDENCY}: ${rangeText(value)}`];
    });
    return matches.length > 0
      ? `Current directory package.json ${matches.join("; ")}.`
      : "No direct brace-expansion override was identified in the current directory's package.json; nested selectors and other manifests were not verified.";
  } catch {
    return "Could not read the current directory's package.json; the responsible override is unverified.";
  }
}

/**
 * Explain the demonstrated minimatch/brace-expansion loading failure.
 * This is not a lockfile audit and never changes or installs dependencies.
 * @param error - Original CLI loading error
 * @returns Additional context, or null for unrelated errors
 */
export async function describeCliDependencyFailure(
  error: unknown
): Promise<string | null> {
  if (
    !(error instanceof Error) ||
    !/['"]brace-expansion['"]/u.test(error.message)
  )
    return null;
  const override = await describeHostOverride();
  try {
    const resolveFromLisa = createRequire(import.meta.url);
    const parentPath = resolveFromLisa.resolve("minimatch/package.json");
    const parent = await readManifest(parentPath);
    const child = await readManifest(
      createRequire(parentPath).resolve("brace-expansion/package.json")
    );
    const dependencies = parent.dependencies as
      | Record<string, unknown>
      | undefined;
    return [
      "Lisa could not load its dependencies; the requested command did not run.",
      `minimatch@${rangeText(parent.version)} declares brace-expansion ${rangeText(dependencies?.[DEPENDENCY])}; Node resolves brace-expansion@${rangeText(child.version)}.`,
      override,
      "@isaacs/brace-expansion is a different package and does not govern brace-expansion.",
      "Review the override and reinstall with a version that satisfies the parent's declared range. No files were changed by this diagnostic.",
    ].join("\n");
  } catch {
    return `Lisa could not load brace-expansion, and its installed dependency chain could not be verified.\n${override}`;
  }
}
