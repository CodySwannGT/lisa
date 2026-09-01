/**
 * @file postinstall-trampoline-source.ts
 * @description The JS source that runs inside the detached reconciliation child.
 *
 * Split out of `postinstall-trampoline` because it is a different kind of code:
 * everything here is a string template compiled into a `node -e` payload, which
 * cannot import anything (it runs while package.json — the file it is repairing
 * — is in flux), so every constant it needs is inlined as a JSON literal at
 * build time. Keeping it beside the scheduling logic made one module that was
 * half TypeScript and half generated JavaScript.
 *
 * The child's job, in order: announce that it is alive, wait for the package
 * manager to exit, re-apply Lisa, and regenerate lockfiles when package.json no
 * longer matches the baseline the package manager resolved its lockfile from —
 * then record what it did (CodySwannGT/lisa#2750).
 * @module utils
 */
import { PM_PATH_ENV_NAMES, PM_PATH_ENV_PREFIXES } from "./pm-env.js";
import type {
  LockfileRegenPlan,
  PackageManager,
} from "./package-manager-detect.js";
import {
  buildTrampolineRegenReporter,
  buildTrampolineReporter,
} from "./postinstall-trampoline-report-source.js";

/**
 * What the detached child needs in order to leave a durable record of itself.
 *
 * Passed in by the caller rather than imported, so this module stays free of a
 * dependency on `core/`: the report's path and schema still have exactly one
 * definition (`core/reconciliation-report`), and it travels here as data.
 */
export interface TrampolineReporting {
  /** Absolute path of the report file the child writes. */
  readonly reportPath: string;
  /** Schema version stamped into every write. */
  readonly reportSchemaVersion: number;
  /** Lisa version, used only when no scheduled report exists to inherit it from. */
  readonly lisaVersion: string;
  /**
   * sha256 of package.json as it stood BEFORE the apply that scheduled this
   * child — which is the content the package manager resolved its lockfile
   * from.
   *
   * This is the whole of CodySwannGT/lisa#2750. The child used to regenerate
   * lockfiles only when ITS OWN re-apply changed package.json, which on a plain
   * `bun install` it never does: the first apply (inside postinstall) already
   * made the change, and the re-apply is idempotent. So the drift the first
   * apply created — the drift the trampoline exists to repair — was the one
   * case that never triggered a regen. Comparing against this baseline asks the
   * question that actually matters: does package.json still match what the
   * lockfile was built from?
   */
  readonly baselinePackageJsonHash: string | null;
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
  readonly reporting: TrampolineReporting;
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
export function buildTrampolineSource(params: TrampolineSourceParams): string {
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
    pmEnvPrefixes: JSON.stringify(PM_PATH_ENV_PREFIXES),
    pmEnvNames: JSON.stringify(PM_PATH_ENV_NAMES),
    reportPath: JSON.stringify(params.reporting.reportPath),
    reportSchemaVersion: JSON.stringify(params.reporting.reportSchemaVersion),
    lisaVersion: JSON.stringify(params.reporting.lisaVersion),
    baselineHash: JSON.stringify(params.reporting.baselinePackageJsonHash),
  } as const;

  return [
    buildTrampolinePrelude(literals),
    buildTrampolineReporter(literals),
    buildTrampolinePmHelpers(literals),
    buildTrampolineHelpers(literals),
    buildTrampolineRegenReporter(),
    buildTrampolineMain(literals),
  ].join("\n");
}

/**
 * Inline `require` prelude + the lockfile plan table. Kept separate so each
 * chunk of the trampoline source stays under the 75-line max-lines-per-function
 * cap enforced by eslint.
 * @param literals - Inlined JSON-safe literals
 * @param literals.lockfilePlans - JSON-serialized lockfile plan table
 * @param literals.pmEnvPrefixes - JSON-serialized package-manager env var prefixes to strip
 * @param literals.pmEnvNames - JSON-serialized package-manager env var names to strip
 * @returns JS source fragment
 */
