/** Confined, bounded, atomic storage for the latest completed Health v1 run. */
import * as fse from "fs-extra";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { withFileTargetLock } from "../core/learnings-lock.js";
import { type HealthResult, validateHealthResult } from "./contract.js";
import { syncContainingDirectory } from "./directory-sync.js";

export const HEALTH_RESULT_PATH = ".lisa/health/latest.json";
export const MAX_HEALTH_RESULT_BYTES = 256 * 1024;

/** Non-throwing read outcome for persisted runtime health state. */
export type HealthReadResult =
  | {
      readonly status: "available";
      readonly result: HealthResult;
      readonly lastRun: string;
    }
  | { readonly status: "never-run" }
  | { readonly status: "unreadable"; readonly reason: string };

/** Atomic write or monotonic no-op outcome. */
export type HealthWriteResult =
  | {
      readonly status: "written";
      readonly path: string;
      readonly result: HealthResult;
    }
  | {
      readonly status: "unchanged";
      readonly path: string;
      readonly result: HealthResult;
    };

/**
 * Read the canonical latest result without throwing for runtime-state faults.
 * @param projectRoot - Project containing runtime health state
 * @returns Available, never-run, or unreadable outcome
 */
export async function readLatestHealthResult(
  projectRoot: string
): Promise<HealthReadResult> {
  try {
    const target = await resolveReadTarget(projectRoot);
    const payload = await readBoundedRegularFile(target);
    if (payload === undefined) return Object.freeze({ status: "never-run" });
    const parsed = JSON.parse(payload) as unknown;
    const result = validateHealthResult(parsed);
    return Object.freeze({
      status: "available",
      result,
      lastRun: result.completedAt,
    });
  } catch (error) {
    return Object.freeze({
      status: "unreadable",
      reason: safeReadReason(error),
    });
  }
}

/**
 * Validate and atomically publish a completed result. Writes are serialized,
 * and an older or equal completion timestamp cannot replace a newer result.
 * @param projectRoot - Project receiving runtime health state
 * @param candidate - Untrusted completed result candidate
 * @returns Written or monotonic unchanged outcome
 */
export async function writeLatestHealthResult(
  projectRoot: string,
  candidate: unknown
): Promise<HealthWriteResult> {
  const result = validateHealthResult(candidate);
  const serialized = serializeValidatedHealthResult(result);
  const { directory, target } = await resolveWriteTarget(projectRoot);
  return withFileTargetLock(target, async () => {
    await assertSafeTarget(target);
    const current = await readLatestHealthResult(projectRoot);
    if (current.status === "available") {
      const samePayload =
        serializeValidatedHealthResult(current.result) === serialized;
      if (current.result.runId === result.runId) {
        if (!samePayload) {
          throw new Error("Health result conflict: runId was reused");
        }
        return unchanged(target, current.result);
      }
      if (current.result.completedAt === result.completedAt) {
        throw new Error(
          "Health result conflict: completedAt is shared by different runs"
        );
      }
      if (current.result.completedAt > result.completedAt) {
        return unchanged(target, current.result);
      }
    }
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
    return Object.freeze({ status: "written", path: target, result });
  });
}

/**
 * Serialize once and reject over-budget output before filesystem mutation.
 * @param result - Validated result
 * @returns Canonical bounded JSON payload
 */
function serializeValidatedHealthResult(result: HealthResult): string {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_HEALTH_RESULT_BYTES) {
    throw new Error("Health result exceeds 256 KiB");
  }
  return serialized;
}

/**
 * Validate and serialize one Health v1 result using the storage wire format.
 * Consumers use this function so emitted bytes cannot drift from persisted
 * bytes.
 * @param candidate - Untrusted completed result candidate
 * @returns Canonical bounded JSON payload, including its trailing newline
 */
export function serializeHealthResult(candidate: unknown): string {
  return serializeValidatedHealthResult(validateHealthResult(candidate));
}

