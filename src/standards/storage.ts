/** Confined, bounded, atomic storage for standards-conformance proof. */
import * as fse from "fs-extra";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { withFileTargetLock } from "../core/learnings-lock.js";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  STANDARDS_PROOF_PATH,
  type StandardsProof,
  validateStandardsProof,
} from "./contract.js";
import {
  MALFORMED_STANDARDS_PROOF_REASON,
  safeStandardsStorageReason,
  safeStandardsValidationReason,
} from "./storage-reasons.js";

export const MAX_STANDARDS_PROOF_BYTES = 128 * 1024;
const PROOF_TOO_LARGE = "Standards proof exceeds 128 KiB";
const UNSAFE_PROOF_TARGET = "Unsafe standards proof target";
/** Filesystem metadata used to pin a proof to one regular file. */
type FileMetadata = Awaited<ReturnType<typeof lstat>>;

/** Closed result of reading a standards proof artifact. */
export type StandardsProofReadResult =
  | { readonly status: "available"; readonly proof: StandardsProof }
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly reason: string };

/** Test-only timing boundary used to exercise post-open file growth. */
export interface StandardsProofReadDependencies {
  readonly afterOpen?: (target: string) => Promise<void>;
}

/**
 * Read strict proof state without throwing for runtime-state faults.
 * @param projectRoot - Project directory containing the proof
 * @param now - Observation time for future-timestamp rejection
 * @param dependencies - Test-only timing dependencies
 * @returns Closed proof read result
 */
export async function readStandardsProof(
  projectRoot: string,
  now: Date = new Date(),
  dependencies: StandardsProofReadDependencies = {}
): Promise<StandardsProofReadResult> {
  const payload = await readProofPayload(projectRoot, dependencies);
  if (typeof payload !== "string") return payload;
  const parsed = parseProofPayload(payload);
  if (parsed.status === "unreadable") return parsed;
  try {
    return Object.freeze({
      status: "available",
      proof: validateStandardsProof(parsed.candidate, now),
    });
  } catch (error) {
    return unreadable(safeStandardsValidationReason(error));
  }
}

/**
 * Parse a bounded proof payload into untrusted data.
 * @param payload - UTF-8 JSON payload
 * @returns Parsed candidate or a safe unreadable result
 */
function parseProofPayload(
  payload: string
):
  | { readonly status: "parsed"; readonly candidate: unknown }
  | Extract<StandardsProofReadResult, { readonly status: "unreadable" }> {
  try {
    return Object.freeze({
      status: "parsed",
      candidate: JSON.parse(payload) as unknown,
    });
  } catch {
    return unreadable(MALFORMED_STANDARDS_PROOF_REASON);
  }
}

/**
 * Read a proof payload while converting storage faults to closed results.
 * @param projectRoot - Project directory containing the proof
 * @param dependencies - Test-only timing dependencies
 * @returns Raw payload or a closed proof read result
 */
async function readProofPayload(
  projectRoot: string,
  dependencies: StandardsProofReadDependencies
): Promise<string | StandardsProofReadResult> {
  try {
    const target = await resolveReadTarget(projectRoot);
    const payload = await readBoundedRegularFile(target, dependencies);
    return payload === undefined
      ? Object.freeze({ status: "missing" })
      : payload;
  } catch (error) {
    return unreadable(safeStandardsStorageReason(error));
  }
}

/**
 * Construct an immutable unreadable result.
 * @param reason - Sanitized operator-facing reason
 * @returns Closed unreadable result
 */
function unreadable(
  reason: string
): Extract<StandardsProofReadResult, { readonly status: "unreadable" }> {
  return Object.freeze({ status: "unreadable", reason });
}

/**
 * Validate and atomically replace the proof only after capture succeeds.
 * @param projectRoot - Project directory that owns the proof
 * @param candidate - Untrusted proof candidate
 * @param now - Validation time for future-timestamp rejection
 * @returns Stored path and immutable proof
 */
export async function writeStandardsProof(
  projectRoot: string,
  candidate: unknown,
  now: Date = new Date()
): Promise<{ readonly path: string; readonly proof: StandardsProof }> {
  const proof = validateStandardsProof(candidate, now);
  const serialized = serialize(proof);
  const { target } = await resolveWriteTarget(projectRoot);
  return await withFileTargetLock(target, async () => {
    await assertSafeTarget(target);
    await writeFileAtomically(target, serialized, {
      mode: 0o600,
      beforeRename: () => assertSafeTarget(target),
    });
    return Object.freeze({ path: target, proof });
  });
}

/**
 * Serialize a proof within its storage budget.
 * @param proof - Validated proof
 * @returns Canonical JSON file payload
 */
