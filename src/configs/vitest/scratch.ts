/* eslint-disable max-lines -- scratch configuration, allocation, reclaim, and compatibility form one lifecycle contract */
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

import {
  createScratchNamespaceAuthority,
  removeAuthorizedScratchRoot,
  sweepAuthorizedScratchNamespace,
  type ScratchNamespaceAuthority,
} from "./scratch-authority.js";
import {
  SCRATCH_RUN_ROOT_PREFIX,
  createScratchOwnerRecord,
  parseScratchRunRootName,
  processBirthFingerprint,
  readScratchOwnerRecord,
  scratchPathIdentity,
  scratchRunRootName,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
  type ScratchPathIdentity,
} from "./scratch-owner.js";

/**
 * Single directory name every Lisa scratch root nests under.
 *
 * The name is the contract: it is what makes "one entry in the shared temp
 * root, ever" checkable, and what the sweep enumerates instead of the
 * (unenumerable) platform root.
 */
export const SCRATCH_NAMESPACE = "lisa-scratch";

/** Prefix identifying a per-process run root inside the namespace. */
export const RUN_ROOT_PREFIX = SCRATCH_RUN_ROOT_PREFIX;

/** Legacy API default retained for callers; age alone never authorizes deletion. */
export const DEFAULT_RECLAIM_AGE_MS = 6 * 60 * 60 * 1000;

/** Environment variable that relocates the namespace away from the platform temp root. */
export const SCRATCH_ROOT_ENV = "LISA_TEST_SCRATCH_ROOT";

/** JSON-array environment contract for prefixes a suite deliberately owns. */
export const SCRATCH_PREFIXES_ENV = "LISA_TEST_SCRATCH_PREFIXES";

/** Opaque suite label persisted in each owner marker. */
export const SCRATCH_SUITE_ENV = "LISA_TEST_SCRATCH_SUITE";

/** Maximum number of registered prefixes accepted from configuration. */
const MAX_REGISTERED_PREFIXES = 64;

/** Maximum bytes in one registered prefix or suite label. */
const MAX_LABEL_BYTES = 128;

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
 * Parse the registry JSON while preserving the public diagnostic.
 * @param raw - Serialized prefix registry
 * @returns Unvalidated decoded value
 */
