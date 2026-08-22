/**
 * Vitest Configuration - Bounded, self-reclaiming test scratch space
 *
 * Test fixtures create temporary directories by calling `mkdtemp` against
 * `os.tmpdir()`. Left alone, every one of those lands directly in the platform
 * temp root — on macOS the shared per-user directory under `/var`, which is
 * never emptied while the machine is up.
 *
 * That is a ratchet rather than a slowdown. Cleanup in a suite is written as
 * `afterEach`, `afterAll` or `try`/`finally`, and all three are IN-PROCESS
 * callbacks: when the runner is killed — SIGKILL, `exit 137`, which is how this
 * failed in practice — none of them run and every directory the run had open is
 * abandoned. A run that dies enlarges the directory the next run depends on, so
 * the next run is slower and likelier to die.
 *
 * Measured on one saturated workstation, against a directory this module
 * governs on the same machine at the same moment:
 *
 * ```
 *                                 shared platform root      inside a run root
 * inode size (stat -f %z)              24,902,496 bytes             64 bytes
 * one stat()                                189.9 ms                 0.2 ms
 * five mkdtemp() calls                   35,619.7 ms                 0.8 ms
 * ```
 *
 * Seven seconds for a single `mkdtemp`. A fixture creating two directories
 * exhausted a 60-second budget having done no work, which is why every symptom
 * of this was a timeout and never an assertion failure.
 *
 * Three properties, each chosen against a specific way the previous state
 * failed:
 *
 * 1. **One entry, ever.** Everything lives under a single `lisa-scratch`
 *    directory in the platform temp root, so a project contributes ONE name to
 *    the shared directory regardless of how many fixtures it creates. The
 *    expensive lookup is paid once per process instead of once per fixture.
 * 2. **Wholesale teardown.** A run's directories nest under one per-process
 *    root, so ending a run is a single recursive removal rather than hundreds
 *    of cooperating call sites.
 * 3. **Reclaim on start, not on exit.** A process that is SIGKILLed cannot run
 *    cleanup — no design can make it. So the residue of a killed run is
 *    reclaimed by the NEXT run instead: roots are named with the pid that owns
 *    them, and a sweep removes any whose owner is gone. This is the only
 *    mechanism that survives an abnormal exit, and it is why the loop above
 *    cannot restart.
 *
 * Deliberately NOT repo-local. A scratch root inside the project would give
 * every fixture two ancestors it must not have: the repository's `.git` (so a
 * fixture asserting "not a git repository" would find the project's) and the
 * repository's `node_modules` (so a fixture asserting a dependency is absent
 * would resolve the project's copy). Both change what fixtures mean, which is a
 * worse defect than the one being fixed.
 * @module configs/vitest/scratch
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { env } from "node:process";

/**
 * Single directory name every Lisa scratch root nests under.
 *
 * The name is the contract: it is what makes "one entry in the shared temp
 * root, ever" checkable, and what the sweep enumerates instead of the
 * (unenumerable) platform root.
 */
export const SCRATCH_NAMESPACE = "lisa-scratch";

/** Prefix identifying a per-process run root inside the namespace. */
export const RUN_ROOT_PREFIX = "run-";

/**
 * Backstop age after which a run root is reclaimed even though its recorded pid
 * still resolves to a live process.
 *
 * Pids are recycled, so liveness alone can pin an abandoned root forever if an
 * unrelated process happens to inherit its number. Six hours is longer than any
 * legitimate suite and short enough that a recycled pid cannot hold a root
 * across a working day.
 */
export const DEFAULT_RECLAIM_AGE_MS = 6 * 60 * 60 * 1000;

/** Environment variable that relocates the namespace away from the platform temp root. */
export const SCRATCH_ROOT_ENV = "LISA_TEST_SCRATCH_ROOT";

/**
 * Resolves the directory the namespace lives in.
 *
 * Honours `LISA_TEST_SCRATCH_ROOT` first so an operator or CI job can point
 * scratch space at a specific volume, then `os.tmpdir()` — which itself re-reads
 * `TMPDIR` on every call, so the pre-existing `export TMPDIR=...` mitigation
 * composes with this rather than being defeated by it.
 * @returns Absolute path to the directory containing the scratch namespace.
 */
export const scratchBaseDir = (): string => {
  const override = env[SCRATCH_ROOT_ENV];
  return override !== undefined && override.trim() !== ""
    ? override
    : os.tmpdir();
};

/**
 * Absolute path of the shared namespace directory.
 * @returns Path to `<base>/lisa-scratch`.
 */
export const scratchNamespaceDir = (): string =>
  path.join(scratchBaseDir(), SCRATCH_NAMESPACE);

