/**
 * @file ui-config-write-persistence.ts
 * @description Safe, surgical persistence for localhost UI config writes.
 *
 * Requests are serialized across processes because both config files are
 * shared read-modify-write state. Every request snapshots, reconciles, and
 * validates both files before publishing either one. Canonical-path and
 * filesystem-identity checks fail closed when a project root or ancestor is
 * replaced at a checked boundary. Node has no portable descriptor-relative
 * temp-create/rename API, so a same-user swap inside the final check-to-use gap
 * remains possible. The two final renames also cannot form one filesystem
 * transaction, so a failure between them can leave the first target published.
 * @module cli/ui-config-write-persistence
 */
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { withFileTargetLock } from "../core/learnings-lock.js";
import type { JsonObject, JsonValue } from "../sync/json-path.js";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  parseConfigDocument,
  renderConfigChanges,
} from "./ui-config-write-document.js";
import {
  assertProjectRootIdentity,
  requireCanonicalProjectRoot,
  type ProjectRootIdentity,
} from "./ui-config-write-root-identity.js";
import { provenanceRemovals } from "./ui-config-write-provenance.js";

const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";
const MAX_CONFIG_BYTES = 128 * 1024;
const READ_CHUNK_BYTES = 16 * 1024;
const WRITE_PERMISSION_BITS = 0o222;
const LOCK_DIRECTORY_PRIVATE_BITS = 0o077;
const LOCK_DIRECTORY_MODE = 0o700;
const CONFIG_LOCK_DIRECTORY = path.join(
  tmpdir(),
  `lisa-ui-config-write-${process.getuid?.() ?? "user"}`
);
const configWriteQueues = new Map<string, Promise<void>>();

/** Changes already classified at the request boundary, before any file I/O. */
export interface RoutedConfigChanges {
  /** Registry-root or registry-descendant changes for committed governance. */
  readonly committed: Readonly<Record<string, JsonValue>>;
  /** Exact console-authorized changes for the gitignored developer overlay. */
  readonly local: Readonly<Record<string, JsonValue>>;
}

/** One bounded, type-checked file image captured before rendering edits. */
interface ConfigSnapshot {
  readonly target: string;
  readonly filename: string;
  readonly bytes: Buffer | undefined;
  readonly text: string;
  readonly document: JsonObject;
  readonly mode: number | undefined;
}

/** Surgical render paired with the semantic document returned to callers. */
interface PreparedConfig {
  readonly snapshot: ConfigSnapshot;
  readonly text: string;
  readonly document: JsonObject;
  readonly changed: boolean;
}

/** Callback that enforces registry validators against the prospective config. */
export type ValidateCommittedConfig = (config: JsonObject) => void;

/**
 * Follow-up work run under the same serialization as the write it follows.
 *
 * Config propagation reads and rewrites both config files, so running it after
 * the lock is released would let a second request's snapshot interleave with
 * this request's propagation. It runs inside the transaction instead, and its
 * result becomes the caller's config view.
 */
export type AfterPersist = (projectRoot: string) => Promise<JsonObject>;

/**
 * Persist one pre-classified request under the project write queue.
 * @param destDir - Project root containing the two fixed config filenames
 * @param changes - Changes split by committed versus local ownership
 * @param validateCommitted - Registry validation applied before either write
 * @param afterPersist - Optional in-transaction follow-up supplying the result
 * @returns The follow-up's config view, or the prospective committed config
 */
export async function persistRoutedConfigChanges(
  destDir: string,
  changes: RoutedConfigChanges,
  validateCommitted: ValidateCommittedConfig,
  afterPersist?: AfterPersist
): Promise<JsonObject> {
  const projectRoot = await requireCanonicalProjectRoot(destDir);
  const lockTarget = await resolveConfigLockTarget(projectRoot.path);
  return await withConfigWriteLock(
    projectRoot.path,
    async () =>
      await withFileTargetLock(lockTarget, async () => {
        await assertProjectRootIdentity(projectRoot);
        const committedTarget = path.join(projectRoot.path, CONFIG_FILE);
        const localTarget = path.join(projectRoot.path, LOCAL_CONFIG_FILE);
        const [committedSnapshot, localSnapshot] = await Promise.all([
          readConfigSnapshot(committedTarget, CONFIG_FILE, projectRoot),
          readConfigSnapshot(localTarget, LOCAL_CONFIG_FILE, projectRoot),
        ]);
        await assertProjectRootIdentity(projectRoot);
        const committed = prepareConfig(
          committedSnapshot,
          Object.keys(changes.local),
          changes.committed,
          provenanceRemovals(changes.committed)
        );
        const local = prepareConfig(
          localSnapshot,
          Object.keys(changes.committed),
          changes.local
        );

        assertPreparedSize(committed);
        assertPreparedSize(local);
        validateCommitted(committed.document);
        await assertProjectRootIdentity(projectRoot);
        assertWritableWhenChanged(committed);
        assertWritableWhenChanged(local);
        await publishPrepared(committed, false, projectRoot);
        await assertProjectRootIdentity(projectRoot);
        await publishPrepared(local, true, projectRoot);
        await assertProjectRootIdentity(projectRoot);
        if (afterPersist === undefined) {
          return committed.document;
        }
        return await afterPersist(projectRoot.path);
      })
  );
}

