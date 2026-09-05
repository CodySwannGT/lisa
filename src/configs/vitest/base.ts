/**
 * Vitest Configuration - Shared Base
 *
 * Exports shared configuration pieces that can be imported by
 * project-specific vitest.config.ts files. Reduces duplication between
 * typescript, nestjs, and other project type configurations.
 *
 * Published as part of the `@codyswann/lisa` npm package so downstream
 * projects can import these utilities directly from the package.
 * @see https://vitest.dev/config/
 * @module configs/vitest/base
 */
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import type { ViteUserConfig } from "vitest/config";
import { isUnitCoverageScope } from "../coverage-scope.js";
import { isInsideWorktree } from "../worktrees.js";
import { scratchNamespaceDir } from "./scratch-namespace-authority.js";
import { parseScratchRunRootName } from "./scratch-owner.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  parseScratchSupervisionLease,
} from "./scratch-supervision.js";

/** Vite UserConfig augmented with Vitest's `test` property */
type UserConfig = ViteUserConfig;

/**
 * Vitest coverage threshold shape — flat metrics without the `global` wrapper
 * that Jest uses. Projects store thresholds in the Jest-compatible format
 * (with `global` key) for portability; factories map to this shape internally.
 */
export interface VitestThresholds {
  readonly statements?: number;
  readonly branches?: number;
  readonly functions?: number;
  readonly lines?: number;
}

/**
 * Portable threshold format shared with Jest configs.
 * Projects use this in their threshold JSON files so the same file
 * works with both Jest (Expo/CDK) and Vitest (TypeScript/NestJS).
 */
export interface PortableThresholds {
  readonly global?: {
    readonly statements?: number;
    readonly branches?: number;
    readonly functions?: number;
    readonly lines?: number;
  };
  /**
   * The floor a unit-scoped run answers to, layered over `global`.
   *
   * Never reaches the runner under this name — `mergeThresholds` folds it into
   * `global` when the scope is unit and strips it either way, because both
   * runners read any non-`global` key as a path or glob and would go looking
   * for a directory called `unit`. That is a threshold that is not enforced and
   * does not complain, which is worse than one that errors.
   */
  readonly unit?: {
    readonly statements?: number;
    readonly branches?: number;
    readonly functions?: number;
    readonly lines?: number;
  };
  readonly [path: string]: unknown;
}

/**
 * Default coverage thresholds used when not specified in project config.
 * Projects can override via vitest.thresholds.json.
 */
export const defaultThresholds: PortableThresholds = {
  global: {
    statements: 70,
    branches: 70,
    functions: 70,
    lines: 70,
  },
};

/**
 * Default patterns to exclude from coverage collection.
 * Common across all stacks — stack-specific configs extend this list.
 *
 * Unlike Jest's `!`-prefixed negation patterns in `collectCoverageFrom`,
 * Vitest uses separate `include`/`exclude` arrays without `!` prefixes.
 */
export const defaultCoverageExclusions: readonly string[] = [
  "**/*.d.ts",
  "**/index.ts",
  "**/node_modules/**",
  "**/dist/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.mock.ts",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/components/ui/**",
];

/**
 * Default patterns to exclude from test discovery across all stacks.
 *
 * The `.claude/worktrees/` exclusion is intentionally NOT baked in here —
 * it is cwd-conditional and supplied by {@link worktreeExclusions} so that
 * a vitest run launched from INSIDE a worktree can still discover its own
 * tests. Stack factories spread `worktreeExclusions()` alongside this list.
 */
export const defaultTestExclusions: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
];

/**
 * Returns the worktree exclusion globs a stack config should add to skip
 * test files / coverage that live inside an agent worktree.
 *
 * Lisa manages scratch worktrees for subagents under TWO roots —
 * `.claude/worktrees/` and a bare `.worktrees/` — and both must be covered.
 * Omitting the second one let sibling worktrees dominate test discovery from
 * the primary checkout (one host project measured 13,821 of 14,277 collected
 * files coming from other branches' worktrees), so the local suite reported
 * other agents' in-flight failures instead of this checkout's.
 *
 * When vitest runs from the primary checkout, tests inside those worktrees
 * should be skipped — each worktree has its own vitest run. When vitest runs
 * from INSIDE a worktree (the project root *is* the worktree), the same globs
 * match every path under root and vitest finds zero tests. This returns the
 * globs only when the current working directory is outside a worktree, so each
 * stack factory can spread them into its `exclude` arrays without hand-rolling
 * the conditional. Mirrors jest's `worktreeTestPathIgnorePatterns()`.
 * @returns The worktree exclude globs, or an empty array when already inside a worktree.
 */