/**
 * Builds the name of a per-process run root.
 *
 * The pid is encoded in the name because it is the only durable record of who
 * owns the directory: a killed process leaves no other trace, and the sweep has
 * to tell an abandoned root from one a sibling run is using right now.
 * @param pid - Owning process id
 * @param startedAt - Epoch milliseconds the root was created
 * @param suffix - Random suffix disambiguating two roots created in the same millisecond
 * @returns The directory name, without any leading path.
 */
export const runRootName = (
  pid: number,
  startedAt: number,
  suffix: string
): string => `${RUN_ROOT_PREFIX}${pid}-${startedAt}-${suffix}`;

/** Ownership recorded in a run root's directory name. */
export interface RunRootOwner {
  /** Process id that created the root */
  readonly pid: number;
  /** Epoch milliseconds the root was created */
  readonly startedAt: number;
}

/**
 * Recovers the pid and creation time encoded in a run root's name.
 * @param name - A directory name from inside the namespace
 * @returns The owner, or `undefined` when the name was not produced by {@link runRootName}.
 */
export const parseRunRootName = (name: string): RunRootOwner | undefined => {
  // Derived from RUN_ROOT_PREFIX rather than spelled out again. A literal here
  // would let the writer and the reader drift apart, and the failure mode of
  // that drift is the worst one available: creation keeps working, the sweep
  // silently matches nothing, and the namespace fills while every run passes.
  const match = new RegExp(`^${RUN_ROOT_PREFIX}(\\d+)-(\\d+)-[^-]+$`).exec(
    name
  );
  if (match === null) {
    return undefined;
  }
  const pid = Number(match[1]);
  const startedAt = Number(match[2]);
  return Number.isSafeInteger(pid) && Number.isSafeInteger(startedAt)
    ? { pid, startedAt }
    : undefined;
};

/** Inputs deciding whether one namespace entry may be removed. */
export interface ReclaimDecisionInput {
  /** Directory name inside the namespace */
  readonly name: string;
  /** Current epoch milliseconds */
  readonly now: number;
  /** Reports whether a pid still resolves to a running process */
  readonly isProcessAlive: (pid: number) => boolean;
  /** Age after which a live-pid root is reclaimed anyway */
  readonly maxAgeMs?: number;
  /** Name of the caller's own root, which is never reclaimed */
  readonly selfName?: string;
}

/**
 * Decides whether a namespace entry is abandoned residue.
 *
 * A name this module did not produce is not judged here — see
 * {@link isStaleForeignEntry}, which reclaims it on age alone. Deleting another
 * tool's fresh data is not this sweep's business; leaving it forever would let
 * one stray directory wedge every future run.
 * @param input - The entry and the facts needed to judge it
 * @param input.name - Directory name inside the namespace
 * @param input.now - Current epoch milliseconds
 * @param input.isProcessAlive - Liveness probe for the recorded pid
 * @param input.maxAgeMs - Age after which a live-pid root is reclaimed anyway
 * @param input.selfName - Caller's own root name, never reclaimed
 * @returns True when the entry may be removed.
 */
export const isReclaimable = ({
  name,
  now,
  isProcessAlive,
  maxAgeMs = DEFAULT_RECLAIM_AGE_MS,
  selfName,
}: ReclaimDecisionInput): boolean => {
  if (selfName !== undefined && name === selfName) {
    return false;
  }
  const owner = parseRunRootName(name);
  if (owner === undefined) {
    return false;
  }
  if (now - owner.startedAt > maxAgeMs) {
    return true;
  }
  return !isProcessAlive(owner.pid);
};

/**
 * Reports whether a pid resolves to a running process.
 *
 * `kill(pid, 0)` sends no signal; it only asks the kernel whether the target
 * exists. `EPERM` means it exists and belongs to someone else, which still
 * counts as alive.
 * @param pid - Process id to probe
 * @returns True when a process with that id exists.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Decides whether an entry this module did not create may be removed.
 *
 * Age is the only signal available: a foreign name carries no owner, so there is
 * nothing to ask the kernel about. Reclaiming on the same backstop the pid arm
 * uses means the namespace self-heals from anything parked in it — an older
 * release's naming scheme, a stray `mktemp` — without this sweep ever deleting
 * something a live tool is still writing to.
 *
 * The alternative was to treat a foreign name as a hard failure. That was tried
 * and rejected: it wedges permanently on one stray directory, and the message a
 * downstream user gets — "run roots must be named by runRootName()" — names
 * something they cannot act on.
 * @param entryPath - Absolute path of the entry
 * @param now - Current epoch milliseconds
 * @param maxAgeMs - Age past which a foreign entry is reclaimed
 * @returns True when the entry is old enough to remove.
 */
