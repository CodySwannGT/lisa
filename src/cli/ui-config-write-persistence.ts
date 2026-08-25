/**
 * @file ui-config-write-persistence.ts
 * @description Safe, surgical persistence for localhost UI config writes.
 *
 * Requests are serialized per project because both config files are shared
 * read-modify-write state. A mixed request snapshots and validates both files
 * before publishing either one. The two final renames cannot form one
 * filesystem transaction, so a failure or external race between those renames
 * can still leave the first target published; each target independently
 * refuses stale source bytes so that residual failure is loud rather than a
 * silent lost update.
 * @module cli/ui-config-write-persistence
 */
import { lstat, open, type FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { applyEdits, modify, type FormattingOptions } from "jsonc-parser";
import {
  getAtPath,
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import { writeFileAtomically } from "../utils/atomic-file-write.js";

const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";
const MAX_CONFIG_BYTES = 128 * 1024;
const READ_CHUNK_BYTES = 16 * 1024;
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

/** Running state for ordered, overlapping dot-path edits. */
interface RenderState {
  readonly text: string;
  readonly document: JsonObject;
  readonly changed: boolean;
}

/** Callback that enforces registry validators against the prospective config. */
export type ValidateCommittedConfig = (config: JsonObject) => void;

/**
 * Persist one pre-classified request under the project write queue.
 * @param destDir - Project root containing the two fixed config filenames
 * @param changes - Changes split by committed versus local ownership
 * @param validateCommitted - Registry validation applied before either write
 * @returns Prospective committed config only; local values are never echoed
 */
export async function persistRoutedConfigChanges(
  destDir: string,
  changes: RoutedConfigChanges,
  validateCommitted: ValidateCommittedConfig
): Promise<JsonObject> {
  return await withConfigWriteLock(path.resolve(destDir), async () => {
    const committedTarget = path.join(destDir, CONFIG_FILE);
    const localTarget = path.join(destDir, LOCAL_CONFIG_FILE);
    const needsLocal = Object.keys(changes.local).length > 0;
    const [committedSnapshot, localSnapshot] = await Promise.all([
      readConfigSnapshot(committedTarget, CONFIG_FILE),
      needsLocal
        ? readConfigSnapshot(localTarget, LOCAL_CONFIG_FILE)
        : Promise.resolve(undefined),
    ]);
    const committed = renderChanges(committedSnapshot, changes.committed);
    const local =
      localSnapshot === undefined
        ? undefined
        : renderChanges(localSnapshot, changes.local);

    validateCommitted(committed.document);
    await publishPrepared(committed, false);
    if (local !== undefined) {
      await publishPrepared(local, true);
    }
    return committed.document;
  });
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
 * @returns Existing strict-JSON image, or an empty absent-file image
 */
async function readConfigSnapshot(
  target: string,
  filename: string
): Promise<ConfigSnapshot> {
  try {
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
      const text = bytes.toString("utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isJsonObject(parsed)) {
        throw new Error(`${filename} must contain a JSON object`);
      }
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
 * @param changes - Routed values for this one target
 * @returns Rendered text plus the matching prospective object
 */
function renderChanges(
  snapshot: ConfigSnapshot,
  changes: Readonly<Record<string, JsonValue>>
): PreparedConfig {
  const formattingOptions = inferFormatting(snapshot.text);
  const rendered = Object.entries(changes).reduce<RenderState>(
    (state, [key, value]) => {
      if (jsonEquals(getAtPath(state.document, key), value)) {
        return state;
      }
      return {
        text: applyEdits(
          state.text,
          modify(state.text, key.split("."), value, { formattingOptions })
        ),
        document: setAtPath(state.document, key, value),
        changed: true,
      };
    },
    {
      text: snapshot.text,
      document: snapshot.document,
      changed: false,
    }
  );
  return { snapshot, ...rendered };
}

/**
 * Match inserted JSON to the document's existing indentation and newlines.
 * @param text - Existing strict JSON text
 * @returns Formatting policy used only around newly inserted syntax
 */
function inferFormatting(text: string): FormattingOptions {
  const indentation = /\n([ \t]+)"/u.exec(text)?.[1];
  const usesTabs = indentation?.includes("\t") ?? false;
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    insertSpaces: !usesTabs,
    tabSize: usesTabs ? 1 : Math.max(1, indentation?.length ?? 2),
  };
}

/**
 * Atomically publish a changed target after proving its source bytes are fresh.
 * @param prepared - Rendered target and its original snapshot
 * @param local - Whether a new file must be restricted to owner-only access
 */
async function publishPrepared(
  prepared: PreparedConfig,
  local: boolean
): Promise<void> {
  if (!prepared.changed) return;
  const mode = prepared.snapshot.mode ?? (local ? 0o600 : undefined);
  await writeFileAtomically(prepared.snapshot.target, prepared.text, {
    ...(mode === undefined ? {} : { mode }),
    beforeRename: async () => {
      const current = await readConfigSnapshot(
        prepared.snapshot.target,
        prepared.snapshot.filename
      );
      if (!sameBytes(current.bytes, prepared.snapshot.bytes)) {
        throw new Error(
          `${prepared.snapshot.filename} changed before atomic replacement`
        );
      }
    },
  });
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