/**
 * Derive a private, repository-external lock identity from the canonical root.
 *
 * The lock cannot live beside either config: the committed file would leave
 * transient untracked state, while the local file's exact ignore rule does not
 * cover an adjacent `.lock`. A user-private temp directory keeps lock metadata
 * outside version control; hashing avoids publishing project paths there.
 * @param projectRoot - Canonical project directory
 * @returns Hardened lock primitive target shared by every alias and process
 */
async function resolveConfigLockTarget(projectRoot: string): Promise<string> {
  await mkdir(CONFIG_LOCK_DIRECTORY, {
    recursive: true,
    mode: LOCK_DIRECTORY_MODE,
  });
  const metadata = await lstat(CONFIG_LOCK_DIRECTORY);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (process.platform !== "win32" &&
      (metadata.mode & LOCK_DIRECTORY_PRIVATE_BITS) !== 0)
  ) {
    throw new Error("Unsafe UI config lock directory");
  }
  const canonicalLockDirectory = await realpath(CONFIG_LOCK_DIRECTORY);
  const identity = createHash("sha256").update(projectRoot).digest("hex");
  return path.join(canonicalLockDirectory, identity);
}

/**
 * Serialize whole mixed-file transactions per canonical project root.
 * @param projectRoot - Absolute project root used as the queue identity
 * @param operation - Complete snapshot, validate, and publish transaction
 * @returns Operation result after all earlier writes settle
 */
async function withConfigWriteLock<T>(
  projectRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = configWriteQueues.get(projectRoot) ?? Promise.resolve();
  const running = previous.catch(() => undefined).then(operation);
  const marker = running.then(
    () => undefined,
    () => undefined
  );
  // eslint-disable-next-line functional/immutable-data -- per-project async queue
  configWriteQueues.set(projectRoot, marker);
  try {
    return await running;
  } finally {
    if (configWriteQueues.get(projectRoot) === marker) {
      // eslint-disable-next-line functional/immutable-data -- completed queue slot
      configWriteQueues.delete(projectRoot);
    }
  }
}

/**
 * Capture a bounded regular file without following a symlink or special entry.
 * @param target - Fixed config path inside the project root
 * @param filename - Public filename used only in safe diagnostics
 * @param projectRoot - Anchored directory identity checked around file access
 * @returns Existing strict-JSON image, or an empty absent-file image
 */
async function readConfigSnapshot(
  target: string,
  filename: string,
  projectRoot: ProjectRootIdentity
): Promise<ConfigSnapshot> {
  try {
    await assertProjectRootIdentity(projectRoot);
    const before = await lstat(target);
    if (!before.isFile()) {
      throw new Error(`${filename} must be a regular file`);
    }
    if (before.size > MAX_CONFIG_BYTES) {
      throw new Error(`${filename} exceeds the 128 KiB safety limit`);
    }
    const handle = await open(target, "r");
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      ) {
        throw new Error(`${filename} changed while it was opened`);
      }
      const bytes = await readBounded(handle);
      const after = await handle.stat();
      if (
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        after.size !== bytes.byteLength
      ) {
        throw new Error(`${filename} changed while it was read`);
      }
      const text = decodeUtf8(bytes, filename);
      const parsed = parseConfigDocument(text, filename);
      await assertProjectRootIdentity(projectRoot);
      return {
        target,
        filename,
        bytes,
        text,
        document: parsed,
        mode: before.mode & 0o7777,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await assertProjectRootIdentity(projectRoot);
      return {
        target,
        filename,
        bytes: undefined,
        text: "{}\n",
        document: {},
        mode: undefined,
      };
    }
    throw error;
  }
}

/**
 * Decode without replacement characters so a write can never normalize unsafe
 * source bytes into a different valid document.
 * @param bytes - Exact bounded file image
 * @param filename - Safe fixed filename used in diagnostics
 * @returns Valid UTF-8 text
 */
