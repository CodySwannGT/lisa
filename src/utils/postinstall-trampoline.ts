import { spawn } from "node:child_process";
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
 * Spawn a fully detached child process that waits for the parent package manager
 * to exit, then re-runs Lisa to reconcile package.json. The child is detached
 * (independent process group, stdio ignored, unref'd) so the parent package
 * manager does not wait for it.
 * @param projectDir - Absolute path to the project directory Lisa will reconcile
 * @param lisaDistDir - Absolute path to Lisa's dist directory (where index.js lives)
 * @param parentPid - PID of the package-manager process to wait on (usually process.ppid)
 */
export function scheduleReconciliationChild(
  projectDir: string,
  lisaDistDir: string,
  parentPid: number
): void {
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
  });

  const child = spawn(nodeBin, ["-e", trampolineSource], {
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
}

/**
 * Build the inline JS source that runs inside the detached trampoline child.
 * The source is passed to `node -e` so it must be self-contained (no imports that
 * require resolution via package.json, which is exactly the file we're racing).
 * @param params - Embedded constants to inline into the trampoline source
 * @returns JS source suitable for `node -e`
 */
function buildTrampolineSource(params: TrampolineSourceParams): string {
  // JSON.stringify gives us safe inline literals for all primitive types.
  const parentPid = JSON.stringify(params.parentPid);
  const pollIntervalMs = JSON.stringify(params.pollIntervalMs);
  const maxWaitMs = JSON.stringify(params.maxWaitMs);
  const settleDelayMs = JSON.stringify(params.settleDelayMs);
  const lisaEntry = JSON.stringify(params.lisaEntry);
  const projectDir = JSON.stringify(params.projectDir);
  const nodeBin = JSON.stringify(params.nodeBin);
  const trampolineEnvVar = JSON.stringify(params.trampolineEnvVar);

  return `
    const { spawn } = require("node:child_process");

    function isAlive(pid) {
      if (!pid || pid <= 1) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    }

    // Returns true when the parent has exited, false when the deadline elapsed
    // while the parent was still alive. Timing out MUST NOT re-run Lisa —
    // that would reintroduce the package.json race the trampoline is designed
    // to avoid (parent PM still writing).
    async function waitForParent() {
      const deadline = Date.now() + ${maxWaitMs};
      while (Date.now() < deadline) {
        if (!isAlive(${parentPid})) return true;
        await new Promise((r) => setTimeout(r, ${pollIntervalMs}));
      }
      return false;
    }

    (async () => {
      try {
        const parentExited = await waitForParent();
        if (!parentExited) {
          // Parent still running after max wait — bail rather than race the PM.
          process.exit(0);
        }
        await new Promise((r) => setTimeout(r, ${settleDelayMs}));
        const child = spawn(
          ${nodeBin},
          [${lisaEntry}, "--yes", "--skip-git-check", ${projectDir}],
          {
            cwd: ${projectDir},
            stdio: "ignore",
            env: Object.assign({}, process.env, { [${trampolineEnvVar}]: "1" }),
          }
        );
        child.on("exit", () => process.exit(0));
      } catch {
        process.exit(0);
      }
    })();
  `;
}
