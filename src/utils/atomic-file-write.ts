/**
 * One atomic, durable file-replacement primitive shared by every Lisa writer
 * that publishes a small canonical document.
 *
 * This block was previously copy-pasted four times — twice in
 * `src/core/learnings-writer.ts` and once each in `src/health/storage.ts` and
 * `src/standards/storage.ts` — and the copies had already drifted apart: the
 * two storage writers fsync the file handle and the containing directory, while
 * both learnings copies fsynced neither. A rename is atomic with respect to
 * concurrent readers, but without the fsync pair the rename can reach disk
 * before the data does, so a power loss could publish a renamed-but-empty
 * ledger (CodySwannGT/lisa#1995). Consolidating removes the drift and gives the
 * learnings writer the durability the storage writers already had.
 *
 * The write is exclusive (`wx`) into a per-process, per-call temp name, so two
 * writers can never share a temp file, and the temp is always removed — a
 * failure leaves the previous target byte-identical rather than truncated.
 * @module utils/atomic-file-write
 */
import { open, rename, rm } from "node:fs/promises";
import * as path from "node:path";
import {
  syncContainingDirectory,
  type OpenDirectory,
} from "./directory-sync.js";

/** Injectable collaborators and per-call policy for {@link writeFileAtomically}. */
export interface AtomicWriteOptions {
  /**
   * Explicit POSIX permission bits for the published file. Omit to keep the
   * platform default (`0o666` minus umask) — the learnings ledger is a
   * committed, human-read file, and forcing `0o600` would silently tighten its
   * permissions on the next write.
   */
  readonly mode?: number;
  /**
   * Caller safety re-check run after the content is durably written but before
   * the rename publishes it. Used by every call site to re-assert that the
   * target's parents have not been swapped for a symlink mid-write; throwing
   * here aborts the publish and still removes the temp file.
   */
  readonly beforeRename?: () => Promise<void>;
  /** Test-only directory opener forwarded to {@link syncContainingDirectory}. */
  readonly openDirectory?: OpenDirectory;
  /** Test-only observer proving the file handle is fsynced before rename. */
  readonly onFileSync?: () => Promise<void>;
}

/**
 * Atomically and durably replace one file's contents.
 * @param target - Absolute path to publish
 * @param content - Full UTF-8 payload to write
 * @param options - Permission policy and injectable collaborators
 */
export async function writeFileAtomically(
  target: string,
  content: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    await writeDurableTemporary(temporary, content, options);
    await options.beforeRename?.();
    await rename(temporary, target);
    await syncContainingDirectory(directory, options.openDirectory);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Write the payload to an exclusive temp file and flush it to disk.
 * @param temporary - Per-call temp path
 * @param content - Full UTF-8 payload
 * @param options - Permission policy and injectable collaborators
 */
async function writeDurableTemporary(
  temporary: string,
  content: string,
  options: AtomicWriteOptions
): Promise<void> {
  const handle =
    options.mode === undefined
      ? await open(temporary, "wx")
      : await open(temporary, "wx", options.mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await options.onFileSync?.();
  } finally {
    await handle.close();
  }
}