function decodeUtf8(bytes: Buffer, filename: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${filename} must contain valid UTF-8`);
  }
}

/**
 * Read no more than the configured limit plus one sentinel byte.
 * @param handle - Already inode-verified regular-file handle
 * @param position - Next byte offset, used by bounded recursive reads
 * @param chunks - Immutable chunks collected so far
 * @returns Exact file bytes when within the safety limit
 */
async function readBounded(
  handle: FileHandle,
  position = 0,
  chunks: readonly Buffer[] = []
): Promise<Buffer> {
  if (position > MAX_CONFIG_BYTES) {
    throw new Error("Config file exceeds the 128 KiB safety limit");
  }
  const remaining = MAX_CONFIG_BYTES + 1 - position;
  const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, remaining));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
  if (bytesRead === 0) {
    return Buffer.concat(chunks, position);
  }
  return await readBounded(handle, position + bytesRead, [
    ...chunks,
    buffer.subarray(0, bytesRead),
  ]);
}

/**
 * Apply ordered dot-path edits while preserving untouched source bytes.
 * @param snapshot - Strict JSON source image
 * @param removals - Owner paths that must not remain in this non-owner file
 * @param changes - Routed values for this one target
 * @param exactRemovals - Exact property paths whose segments may contain dots
 * @returns Rendered text plus the matching prospective object
 */
function prepareConfig(
  snapshot: ConfigSnapshot,
  removals: readonly string[],
  changes: Readonly<Record<string, JsonValue>>,
  exactRemovals: readonly (readonly string[])[] = []
): PreparedConfig {
  return {
    snapshot,
    ...renderConfigChanges(snapshot, removals, changes, exactRemovals),
  };
}

/**
 * Refuse replacement of an existing target whose owner intentionally removed
 * every write bit; directory-level rename permission must not bypass that
 * policy, and a mixed request must fail before its first publish.
 * @param prepared - Fully rendered target awaiting publication
 */
function assertWritableWhenChanged(prepared: PreparedConfig): void {
  if (
    prepared.changed &&
    prepared.snapshot.mode !== undefined &&
    (prepared.snapshot.mode & WRITE_PERMISSION_BITS) === 0
  ) {
    throw new Error(`${prepared.snapshot.filename} is read-only`);
  }
}

/**
 * Bound the rendered image, not only the source snapshot. Surgical insertion
 * can grow a previously valid file, and both targets must be rejected before
 * the first publish if either prospective image crosses the shared limit.
 * @param prepared - Fully rendered target awaiting publication
 */
function assertPreparedSize(prepared: PreparedConfig): void {
  if (Buffer.byteLength(prepared.text, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error(
      `${prepared.snapshot.filename} exceeds the 128 KiB safety limit`
    );
  }
}

/**
 * Atomically publish a changed target after proving its source image is fresh.
 * A mode change is part of that image because restoring snapshot permissions
 * would otherwise undo a concurrent hardening even when the bytes still match.
 * @param prepared - Rendered target and its original snapshot
 * @param local - Whether a new file must be restricted to owner-only access
 * @param projectRoot - Anchored directory identity checked around publication
 */
async function publishPrepared(
  prepared: PreparedConfig,
  local: boolean,
  projectRoot: ProjectRootIdentity
): Promise<void> {
  if (!prepared.changed) return;
  const mode = prepared.snapshot.mode ?? (local ? 0o600 : undefined);
  await assertProjectRootIdentity(projectRoot);
  await writeFileAtomically(prepared.snapshot.target, prepared.text, {
    ...(mode === undefined ? {} : { mode }),
    beforeRename: async () => {
      await assertProjectRootIdentity(projectRoot);
      const current = await readConfigSnapshot(
        prepared.snapshot.target,
        prepared.snapshot.filename,
        projectRoot
      );
      if (
        !sameBytes(current.bytes, prepared.snapshot.bytes) ||
        current.mode !== prepared.snapshot.mode
      ) {
        throw new Error(
          `${prepared.snapshot.filename} changed before atomic replacement`
        );
      }
      await assertProjectRootIdentity(projectRoot);
    },
  });
  await assertProjectRootIdentity(projectRoot);
}

/**
 * Compare absent/present source images without coercing UTF-8 bytes.
 * @param current - Bytes observed immediately before replacement
 * @param original - Bytes used to render the prospective document
 * @returns Whether the target still contains the exact source image
 */
function sameBytes(
  current: Buffer | undefined,
  original: Buffer | undefined
): boolean {
  if (current === undefined || original === undefined) {
    return current === original;
  }
  return current.equals(original);
}
