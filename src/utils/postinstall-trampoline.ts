import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeEnvForReconciliation } from "./pm-env.js";
import {
  type LockfileRegenPlan,
  type PackageManager,
  LOCKFILE_REGEN_PLANS,
  detectPackageManagers,
  enginesForbiddenManagers,
  getLockfileRegenPlan,
} from "./package-manager-detect.js";
import type { TrampolineReporting } from "./postinstall-trampoline-source.js";
import { buildTrampolineSource } from "./postinstall-trampoline-source.js";

/**
 * Env var set by npm/bun/yarn/pnpm when running lifecycle scripts (postinstall, etc.).
 * Used to detect whether Lisa was invoked as a postinstall child of a package manager.
 */
const LIFECYCLE_ENV_VAR = "npm_package_json";

/**
 * Sentinel env var Lisa sets on the detached trampoline child so that the trampoline
 * re-run does not itself attempt to re-schedule (prevents infinite trampolines).
 */
const TRAMPOLINE_ENV_VAR = "LISA_POSTINSTALL_TRAMPOLINE";
const NPM_USER_AGENT_ENV_VAR = "npm_config_user_agent";
const NPM_EXEC_PATH_ENV_VAR = "npm_execpath";

/**
 * How long the trampoline will wait for the parent package manager to exit before
 * giving up. Applies in the worst case (PM hangs or exits without signal detection).
 */
const MAX_WAIT_MS = 120_000;

/**
 * Polling interval (ms) for parent-liveness check inside the trampoline.
 */
const POLL_INTERVAL_MS = 100;

/**
 * Settle delay (ms) after the parent has exited, giving the filesystem and any final
 * writes a moment to quiesce before Lisa re-applies its changes.
 */
const SETTLE_DELAY_MS = 250;

// Re-export the package-manager detection surface (imported above from
// package-manager-detect.ts) so existing importers/tests can keep importing it
// from this module.
export {
  LOCKFILE_REGEN_PLANS,
  detectPackageManagers,
  enginesForbiddenManagers,
  getLockfileRegenPlan,
};
export type { LockfileRegenPlan, PackageManager, TrampolineReporting };

/**
 * Read an env var by name without widening the project-wide process.env ban.
 * Lisa's CLI isn't a Lambda handler or Nest service; it has to introspect its
 * own package-manager lifecycle context (which, by construction, is supplied
 * via externally set env vars) to decide whether to trampoline. Routing these
 * presence checks through ConfigService/getStandaloneConfig would not add
 * type-safety. The eslint-disable is scoped to the single read expression so
 * no other process.env usage in this file is implicitly allowed.
 * @param name - Name of the env variable to read
 * @returns Value or undefined
 */
function readEnv(name: string): string | undefined {
  // eslint-disable-next-line no-restricted-syntax -- lifecycle detection requires reading externally-set env vars; scoped to this single read
  return process.env[name];
}

/**
 * Determine whether this Lisa invocation is running as a package-manager lifecycle
 * script (postinstall, prepare, etc.). Works across npm, bun, yarn, and pnpm since
 * all set npm_package_json while executing lifecycle scripts.
 * @returns true when running inside a package-manager lifecycle hook
 */
export function isRunningAsLifecycleScript(): boolean {
  return Boolean(readEnv(LIFECYCLE_ENV_VAR));
}

/**
 * Determine whether this Lisa invocation is itself the trampoline reconciliation
 * child. Used to short-circuit further trampoline scheduling.
 * @returns true when running inside the detached reconciliation child
 */
export function isRunningAsTrampoline(): boolean {
  return readEnv(TRAMPOLINE_ENV_VAR) === "1";
}

/**
 * Determine whether the current lifecycle parent is npm itself.
 *
 * npm writes package-lock.json before dependency package postinstall scripts run,
 * and it does not repair the lock after a child script mutates the host
 * package.json. A detached trampoline fixes that eventually, but an immediate
 * `npm ci` can race it. For npm lifecycle runs we can safely reuse Lisa's
 * existing in-process lockfile regeneration before the install command exits.
 *
 * Bun/yarn/pnpm lifecycle behavior remains on the detached trampoline path
 * because those managers can still rewrite package.json after scripts finish.
 * @returns true when npm lifecycle env identifies npm as the parent package manager
 */
function isNpmLifecycleParent(): boolean {
  const userAgent = readEnv(NPM_USER_AGENT_ENV_VAR);
  if (userAgent?.startsWith("npm/")) {
    return true;
  }
  const execPath = readEnv(NPM_EXEC_PATH_ENV_VAR);
  return (
    execPath !== undefined && /(?:^|[/\\])npm(?:-cli\.js)?$/.test(execPath)
  );
}