export function worktreeExclusions(): readonly string[] {
  return isInsideWorktree()
    ? []
    : ["**/.claude/worktrees/**", "**/.worktrees/**"];
}

/**
 * Environment variable that sets the worker pool size verbatim.
 *
 * The escape hatch, and it wins in BOTH directions — a value above the
 * checked-in floor raises the pool as readily as a value below it lowers it.
 * A cap nobody can lift is a cap that gets worked around by deleting it.
 */
export const MAX_WORKERS_OVERRIDE_VAR = "LISA_VITEST_MAX_WORKERS";

/**
 * Environment variable stating how many concurrent runs share this machine.
 *
 * Optional, and it is a statement of INTENT rather than an observation: "six
 * runs are coming", which is knowledge a count of what is live right now cannot
 * have. So it outranks {@link discoverFleetConcurrency} when present.
 *
 * It is no longer the only way the divisor is reached, and that correction is
 * the whole of #3665. Shipped as the sole mechanism, it was set by nothing —
 * one occurrence in the tree, its own declaration — so the divisor was inert
 * for every consumer and the cap arrived as floor-only. Discovery is the layer
 * that reaches a run nobody configured; this variable is now the way to
 * override what discovery sees.
 */
export const FLEET_CONCURRENCY_VAR = "LISA_FLEET_CONCURRENCY";

/**
 * The pool size an uninstructed run gets.
 *
 * A proportion rather than a constant, so it stays sane on a two-core CI runner
 * and on an eighteen-core workstation alike. The value is not a guess: the
 * 966-file coverage suite measured on 2026-08-27 started one worker per core,
 * drove host load above 300 and starved two inventory tests past their
 * 120-second liveness bound; half the cores preserved parallelism and cleared
 * the bound.
 */
export const DEFAULT_MAX_WORKERS = "50%";

/**
 * The smallest pool the fleet divisor may produce.
 *
 * Dividing far enough eventually reaches one worker, and one worker is not a
 * gentler version of two — it serialises the suite, so every file waits behind
 * every other file and per-test budgets start expiring. That is the failure
 * `vitest.config.local.ts` already records from `--maxWorkers=4` (124 timeouts
 * against 54): fewer workers is not automatically safer, and a cap that trades
 * a visible kill for an invisible timeout has not helped anyone.
 */
export const MIN_FLEET_WORKERS = 2;

/**
 * Reads a positive integer from the environment, or `null` when there isn't one.
 * @param raw - The raw environment value.
 * @returns The parsed integer, or null when absent, malformed, or not positive.
 */
const positiveInteger = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
};

/**
 * How many Lisa test runs are live on this machine right now, including this one.
 *
 * ## Why this is discovered rather than declared
 *
 * The divisor shipped as an explicit signal, and for a release nothing set it:
 * `LISA_FLEET_CONCURRENCY` occurred exactly once in the tree, at its own
 * declaration. So the cap reached every consumer as floor-only, and the layer
 * that addresses multi-agent contention was inert by default
 * (CodySwannGT/lisa#3665).
 *
 * The obvious repair — pick a component and have it export the variable — fails
 * its own test. **Nothing knows how many runs it is about to start.** Agents are
 * launched independently, each in its own worktree, by whoever happens to be
 * driving; there is no scheduler holding that number. A setter would have to
 * guess, and a guessed fleet size that goes stale the moment the fleet resizes
 * is a worse contract than no setter at all.
 *
 * What every run *can* do is look. Each supervised run already registers a
 * `run-<pid>-<epoch>-<suffix>` root inside one namespace under `os.tmpdir()`,
 * which on this platform is per-user and therefore shared by every checkout on
 * the machine. Counting the roots whose owning process is still alive answers
 * the question at the only moment it matters — when this run is about to size
 * its pool — without anybody having to know the answer in advance.
 *
 * ## Fail open, never closed
 *
 * This runs inside a Vitest config factory, so a throw here does not degrade a
 * test run, it prevents one. Every failure path returns 1 (no fleet detected),
 * which yields the floor — the behaviour that shipped. An unreadable namespace,
 * a permission error, a platform without `process.kill`, an absent directory on
 * the very first run: all of them mean "no evidence of siblings", never "assume
 * the worst and throttle".
 *
 * Our own pid is excluded rather than subtracted, because the config may load
 * before or after this run registers its own root, and both orders must give
 * the same count. The result adds one back for this run.
 * @param deps - Injectable seams so tests state a fleet instead of spawning one.
 * @param deps.namespaceDir - One directory holding run roots; overrides the candidates.
 * @param deps.namespaceDirs - Every directory worth counting.
 * @param deps.readDir - Directory lister.
 * @param deps.isAlive - Process-liveness probe.
 * @param deps.self - This process's id.
 * @param deps.selfBasename - This run's own root basename, when supervised.
 * @returns Live run count including this one; 1 when nothing else is detected.
 */
