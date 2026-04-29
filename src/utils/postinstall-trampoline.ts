import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Known package managers whose lockfiles must be regenerated when Lisa's apply
 * mutates package.json (e.g., adds/updates resolutions or overrides entries).
 */
export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

/**
 * Description of a package manager's lockfile file + the command Lisa should run
 * to rebuild the lockfile without running install scripts.
 */
export interface LockfileRegenPlan {
  readonly pm: PackageManager;
  readonly lockfile: string;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Per-PM lockfile + regen command mapping. The regen commands are all
 * "sync lockfile without running scripts" variants — we do NOT want to
 * re-run lifecycle scripts (that would re-trigger the trampoline).
 *
 * bun: `bun install` is the canonical way to sync bun.lock after package.json
 * changes. As of bun 1.x there is no `--lockfile-only` flag; `bun install`
 * is already fast when node_modules is up-to-date and will simply update
 * bun.lock to match package.json. We pass `--ignore-scripts` to avoid re-running
 * the parent PM's lifecycle hooks (which triggered this trampoline to begin with).
 */
const INSTALL = "install";
const IGNORE_SCRIPTS = "--ignore-scripts";

const LOCKFILE_REGEN_PLANS: Readonly<
  Record<PackageManager, LockfileRegenPlan>
> = {
  bun: {
    pm: "bun",
    lockfile: "bun.lock",
    command: "bun",
    args: [INSTALL, IGNORE_SCRIPTS],
  },
  npm: {
    pm: "npm",
    lockfile: "package-lock.json",
    command: "npm",
    args: [INSTALL, "--package-lock-only", IGNORE_SCRIPTS],
  },
  pnpm: {
    pm: "pnpm",
    lockfile: "pnpm-lock.yaml",
    command: "pnpm",
    args: [INSTALL, "--lockfile-only", IGNORE_SCRIPTS],
  },
  yarn: {
    pm: "yarn",
    lockfile: "yarn.lock",
    command: "yarn",
    args: [INSTALL, "--mode", "update-lockfile"],
  },
} as const;

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
 * Detect which package managers the project uses based on lockfile presence.
 *
 * A project may have more than one lockfile (the CDK dual-lockfile pattern
 * keeps `bun.lock` for local dev while publishing `package-lock.json` for
 * consumers), in which case every present lockfile must be regenerated so both
 * stay in sync with package.json.
 * @param projectDir - Absolute path to the project directory
 * @returns Ordered list of detected package managers (possibly empty)
 */
export function detectPackageManagers(
  projectDir: string
): readonly PackageManager[] {
  return Object.values(LOCKFILE_REGEN_PLANS)
    .filter(plan => existsSync(path.join(projectDir, plan.lockfile)))
    .map(plan => plan.pm);
}

/**
 * Get the regen plan (command/args/lockfile) for a given package manager.
 * @param pm - Package manager to look up
 * @returns Regen plan describing which command to spawn
 */
export function getLockfileRegenPlan(pm: PackageManager): LockfileRegenPlan {
  return LOCKFILE_REGEN_PLANS[pm];
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
 * A blocking (non-detached) CI variant was previously attempted so that the
 * parent would wait for reconciliation before the next CI step ran. However,
 * this created a circular deadlock: the package manager blocks waiting for Lisa
 * (postinstall), Lisa blocks waiting for the trampoline child, and the
 * trampoline child polls `parentPid` (the package manager) waiting for it to
 * exit — a wait that can never complete. After the 120 s `MAX_WAIT_MS` timeout
 * the child exits without running reconciliation at all. Always using the
 * detached pattern avoids this deadlock and ensures reconciliation actually runs.
 * @param projectDir - Absolute path to the project directory Lisa will reconcile
 * @param lisaDistDir - Absolute path to Lisa's dist directory (where index.js lives)
 * @param parentPid - PID of the package-manager process to wait on (usually process.ppid)
 * @param spawnFn - Optional spawn implementation; defaults to node:child_process spawn. Tests pass a vi.fn() spy here as a dependency-injection seam, avoiding the unreliable vi.doMock-on-builtins pattern that breaks under v8 coverage in CI runners.
 * @returns Promise that resolves immediately after spawning the detached child
 */
export async function scheduleReconciliationChild(
  projectDir: string,
  lisaDistDir: string,
  parentPid: number,
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
  });