/**
 * Detect whether Lisa is running inside a CI environment.
 *
 * Returns false when running inside a Vitest or Jest test runner, even if
 * `CI=true` is set, because test runners are not package-manager processes
 * and the trampoline's parent-liveness check would never terminate.
 * @returns true when common CI env vars indicate we're in a CI runner AND we
 *   are not currently inside a test runner process
 */
export function isRunningInCI(): boolean {
  if (readEnv("VITEST") !== undefined) return false;
  if (readEnv("JEST_WORKER_ID") !== undefined) return false;
  return (
    readEnv("CI") === "true" ||
    readEnv("CI") === "1" ||
    readEnv("GITHUB_ACTIONS") === "true" ||
    readEnv("CONTINUOUS_INTEGRATION") === "true"
  );
}

/**
 * Decide whether Lisa should spawn a post-install reconciliation trampoline.
 *
 * Background: `bun add` (and similar mutations in other package managers) reads
 * package.json into memory at the start of the command and writes it back at the end,
 * overwriting any changes that postinstall scripts make to package.json. This breaks
 * Lisa's `force`/`defaults`/`merge` semantics for package.json fields like
 * resolutions/overrides/scripts when the project is updated via
 * `bun add -d @codyswann/lisa\@latest` (escaped to avoid JSDoc misparsing).
 *
 * The trampoline works around this by spawning a fully detached child process that
 * waits for the package manager to exit, then re-runs Lisa. The re-run happens after
 * the package manager has finished writing package.json, so Lisa's changes survive.
 *
 * We only schedule the trampoline when:
 * - Lisa is running as a lifecycle script (so the package-manager write race applies)
 * - Lisa is not already the trampoline child (no recursive scheduling)
 * - We're not in dry-run mode (no filesystem changes, nothing to reconcile)
 * @param dryRun - Whether Lisa is in dry-run mode
 * @returns true when reconciliation trampoline should be scheduled
 */
export function shouldSchedulePostinstallReconciliation(
  dryRun: boolean
): boolean {
  if (dryRun) return false;
  if (isRunningAsTrampoline()) return false;
  // Test runners (vitest, jest) frequently invoke `bun run` / `npm test` which
  // sets `npm_package_json`, making `isRunningAsLifecycleScript()` true. The
  // detached trampoline child then races against the test's temp-dir cleanup
  // and dies with ENOENT when its cwd vanishes. Same principle as
  // isRunningInCI's vitest/jest opt-out above — test runners are not real
  // package-manager processes and the trampoline must not spawn from them.
  if (readEnv("VITEST") !== undefined) return false;
  if (readEnv("JEST_WORKER_ID") !== undefined) return false;
  if (isNpmLifecycleParent()) return false;
  return isRunningAsLifecycleScript();
}

/**
 * Get the directory containing the currently running Lisa CLI entrypoint.
 * Walks up from the current module (utils) to dist/, then returns dist/.
 * This path is embedded in the trampoline shell script so it can re-invoke Lisa
 * without relying on cwd or a PATH lookup.
 *
 * Note: exported for testing but not part of the public API.
 * @param moduleUrl - import.meta.url of the caller (for ESM compatibility)
 * @returns Absolute path to the Lisa dist directory
 */
export function getLisaDistDir(moduleUrl: string): string {
  const filename = fileURLToPath(moduleUrl);
  // Walk from <dist>/utils/postinstall-trampoline.js → <dist>
  return path.resolve(path.dirname(filename), "..");
}

/**
 * Hash a file's contents (sha256, hex-encoded). Returns null if the file
 * does not exist or cannot be read. Used to detect whether Lisa mutated
 * package.json during its apply so we only regenerate lockfiles when needed.
 * @param filePath - Absolute path to the file
 * @returns Hex-encoded sha256 hash, or null if the file is unavailable
 */
