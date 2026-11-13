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
 * it rewrites only a shim at a documented location whose body is exactly the
 * vendor's (comments aside, the `command -v sonar` guard followed by one
 * `sonar hook <event>` line, in that order). A shim that already executes the
 * wrapper is left alone, which makes the rewrite idempotent, and any other body
 * is treated as operator-customised and never touched. Write safety (symlinked
 * ancestors, atomic replacement, read-only shims) lives in `sonar-shim-fs.ts`.
 * @module sonar/sonar-shim-repoint
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  parentInsideProject,
  regularFileMode,
  replaceFileAtomically,
} from "./sonar-shim-fs.js";

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

/**
 * An executable line delegating to the wrapper. Only a real invocation counts
 * as "already repointed": a comment that merely names the wrapper must not
 * hide a live `sonar hook` call.
 */
const WRAPPER_INVOCATION =
  /^exec\s+bash\s+"?[^"\s]*scripts\/lisa-hooks\/sonar-secrets\.sh"?\s+[a-z][a-z0-9-]*$/;

/**
 * The vendor shim's guard, in the only order it is written: anything else (an
 * early `exit 0` that disables the hook, say) is a customisation, and
 * rewriting it would silently re-enable or change what it does.
 */
const VENDOR_GUARD_SEQUENCE: readonly RegExp[] = [
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
  /**
   * Shim paths that could not be read or rewritten safely: not readable, not
   * writable, or reached through a symlinked folder outside the project.
   */
  readonly failed: readonly string[];
  /**
   * Shim paths that call `sonar hook` but are neither the vendor form nor
   * already repointed; left untouched for an operator to patch per §4a.
   */
  readonly unrecognized: readonly string[];
}

/**
 * The executable lines of a shim: trimmed, without blanks or comments.
 * @param body - Shim file contents
 * @returns Non-blank, non-comment lines in file order
 */
function executableLines(body: string): readonly string[] {
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"));
}

/**
 * Whether a shim already executes the wrapper.
 * @param body - Shim file contents
 * @returns True when an executable line invokes the wrapper
 */
export function invokesWrapper(body: string): boolean {
  return executableLines(body).some(line => WRAPPER_INVOCATION.test(line));
}

/**
 * Extract the vendor event from an unmodified vendor shim body.
 * @param body - Shim file contents
 * @returns The event name, or undefined when the body is already repointed,
 *   customised, or otherwise not exactly the vendor's guard-then-hook sequence
 */
export function parseVendorShimEvent(body: string): string | undefined {
  const lines = executableLines(body);
  if (lines.length !== VENDOR_GUARD_SEQUENCE.length + 1) return undefined;
  const guarded = VENDOR_GUARD_SEQUENCE.every((pattern, index) =>
    pattern.test(lines[index] ?? "")
  );
  const hookLine = lines[VENDOR_GUARD_SEQUENCE.length] ?? "";
  return guarded ? VENDOR_HOOK_LINE.exec(hookLine)?.[1] : undefined;
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
 * Called with each shim's absolute path just before it is replaced, so the
 * caller can back it up (apply registers it for rollback).
 */
export type BeforeShimWrite = (absolute: string) => Promise<void>;

/** Options for {@link repointSonarShims}. */
export interface RepointSonarShimsOptions {
  /** Invoked before each replacement; a rejection marks the shim `failed`. */
  readonly beforeWrite?: BeforeShimWrite;
}

/**
 * Classify a body that is not a vendor shim.
 * @param body - Shim file contents
 * @returns `unrecognized` when it still calls `sonar hook` directly
 */
function classifyNonVendor(body: string): ShimOutcome {
  if (invokesWrapper(body)) return "skipped";
  const callsHook = executableLines(body).some(line =>
    SONAR_HOOK_CALL.test(line)
  );
  return callsHook ? "unrecognized" : "skipped";
}

/**
 * Classify a shim body and, when it is the vendor's, rewrite it in place.
 * @param absolute - Absolute shim path
 * @param relative - Shim path relative to the project root
 * @param mode - Permission bits to restore after the write
 * @param beforeWrite - Hook run just before the replacement
 * @returns The outcome for this shim
 */
async function rewriteIfVendor(
  absolute: string,
  relative: string,
  mode: number,
  beforeWrite: BeforeShimWrite | undefined
): Promise<ShimOutcome> {
  const body = await readFile(absolute, "utf8");
  const event = invokesWrapper(body) ? undefined : parseVendorShimEvent(body);
  if (event === undefined) return classifyNonVendor(body);
  const firstLine = body.split("\n", 1)[0];
  const shebang = firstLine?.startsWith("#!") ? firstLine : undefined;
  const relWrapper = path.posix.relative(
    path.posix.dirname(relative),
    SONAR_WRAPPER_PATH
  );
  await beforeWrite?.(absolute);
  await replaceFileAtomically(
    absolute,
    renderRepointedShim(shebang, relWrapper, event),
    mode
  );
  return "repointed";
}

/**
 * Repoint one shim when it is an unmodified vendor shim.
 *
 * Never throws: an unreadable or unwritable shim, or one whose parent folder
 * resolves outside the project through a symlink, is reported as `failed`, so
 * one bad file cannot abort (and roll back) the whole apply and the operator
 * is told about it.
 * @param projectRoot - Absolute project root
 * @param relative - Shim path relative to the project root
 * @param beforeWrite - Hook run just before the replacement
 * @returns The outcome for this shim
 */
async function repointShim(
  projectRoot: string,
  relative: string,
  beforeWrite: BeforeShimWrite | undefined
): Promise<ShimOutcome> {
  const absolute = path.join(projectRoot, relative);
  const mode = await regularFileMode(absolute);
  if (mode === undefined) return "skipped";
  try {
    if (!(await parentInsideProject(projectRoot, absolute))) return "failed";
    return await rewriteIfVendor(absolute, relative, mode, beforeWrite);
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
 * @param options - Optional pre-write hook (used by apply for rollback backup)
 * @returns Whether the wrapper exists, and each shim's outcome by category
 */
export async function repointSonarShims(
  projectRoot: string,
  options: RepointSonarShimsOptions = {}
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
        [
          relative,
          await repointShim(projectRoot, relative, options.beforeWrite),
        ] as const
    )
  );
  return {
    wrapperPresent: true,
    repointed: pathsWith(outcomes, "repointed"),
    failed: pathsWith(outcomes, "failed"),
    unrecognized: pathsWith(outcomes, "unrecognized"),
  };
}