export function discoverFleetConcurrency(
  deps: {
    namespaceDir?: () => string;
    namespaceDirs?: () => readonly string[];
    readDir?: (dir: string) => readonly string[];
    isAlive?: (pid: number) => boolean;
    self?: number;
    selfBasename?: () => string | undefined;
  } = {}
): number {
  const {
    namespaceDir,
    namespaceDirs = namespaceDir === undefined
      ? candidateNamespaceDirs
      : () => [namespaceDir()],
    readDir = (dir: string) => readdirSync(dir),
    isAlive = defaultIsAlive,
    self = process.pid,
    selfBasename = ownRunRootBasename,
  } = deps;
  return (
    liveFleetRunRootNames({ namespaceDirs, readDir, isAlive }).filter(
      name => !isOwnRunRoot(name, self, selfBasename())
    ).length + 1
  );
}

/**
 * Every namespace a sibling run might have registered itself in.
 *
 * `scratchNamespaceDir()` is built on `os.tmpdir()`, which is `TMPDIR` when the
 * environment sets one. Two agents with different `TMPDIR` values therefore
 * enumerate different directories and each sees only its own cohort — a real,
 * measured undercount, and the largest of the four named in #3941. The fix is
 * not to relocate the scratch namespace, which the authority owns and which
 * other machinery depends on: it is to LOOK in more than one place when
 * counting. Reading a namespace that does not exist costs one `ENOENT`.
 *
 * `/tmp` is the platform default `os.tmpdir()` falls back to when `TMPDIR` is
 * unset, so it is where a run with a plain environment registers. Including it
 * makes a `TMPDIR`-carrying run see a plain one and vice versa. Windows has no
 * such stable second location, so there the list is the resolved one alone.
 * @returns Namespace directories to count, without duplicates.
 */
function candidateNamespaceDirs(): readonly string[] {
  const resolved = scratchNamespaceDir();
  if (process.platform === "win32") return [resolved];
  const fallback = join("/tmp", basename(resolved));
  return resolved === fallback ? [resolved] : [resolved, fallback];
}

/**
 * This run's own scratch root basename, when it is supervised.
 *
 * The config factory runs inside the PAYLOAD process, whose pid is not the pid
 * the run root is named for — the supervisor allocates the root before it forks
 * the bootstrap that launches the payload. So `process.pid` never matches the
 * run's own root, and a pid-only exclusion counts this run's root as a sibling
 * and then adds one more for itself. The lease is the only thing in the payload
 * that names the root, so it is what identifies it.
 * @returns The run root basename, or undefined when this run is unsupervised.
 */
export function ownRunRootBasename(): string | undefined {
  const raw = env[SCRATCH_SUPERVISION_LEASE_ENV];
  if (raw === undefined) return undefined;
  try {
    return parseScratchSupervisionLease(raw).suiteRootBasename;
  } catch {
    return undefined;
  }
}

/**
 * Whether one run-root basename belongs to this run.
 * @param name - Candidate run-root basename.
 * @param self - This process's id.
 * @param ownBasename - This run's own root basename, when it has one.
 * @returns Whether the entry is this run rather than a sibling.
 */
function isOwnRunRoot(
  name: string,
  self: number,
  ownBasename: string | undefined
): boolean {
  if (ownBasename !== undefined && name === ownBasename) return true;
  return parseScratchRunRootName(name)?.pid === self;
}

/**
 * Names of every live run root across the namespaces worth counting.
 *
 * Fails open per namespace rather than per call: one unreadable directory must
 * not erase the count from a readable one. An empty result means "no evidence
 * of siblings", which yields the floor — the behaviour that shipped.
 * @param deps - Injected seams; every one defaults to the real machine.
 * @param deps.namespaceDirs - Directories to enumerate.
 * @param deps.readDir - Directory lister.
 * @param deps.isAlive - Process-liveness probe.
 * @returns Live run-root basenames, de-duplicated across namespaces.
 */