/**
 * Return the canonical idempotent no-write result.
 * @param target - Canonical result path
 * @param result - Existing persisted result
 * @returns Frozen unchanged outcome
 */
function unchanged(target: string, result: HealthResult): HealthWriteResult {
  return Object.freeze({ status: "unchanged", path: target, result });
}

/**
 * Resolve an existing project root and canonical read target.
 * @param projectRoot - Project containing runtime health state
 * @returns Confined canonical target
 */
async function resolveReadTarget(projectRoot: string): Promise<string> {
  const root = await requireProjectRoot(projectRoot);
  const lisaDirectory = path.join(root, ".lisa");
  const healthDirectory = path.join(lisaDirectory, "health");
  if ((await statPath(lisaDirectory)) !== undefined) {
    await assertConfinedDirectory(root, lisaDirectory);
  }
  if ((await statPath(healthDirectory)) !== undefined) {
    await assertConfinedDirectory(root, healthDirectory);
  }
  return path.join(root, HEALTH_RESULT_PATH);
}

/**
 * Create safe canonical parent directories and return write paths.
 * @param projectRoot - Project receiving runtime health state
 * @returns Confined parent directory and target
 */
async function resolveWriteTarget(
  projectRoot: string
): Promise<{ readonly directory: string; readonly target: string }> {
  const root = await requireProjectRoot(projectRoot);
  const lisaDirectory = path.join(root, ".lisa");
  const directory = path.join(lisaDirectory, "health");
  await ensureSafeDirectory(root, lisaDirectory);
  await ensureSafeDirectory(root, directory);
  return { directory, target: path.join(directory, "latest.json") };
}

/**
 * Resolve and verify a real directory root.
 * @param projectRoot - Project-root candidate
 * @returns Canonical real project root
 */
async function requireProjectRoot(projectRoot: string): Promise<string> {
  const resolved = path.resolve(projectRoot);
  const root = await realpath(resolved);
  const metadata = await lstat(root);
  if (!metadata.isDirectory()) {
    throw new Error("Health project root is not a directory");
  }
  return root;
}

/**
 * Create one directory only after its nearest existing parent stays confined.
 * @param root - Canonical project root
 * @param directory - Intended child directory
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
 * Reject symlinked, special, or root-escaping storage parents.
 * @param root - Canonical project root
 * @param directory - Existing storage parent
 */
async function assertConfinedDirectory(
  root: string,
  directory: string
): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Unsafe health storage parent");
  }
  const actual = await realpath(directory);
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) {
    throw new Error("Unsafe health storage parent escapes project root");
  }
}

/**
 * Reject an existing target unless it is a regular non-symlink file.
 * @param target - Canonical result target
 */
async function assertSafeTarget(target: string): Promise<void> {
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Unsafe health result target");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Read a bounded stable regular-file inode.
 * @param target - Canonical result target
 * @returns Strict UTF-8 payload, or undefined when absent
 */
async function readBoundedRegularFile(
  target: string
): Promise<string | undefined> {
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("Unsafe health result target");
    }
    if (before.size > MAX_HEALTH_RESULT_BYTES) {
      throw new Error("Health result exceeds 256 KiB");
    }
    const handle = await open(target, "r");
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size > MAX_HEALTH_RESULT_BYTES
      ) {
        throw new Error("Health result changed during read");
      }
      const bytes = await handle.readFile();
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Read path metadata without following symlinks.
 * @param filePath - Filesystem path
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

/**
 * Reduce runtime-state failures to a non-sensitive operator-readable reason.
 * @param error - Read failure
 * @returns Stable operator-facing reason
 */
function safeReadReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  if (message.includes("schemaVersion"))
    return "unsupported health result schema";
  if (message.includes("256 KiB")) return "health result exceeds size limit";
  if (message.includes("Unsafe") || message.includes("changed during read")) {
    return "unsafe health result storage";
  }
  return "malformed health result";
}
