/**
 * @file doctor-nightly-e2e-guard-io.ts
 * @description Bounded no-follow reads for hostile workflow and target paths
 * @module cli/doctor-nightly-e2e-guard-io
 */
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import * as path from "node:path";

import {
  NightlyGuardDeadlineError,
  nightlyGuardRemaining,
  type NightlyGuardDeadline,
  withinNightlyGuardDeadline,
} from "./doctor-nightly-e2e-guard-deadline.js";

/** Successful bytes or the precise availability class of a safe read. */
export type NightlyGuardReadResult =
  | { readonly state: "ok"; readonly bytes: Buffer }
  | { readonly state: "missing"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

/** Deterministic directory entries or an explicit availability refusal. */
export type NightlyGuardDirectoryResult =
  | { readonly state: "ok"; readonly names: readonly string[] }
  | { readonly state: "missing"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

/** Identity retained across an IO operation to detect path replacement. */
interface PathIdentity {
  readonly device: number;
  readonly inode: number;
}

/** Component-walk result that never follows a symlink. */
type ComponentResult =
  | { readonly state: "ok"; readonly final: Stats }
  | { readonly state: "missing"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException).code;
const displayError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const rethrowDeadline = (error: unknown): void => {
  if (error instanceof NightlyGuardDeadlineError) throw error;
};
const identity = (stats: Stats): PathIdentity => ({
  device: stats.dev,
  inode: stats.ino,
});
const sameIdentity = (left: PathIdentity, right: PathIdentity): boolean =>
  left.device === right.device && left.inode === right.inode;
const byteLimit = (bytes: number): string =>
  bytes === 1024 * 1024 ? "1 MiB" : `${bytes} byte`;

const safeParts = (relativePath: string): readonly string[] | undefined => {
  if (path.isAbsolute(relativePath)) return undefined;
  const parts = relativePath.split(/[\\/]/u);
  return parts.length > 0 &&
    parts.every(part => part !== "" && part !== "." && part !== "..")
    ? parts
    : undefined;
};

const unavailable = (reason: string): ComponentResult => ({
  state: "unavailable",
  reason,
});

/**
 * Walk every project-relative component with lstat, rejecting symlinks before
 * any directory or file operation can follow them.
 * @param projectRoot - Logical project containment root
 * @param relativePath - Validated relative path
 * @param deadline - Shared whole-operation deadline
 * @returns Final component identity or an exact refusal
 */
async function inspectComponents(
  projectRoot: string,
  relativePath: string,
  deadline: NightlyGuardDeadline
): Promise<ComponentResult> {
  const parts = safeParts(relativePath);
  if (!parts) return unavailable("path escapes the project root");

  const inspect = async (index: number): Promise<ComponentResult> => {
    const current = path.join(projectRoot, ...parts.slice(0, index + 1));
    if (nightlyGuardRemaining(deadline) <= 0) {
      throw new NightlyGuardDeadlineError(deadline.reason);
    }
    const inspected: Stats | ComponentResult = await withinNightlyGuardDeadline(
      deadline,
      () => lstat(current)
    ).catch(error => {
      rethrowDeadline(error);
      const code = errorCode(error);
      return code === "ENOENT"
        ? { state: "missing", reason: `${relativePath} is missing` }
        : unavailable(
            `${relativePath} is unreadable (${code ?? displayError(error)})`
          );
    });
    if ("state" in inspected) return inspected;
    const stats = inspected;
    if (stats.isSymbolicLink()) {
      return unavailable(`${parts.slice(0, index + 1).join("/")} is a symlink`);
    }
    if (index < parts.length - 1 && !stats.isDirectory()) {
      return unavailable(
        `${parts.slice(0, index + 1).join("/")} is not a directory`
      );
    }
    return index === parts.length - 1
      ? { state: "ok", final: stats }
      : await inspect(index + 1);
  };

  return await inspect(0);
}

const isContained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/**
 * Verify the opened inode is still the contained, non-symlink path immediately
 * before its bytes become proof evidence.
 * @param projectRoot - Logical containment root
 * @param relativePath - Path whose components are rechecked
 * @param opened - Inode identity captured from the file descriptor
 * @param deadline - Shared deadline
 * @returns Reverified component result
 */
async function verifyIdentity(
  projectRoot: string,
  relativePath: string,
  opened: PathIdentity,
  deadline: NightlyGuardDeadline
): Promise<ComponentResult> {
  const inspected = await inspectComponents(
    projectRoot,
    relativePath,
    deadline
  );
  if (inspected.state !== "ok") return inspected;
  if (!sameIdentity(opened, identity(inspected.final))) {
    return unavailable(`${relativePath} changed identity while it was read`);
  }
  try {
    const [physicalRoot, physicalTarget] = await withinNightlyGuardDeadline(
      deadline,
      () =>
        Promise.all([
          realpath(projectRoot),
          realpath(path.join(projectRoot, relativePath)),
        ])
    );
    return isContained(physicalRoot, physicalTarget)
      ? inspected
      : unavailable(`${relativePath} is not contained by the project root`);
  } catch (error) {
    rethrowDeadline(error);
    return unavailable(
      `${relativePath} containment is unreadable (${errorCode(error) ?? displayError(error)})`
    );
  }
}

/**
 * Read at most `maxBytes + 1` through an already no-follow file descriptor.
 * @param handle - Open no-follow file descriptor
 * @param maxBytes - Hard content ceiling
 * @param deadline - Shared deadline
 * @returns Bounded bytes, including one overflow sentinel byte when present
 */
async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  deadline: NightlyGuardDeadline
): Promise<Buffer> {
  const buffer = Buffer.alloc(maxBytes + 1);
  const readAt = async (offset: number): Promise<number> => {
    if (offset >= buffer.length) return offset;
    if (nightlyGuardRemaining(deadline) <= 0) {
      throw new NightlyGuardDeadlineError(deadline.reason);
    }
    const { bytesRead } = await withinNightlyGuardDeadline(deadline, () =>
      handle.read(buffer, offset, buffer.length - offset, offset)
    );
    return bytesRead === 0 ? offset : await readAt(offset + bytesRead);
  };
  const used = await readAt(0);
  return buffer.subarray(0, used);
}

const openNightlyGuardFile = async (
  projectRoot: string,
  relativePath: string,
  deadline: NightlyGuardDeadline
) =>
  await withinNightlyGuardDeadline(deadline, () =>
    open(
      path.join(projectRoot, relativePath),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
  ).then(
    handle => ({ state: "ok" as const, handle }),
    error => {
      rethrowDeadline(error);
      const code = errorCode(error);
      return code === "ENOENT"
        ? { state: "missing" as const, reason: `${relativePath} is missing` }
        : {
            state: "unavailable" as const,
            reason: `${relativePath} is unreadable (${code ?? displayError(error)})`,
          };
    }
  );

/**
 * Read one regular file without following any path component.
 * @param projectRoot - Containment root
 * @param relativePath - Project-relative path
 * @param maxBytes - Hard byte ceiling
 * @param deadline - Shared deadline
 * @returns Bounded bytes or a precise availability class
 */
export async function readNightlyGuardFile(
  projectRoot: string,
  relativePath: string,
  maxBytes: number,
  deadline: NightlyGuardDeadline
): Promise<NightlyGuardReadResult> {
  const inspected = await inspectComponents(
    projectRoot,
    relativePath,
    deadline
  );
  if (inspected.state !== "ok") return inspected;
  if (!inspected.final.isFile()) {
    return {
      state: "unavailable",
      reason: `${relativePath} is not a regular file`,
    };
  }
  if (inspected.final.size > maxBytes) {
    return {
      state: "unavailable",
      reason: `${relativePath} exceeds the ${byteLimit(maxBytes)} file limit`,
    };
  }

  const opened = await openNightlyGuardFile(
    projectRoot,
    relativePath,
    deadline
  );
  if (opened.state !== "ok") return opened;
  const handle = opened.handle;

  try {
    const stats = await withinNightlyGuardDeadline(deadline, () =>
      handle.stat()
    );
    if (!stats.isFile()) {
      return {
        state: "unavailable",
        reason: `${relativePath} is not a regular file`,
      };
    }
    const bytes = await readBounded(handle, maxBytes, deadline);
    if (bytes.length > maxBytes) {
      return {
        state: "unavailable",
        reason: `${relativePath} exceeds the ${byteLimit(maxBytes)} file limit`,
      };
    }
    const verified = await verifyIdentity(
      projectRoot,
      relativePath,
      identity(stats),
      deadline
    );
    return verified.state === "ok" ? { state: "ok", bytes } : verified;
  } catch (error) {
    rethrowDeadline(error);
    return {
      state: "unavailable",
      reason: `${relativePath} is unreadable (${errorCode(error) ?? displayError(error)})`,
    };
  } finally {
    await handle.close();
  }
}

/**
 * List a directory only when every component and its identity remain safe.
 * @param projectRoot - Containment root
 * @param relativePath - Project-relative directory
 * @param deadline - Shared deadline
 * @returns Directory entries or an availability refusal
 */
export async function readNightlyGuardDirectory(
  projectRoot: string,
  relativePath: string,
  deadline: NightlyGuardDeadline
): Promise<NightlyGuardDirectoryResult> {
  const before = await inspectComponents(projectRoot, relativePath, deadline);
  if (before.state !== "ok") return before;
  if (!before.final.isDirectory()) {
    return {
      state: "unavailable",
      reason: `${relativePath} is not a directory`,
    };
  }
  try {
    const names = await withinNightlyGuardDeadline(deadline, () =>
      readdir(path.join(projectRoot, relativePath))
    );
    const after = await inspectComponents(projectRoot, relativePath, deadline);
    if (after.state !== "ok") return after;
    return sameIdentity(identity(before.final), identity(after.final))
      ? { state: "ok", names }
      : {
          state: "unavailable",
          reason: `${relativePath} changed identity while it was listed`,
        };
  } catch (error) {
    rethrowDeadline(error);
    const code = errorCode(error);
    return code === "ENOENT"
      ? { state: "missing", reason: `${relativePath} is missing` }
      : {
          state: "unavailable",
          reason: `${relativePath} is unreadable (${code ?? displayError(error)})`,
        };
  }
}
