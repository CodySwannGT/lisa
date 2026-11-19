/**
 * Package-file reads for the public upstream-attribution projection.
 *
 * Proves the projection runs inside a genuine Lisa package with frozen,
 * non-empty evidence manifests, and that every excerpt exists verbatim in a
 * regular, non-symlink Lisa file whose bytes match its pinned SHA-256. Reads
 * are bounded, refuse to follow links, and detect a file changing mid-read.
 * @module core/upstream-attribution-files
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

import {
  assertTextControlsSafe,
  decodeUtf8,
  reject,
} from "./upstream-attribution-guards.js";
import {
  UPSTREAM_EVIDENCE_MANIFEST,
  UPSTREAM_PUBLIC_COMMITS,
  UPSTREAM_SURFACE_MANIFEST,
} from "./upstream-evidence-manifest.js";

/** Field every excerpt failure is reported against. */
export const EXCERPTS_FIELD = "lisaOwnedExcerpts";

const PACKAGE_ROOT = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
);
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_PACKAGE_JSON_BYTES = 64_000;
const INVALID_PACKAGE_IDENTITY = "Invalid Lisa package identity";

/**
 * Refuse to run unless the manifests are present and frozen and the package
 * root really is `@codyswann/lisa`.
 * @throws {Error} When a manifest is empty or mutable, or the package identity is wrong
 */
export function assertRuntimeContract(): void {
  if (
    Object.keys(UPSTREAM_EVIDENCE_MANIFEST).length === 0 ||
    Object.keys(UPSTREAM_SURFACE_MANIFEST).length === 0 ||
    Object.keys(UPSTREAM_PUBLIC_COMMITS).length === 0 ||
    !Object.isFrozen(UPSTREAM_EVIDENCE_MANIFEST) ||
    !Object.isFrozen(UPSTREAM_SURFACE_MANIFEST) ||
    !Object.isFrozen(UPSTREAM_PUBLIC_COMMITS)
  ) {
    throw new Error("Upstream evidence manifests are missing or mutable");
  }
  const packageJson = parsePackageIdentity(
    readBoundedRegularFile(
      path.join(PACKAGE_ROOT, "package.json"),
      MAX_PACKAGE_JSON_BYTES,
      "package identity"
    )
  );
  if (
    packageJson === null ||
    typeof packageJson !== "object" ||
    isProxy(packageJson) ||
    Object.getPrototypeOf(packageJson) !== Object.prototype ||
    Object.getOwnPropertyDescriptor(packageJson, "name")?.value !==
      "@codyswann/lisa"
  ) {
    throw new Error(INVALID_PACKAGE_IDENTITY);
  }
}

/**
 * Parse the package manifest bytes.
 * @param packageBytes - Raw `package.json` bytes
 * @returns The parsed JSON value
 * @throws {Error} When the bytes are not valid UTF-8 JSON
 */
function parsePackageIdentity(packageBytes: Buffer): unknown {
  try {
    return JSON.parse(decodeUtf8(packageBytes, "package identity")) as unknown;
  } catch {
    throw new Error(INVALID_PACKAGE_IDENTITY);
  }
}

/**
 * Prove an excerpt exists verbatim in its hash-pinned Lisa package file.
 * @param file - Package-relative manifest member
 * @param excerpt - Excerpt text that must appear in the file
 */
export function verifyExcerpt(file: string, excerpt: string): void {
  const absolutePath = path.join(PACKAGE_ROOT, file);
  if (realpathOrReject(absolutePath) !== absolutePath) {
    reject(EXCERPTS_FIELD, "file must not be a symlink");
  }
  const bytes = readBoundedRegularFile(
    absolutePath,
    MAX_SOURCE_BYTES,
    EXCERPTS_FIELD
  );
  const expectedHash = UPSTREAM_EVIDENCE_MANIFEST[file];
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash === undefined || actualHash !== expectedHash) {
    reject(EXCERPTS_FIELD, "file failed its manifest hash check");
  }
  const contents = decodeUtf8(bytes, EXCERPTS_FIELD);
  assertTextControlsSafe(contents, EXCERPTS_FIELD);
  if (!contents.includes(excerpt)) {
    reject(EXCERPTS_FIELD, "text is not present verbatim in its Lisa file");
  }
}

/**
 * Resolve a path's real location, rejecting a missing file.
 * @param filePath - Absolute path inside the package
 * @returns The fully resolved path
 */
function realpathOrReject(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return reject(EXCERPTS_FIELD, "file does not exist in this Lisa package");
  }
}

/**
 * Open a file read-only without following a final symlink or blocking.
 * @param filePath - Absolute path to open
 * @param field - Field name reported on rejection
 * @returns The open file descriptor
 */
function openNoFollow(filePath: string, field: string): number {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  try {
    return openSync(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK | noFollow
    );
  } catch {
    return reject(field, "must be a readable non-symlink file");
  }
}

/**
 * Read a regular file of bounded size, rejecting one that changes mid-read.
 * @param filePath - Absolute path to read
 * @param maxBytes - Largest accepted file size
 * @param field - Field name reported on rejection
 * @returns The file's bytes
 */
function readBoundedRegularFile(
  filePath: string,
  maxBytes: number,
  field: string
): Buffer {
  const descriptor = openNoFollow(filePath, field);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) {
      return reject(field, "must be a regular file");
    }
    if (before.size > maxBytes) {
      return reject(field, "exceeds its source byte limit");
    }
    const bytes = Buffer.alloc(before.size);
    const count = readFixedBytes(descriptor, bytes, 0);
    const after = fstatSync(descriptor);
    if (after.size !== before.size || count !== before.size) {
      return reject(field, "changed while being read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Fill a buffer from a descriptor, stopping early at end of file.
 * @param descriptor - Open file descriptor
 * @param buffer - Buffer sized to the expected file length
 * @param offset - Bytes already read
 * @returns Total bytes read
 */
function readFixedBytes(
  descriptor: number,
  buffer: Buffer,
  offset: number
): number {
  if (offset >= buffer.length) {
    return offset;
  }
  const count = readSync(
    descriptor,
    buffer,
    offset,
    buffer.length - offset,
    offset
  );
  return count === 0
    ? offset
    : readFixedBytes(descriptor, buffer, offset + count);
}
