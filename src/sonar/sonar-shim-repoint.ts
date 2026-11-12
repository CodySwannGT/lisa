/**
 * Repoint `sonar integrate`-generated hook shims at Lisa's Sonar wrapper.
 *
 * CodySwannGT/lisa#4502. `sonar integrate <agent>` writes a shim that pipes the
 * hook payload straight to `sonar hook <event>`, so an unauthenticated CLI
 * blocks every prompt with a reason that reads like a real finding. #2324
 * shipped `scripts/lisa-hooks/sonar-secrets.sh`, which resolves
 * `SONARQUBE_CLI_TOKEN` and downgrades that case to a warning — but the shim
 * is generated, not copied, so only a human following `lisa-setup-sonar` §4a
 * ever repointed it. A host project whose shim predates #2324 kept blocking
 * every prompt (headless workers never started), and `processSonarIntegration`
 * re-runs `sonar integrate` on each apply, which restores the vendor shim.
 *
 * This module closes the loop at apply time. It is deliberately conservative:
 * it rewrites only a shim at a documented location whose body is recognisably
 * the vendor's (comments, the `command -v sonar` guard, and exactly one
 * `sonar hook <event>` line). A shim already naming the wrapper is left alone,
 * which makes the rewrite idempotent, and any other body is treated as
 * operator-customised and never touched.
 * @module sonar/sonar-shim-repoint
 */
import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Shim locations `lisa-setup-sonar` §4a documents, relative to the project root.
 *
 * Parity gaps, deliberately not listed here: OpenCode and Devin have no vendor
 * `sonar integrate` path, so there is no vendor shim for Lisa to manage; Cursor
 * is wired by `/lisa:setup:sonar` and §4a does not document its shim location,
 * so its repointing stays with that setup skill. Windows `.ps1` shims are also
 * out of scope: the wrapper is bash-only, so those remain manual §4a patching.
 */
export const SONAR_SHIM_PATHS: readonly string[] = [
  ".claude/hooks/sonar-secrets/build-scripts/prompt-secrets.sh",
  ".claude/hooks/sonar-secrets/build-scripts/pretool-secrets.sh",
  ".codex/hooks/sonar-secrets/build-scripts/prompt-secrets.sh",
  ".github/hooks/sonar-secrets/build-scripts/pretool-secrets.sh",
  ".agents/sonar/hooks/pretool-secrets.sh",
];

/** Lisa's Sonar hook wrapper, relative to the project root. */
export const SONAR_WRAPPER_PATH = "scripts/lisa-hooks/sonar-secrets.sh";

/** Marker proving a shim already delegates to the wrapper. */
const WRAPPER_MARKER = path.posix.basename(SONAR_WRAPPER_PATH);

/** Structural lines the vendor shim may carry besides its hook call. */
const VENDOR_GUARD_LINES: readonly RegExp[] = [
  /^if\s+!\s+command\s+-v\s+sonar\b[^;]*;\s*then$/,
  /^exit\s+0$/,
  /^fi$/,
];

/**
 * The single hook call; capture group 1 is the vendor event name.
 *
 * A trailing `"$@"` is recognised but dropped on rewrite: the wrapper takes the
 * event as its only argument, and the vendor shim is never passed others.
 */
const VENDOR_HOOK_LINE =
  /^(?:exec\s+)?(?:cat\s*\|\s*)?sonar\s+hook\s+([a-z][a-z0-9-]*)(?:\s+"\$@")?$/;

/** Any call of the vendor hook command, whether or not it is recognisable. */
const SONAR_HOOK_CALL = /\bsonar\s+hook\b/;

/** What happened to one documented shim location. */
type ShimOutcome = "repointed" | "skipped" | "failed" | "unrecognized";

/** Outcome of one repoint pass. */
export interface SonarShimRepointResult {
  /** Whether the wrapper exists; nothing is rewritten when it does not. */
  readonly wrapperPresent: boolean;
  /** Shim paths (relative to the project root) rewritten by this pass. */
  readonly repointed: readonly string[];
  /** Shim paths that could not be read or rewritten (e.g. not writable). */
  readonly failed: readonly string[];
  /**
   * Shim paths that call `sonar hook` but are neither the vendor form nor
   * already repointed; left untouched for an operator to patch per §4a.
   */
  readonly unrecognized: readonly string[];
}

/**
 * Extract the vendor event from an unmodified vendor shim body.
 * @param body - Shim file contents
 * @returns The event name, or undefined when the body is already repointed,
 *   customised, or otherwise not recognisably the vendor's
 */
export function parseVendorShimEvent(body: string): string | undefined {
  if (body.includes(WRAPPER_MARKER)) return undefined;
  const lines = body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"));
  const hookEvents = lines
    .map(line => VENDOR_HOOK_LINE.exec(line)?.[1])
    .filter((event): event is string => event !== undefined);
  const allRecognised = lines.every(
    line =>
      VENDOR_HOOK_LINE.test(line) ||
      VENDOR_GUARD_LINES.some(pattern => pattern.test(line))
  );
  return allRecognised && hookEvents.length === 1 ? hookEvents[0] : undefined;
}