export function hashFile(filePath: string): string | null {
  try {
    const contents = readFileSync(filePath);
    return createHash("sha256").update(contents).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Regenerate lockfiles in the current process (no trampoline, no detached child).
 *
 * This is the synchronous counterpart to the trampoline's `regenerateLockfiles`
 * closure. It runs in-process when Lisa is invoked manually (e.g.,
 * `node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check .`
 * after `npm install -D`), where no parent package-manager process is racing
 * to rewrite package.json. In that path the trampoline is never scheduled, so
 * without an in-process regen the lockfile drifts from package.json and the
 * next `npm ci` (or `bun install --frozen-lockfile`) fails.
 *
 * Best-effort: failures (missing PM binary, transient network issues) are
 * intentionally swallowed so a missing global PM does not cascade into an
 * apply failure. The caller should already have verified that the project's
 * primary package manager is on PATH before invoking Lisa manually.
 * @param projectDir - Absolute path to the project directory
 * @param spawnFn - Optional spawn implementation; defaults to node:child_process spawn. Tests pass a vi.fn() spy here as a DI seam.
 * @returns Promise that resolves once all detected lockfiles have been regenerated
 */
export async function regenerateLockfilesInProcess(
  projectDir: string,
  spawnFn: typeof spawn = spawn
): Promise<void> {
  for (const pm of detectPackageManagers(projectDir)) {
    const plan = LOCKFILE_REGEN_PLANS[pm];
    await new Promise<void>(resolve => {
      try {
        const child = spawnFn(plan.command, [...plan.args], {
          cwd: projectDir,
          stdio: "ignore",
        });
        child.on("exit", () => resolve());
        child.on("error", () => resolve());
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Spawn a reconciliation child process that waits for the parent package manager
 * to exit, then re-runs Lisa to reconcile package.json.
 *
 * The child is always spawned fully detached (independent process group, stdio
 * ignored, unref'd) so the parent package manager can exit normally. The
 * trampoline child then detects the parent exiting and re-runs Lisa after the
 * package manager has finished writing package.json.
 *
 * A blocking (non-detached) CI variant was previously attempted but created a
 * circular deadlock (PM waits for Lisa, Lisa waits for the child, the child
 * polls `parentPid` waiting for the PM) that only resolves after the 120 s
 * `MAX_WAIT_MS` timeout — without running reconciliation. Always detaching
 * avoids this deadlock and ensures reconciliation actually runs.
 * @param projectDir - Absolute path to the project directory Lisa will reconcile
 * @param lisaDistDir - Absolute path to Lisa's dist directory (where index.js lives)
 * @param parentPid - PID of the package-manager process to wait on (usually process.ppid)
 * @param reporting - Report path/schema plus the pre-apply package.json baseline the child compares against
 * @param spawnFn - Optional spawn implementation; defaults to node:child_process spawn. Tests pass a vi.fn() spy here as a dependency-injection seam, avoiding the unreliable vi.doMock-on-builtins pattern that breaks under v8 coverage in CI runners.
 * @returns Promise that resolves immediately after spawning the detached child
 */
export async function scheduleReconciliationChild(
  projectDir: string,
  lisaDistDir: string,
  parentPid: number,
  reporting: TrampolineReporting,
  // Dependency-injection seam: callers can override the spawn function for
  // testing. Default is the real node:child_process spawn. Production callers
  // pass nothing; tests pass a vi.fn() spy and assert on it directly without
  // relying on vi.doMock for node builtins (which is flaky in CI under v8
  // coverage). The seam is invisible to production callers.
  spawnFn: typeof spawn = spawn
): Promise<void> {
  const nodeBin = process.execPath;
  const lisaEntry = path.join(lisaDistDir, "index.js");

  const trampolineSource = buildTrampolineSource({
    parentPid,
    pollIntervalMs: POLL_INTERVAL_MS,
    maxWaitMs: MAX_WAIT_MS,
    settleDelayMs: SETTLE_DELAY_MS,
    lisaEntry,
    projectDir,
    nodeBin,
    trampolineEnvVar: TRAMPOLINE_ENV_VAR,
    lockfileRegenPlans: LOCKFILE_REGEN_PLANS,
    reporting,
  });

  const child = spawnFn(nodeBin, ["-e", trampolineSource], {
    cwd: projectDir,
    detached: true,
    stdio: "ignore",
    env: {
      // Strip PM path/lifecycle vars before the child inherits the env: a stale
      // npm_config_local_prefix / INIT_CWD from a SIBLING project's concurrent
      // install would otherwise redirect the re-run to the wrong project. See pm-env.ts.
      ...sanitizeEnvForReconciliation(inheritedEnv()),
      // Prevent the child from seeing package-manager lifecycle env vars that would
      // make it think it's a lifecycle script (breaks isRunningAsLifecycleScript).
      [LIFECYCLE_ENV_VAR]: "",
      [TRAMPOLINE_ENV_VAR]: "1",
    },
  });

  // Fully detach so the parent package manager can exit. The child's
  // waitForParent() will detect the exit and trigger reconciliation.
  child.unref();
}

/**
 * Snapshot the current process environment for the detached child. Centralised so
 * the one process.env access site is explicit and reviewable. The inline disable
 * is narrow (single expression) so no other process.env reads in this file are
 * accidentally allowed.
 * @returns Shallow copy of the current environment
 */
function inheritedEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- detached child requires the full parent environment to find node binaries/PATH; scoped to this single read
  return { ...process.env };
}
