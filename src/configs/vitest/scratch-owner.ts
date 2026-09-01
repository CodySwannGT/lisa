/**
 * Durable owner records for Vitest scratch roots.
 *
 * A pid is not an identity: kernels reuse it. The marker therefore binds the
 * pid to the process birth value reported by the operating system, and every
 * reclaim decision compares both. A live pid whose birth cannot be read is
 * preserved; deletion fails closed rather than guessing.
 * @module configs/vitest/scratch-owner
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

/** Owner-marker filename stored directly inside every run root. */
export const SCRATCH_OWNER_FILE = ".lisa-scratch-owner.json";

/** Prefix identifying a per-process run root inside the namespace. */
export const SCRATCH_RUN_ROOT_PREFIX = "run-";

/** Filesystem identity pinned into an owner record. */
export interface ScratchPathIdentity {
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

/** Version-one durable owner marker. */
export interface ScratchOwnerRecordV1 {
  readonly schema: 1;
  readonly pid: number;
  readonly processBirthFingerprint: string;
  readonly createdAt: string;
  readonly token: string;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
  readonly namespace: ScratchPathIdentity;
  readonly root: ScratchPathIdentity;
}

/** Minimal namespace authority consumed while constructing a record. */
interface OwnerAuthority {
  readonly namespace: ScratchPathIdentity;
}

/** Inputs for a new owner record. */
export interface CreateScratchOwnerRecordOptions {
  readonly authority: OwnerAuthority;
  readonly root: string;
  readonly pid?: number;
  readonly processBirthFingerprint?: string;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
  /** Precommitted 128-bit ownership token, when a supervisor armed it first. */
  readonly token?: string;
  readonly now?: Date;
}

/** Probes used to classify a persisted owner. */
export interface ScratchOwnerProbes {
  readonly isProcessAlive: (pid: number) => boolean;
  readonly processBirthFingerprint: (pid: number) => string | undefined;
}

/** Safe reclaim verdict for an owner record. */
export type ScratchOwnerDisposition = "reclaim" | "preserve";

/** Maximum time allowed for the bounded macOS process-birth probe. */
const PS_TIMEOUT_MS = 1_000;

/** Maximum pids admitted to one bounded macOS `ps` invocation. */
const DARWIN_BIRTH_BATCH_SIZE = 256;

/** Injectable seams for one bulk process-birth snapshot. */
export interface ProcessBirthFingerprintSnapshotOptions {
  /** Platform contract to exercise; defaults to the current platform. */
  readonly platform?: NodeJS.Platform;
  /** Bounded macOS batch runner, injectable for deterministic call-count tests. */
  readonly runDarwinBatch?: (pids: readonly number[]) => string | undefined;
}

/** Maximum owner-marker bytes accepted at the destructive authority boundary. */
const MAX_OWNER_MARKER_BYTES = 16 * 1024;

/** Maximum bytes accepted for one opaque marker string. */
const MAX_OWNER_TEXT_BYTES = 256;

/** Maximum bytes accepted for one canonical filesystem path. */
const MAX_OWNER_PATH_BYTES = 4_096;

/** Maximum registered prefixes accepted in one marker. */
const MAX_OWNER_PREFIXES = 64;

/**
 * Read Linux's immutable process start ticks.
 * @param pid - Process id to inspect
 * @returns A stable fingerprint, or undefined when unavailable
 */
function linuxBirthFingerprint(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const commEnd = stat.lastIndexOf(")");
    if (commEnd < 0) return undefined;
    const fields = stat
      .slice(commEnd + 2)
      .trim()
      .split(/\s+/u);
    const startTicks = fields[19];
    return startTicks === undefined ? undefined : `linux:${startTicks}`;
  } catch {
    return undefined;
  }
}

/**
 * Read macOS kernel-reported process start times through one bounded `ps` call.
 * @param pids - Process ids to inspect together
 * @returns Raw pid/start rows, or undefined when unavailable
 */
function runDarwinBirthBatch(pids: readonly number[]): string | undefined {
  const result = spawnSync(
    "/bin/ps",
    ["-p", pids.join(","), "-o", "pid=", "-o", "lstart="],
    {
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: Math.max(4_096, pids.length * 128),
      timeout: PS_TIMEOUT_MS,
    }
  );
  if (
    result.status !== 0 ||
    result.signal !== null ||
    result.error !== undefined
  ) {
    return undefined;
  }
  return result.stdout;
}

/**
 * Parse one bulk `pid lstart` row without depending on locale text.
 * @param row - One bounded `ps` output row
 * @returns Parsed pid and fingerprint, or undefined for malformed output
 */
function parseDarwinBirthRow(
  row: string
): readonly [number, string] | undefined {
  const normalized = row.trim();
  const separator = normalized.search(/\s/u);
  if (separator < 1) return undefined;
  const pid = Number(normalized.slice(0, separator));
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const start = normalized.slice(separator).trim().replace(/\s+/gu, " ");
  return start === "" ? undefined : [pid, `darwin:${start}`];
}