/**
 * Render a shim that delegates to the wrapper.
 * @param shebang - The original shim's shebang line, if it had one
 * @param relWrapper - POSIX path from the shim's directory to the wrapper
 * @param event - Vendor event name the wrapper forwards to `sonar hook`
 * @returns New shim body
 */
export function renderRepointedShim(
  shebang: string | undefined,
  relWrapper: string,
  event: string
): string {
  return [
    shebang ?? "#!/bin/bash",
    `# Delegates to Lisa's ${SONAR_WRAPPER_PATH}, which resolves`,
    "# SONARQUBE_CLI_TOKEN and downgrades an unauthenticated scanner to a warning.",
    "# Re-running `sonar integrate` restores the vendor shim; `lisa apply` repoints it.",
    "if ! command -v sonar &> /dev/null; then",
    "  exit 0",
    "fi",
    'here="$(cd -- "$(dirname -- "$0")" && pwd)"',
    `exec bash "\${here}/${relWrapper}" ${event}`,
    "",
  ].join("\n");
}

/**
 * Whether a path is a regular, non-symlinked file, and its permission bits.
 * @param absolute - Absolute path to inspect
 * @returns The permission bits, or undefined when missing or not a regular file
 */
async function regularFileMode(absolute: string): Promise<number | undefined> {
  const stats = await lstat(absolute).catch(() => undefined);
  if (stats === undefined || !stats.isFile()) return undefined;
  return stats.mode & 0o7777;
}

/**
 * Classify a shim body and, when it is the vendor's, rewrite it in place.
 * @param absolute - Absolute shim path
 * @param relative - Shim path relative to the project root
 * @param mode - Permission bits to restore after the write
 * @returns The outcome for this shim
 */
async function rewriteIfVendor(
  absolute: string,
  relative: string,
  mode: number
): Promise<ShimOutcome> {
  const body = await readFile(absolute, "utf8");
  const event = parseVendorShimEvent(body);
  if (event === undefined) {
    const stray = !body.includes(WRAPPER_MARKER) && SONAR_HOOK_CALL.test(body);
    return stray ? "unrecognized" : "skipped";
  }
  const firstLine = body.split("\n", 1)[0];
  const shebang = firstLine?.startsWith("#!") ? firstLine : undefined;
  const relWrapper = path.posix.relative(
    path.posix.dirname(relative),
    SONAR_WRAPPER_PATH
  );
  await writeFile(absolute, renderRepointedShim(shebang, relWrapper, event));
  await chmod(absolute, mode);
  return "repointed";
}

/**
 * Repoint one shim when it is an unmodified vendor shim.
 *
 * Never throws: an unreadable or unwritable shim is reported as `failed`, so
 * one bad file cannot abort (and roll back) the whole apply.
 * @param projectRoot - Absolute project root
 * @param relative - Shim path relative to the project root
 * @returns The outcome for this shim
 */
async function repointShim(
  projectRoot: string,
  relative: string
): Promise<ShimOutcome> {
  const absolute = path.join(projectRoot, relative);
  const mode = await regularFileMode(absolute);
  if (mode === undefined) return "skipped";
  try {
    return await rewriteIfVendor(absolute, relative, mode);
  } catch {
    return "failed";
  }
}

/**
 * Collect the shim paths that ended with one outcome.
 * @param outcomes - Path/outcome pairs in {@link SONAR_SHIM_PATHS} order
 * @param wanted - Outcome to select
 * @returns Matching shim paths
 */
function pathsWith(
  outcomes: readonly (readonly [string, ShimOutcome])[],
  wanted: ShimOutcome
): readonly string[] {
  return outcomes
    .filter(([, outcome]) => outcome === wanted)
    .map(([relative]) => relative);
}

/**
 * Repoint every documented vendor shim in a project at Lisa's wrapper.
 *
 * A no-op when the wrapper is absent: a shim pointed at a missing wrapper would
 * fail every hook, which is worse than the vendor behaviour it replaces.
 * @param projectRoot - Absolute project root
 * @returns Whether the wrapper exists, and each shim's outcome by category
 */
export async function repointSonarShims(
  projectRoot: string
): Promise<SonarShimRepointResult> {
  const wrapperMode = await regularFileMode(
    path.join(projectRoot, SONAR_WRAPPER_PATH)
  );
  if (wrapperMode === undefined) {
    return {
      wrapperPresent: false,
      repointed: [],
      failed: [],
      unrecognized: [],
    };
  }
  const outcomes = await Promise.all(
    SONAR_SHIM_PATHS.map(
      async relative =>
        [relative, await repointShim(projectRoot, relative)] as const
    )
  );
  return {
    wrapperPresent: true,
    repointed: pathsWith(outcomes, "repointed"),
    failed: pathsWith(outcomes, "failed"),
    unrecognized: pathsWith(outcomes, "unrecognized"),
  };
}