export function liveFleetRunRootNames(
  deps: {
    namespaceDirs?: () => readonly string[];
    readDir?: (dir: string) => readonly string[];
    isAlive?: (pid: number) => boolean;
  } = {}
): readonly string[] {
  const {
    namespaceDirs = candidateNamespaceDirs,
    readDir = (dir: string) => readdirSync(dir),
    isAlive = defaultIsAlive,
  } = deps;
  const names = namespaceDirs().flatMap(dir => {
    try {
      return [...readDir(dir)];
    } catch {
      // Absent namespace, unreadable directory, or a platform that refuses the
      // probe. None of these is evidence of a fleet, and none may stop a run.
      return [];
    }
  });
  return [...new Set(names)].filter(name => {
    const owner = parseScratchRunRootName(name);
    if (owner === undefined) return false;
    try {
      return isAlive(owner.pid);
    } catch {
      return false;
    }
  });
}

/**
 * The pool one run gets when a fleet of the stated size shares the machine.
 *
 * Extracted so admission control can ask what a run would be given without
 * re-deriving the arithmetic. Never below {@link MIN_FLEET_WORKERS}, which is
 * exactly why the product `fleetShare(cores, fleet) * fleet` grows without
 * bound in `fleet` and why pool sizing alone cannot bound the fleet
 * (CodySwannGT/lisa#3941).
 * @param cores - Logical cores available.
 * @param fleet - How many runs share the machine.
 * @returns Workers for one run.
 */
export function fleetShare(cores: number, fleet: number): number {
  return Math.max(MIN_FLEET_WORKERS, Math.floor(cores / 2 / fleet));
}