function buildTrampolinePrelude(literals: {
  readonly lockfilePlans: string;
  readonly pmEnvPrefixes: string;
  readonly pmEnvNames: string;
}): string {
  return `
    const { spawn } = require("node:child_process");
    const { createHash } = require("node:crypto");
    const {
      existsSync,
      mkdirSync,
      readFileSync,
      renameSync,
      writeFileSync,
    } = require("node:fs");
    const path = require("node:path");

    const LOCKFILE_PLANS = ${literals.lockfilePlans};
    const PM_ENV_PREFIXES = ${literals.pmEnvPrefixes};
    const PM_ENV_NAMES = ${literals.pmEnvNames};
    // Strip PM path/lifecycle vars from spawned bun/Lisa env. Mirrors pm-env.ts.
    function sanitizeEnv(env) {
      const bad = (k) => PM_ENV_NAMES.indexOf(k) !== -1 || PM_ENV_PREFIXES.some((p) => k.startsWith(p));
      return Object.fromEntries(Object.entries(env).filter(([k]) => !bad(k)));
    }
  `;
}

/**
 * Package-manager helpers inlined into the trampoline child: the `engines`
 * opt-out reader, the lockfile-presence detector, and the regen loop.
 *
 * The regen loop is still best-effort at the process level — a missing package
 * manager binary must never cascade into a failed install — but it now returns
 * which managers it tried and which failed, so the outcome can be recorded
 * instead of swallowed (CodySwannGT/lisa#2750).
 * @param literals - Inlined JSON-safe literals
 * @param literals.projectDir - Project directory whose lockfiles are regenerated
 * @returns JS source fragment
 */
function buildTrampolinePmHelpers(literals: {
  readonly projectDir: string;
}): string {
  return `
    function enginesForbiddenManagers(dir) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        const engines = (pkg && pkg.engines) || {};
        return ["bun", "npm", "yarn", "pnpm"].filter(
          (pm) => typeof engines[pm] === "string" && /please-use|do-not-use/i.test(engines[pm])
        );
      } catch {
        return [];
      }
    }

    function detectPackageManagers(dir) {
      const forbidden = enginesForbiddenManagers(dir);
      return Object.values(LOCKFILE_PLANS)
        .filter((plan) => [plan.lockfile].concat(plan.lockfileAlternatives || []).some((f) => existsSync(path.join(dir, f))))
        .map((plan) => plan.pm)
        .filter((pm) => forbidden.indexOf(pm) === -1);
    }

    async function regenerateLockfiles() {
      const attempted = [];
      const failed = [];
      for (const pm of detectPackageManagers(${literals.projectDir})) {
        const plan = LOCKFILE_PLANS[pm];
        if (!plan) continue;
        attempted.push(pm);
        // Still best-effort at the process level: a missing PM binary must not
        // cascade into an install failure. What changed is that the failure is
        // now RECORDED instead of swallowed outright, which is what makes a
        // regen that did not work distinguishable from one that had nothing to
        // do (CodySwannGT/lisa#2750).
        const ok = await spawnChild(plan.command, plan.args);
        if (!ok) {
          failed.push(pm + " (" + plan.command + " " + plan.args.join(" ") + ")");
        }
      }
      return { attempted: attempted, failed: failed };
    }
  `;
}