function parsePrefixRegistry(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${SCRATCH_PREFIXES_ENV} must be a JSON array of prefixes`);
  }
}

/**
 * Read and validate the bounded pre-collection prefix registry.
 * @returns Sorted unique direct-child prefixes
 */
export function registeredScratchPrefixes(): readonly string[] {
  const raw = env[SCRATCH_PREFIXES_ENV];
  if (raw === undefined || raw === "") return [];
  const parsed = parsePrefixRegistry(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_REGISTERED_PREFIXES) {
    throw new Error(
      `${SCRATCH_PREFIXES_ENV} must contain at most ${String(MAX_REGISTERED_PREFIXES)} prefixes`
    );
  }
  const prefixes = parsed.map(value => {
    if (
      typeof value !== "string" ||
      value === "" ||
      Buffer.byteLength(value, "utf8") > MAX_LABEL_BYTES ||
      value.includes("/") ||
      value.includes("\\") ||
      value === "." ||
      value === ".."
    ) {
      throw new Error(`${SCRATCH_PREFIXES_ENV} contains an invalid prefix`);
    }
    return value;
  });
  return [...new Set(prefixes)].sort((left, right) =>
    left.localeCompare(right)
  );
}

/**
 * Whether a label contains a control code unsafe for diagnostics.
 * @param label - Candidate suite label
 * @returns True when a control code is present
 */
function containsControlCode(label: string): boolean {
  return [...label].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Read the opaque bounded suite label used for diagnostics and ownership.
 * @returns Valid suite label
 */
export function scratchSuiteLabel(): string {
  const label = env[SCRATCH_SUITE_ENV] ?? "vitest";
  if (
    label === "" ||
    Buffer.byteLength(label, "utf8") > MAX_LABEL_BYTES ||
    containsControlCode(label)
  ) {
    throw new Error(`${SCRATCH_SUITE_ENV} contains an invalid suite label`);
  }
  return label;
}

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
export const runRootName = scratchRunRootName;

/**
 * Recovers the pid and creation time encoded in a run root's name.
 * @param name - A directory name from inside the namespace
 * @returns The owner, or `undefined` when the name was not produced by {@link runRootName}.
 */
export const parseRunRootName = parseScratchRunRootName;

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
 * A name this module did not produce is never judged reclaimable. Markerless
 * recognized names are removed only when the encoded pid is dead; durable
 * markers additionally bind process-birth and filesystem authority.
 * @param input - The entry and the facts needed to judge it
 * @param input.name - Directory name inside the namespace
 * @param input.isProcessAlive - Liveness probe for the recorded pid
 * @param input.selfName - Caller's own root name, never reclaimed
 * @returns True when the entry may be removed.
 */
export const isReclaimable = ({
  name,
  isProcessAlive,
  selfName,
}: ReclaimDecisionInput): boolean => {
  if (selfName !== undefined && name === selfName) {
    return false;
  }
  const owner = parseRunRootName(name);
  return owner !== undefined && !isProcessAlive(owner.pid);
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
 * A foreign or corrupt entry carries no trustworthy owner authority. Age does
 * not make it safer to delete: a long-lived process may still own it. This
 * compatibility helper therefore always refuses; namespace inspection reports
 * the entry as unowned instead.
 * @param _entryPath - Absolute path of the entry
 * @param _now - Current epoch milliseconds
 * @param _maxAgeMs - Retained compatibility argument; never authorises removal
 * @returns Always false
 */
export const isStaleForeignEntry = (
  _entryPath: string,
  _now: number,
  _maxAgeMs: number
): boolean => false;

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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
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
  /** Retained compatibility bound; age alone never authorizes removal */
  readonly maxAgeMs?: number;
  /** Caller's own root name, never reclaimed */
  readonly selfName?: string;
  /** Process-birth probe, overridable for deterministic tests */
  readonly processBirthFingerprint?: (pid: number) => string | undefined;
}

/** Durable handle for one run root owned by this process. */
export interface OwnedScratchRunRoot {
  readonly path: string;
  readonly basename: string;
  readonly authority: ScratchNamespaceAuthority;
  readonly owner: ScratchOwnerRecordV1;
}

/** Precommitted immutable intent for one exact direct run root. */
export interface ScratchRunRootIntentV1 {
  readonly schema: 1;
  readonly rootPath: string;
  readonly basename: string;
  readonly authority: ScratchNamespaceAuthority;
  readonly pid: number;
  readonly processBirthFingerprint: string;
  readonly createdAt: string;
  readonly token: string;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Validated owner configuration captured before filesystem allocation. */
interface ScratchOwnerConfiguration {
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Optional seams for creating one transactional run root. */
interface CreateRunRootOptions {
  readonly dir?: string;
  readonly now?: number;
  readonly writeOwnerRecord?: typeof writeScratchOwnerRecord;
}

/**
 * Removes abandoned run roots from the namespace.
 *
 * This is the arm of the design that survives a kill. It runs at the START of a
 * run precisely because the run that leaked cannot be the one to clean up.
 * @param options - Sweep inputs
 * @param options.dir - Namespace directory to sweep
 * @param options.isProcessAlive - Liveness probe for recorded pids
 * @param options.selfName - Caller's own root name, never reclaimed
 * @param options.processBirthFingerprint - OS birth probe for pid reuse
 * @returns Which entries were removed and which were kept.
 */
export const sweepScratchNamespace = ({
  dir = scratchNamespaceDir(),
  isProcessAlive: alive = isProcessAlive,
  selfName,
  processBirthFingerprint: birthProbe = processBirthFingerprint,
}: SweepOptions = {}): SweepResult => {
  return sweepAuthorizedScratchNamespace({
    dir,
    isProcessAlive: alive,
    processBirthFingerprint: birthProbe,
    ...(selfName === undefined ? {} : { selfName }),
  });
};

/**
 * Creates a run root owned by the current process and returns its path.
 * @param options - Overrides for the namespace directory and clock
 * @param options.dir - Namespace directory to create the root inside
 * @param options.now - Epoch milliseconds recorded in the root's name
 * @param options.writeOwnerRecord - Marker writer, injectable for rollback proof
 * @returns Absolute path of this process's run root.
 */
export const createRunRoot = ({
  dir = scratchNamespaceDir(),
  now = Date.now(),
  writeOwnerRecord = writeScratchOwnerRecord,
}: CreateRunRootOptions = {}): string => {
  if (path.basename(dir) !== SCRATCH_NAMESPACE) {
    throw new Error(
      `Scratch namespace must be the exact ${SCRATCH_NAMESPACE} child`
    );
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error(
      "Scratch run-root timestamp must be a non-negative integer"
    );
  }
  const configuration: ScratchOwnerConfiguration = {
    suiteLabel: scratchSuiteLabel(),
    registeredPrefixes: registeredScratchPrefixes(),
  };
  const authority = createScratchNamespaceAuthority(path.dirname(dir));
  const suffix = randomBytes(4).toString("hex");
  const root = path.join(
    authority.namespace.canonicalPath,
    runRootName(process.pid, now, suffix)
  );
  fs.mkdirSync(root, { mode: 0o700 });
  try {
    const owner = createOwnerForNewRoot(authority, root, now, configuration);
    writeOwnerRecord(root, owner);
  } catch (error) {
    try {
      removeAuthorizedScratchRoot({
        authority,
        basename: path.basename(root),
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Scratch root allocation failed and rollback could not reclaim it"
      );
    }
    throw error;
  }
  return root;
};

/**
 * Create the directory before capturing its immutable owner record.
 * @param authority - Pinned namespace authority
 * @param root - New direct run-root path
 * @param now - Creation epoch milliseconds
 * @param configuration - Prevalidated owner configuration
 * @returns Immutable owner marker
 */
function createOwnerForNewRoot(
  authority: ScratchNamespaceAuthority,
  root: string,
  now: number,
  configuration: ScratchOwnerConfiguration
): ScratchOwnerRecordV1 {
  return createScratchOwnerRecord({
    authority,
    root,
    suiteLabel: configuration.suiteLabel,
    registeredPrefixes: configuration.registeredPrefixes,
    now: new Date(now),
  });
}

/**
 * Prepare an exact root identity without creating that root.
 *
 * The namespace may be established here, but the direct run-root mutation is
 * deliberately deferred until a detached cleanup authority acknowledges the
 * token-bearing intent.
 * @param baseDir - Logical temp base
 * @returns Immutable precommitted root intent
 */
export function prepareOwnedScratchRunRoot(
  baseDir: string
): ScratchRunRootIntentV1 {
  const suiteLabel = scratchSuiteLabel();
  const registeredPrefixes = registeredScratchPrefixes();
  const authority = createScratchNamespaceAuthority(baseDir);
  const now = Date.now();
  const basename = runRootName(
    process.pid,
    now,
    randomBytes(4).toString("hex")
  );
  return Object.freeze({
    schema: 1 as const,
    rootPath: path.join(authority.namespace.canonicalPath, basename),
    basename,
    authority,
    pid: process.pid,
    processBirthFingerprint:
      processBirthFingerprint(process.pid) ??
      `unsupported:${String(process.pid)}`,
    createdAt: new Date(now).toISOString(),
    token: randomBytes(16).toString("hex"),
    suiteLabel,
    registeredPrefixes,
  });
}

/**
 * Materialize one previously armed root and persist its immutable marker.
 * @param intent - Precommitted root intent
 * @returns Durable owned-root handle
 */
export function materializeOwnedScratchRunRoot(
  intent: ScratchRunRootIntentV1
): OwnedScratchRunRoot {
  if (intent.schema !== 1)
    throw new Error("Invalid scratch root intent schema");
  if (
    path.join(intent.authority.namespace.canonicalPath, intent.basename) !==
    intent.rootPath
  ) {
    throw new Error("Scratch root intent path does not match its authority");
  }
  fs.mkdirSync(intent.rootPath, { mode: 0o700 });
  try {
    const owner = createScratchOwnerRecord({
      authority: intent.authority,
      root: intent.rootPath,
      pid: intent.pid,
      processBirthFingerprint: intent.processBirthFingerprint,
      suiteLabel: intent.suiteLabel,
      registeredPrefixes: intent.registeredPrefixes,
      token: intent.token,
      now: new Date(intent.createdAt),
    });
    writeScratchOwnerRecord(intent.rootPath, owner);
    return {
      path: intent.rootPath,
      basename: intent.basename,
      authority: intent.authority,
      owner,
    };
  } catch (error) {
    removeAuthorizedScratchRoot({
      authority: intent.authority,
      basename: intent.basename,
    });
    throw error;
  }
}

/**
 * Validate an opened marker against the complete armed intent.
 * @param intent - Precommitted root facts
 * @param owner - Persisted owner marker
 * @param root - Currently opened root identity
 */
function assertIntentOwner(
  intent: ScratchRunRootIntentV1,
  owner: ScratchOwnerRecordV1,
  root: ScratchPathIdentity
): void {
  if (
    owner.token !== intent.token ||
    owner.pid !== intent.pid ||
    owner.processBirthFingerprint !== intent.processBirthFingerprint ||
    owner.namespace.dev !== intent.authority.namespace.dev ||
    owner.namespace.ino !== intent.authority.namespace.ino ||
    owner.root.dev !== root.dev ||
    owner.root.ino !== root.ino
  ) {
    throw new Error(
      "Scratch owner token or armed identity does not match intent"
    );
  }
}

/**
 * Open one exact materialized root without following a replacement symlink.
 * @param intent - Armed root intent
 * @returns Owned handle, or undefined when not yet materialized
 */
export function openOwnedScratchRunRoot(
  intent: ScratchRunRootIntentV1
): OwnedScratchRunRoot | undefined {
  try {
    const root = scratchPathIdentity(intent.rootPath);
    const owner = readScratchOwnerRecord(intent.rootPath);
    assertIntentOwner(intent, owner, root);
    return {
      path: intent.rootPath,
      basename: intent.basename,
      authority: intent.authority,
      owner,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Find a matching interrupted quarantine by token and original inode.
 * @param intent - Precommitted root facts
 * @returns Matching quarantine identity, or undefined
 */
function interruptedQuarantine(
  intent: ScratchRunRootIntentV1
):
  | { readonly basename: string; readonly identity: ScratchPathIdentity }
  | undefined {
  for (const basename of fs.readdirSync(
    intent.authority.namespace.canonicalPath
  )) {
    if (!basename.startsWith(".lisa-quarantine-")) continue;
    const candidate = path.join(
      intent.authority.namespace.canonicalPath,
      basename
    );
    try {
      const owner = readScratchOwnerRecord(candidate);
      if (owner.token !== intent.token) continue;
      const identity = scratchPathIdentity(candidate);
      assertIntentOwner(intent, owner, identity);
      return { basename, identity };
    } catch {
      // Foreign and malformed quarantines are never authority for this intent.
    }
  }
  return undefined;
}

/**
 * Sweep an authority before allocating the successor root.
 * @param authority - Pinned namespace authority
 * @returns Newly allocated root path
 */
function sweepThenCreateRoot(authority: ScratchNamespaceAuthority): string {
  sweepScratchNamespace({ dir: authority.namespace.canonicalPath });
  return createRunRoot({ dir: authority.namespace.canonicalPath });
}

/**
 * Reclaim residue and allocate a durable owned-root handle.
 * @param baseDir - Canonical temp base to govern
 * @returns Owned run-root handle
 */
export function reclaimAndCreateOwnedRunRoot(
  baseDir: string
): OwnedScratchRunRoot {
  const authority = createScratchNamespaceAuthority(baseDir);
  const root = sweepThenCreateRoot(authority);
  return {
    path: root,
    basename: path.basename(root),
    authority,
    owner: readScratchOwnerRecord(root),
  };
}

/**
 * Read an existing owner marker or atomically upgrade a legacy current root.
 * @param authority - Pinned namespace authority
 * @param root - Existing current-process root
 * @param startedAt - Timestamp encoded in its recognized name
 * @returns Existing or newly written owner marker
 */
function readOrCreateAdoptedOwner(
  authority: ScratchNamespaceAuthority,
  root: string,
  startedAt: number
): ScratchOwnerRecordV1 {
  try {
    return readScratchOwnerRecord(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const owner = createScratchOwnerRecord({
      authority,
      root,
      suiteLabel: scratchSuiteLabel(),
      registeredPrefixes: registeredScratchPrefixes(),
      now: new Date(startedAt),
    });
    writeScratchOwnerRecord(root, owner);
    return owner;
  }
}

/**
 * Upgrade a source/dist-compatible path memo created by an older setup copy.
 *
 * Lisa's own config may load a built setup module and the source setup module
 * in the same worker. The public memo deliberately remains a string path; when
 * the first copy predates durable markers, the newer copy adopts that exact
 * current-process root and supplies the missing authority record.
 * @param root - Existing memoized run-root path
 * @param baseDir - Temp base recorded before redirection
 * @returns Durable handle for the existing root
 */
export function adoptOwnedScratchRunRoot(
  root: string,
  baseDir: string
): OwnedScratchRunRoot {
  const authority = createScratchNamespaceAuthority(baseDir);
  const canonicalRoot = fs.realpathSync(root);
  if (
    path.dirname(canonicalRoot) !== authority.namespace.canonicalPath ||
    path.basename(root) !== path.basename(canonicalRoot)
  ) {
    throw new Error("Memoized scratch root is outside canonical authority");
  }
  const parsed = parseRunRootName(path.basename(root));
  if (parsed?.pid !== process.pid) {
    throw new Error("Memoized scratch root is not owned by this process");
  }
  const owner = readOrCreateAdoptedOwner(authority, root, parsed.startedAt);
  return {
    path: root,
    basename: path.basename(root),
    authority,
    owner,
  };
}

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
  if (path.basename(dir) !== SCRATCH_NAMESPACE) {
    throw new Error(
      `Scratch namespace must be the exact ${SCRATCH_NAMESPACE} child`
    );
  }
  return reclaimAndCreateOwnedRunRoot(path.dirname(dir)).path;
};

/**
 * Remove a run root using the authority and token captured when it was made.
 * @param owned - Durable owned-root handle
 */
export function removeOwnedScratchRunRoot(
  owned: OwnedScratchRunRoot | ScratchRunRootIntentV1
): void {
  if ("rootPath" in owned) {
    const opened = openOwnedScratchRunRoot(owned);
    if (opened !== undefined) {
      removeOwnedScratchRunRoot(opened);
      return;
    }
    const quarantine = interruptedQuarantine(owned);
    if (quarantine === undefined) return;
    removeAuthorizedScratchRoot({
      authority: owned.authority,
      basename: quarantine.basename,
      expectedToken: owned.token,
      expectedIdentity: quarantine.identity,
    });
    return;
  }
  removeAuthorizedScratchRoot({
    authority: owned.authority,
    basename: owned.basename,
    expectedToken: owned.owner.token,
    expectedIdentity: owned.owner.root,
  });
}

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
/* eslint-enable max-lines -- end cohesive scratch lifecycle contract */