/**
 * Capture process birth once for a bounded pid set.
 *
 * Darwin has no `/proc`, so namespace audits must not launch one `ps` process
 * per live scratch root. This snapshot deduplicates pids and reads them in
 * bounded 256-pid batches; callers reuse the returned map throughout one
 * sweep/inspection transaction.
 * @param pids - Process ids needed by one audit transaction
 * @param options - Platform and deterministic batch seam
 * @returns A complete lookup whose missing observations remain undefined
 */
export function processBirthFingerprintSnapshot(
  pids: readonly number[],
  options: ProcessBirthFingerprintSnapshotOptions = {}
): ReadonlyMap<number, string | undefined> {
  const unique = [...new Set(pids)]
    .filter(pid => Number.isSafeInteger(pid) && pid > 0)
    .sort((left, right) => left - right);
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    return new Map(unique.map(pid => [pid, linuxBirthFingerprint(pid)]));
  }
  if (platform !== "darwin") {
    return new Map(unique.map(pid => [pid, undefined]));
  }
  const runBatch = options.runDarwinBatch ?? runDarwinBirthBatch;
  const batchCount = Math.ceil(unique.length / DARWIN_BIRTH_BATCH_SIZE);
  const observations = new Map(
    Array.from({ length: batchCount }, (_, index) =>
      unique.slice(
        index * DARWIN_BIRTH_BATCH_SIZE,
        (index + 1) * DARWIN_BIRTH_BATCH_SIZE
      )
    ).flatMap(batch =>
      (runBatch(batch) ?? "")
        .split("\n")
        .map(parseDarwinBirthRow)
        .filter(
          (entry): entry is readonly [number, string] => entry !== undefined
        )
    )
  );
  return new Map(unique.map(pid => [pid, observations.get(pid)]));
}

/**
 * Read the OS-authoritative birth fingerprint for a process.
 * @param pid - Process id to inspect
 * @returns Fingerprint, or undefined on an unsupported/ambiguous platform
 */
export function processBirthFingerprint(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  return processBirthFingerprintSnapshot([pid]).get(pid);
}

/** Stable unsupported-platform fallback captured once at module load. */
const UNSUPPORTED_CURRENT_BIRTH = `unsupported:${String(process.pid)}:${String(
  Math.round(Date.now() - process.uptime() * 1_000)
)}`;

/**
 * Fingerprint the current process for a newly-created marker.
 *
 * Unsupported platforms still need an opaque value to make the marker
 * complete. Reclaim never treats this fallback as authoritative: a live pid on
 * such a platform yields an ambiguous observation and is preserved.
 * @returns Current process birth fingerprint
 */
export function currentProcessBirthFingerprint(): string {
  return processBirthFingerprint(process.pid) ?? UNSUPPORTED_CURRENT_BIRTH;
}

/** Ownership encoded in a legacy or current run-root basename. */
export interface RunRootOwner {
  readonly pid: number;
  readonly startedAt: number;
}

/**
 * Build a run-root basename.
 * @param pid - Owning process id
 * @param startedAt - Creation epoch milliseconds
 * @param suffix - Opaque random suffix
 * @returns Direct namespace-child basename
 */
export function scratchRunRootName(
  pid: number,
  startedAt: number,
  suffix: string
): string {
  return `${SCRATCH_RUN_ROOT_PREFIX}${String(pid)}-${String(startedAt)}-${suffix}`;
}

/**
 * Parse the owner fields encoded in a run-root basename.
 * @param name - Direct namespace-child basename
 * @returns Parsed owner, or undefined for an unrelated name
 */
export function parseScratchRunRootName(
  name: string
): RunRootOwner | undefined {
  const match = new RegExp(
    `^${SCRATCH_RUN_ROOT_PREFIX}(\\d+)-(\\d+)-[^-]+$`
  ).exec(name);
  if (match === null) return undefined;
  const pid = Number(match[1]);
  const startedAt = Number(match[2]);
  return Number.isSafeInteger(pid) && Number.isSafeInteger(startedAt)
    ? { pid, startedAt }
    : undefined;
}

/**
 * Decide whether a valid owner may be reclaimed.
 * @param record - Persisted owner marker
 * @param probes - Kernel probes, injectable for deterministic tests
 * @returns Fail-closed reclaim disposition
 */
export function classifyScratchOwner(
  record: ScratchOwnerRecordV1,
  probes: ScratchOwnerProbes
): ScratchOwnerDisposition {
  if (!probes.isProcessAlive(record.pid)) return "reclaim";
  if (record.processBirthFingerprint.startsWith("unsupported:")) {
    return "preserve";
  }
  const observed = probes.processBirthFingerprint(record.pid);
  if (observed === undefined) return "preserve";
  return observed === record.processBirthFingerprint ? "preserve" : "reclaim";
}

