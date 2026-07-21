/** Confined, bounded filesystem reads for deterministic health probes. */
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 512 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const UNSAFE_PROJECT_FILE = "Unsafe health project file";

/** Stable metadata and bytes captured from one confined regular file. */
export interface ProjectFileSnapshot {
  readonly bytes: Buffer;
  readonly mode: number;
}

/** Safe path kinds understood by deterministic health. */
export type ProjectPathKind = "missing" | "file" | "directory";

/**
 * Resolve a project-relative path without permitting traversal.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @returns Confined absolute path
 */
export function resolveProjectPath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Health path must be project-relative");
  }
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Health path escapes project root");
  }
  return target;
}

/**
 * Assert that one lstat result is a bounded regular file.
 * @param stat - File metadata
 * @param maximumBytes - Maximum allowed size
 */
function assertBoundedFile(stat: Stats, maximumBytes: number): void {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(UNSAFE_PROJECT_FILE);
  }
  if (stat.size > maximumBytes) {
    throw new Error("Health project file exceeds size limit");
  }
}

/**
 * Test for one confined regular file while refusing to follow its final link.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @returns Whether a stable regular file exists
 */
export async function projectRegularFileExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  const target = resolveProjectPath(root, relativePath);
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(UNSAFE_PROJECT_FILE);
    }
    const actual = await realpath(target);
    if (!actual.startsWith(`${root}${path.sep}`)) {
      throw new Error("Unsafe health project file escapes project root");
    }
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.isSymbolicLink()) {
        throw new Error(UNSAFE_PROJECT_FILE);
      }
      if (opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new Error("Health project file changed during inspection");
      }
      return true;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Read at most maximum plus one bytes without unbounded stream behavior.
 * @param handle - Open nonblocking regular-file handle
 * @param maximumBytes - Maximum allowed payload size
 * @param offset - Current read offset
 * @returns Bounded bytes
 */
async function readBounded(
  handle: FileHandle,
  maximumBytes: number,
  offset = 0
): Promise<Buffer> {
  const remaining = maximumBytes + 1 - offset;
  if (remaining <= 0) return Buffer.alloc(0);
  const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
  const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
  if (bytesRead === 0) return Buffer.alloc(0);
  const current = chunk.subarray(0, bytesRead);
  const tail = await readBounded(handle, maximumBytes, offset + bytesRead);
  return Buffer.concat([current, tail], bytesRead + tail.length);
}

/**
 * Read one stable regular file without following a target outside the project.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @param maximumBytes - Maximum permitted file size
 * @returns File bytes, or undefined when absent
 */
export async function readProjectFile(
  root: string,
  relativePath: string,
  maximumBytes = DEFAULT_MAX_BYTES
): Promise<ProjectFileSnapshot | undefined> {
  const target = resolveProjectPath(root, relativePath);
  try {
    const before = await lstat(target);
    assertBoundedFile(before, maximumBytes);
    const actual = await realpath(target);
    if (!actual.startsWith(`${root}${path.sep}`)) {
      throw new Error("Unsafe health project file escapes project root");
    }
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const opened = await handle.stat();
      assertBoundedFile(opened, maximumBytes);
      if (opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new Error("Health project file changed during read");
      }
      const bytes = await readBounded(handle, maximumBytes);
      if (bytes.length > maximumBytes) {
        throw new Error("Health project file exceeds size limit");
      }
      const after = await handle.stat();
      if (after.size !== opened.size || bytes.length !== after.size) {
        throw new Error("Health project file changed during read");
      }
      return { bytes, mode: opened.mode };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Read just the bytes from one confined stable regular file.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @param maximumBytes - Maximum permitted file size
 * @returns File bytes, or undefined when absent
 */
export async function readProjectBytes(
  root: string,
  relativePath: string,
  maximumBytes = DEFAULT_MAX_BYTES
): Promise<Buffer | undefined> {
  return (await readProjectFile(root, relativePath, maximumBytes))?.bytes;
}

/**
 * Classify a confined path without following symbolic links or accepting
 * special files such as FIFOs and devices.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @returns Safe path kind
 */
export async function projectPathKind(
  root: string,
  relativePath: string
): Promise<ProjectPathKind> {
  const target = resolveProjectPath(root, relativePath);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error("Unsafe health project path");
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new Error("Unsafe health project path");
    }
    const actual = await realpath(target);
    if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) {
      throw new Error("Unsafe health project path escapes project root");
    }
    return stat.isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/**
 * Read strict UTF-8 text from a confined project file.
 * @param root - Canonical project root
 * @param relativePath - Project-relative path
 * @param maximumBytes - Maximum permitted file size
 * @returns Text, or undefined when absent
 */
export async function readProjectText(
  root: string,
  relativePath: string,
  maximumBytes = DEFAULT_MAX_BYTES
): Promise<string | undefined> {
  const bytes = await readProjectBytes(root, relativePath, maximumBytes);
  return bytes === undefined
    ? undefined
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Read a JSON object without exposing its values in failures.
 * @param root - Canonical project root
 * @param relativePath - Project-relative JSON path
 * @returns Parsed object, or undefined when absent
 */
export async function readProjectJsonObject(
  root: string,
  relativePath: string
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const text = await readProjectText(root, relativePath);
  if (text === undefined) return undefined;
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Health project JSON must be an object");
  }
  return parsed as Readonly<Record<string, unknown>>;
}