/**
 * Process helpers inlined into the trampoline child: parent-liveness probe,
 * file hasher, the wait loop, the sanitised child spawner, and the Lisa
 * re-invoker. Each mirrors an exported TS helper in `postinstall-trampoline` or
 * `package-manager-detect`, so the logic stays test-covered via those.
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
            env: Object.assign(sanitizeEnv(process.env), { [${literals.trampolineEnvVar}]: "1" }),
          });
          child.on("exit", (code) => resolve(code === 0));
          child.on("error", () => resolve(false));
        } catch {
          resolve(false);
        }
      });
    }

    function runLisa() {
      // BOTH flags, and they mean different things since
      // CodySwannGT/lisa#3066: --skip-git-check waives the clean-tree check,
      // which this child needs because the install it follows has already
      // rewritten package.json and the lockfile; --postinstall-safe declares
      // the install-lifecycle context that selects the reduced apply, so a
      // trampoline never regenerates committed agent trees. It is a FLAG
      // rather than LISA_POSTINSTALL=1 because sanitizeEnv strips this child's
      // environment, and a declaration that can be stripped can be lost
      // silently.
      return spawnChild(${literals.nodeBin}, [${literals.lisaEntry}, "--yes", "--skip-git-check", "--postinstall-safe", ${literals.projectDir}]);
    }

  `;
}

/**
 * Top-level async IIFE that orchestrates the trampoline child:
 * 1) announce that the child is alive (so a spawn that produced nothing is
 *    distinguishable from one that ran),
 * 2) wait for the parent PM to exit,
 * 3) re-run Lisa,
 * 4) regenerate lockfiles when package.json no longer matches the baseline the
 *    package manager resolved its lockfile from,
 * 5) record the outcome either way.
 *
 * Step 4 is the fix for CodySwannGT/lisa#2750. It used to compare package.json
 * before and after the child's OWN re-apply, and regenerate only when that
 * re-apply changed something. On the path that matters — a plain `bun install`
 * where the first apply (inside postinstall) already rewrote package.json and
 * the re-apply is therefore idempotent — that comparison is always equal, so
 * the regen never ran and the lockfile stayed exactly as stale as the install
 * left it. Measured on a bun consumer: `bun.lock`'s mtime never moved, while
 * the regen plan run by hand fixed the drift in 1.66 s.
 *
 * The baseline comparison asks the right question instead: package.json is
 * compared against its content BEFORE the first apply, which is what the
 * lockfile was built from. It also no longer requires the re-apply to have
 * SUCCEEDED — a re-apply that fails leaves the first apply's drift in place,
 * and refusing to regen there is the one case where the lockfile is guaranteed
 * wrong.
 *
 * Timing out MUST NOT re-run Lisa — that would reintroduce the package.json
 * race the trampoline is designed to avoid (parent PM still writing).
 * @param literals - Inlined JSON-safe literals
 * @param literals.settleDelayMs - Settle delay before re-invoking Lisa
 * @param literals.projectDir - Project directory Lisa will reconcile
 * @param literals.baselineHash - sha256 of package.json before the apply that scheduled this child
 * @returns JS source fragment
 */
function buildTrampolineMain(literals: {
  readonly settleDelayMs: string;
  readonly projectDir: string;
  readonly baselineHash: string;
}): string {
  return `
    (async () => {
      try {
        report(
          "started",
          "Waiting for the package manager to exit before re-applying Lisa.",
          []
        );
        const parentExited = await waitForParent();
        if (!parentExited) {
          report(
            "parent-wait-timed-out",
            "The package manager was still running after the wait deadline, so " +
              "Lisa did not re-apply (re-applying under a live package manager " +
              "is the race this exists to avoid). Lockfiles may be out of sync " +
              "with package.json.",
            []
          );
          process.exit(0);
        }
        await new Promise((r) => setTimeout(r, ${literals.settleDelayMs}));

        const pkgPath = path.join(${literals.projectDir}, "package.json");
        const baselineHash = ${literals.baselineHash};

        const lisaOk = await runLisa();
        const reapplyNote = lisaOk
          ? ""
          : " The re-apply itself exited non-zero; run it by hand to see why.";

        const postHash = hashFile(pkgPath);
        if (postHash === null) {
          report(
            "failed",
            "package.json could not be read after the re-apply, so lockfile " +
              "drift could not be assessed." + reapplyNote,
            []
          );
          process.exit(0);
        }

        // Compare against what the package manager built the lockfile FROM,
        // not against what this child's own idempotent re-apply changed.
        if (baselineHash !== null && postHash === baselineHash) {
          report(
            "not-needed",
            "package.json matches what the package manager resolved the " +
              "lockfile from, so no lockfile can be stale." + reapplyNote,
            []
          );
          process.exit(0);
        }

        reportRegen(await regenerateLockfiles(), reapplyNote);

        process.exit(0);
      } catch (error) {
        report(
          "failed",
          "The reconciliation aborted before completing: " +
            (error && error.message ? error.message : String(error)),
          []
        );
        process.exit(0);
      }
    })();
  `;
}