/**
 * Capture an immutable filesystem identity without following a final symlink.
 * @param candidate - Existing regular file or directory
 * @returns Canonical path plus device/inode identity
 */
export function scratchPathIdentity(candidate: string): ScratchPathIdentity {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) {
    throw new Error(`Scratch authority refuses symlink path: ${candidate}`);
  }
  return {
    canonicalPath: fs.realpathSync(candidate),
    dev: stat.dev,
    ino: stat.ino,
  };
}

/**
 * Construct a version-one owner marker from live filesystem state.
 * @param options - Owner and path facts
 * @returns Immutable owner record
 */
export function createScratchOwnerRecord(
  options: CreateScratchOwnerRecordOptions
): ScratchOwnerRecordV1 {
  const prefixes = [...new Set(options.registeredPrefixes)].sort(
    (left, right) => left.localeCompare(right)
  );
  return {
    schema: 1,
    pid: options.pid ?? process.pid,
    processBirthFingerprint:
      options.processBirthFingerprint ?? currentProcessBirthFingerprint(),
    createdAt: (options.now ?? new Date()).toISOString(),
    token: options.token ?? randomBytes(16).toString("hex"),
    suiteLabel: options.suiteLabel,
    registeredPrefixes: prefixes,
    namespace: options.authority.namespace,
    root: scratchPathIdentity(options.root),
  };
}

/**
 * Validate an inert parsed object as a version-one owner record.
 * @param candidate - Parsed marker payload
 * @returns Validated owner record
 */
function validateOwnerRecord(candidate: unknown): ScratchOwnerRecordV1 {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Scratch owner marker must be an object");
  }
  const value = candidate as Record<string, unknown>;
  const namespace = value["namespace"] as Record<string, unknown> | undefined;
  const root = value["root"] as Record<string, unknown> | undefined;
  const prefixes = value["registeredPrefixes"];
  const validText = (text: unknown): text is string =>
    typeof text === "string" &&
    text !== "" &&
    Buffer.byteLength(text, "utf8") <= MAX_OWNER_TEXT_BYTES;
  const validPath = (text: unknown): text is string =>
    typeof text === "string" &&
    text !== "" &&
    Buffer.byteLength(text, "utf8") <= MAX_OWNER_PATH_BYTES;
  const validIdentity = (
    identity: Record<string, unknown> | undefined
  ): boolean =>
    identity !== undefined &&
    validPath(identity["canonicalPath"]) &&
    path.isAbsolute(identity["canonicalPath"]) &&
    Number.isSafeInteger(identity["dev"]) &&
    Number.isSafeInteger(identity["ino"]);
  if (
    value["schema"] !== 1 ||
    typeof value["pid"] !== "number" ||
    !Number.isSafeInteger(value["pid"]) ||
    value["pid"] <= 0 ||
    !validText(value["processBirthFingerprint"]) ||
    !validText(value["createdAt"]) ||
    Number.isNaN(Date.parse(value["createdAt"])) ||
    !validText(value["token"]) ||
    !validText(value["suiteLabel"]) ||
    !Array.isArray(prefixes) ||
    prefixes.length > MAX_OWNER_PREFIXES ||
    !prefixes.every(
      prefix =>
        validText(prefix) &&
        !prefix.includes("/") &&
        !prefix.includes("\\") &&
        prefix !== "." &&
        prefix !== ".."
    ) ||
    !validIdentity(namespace) ||
    !validIdentity(root)
  ) {
    throw new Error("Invalid scratch owner marker schema");
  }
  return candidate as ScratchOwnerRecordV1;
}

/**
 * Write an owner marker without permitting a pre-existing file or symlink.
 * @param root - Owned run root
 * @param record - Marker to persist
 */
export function writeScratchOwnerRecord(
  root: string,
  record: ScratchOwnerRecordV1
): void {
  const marker = path.join(root, SCRATCH_OWNER_FILE);
  const descriptor = fs.openSync(
    marker,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Read and validate an owner marker without following a marker symlink.
 * @param root - Run root containing the marker
 * @returns Validated owner marker
 */
export function readScratchOwnerRecord(root: string): ScratchOwnerRecordV1 {
  const marker = path.join(root, SCRATCH_OWNER_FILE);
  const stat = fs.lstatSync(marker);
  if (stat.isSymbolicLink()) {
    throw new Error(`Scratch owner marker is a symlink: ${marker}`);
  }
  if (!stat.isFile())
    throw new Error(`Scratch owner marker is not a file: ${marker}`);
  if (stat.size > MAX_OWNER_MARKER_BYTES) {
    throw new Error(
      `Scratch owner marker exceeds ${String(MAX_OWNER_MARKER_BYTES)} bytes`
    );
  }
  return validateOwnerRecord(JSON.parse(fs.readFileSync(marker, "utf8")));
}
