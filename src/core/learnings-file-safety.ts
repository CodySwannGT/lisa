/** Filesystem containment and safe reads for project learnings. */
import * as fse from "fs-extra";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { LEARNINGS_CONTRACT } from "./learnings-contract.js";
import {
  conflictMarkerError,
  findConflictMarkerInBytes,
} from "./learnings-document.js";
import {
  eagerContextRejection,
  findEagerContextSurface,
} from "./learnings-location.js";

/**
 * Resolve the configured target without permitting project-root escape, and
 * without permitting an auto-loaded rules tree.
 *
 * The eager-tree arm is the write boundary's own guard, deliberately duplicated
 * from `learnings.file` config validation rather than delegated to it. Lisa
 * 2.232.0 scaffolded the ledger into `.claude/rules/` and every downstream
 * project happily wrote there: the raw ledger entered eager context in every
 * session, and a merge-hostile file sat where nothing watched it until 19
 * captured learnings vanished in a silent merge. Every writer — ledger,
 * overflow, apply's relocation — funnels through this function, so failing
 * loudly HERE means no future caller can reintroduce that placement by
 * synthesizing a path that never passed through config validation.
 * @param projectRoot - Host project root
 * @param relativeFile - Configured project-relative file
 * @returns Resolved root and target paths
 */
export function resolveSafeLearningTarget(
  projectRoot: string,
  relativeFile: string
): { readonly root: string; readonly target: string } {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relativeFile);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      "Unsafe projectRulesFile: learnings path escapes project root"
    );
  }
  // Re-derive the relative path from the RESOLVED target rather than trusting
  // the caller's string: `.lisa/../.claude/rules/x.md` is an eager-tree write
  // that no prefix test on the raw input would catch.
  const surface = findEagerContextSurface(path.relative(root, target));
  if (surface !== undefined) {
    throw new Error(
      `Refusing to use ${relativeFile} as a learnings ledger: ${eagerContextRejection(surface)}`
    );
  }
  return { root, target };
}

/**
 * Read only a bounded regular file from the inode that was safety-checked.
 * @param target - Resolved learnings file path
 * @returns Existing content, or undefined when the file does not exist
 */
export async function readExistingLearnings(
  target: string
): Promise<string | undefined> {
  try {
    const beforeOpen = await lstat(target);
    if (!beforeOpen.isFile()) {
      throw new Error(
        "Unsafe project learnings path: target is not a regular file"
      );
    }
    const handle = await open(target, "r");
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== beforeOpen.dev ||
        opened.ino !== beforeOpen.ino
      ) {
        throw new Error(
          "Unsafe project learnings path: target changed during open"
        );
      }
      if (opened.size > LEARNINGS_CONTRACT.maxTokens) {
        // Diagnose conflict corruption before reporting size. A conflicted
        // merge roughly doubles the ledger, so this branch is exactly where a
        // real corruption lands — reporting "exceeds maxTokens" here would
        // send the writer's caller off shortening entries instead of
        // recompacting the duplicated block.
        await assertNoConflictMarkerPrefix(handle);
        throw new Error(
          `Project learnings payload exceeds maxTokens ${LEARNINGS_CONTRACT.maxTokens}`
        );
      }
      return handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Throw the shared conflict diagnosis when an over-budget file is corrupted.
 *
 * Reads only a bounded prefix from the already-verified handle, so an oversized
 * ledger is diagnosed without ever being fully loaded.
 * @param handle - Open handle to the verified regular file
 */
async function assertNoConflictMarkerPrefix(handle: FileHandle): Promise<void> {
  const buffer = Buffer.allocUnsafe(LEARNINGS_CONTRACT.maxTokens + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const conflictLine = findConflictMarkerInBytes(buffer.subarray(0, bytesRead));
  if (conflictLine !== undefined) {
    throw conflictMarkerError(conflictLine);
  }
}

/**
 * Reject parent-directory symlinks that resolve outside the project root.
 * @param root - Resolved project root
 * @param parent - Target parent directory
 */
export async function assertSafeLearningParents(
  root: string,
  parent: string
): Promise<void> {
  const realRoot = await realpath(root);
  const cursor = await findExistingAncestor(parent);
  const realParent = await realpath(cursor);
  if (
    realParent !== realRoot &&
    !realParent.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error(
      "Unsafe project learnings path: parent escapes project root"
    );
  }
}

/**
 * Find the nearest existing ancestor without mutable traversal state.
 * @param candidate - Starting filesystem path
 * @returns Nearest existing ancestor
 */
async function findExistingAncestor(candidate: string): Promise<string> {
  if (await fse.pathExists(candidate)) {
    return candidate;
  }
  const parent = path.dirname(candidate);
  if (parent === candidate) {
    throw new Error("Unsafe project learnings path: no project ancestor");
  }
  return findExistingAncestor(parent);
}