function serialize(proof: StandardsProof): string {
  const payload = `${JSON.stringify(proof, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_STANDARDS_PROOF_BYTES) {
    throw new Error(PROOF_TOO_LARGE);
  }
  return payload;
}

/**
 * Resolve and validate a real project directory.
 * @param projectRoot - Candidate project directory
 * @returns Canonical project directory
 */
async function requireProjectRoot(projectRoot: string): Promise<string> {
  const root = await realpath(path.resolve(projectRoot));
  const metadata = await lstat(root);
  if (!metadata.isDirectory())
    throw new Error("Project root is not a directory");
  return root;
}

/**
 * Resolve a confined proof read target without creating directories.
 * @param projectRoot - Project directory containing the proof
 * @returns Confined proof path
 */
async function resolveReadTarget(projectRoot: string): Promise<string> {
  const root = await requireProjectRoot(projectRoot);
  for (const directory of [
    path.join(root, ".lisa"),
    path.join(root, ".lisa", "standards"),
  ]) {
    if ((await statPath(directory)) !== undefined) {
      await assertConfinedDirectory(root, directory);
    }
  }
  return path.join(root, STANDARDS_PROOF_PATH);
}

/**
 * Resolve and prepare a confined proof write target.
 * @param projectRoot - Project directory that owns the proof
 * @returns Confined storage directory and proof path
 */
async function resolveWriteTarget(
  projectRoot: string
): Promise<{ readonly directory: string; readonly target: string }> {
  const root = await requireProjectRoot(projectRoot);
  const lisa = path.join(root, ".lisa");
  const directory = path.join(lisa, "standards");
  await ensureSafeDirectory(root, lisa);
  await ensureSafeDirectory(root, directory);
  return { directory, target: path.join(directory, "latest.json") };
}

/**
 * Create a directory only through a confined real parent.
 * @param root - Canonical project directory
 * @param directory - Directory to validate or create
 */
async function ensureSafeDirectory(
  root: string,
  directory: string
): Promise<void> {
  if ((await statPath(directory)) !== undefined) {
    await assertConfinedDirectory(root, directory);
    return;
  }
  await assertConfinedDirectory(root, path.dirname(directory));
  await fse.ensureDir(directory);
  await assertConfinedDirectory(root, directory);
}

/**
 * Require a real directory confined beneath the project root.
 * @param root - Canonical project directory
 * @param directory - Directory to validate
 */
async function assertConfinedDirectory(
  root: string,
  directory: string
): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Unsafe standards storage parent");
  }
  const actual = await realpath(directory);
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) {
    throw new Error("Unsafe standards storage parent escapes project root");
  }
}

/**
 * Reject an existing proof target unless it is a regular file.
 * @param target - Proof path to validate
 */
async function assertSafeTarget(target: string): Promise<void> {
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(UNSAFE_PROOF_TARGET);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Open and read one bounded regular file without following symlinks.
 * @param target - Proof path to read
 * @param dependencies - Test-only timing dependencies
 * @returns UTF-8 payload, or undefined when the path is absent
 */
async function readBoundedRegularFile(
  target: string,
  dependencies: StandardsProofReadDependencies
): Promise<string | undefined> {
  try {
    const before = await lstat(target);
    assertReadableMetadata(before);
    const handle = await open(
      target,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
    );
    try {
      return await readOpenedProof(handle, target, before, dependencies);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (
      ["ELOOP", "ENXIO", "EAGAIN"].includes(
        (error as NodeJS.ErrnoException).code ?? ""
      )
    ) {
      throw new Error(UNSAFE_PROOF_TARGET);
    }
    throw error;
  }
}

/**
 * Require regular-file metadata within the proof size budget.
 * @param metadata - Filesystem metadata to validate
 */
function assertReadableMetadata(metadata: FileMetadata): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(UNSAFE_PROOF_TARGET);
  }
  if (metadata.size > MAX_STANDARDS_PROOF_BYTES) {
    throw new Error(PROOF_TOO_LARGE);
  }
}

/**
 * Pin an opened proof descriptor before reading its contents.
 * @param handle - Open no-follow file handle
 * @param target - Proof path used for identity checks
 * @param before - Metadata observed before opening
 * @param dependencies - Test-only timing dependencies
 * @returns Stable UTF-8 payload
 */
async function readOpenedProof(
  handle: Awaited<ReturnType<typeof open>>,
  target: string,
  before: FileMetadata,
  dependencies: StandardsProofReadDependencies
): Promise<string> {
  const opened = await handle.stat();
  const bytes = Buffer.alloc(MAX_STANDARDS_PROOF_BYTES + 1);
  assertSameFile(before, opened);
  await dependencies.afterOpen?.(target);
  return await finishOpenedProofRead(handle, target, opened, bytes);
}

/**
 * Read an opened proof and verify its descriptor and path remain stable.
 * @param handle - Open proof file handle
 * @param target - Proof path used for identity checks
 * @param opened - Metadata pinned immediately after opening
 * @param bytes - Fixed-size destination buffer
 * @returns Stable UTF-8 payload
 */
async function finishOpenedProofRead(
  handle: Awaited<ReturnType<typeof open>>,
  target: string,
  opened: FileMetadata,
  bytes: Buffer
): Promise<string> {
  const total = await readDescriptorBytes(handle, bytes);
  if (total > MAX_STANDARDS_PROOF_BYTES) throw new Error(PROOF_TOO_LARGE);
  const [afterOpened, afterPath] = await Promise.all([
    handle.stat(),
    lstat(target),
  ]);
  assertSameFile(opened, afterOpened);
  assertSameFile(opened, afterPath);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(0, total)
  );
}

/**
 * Require two metadata snapshots to identify the same unchanged file.
 * @param expected - Pinned metadata snapshot
 * @param actual - Later metadata snapshot
 */
function assertSameFile(expected: FileMetadata, actual: FileMetadata): void {
  if (
    !actual.isFile() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.size !== expected.size
  ) {
    throw new Error("Standards proof changed during read");
  }
}

/**
 * Fill a fixed-size buffer from an opened descriptor.
 * @param handle - Open proof file handle
 * @param bytes - Destination buffer
 * @returns Number of bytes read
 */
async function readDescriptorBytes(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer
): Promise<number> {
  // eslint-disable-next-line functional/no-let -- fixed-size descriptor read advances one bounded offset
  let total = 0;
  while (total < bytes.byteLength) {
    const chunk = await handle.read(
      bytes,
      total,
      bytes.byteLength - total,
      total
    );
    if (chunk.bytesRead === 0) break;
    total += chunk.bytesRead;
  }
  return total;
}

/**
 * Read path metadata while treating absence as undefined.
 * @param filePath - Filesystem path to inspect
 * @returns Metadata, or undefined when absent
 */
async function statPath(
  filePath: string
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
