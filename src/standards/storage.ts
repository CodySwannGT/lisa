/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns -- storage mirrors the already-reviewed Health atomic boundary */
/** Confined, bounded, atomic storage for standards-conformance proof. */
import * as fse from "fs-extra";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { withFileTargetLock } from "../core/learnings-lock.js";
import { syncContainingDirectory } from "../health/directory-sync.js";
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
type FileMetadata = Awaited<ReturnType<typeof lstat>>;

export type StandardsProofReadResult =
  | { readonly status: "available"; readonly proof: StandardsProof }
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly reason: string };

/** Test-only timing boundary used to exercise post-open file growth. */
export interface StandardsProofReadDependencies {
  readonly afterOpen?: (target: string) => Promise<void>;
}

/** Read strict proof state without throwing for runtime-state faults. */
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

function unreadable(
  reason: string
): Extract<StandardsProofReadResult, { readonly status: "unreadable" }> {
  return Object.freeze({ status: "unreadable", reason });
}

/** Validate and atomically replace the proof only after capture succeeds. */
export async function writeStandardsProof(
  projectRoot: string,
  candidate: unknown,
  now: Date = new Date()
): Promise<{ readonly path: string; readonly proof: StandardsProof }> {
  const proof = validateStandardsProof(candidate, now);
  const serialized = serialize(proof);
  const { directory, target } = await resolveWriteTarget(projectRoot);
  return await withFileTargetLock(target, async () => {
    await assertSafeTarget(target);
    const temporary = path.join(
      directory,
      `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await assertSafeTarget(target);
      await rename(temporary, target);
      await syncContainingDirectory(directory);
    } finally {
      await rm(temporary, { force: true });
    }
    return Object.freeze({ path: target, proof });
  });
}

function serialize(proof: StandardsProof): string {
  const payload = `${JSON.stringify(proof, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_STANDARDS_PROOF_BYTES) {
    throw new Error(PROOF_TOO_LARGE);
  }
  return payload;
}

async function requireProjectRoot(projectRoot: string): Promise<string> {
  const root = await realpath(path.resolve(projectRoot));
  const metadata = await lstat(root);
  if (!metadata.isDirectory())
    throw new Error("Project root is not a directory");
  return root;
}

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

function assertReadableMetadata(metadata: FileMetadata): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(UNSAFE_PROOF_TARGET);
  }
  if (metadata.size > MAX_STANDARDS_PROOF_BYTES) {
    throw new Error(PROOF_TOO_LARGE);
  }
}

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

/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns -- restore repository defaults */