/**
 * Whether a pid names a live process.
 *
 * `EPERM` means the process exists and belongs to somebody else, which counts:
 * another user's Lisa run still competes for this machine's cores. Only `ESRCH`
 * — no such process — means the root is abandoned.
 * @param pid - Process id to probe.
 * @returns Whether it is alive.
 */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Why discovery no longer truncates its listing.
 *
 * A `.slice(0, 4_096)` used to bound the entries inspected, and the stated
 * reason was that an unbounded `readdir` over a pathologically grown directory
 * is the shape that once turned a shared temp directory into a 24.8 MB inode.
 * The concern is real; the slice did not address it. `readdirSync` materialises
 * the WHOLE listing before anything can slice it, so the expensive part had
 * already happened — the bound removed only the per-name regex, and bought that
 * saving by silently undercounting the fleet the moment the namespace held more
 * than 4,096 entries. This namespace has been measured holding 3,730
 * (CodySwannGT/lisa#3032), so the undercount was reachable rather than
 * theoretical, and it undercounts hardest exactly when the fleet is largest.
 *
 * A bound that protects nothing and corrupts the count is worse than no bound,
 * so the listing is now counted in full. The real protection against a grown
 * namespace lives where the reading happens — `MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES`
 * in the scratch authority — not here.
 */

/**
 * Resolves the Vitest worker-pool cap for this run.
 *
 * ## Why a cap exists at all
 *
 * Vitest sizes its pool to the machine, not to what else is running on it. With
 * nothing set, each run claims roughly one worker per core, so *k* concurrent
 * agents claim *k* × cores. On one 18-core workstation that was measured at
 * `load1` 378 with 38 live vitest processes, at which point gates stopped
 * returning verdicts and started being terminated by signal — and a killed gate
 * reads exactly like a real regression, so the agent that receives one retries,
 * which adds load, which kills the next run.
 *
 * ## Why it is not a smaller constant
 *
 * Fewer workers means each test file waits longer for a slot, so a fixed
 * per-test budget is crossed more often even as machine load falls. That is
 * recorded, not hypothesised — see {@link MIN_FLEET_WORKERS}. So the resolution
 * has three layers, and only the middle one knows about the fleet:
 *
 * 1. **Floor.** {@link DEFAULT_MAX_WORKERS}, when this run is the only one.
 * 2. **Divisor.** The floor divided by the number of concurrent runs, so the
 *    fleet's total pool is bounded by the machine rather than multiplied by its
 *    own size — never below {@link MIN_FLEET_WORKERS}. That number comes from
 *    {@link FLEET_CONCURRENCY_VAR} when something states it, and otherwise from
 *    {@link discoverFleetConcurrency}, which counts live sibling runs.
 *    Discovery is what makes this layer reach a run nobody configured; as an
 *    opt-in signal it reached nothing for a release (#3665).
 * 3. **Override.** {@link MAX_WORKERS_OVERRIDE_VAR} replaces both, upward or
 *    downward.
 *
 * A stated signal outranks discovery rather than being reconciled with it. An
 * operator who says "we are six" is describing an intent — six runs are coming,
 * even if only two have started — and a count of what happens to be live right
 * now must not quietly contradict it.
 * ## Why the environment is imported rather than reached for
 *
 * The default comes from `node:process`'s `env` binding, not from the ambient
 * `process.env`. The project's `no-restricted-syntax` rule sends application
 * code to a config service for its configuration, and a Vitest config factory
 * cannot use one: the runner loads this module to decide how to run, before any
 * such service exists — the same reason `isUnitCoverageScope` gives for reading
 * its scope variable directly. Importing the binding declares that dependency
 * at the top of the file instead of hiding it mid-function, and keeps the
 * parameter injectable so tests state an environment rather than mutating one.
 * @param environment - Environment to read; defaults to this process's.
 * @param cores - Logical cores available; defaults to this machine's count.
 * @param discover - Fleet-size discovery; defaults to counting live run roots.
 * @returns A value for Vitest's `maxWorkers` — a worker count, or a percentage.
 */
export function resolveMaxWorkers(
  environment: NodeJS.ProcessEnv = env,
  cores: number = availableParallelism(),
  discover: () => number = discoverFleetConcurrency
): number | string {
  const override = positiveInteger(environment[MAX_WORKERS_OVERRIDE_VAR]);
  if (override !== null) return override;

  const stated = positiveInteger(environment[FLEET_CONCURRENCY_VAR]);
  const fleet = stated ?? discover();
  if (fleet <= 1) return DEFAULT_MAX_WORKERS;

  return fleetShare(cores, fleet);
}

/**
 * Resolves a sibling module of this file to an absolute path Vitest can load.
 *
 * `setupFiles` and `globalSetup` take file paths rather than functions, and this
 * module is consumed from two places with different extensions: downstream
 * projects import the compiled `dist/` copy, while Lisa's own unit tests import
 * the `src/` TypeScript directly. Probing for the built file first and falling
 * back to the source keeps one wiring correct on both.
 * @param basename - Sibling module name without extension
 * @returns Absolute path to the module.
 */
const resolveSiblingModule = (basename: string): string => {
  const built = fileURLToPath(new URL(`./${basename}.js`, import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL(`./${basename}.ts`, import.meta.url));
};

/**
 * Setup files that bound and reclaim the suite's temporary directories.
 *
 * Every stack factory spreads this. Without it, each fixture's
 * `mkdtemp(os.tmpdir())` lands directly in the shared platform temp root, which
 * is never emptied while the machine is up and which no in-process cleanup can
 * protect once the runner is killed.
 * @returns Absolute paths to spread into `test.setupFiles`.
 * @see {@link module:configs/vitest/scratch} for the measurements behind this
 */
export function scratchSetupFiles(): readonly string[] {
  return [
    resolveSiblingModule("scratch-setup"),
    resolveSiblingModule("scratch-leak-setup"),
  ];
}

/**
 * Global setup that reclaims residue before a run and audits the namespace after it.
 *
 * Admission runs FIRST, and the order is load-bearing: it is the only hook that
 * can decline to start work, and holding a run before the namespace sweep keeps
 * a queued run from doing filesystem work it may not get to use. Vitest runs
 * `globalSetup` entries in order, so the array order is the contract.
 * @returns Absolute paths to spread into `test.globalSetup`.
 */
export function scratchGlobalSetup(): readonly string[] {
  return [
    resolveSiblingModule("fleet-admission-global-setup"),
    resolveSiblingModule("scratch-global-setup"),
  ];
}

/**
 * Global setup that refuses a coverage run measuring an empty file set.
 *
 * Every stack factory spreads this beside {@link scratchGlobalSetup}, because
 * every stack factory declares a `coverage.include` written for the layout that
 * stack normally has. Applied to a project laid out differently the globs match
 * nothing and the gate reports a number it never measured
 * (CodySwannGT/lisa#3468).
 * @returns Absolute paths to spread into `test.globalSetup`.
 * @see {@link module:configs/vitest/coverage-include-authority} for the measurements behind this
 */
export function coverageGlobalSetup(): readonly string[] {
  return [resolveSiblingModule("coverage-include-global-setup")];
}

/**
 * Maps portable threshold format (with `global` wrapper) to Vitest's
 * flat threshold format. Projects store thresholds in the portable
 * format so the same JSON file works for both Jest and Vitest stacks.
 * @param thresholds - Portable thresholds with `global` wrapper
 * @returns Flat Vitest thresholds object
 */
export const mapThresholds = (
  thresholds: PortableThresholds
): VitestThresholds => ({
  ...(thresholds.global?.statements !== undefined
    ? { statements: thresholds.global.statements }
    : {}),
  ...(thresholds.global?.branches !== undefined
    ? { branches: thresholds.global.branches }
    : {}),
  ...(thresholds.global?.functions !== undefined
    ? { functions: thresholds.global.functions }
    : {}),
  ...(thresholds.global?.lines !== undefined
    ? { lines: thresholds.global.lines }
    : {}),
});

/**
 * Merges project-specific threshold overrides into default thresholds.
 * Allows projects to selectively raise or lower coverage requirements
 * via vitest.thresholds.json without replacing the entire threshold object.
 *
 * Uses the portable format (with `global` wrapper) for compatibility
 * with both Jest and Vitest threshold JSON files.
 *
 * A `unit` block in the overrides is the floor for a unit-scoped run, and is
 * applied only when {@link isUnitCoverageScope} says this process is one. It is
 * layered over the EFFECTIVE global floor rather than over the stack default,
 * so a project that raised its global and declared no unit block keeps the
 * higher number. It is stripped from the result either way: both runners read a
 * non-`global` key as a path glob, and a surviving `unit` key would become a
 * threshold that is never enforced and never complains.
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from vitest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
export const mergeThresholds = (
  defaults: PortableThresholds,
  overrides: PortableThresholds
): PortableThresholds => {
  const { unit: _defaultUnit, ...restDefaults } = defaults;
  const { unit: overrideUnit, ...restOverrides } = overrides;
  const global = {
    ...(defaults.global as Record<string, number>),
    ...(overrides.global as Record<string, number>),
  };
  return {
    ...restDefaults,
    ...restOverrides,
    // Layered over the effective global floor, not over Lisa's default one: a
    // project that raised its global and declared no unit block must keep the
    // higher number, or a "scope fix" would silently hand it a lower bar.
    global: isUnitCoverageScope()
      ? { ...global, ...(overrideUnit as Record<string, number>) }
      : global,
  };
};

/**
 * Deep merges the `test` key of multiple Vitest UserConfig objects.
 * Arrays are concatenated and deduplicated. Nested objects (like
 * `coverage`) are shallow-merged. Scalar values from later configs
 * take precedence.
 * @param configs - Vitest UserConfig objects to merge in order of precedence
 * @returns Single merged UserConfig
 */
export const mergeVitestConfigs = (...configs: UserConfig[]): UserConfig => {
  if (configs.length === 0) {
    return {};
  }

  const mergeObjects = (
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): Record<string, unknown> =>
    Object.keys(b).reduce(
      (acc, key) => {
        const accVal = acc[key];
        const bVal = b[key];

        const merged =
          Array.isArray(accVal) && Array.isArray(bVal)
            ? [...new Set([...accVal, ...bVal])]
            : typeof accVal === "object" &&
                accVal !== null &&
                !Array.isArray(accVal) &&
                typeof bVal === "object" &&
                bVal !== null &&
                !Array.isArray(bVal)
              ? {
                  ...(accVal as Record<string, unknown>),
                  ...(bVal as Record<string, unknown>),
                }
              : bVal;

        return { ...acc, [key]: merged };
      },
      { ...a }
    );

  return configs.reduce((acc, config) => {
    const accTest = (acc.test ?? {}) as Record<string, unknown>;
    const configTest = (config.test ?? {}) as Record<string, unknown>;

    return {
      ...acc,
      ...config,
      test: mergeObjects(accTest, configTest),
    };
  }, {} as UserConfig);
};

export {
  COVERAGE_REPORTS_DIR_ENV,
  COVERAGE_RUNS_DIR,
  coverageReportsDirectory,
  coverageRunDirectory,
  resetCoverageReportsDirectory,
} from "./coverage-reports-directory.js";