export const isStaleForeignEntry = (
  entryPath: string,
  now: number,
  maxAgeMs: number
): boolean => {
  try {
    return now - fs.statSync(entryPath).mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
};

/**
 * Lists the namespace's direct children, treating an absent namespace as empty.
 *
 * A directory that cannot be read is not a directory that is empty — but for the
 * one case that occurs here, the namespace not existing yet, the two are the
 * same answer and every caller wants to continue rather than fail.
 * @param dir - Namespace directory to list
 * @returns The entry names, or an empty list.
 */
export const readNamespaceEntries = (dir: string): readonly string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** Outcome of one sweep of the namespace. */
export interface SweepResult {
  /** Names removed as abandoned residue */
  readonly removed: readonly string[];
  /** Names left in place because a live owner still holds them */
  readonly kept: readonly string[];
}

/** Options controlling one sweep. */
export interface SweepOptions {
  /** Namespace directory to sweep (defaults to the resolved namespace) */
  readonly dir?: string;
  /** Current epoch milliseconds */
  readonly now?: number;
  /** Liveness probe, overridable for tests */
  readonly isProcessAlive?: (pid: number) => boolean;
  /** Age after which a live-pid root is reclaimed anyway */
  readonly maxAgeMs?: number;
  /** Caller's own root name, never reclaimed */
  readonly selfName?: string;
}

/**
 * Removes abandoned run roots from the namespace.
 *
 * This is the arm of the design that survives a kill. It runs at the START of a
 * run precisely because the run that leaked cannot be the one to clean up.
 * @param options - Sweep inputs
 * @param options.dir - Namespace directory to sweep
 * @param options.now - Current epoch milliseconds
 * @param options.isProcessAlive - Liveness probe for recorded pids
 * @param options.maxAgeMs - Age after which a live-pid root is reclaimed anyway
 * @param options.selfName - Caller's own root name, never reclaimed
 * @returns Which entries were removed and which were kept.
 */
export const sweepScratchNamespace = ({
  dir = scratchNamespaceDir(),
  now = Date.now(),
  isProcessAlive: alive = isProcessAlive,
  maxAgeMs = DEFAULT_RECLAIM_AGE_MS,
  selfName,
}: SweepOptions = {}): SweepResult =>
  readNamespaceEntries(dir).reduce<SweepResult>(
    (acc, name) => {
      const entryPath = path.join(dir, name);
      const decision: ReclaimDecisionInput = {
        name,
        now,
        isProcessAlive: alive,
        maxAgeMs,
        ...(selfName === undefined ? {} : { selfName }),
      };
      const reclaimable =
        parseRunRootName(name) === undefined
          ? name !== selfName && isStaleForeignEntry(entryPath, now, maxAgeMs)
          : isReclaimable(decision);

      if (!reclaimable) {
        return { removed: acc.removed, kept: [...acc.kept, name] };
      }
      try {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } catch {
        // A root another process is removing right now races us here. Losing
        // that race is the correct outcome and is not worth failing a run over.
        return { removed: acc.removed, kept: [...acc.kept, name] };
      }
      return { removed: [...acc.removed, name], kept: acc.kept };
    },
    { removed: [], kept: [] }
  );

/**
 * Creates a run root owned by the current process and returns its path.
 * @param options - Overrides for the namespace directory and clock
 * @param options.dir - Namespace directory to create the root inside
 * @param options.now - Epoch milliseconds recorded in the root's name
 * @returns Absolute path of this process's run root.
 */
export const createRunRoot = ({
  dir = scratchNamespaceDir(),
  now = Date.now(),
}: { readonly dir?: string; readonly now?: number } = {}): string => {
  const suffix = randomBytes(4).toString("hex");
  const root = path.join(dir, runRootName(process.pid, now, suffix));
  fs.mkdirSync(root, { recursive: true });
  return root;
};

/**
 * Reclaims abandoned roots, then allocates one for this process.
 *
 * The order is the point, and it is why this is one function rather than two
 * calls at the call site: reclaiming AFTER allocating leaves a window in which
 * the namespace holds both, and reclaiming somewhere else entirely is how a
 * caller ends up allocating without ever reclaiming at all.
 * @param dir - Namespace directory
 * @returns Absolute path of the newly created run root.
 */
export const reclaimAndCreateRunRoot = (dir: string): string => {
  sweepScratchNamespace({ dir });
  return createRunRoot({ dir });
};

/**
 * Removes a directory tree, ignoring an already-absent path.
 * @param dir - Directory to remove
 */
export const removeScratchDir = (dir: string): void => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: residue that resists removal is reclaimed by the next run's
    // sweep rather than failing the current one.
  }
};