  const child = spawnFn(nodeBin, ["-e", trampolineSource], {
    cwd: projectDir,
    detached: true,
    stdio: "ignore",
    env: {
      ...inheritedEnv(),
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

/**
 * Shape of the parameters embedded into the trampoline's inline JS source.
 * Grouping keeps the callsite readable and the injected literals explicit.
 */
interface TrampolineSourceParams {
  readonly parentPid: number;
  readonly pollIntervalMs: number;
  readonly maxWaitMs: number;
  readonly settleDelayMs: number;
  readonly lisaEntry: string;
  readonly projectDir: string;
  readonly nodeBin: string;
  readonly trampolineEnvVar: string;
  readonly lockfileRegenPlans: Readonly<
    Record<PackageManager, LockfileRegenPlan>
  >;
}

/**
 * Build the inline JS source that runs inside the detached trampoline child.
 * The source is passed to `node -e` so it must be self-contained (no imports that
 * require resolution via package.json, which is exactly the file we're racing).
 *
 * The trampoline now runs in two phases inside the child:
 * 1. Wait for the parent PM to exit, then re-invoke Lisa to reconcile package.json.
 * 2. If Lisa's re-invocation mutated package.json, regenerate whichever lockfiles
 *    are present in the project so `bun install --frozen-lockfile` / `npm ci` in
 *    downstream CI jobs do not fail with "lockfile had changes, but lockfile is
 *    frozen." Lockfile regen runs with `--ignore-scripts` so the parent PM's
 *    lifecycle hooks are not re-invoked (which would retrigger this trampoline).
 * @param params - Embedded constants to inline into the trampoline source
 * @returns JS source suitable for `node -e`
 */
function buildTrampolineSource(params: TrampolineSourceParams): string {
  // JSON.stringify gives us safe inline literals for all primitive types.
  const literals = {
    parentPid: JSON.stringify(params.parentPid),
    pollIntervalMs: JSON.stringify(params.pollIntervalMs),
    maxWaitMs: JSON.stringify(params.maxWaitMs),
    settleDelayMs: JSON.stringify(params.settleDelayMs),
    lisaEntry: JSON.stringify(params.lisaEntry),
    projectDir: JSON.stringify(params.projectDir),
    nodeBin: JSON.stringify(params.nodeBin),
    trampolineEnvVar: JSON.stringify(params.trampolineEnvVar),
    lockfilePlans: JSON.stringify(params.lockfileRegenPlans),
  } as const;

  return [
    buildTrampolinePrelude(literals),
    buildTrampolineHelpers(literals),
    buildTrampolineMain(literals),
  ].join("\n");
}

/**
 * Inline `require` prelude + the lockfile plan table. Kept separate so each
 * chunk of the trampoline source stays under the 75-line max-lines-per-function
 * cap enforced by eslint.
 * @param literals - Inlined JSON-safe literals
 * @param literals.lockfilePlans - JSON-serialized lockfile plan table
 * @returns JS source fragment
 */
function buildTrampolinePrelude(literals: {
  readonly lockfilePlans: string;
}): string {
  return `
    const { spawn } = require("node:child_process");
    const { createHash } = require("node:crypto");
    const { existsSync, readFileSync } = require("node:fs");
    const path = require("node:path");

    const LOCKFILE_PLANS = ${literals.lockfilePlans};
  `;
}

/**
 * Helper functions inlined into the trampoline child: parent-liveness probe,
 * file hasher, package-manager detector, Lisa re-invoker, and best-effort
 * lockfile regenerator. Each mirrors an exported TS helper in this module so
 * the logic stays test-covered via the exported versions.
 * @param literals - Inlined JSON-safe literals
 * @param literals.parentPid - Parent package-manager PID for liveness probe
 * @param literals.pollIntervalMs - Poll interval for parent-liveness checks
 * @param literals.maxWaitMs - Max wait deadline before bailing out
 * @param literals.nodeBin - Node binary path to re-invoke Lisa with
 * @param literals.lisaEntry - Absolute path to Lisa's dist/index.js
 * @param literals.projectDir - Project directory Lisa will reconcile
 * @param literals.trampolineEnvVar - Env var name used to mark child as trampoline
 * @returns JS source fragment
 */
function buildTrampolineHelpers(literals: {
  readonly parentPid: string;
  readonly pollIntervalMs: string;
  readonly maxWaitMs: string;
  readonly nodeBin: string;
  readonly lisaEntry: string;
  readonly projectDir: string;
  readonly trampolineEnvVar: string;
}): string {
  return `
    function isAlive(pid) {
      if (!pid || pid <= 1) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    }

    function hashFile(p) {
      try { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
      catch { return null; }
    }

    function detectPackageManagers(dir) {
      return Object.values(LOCKFILE_PLANS)
        .filter((plan) => existsSync(path.join(dir, plan.lockfile)))
        .map((plan) => plan.pm);
    }

    async function waitForParent() {
      const deadline = Date.now() + ${literals.maxWaitMs};
      while (Date.now() < deadline) {
        if (!isAlive(${literals.parentPid})) return true;
        await new Promise((r) => setTimeout(r, ${literals.pollIntervalMs}));
      }
      return false;
    }

    function spawnChild(command, args) {
      return new Promise((resolve) => {
        try {
          const child = spawn(command, args, {
            cwd: ${literals.projectDir},
            stdio: "ignore",
            env: Object.assign({}, process.env, { [${literals.trampolineEnvVar}]: "1" }),
          });
          child.on("exit", (code) => resolve(code === 0));
          child.on("error", () => resolve(false));
        } catch {
          resolve(false);
        }
      });
    }

    function runLisa() {
      return spawnChild(${literals.nodeBin}, [${literals.lisaEntry}, "--yes", "--skip-git-check", ${literals.projectDir}]);
    }

    async function regenerateLockfiles() {
      for (const pm of detectPackageManagers(${literals.projectDir})) {
        const plan = LOCKFILE_PLANS[pm];
        if (!plan) continue;
        // Best-effort: failures are intentionally swallowed so a missing PM
        // binary (e.g., no global bun on the PATH) does not cascade into an
        // install failure.
        await spawnChild(plan.command, plan.args);
      }
    }
  `;
}

/**
 * Top-level async IIFE that orchestrates the trampoline child:
 * 1) wait for parent PM to exit,
 * 2) hash package.json,
 * 3) re-run Lisa,
 * 4) if Lisa changed package.json, regenerate lockfiles.
 *
 * Timing out MUST NOT re-run Lisa — that would reintroduce the package.json
 * race the trampoline is designed to avoid (parent PM still writing).
 * @param literals - Inlined JSON-safe literals
 * @param literals.settleDelayMs - Settle delay before re-invoking Lisa
 * @param literals.projectDir - Project directory Lisa will reconcile
 * @returns JS source fragment
 */
function buildTrampolineMain(literals: {
  readonly settleDelayMs: string;
  readonly projectDir: string;
}): string {
  return `
    (async () => {
      try {
        const parentExited = await waitForParent();
        if (!parentExited) {
          process.exit(0);
        }
        await new Promise((r) => setTimeout(r, ${literals.settleDelayMs}));

        const pkgPath = path.join(${literals.projectDir}, "package.json");
        const preHash = hashFile(pkgPath);

        const lisaOk = await runLisa();

        const postHash = hashFile(pkgPath);
        const packageJsonChanged =
          lisaOk && preHash !== null && postHash !== null && preHash !== postHash;

        if (packageJsonChanged) {
          await regenerateLockfiles();
        }

        process.exit(0);
      } catch {
        process.exit(0);
      }
    })();
  `;
}
