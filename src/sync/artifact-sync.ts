/**
 * The sync direction of the config-sync pass — config wins, written into every
 * artifact file that already exists — plus the state and action vocabulary the
 * pass threads through it.
 *
 * Split out of `config-sync.ts` so the populate direction and the write
 * direction each stay readable on their own.
 * @module sync/artifact-sync
 */
import { deepMerge } from "../utils/index.js";
import {
  getAtPath,
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "./json-path.js";
import type { ArtifactBinding, SyncedSetting } from "./registry.js";
import {
  MutationFloorDivergenceError,
  describeHonouredMutationFloorDivergence,
  isMutationFloorBinding,
  readMutationFloorDeclaration,
} from "./stryker-thresholds-ownership.js";

/** What sync did (or would do, in dry-run) for one setting. */
export type SyncActionKind =
  | "absorbed-artifact"
  | "populated-default"
  | "filled-missing"
  | "default-evolved"
  | "artifact-synced"
  | "divergence-honoured";

/** One reportable sync action. */
export interface SyncAction {
  /** Config key the action applies to */
  readonly key: string;
  /** What happened */
  readonly kind: SyncActionKind;
  /** Human-readable detail (e.g. which artifact file was involved) */
  readonly detail: string;
}

/** Read-only project inputs consumed by the sync planner. */
export interface SyncReadDependencies {
  readonly readJson: (relativePath: string) => Promise<unknown | null>;
  readonly pathExists: (relativePath: string) => Promise<boolean>;
}

/** Accumulated state threaded through the sync pass. */
export interface SyncState {
  readonly committed: JsonObject;
  readonly actions: readonly SyncAction[];
  readonly artifactWrites: ReadonlyMap<string, JsonObject>;
  /**
   * Refusal recorded when the config-owned mutation floor and the floor on
   * disk disagree. Held rather than thrown at the point of discovery so the
   * pass still completes and nothing at all is persisted.
   */
  readonly divergence: MutationFloorDivergenceError | undefined;
}

/**
 * Apply an entry's optional executable value contract.
 * @param entry - Registry entry owning the value
 * @param value - Untrusted effective value
 * @returns Validated or unchanged JSON value
 */
export function validateEntryValue(
  entry: SyncedSetting,
  value: JsonValue
): JsonValue {
  return entry.validate?.(value) ?? value;
}

/**
 * Queue artifact writes for one entry (sync direction: config wins). Only
 * files that already exist on disk are written — sync never scaffolds
 * artifacts into stacks that do not use them.
 * @param state - Current sync state
 * @param entry - Registry entry
 * @param local - Local config overlay
 * @param reads - Project input readers
 * @returns Updated state
 */
export async function syncArtifacts(
  state: SyncState,
  entry: SyncedSetting,
  local: JsonObject,
  reads: SyncReadDependencies
): Promise<SyncState> {
  const bindings = entry.artifacts ?? [];
  if (bindings.length === 0) {
    return state;
  }
  const effective = getAtPath(deepMerge(state.committed, local), entry.key);
  if (effective === undefined) {
    return state;
  }
  const validatedEffective = validateEntryValue(entry, effective);
  return bindings.reduce<Promise<SyncState>>(
    async (statePromise, binding) =>
      syncOneArtifact(
        await statePromise,
        entry,
        binding,
        validatedEffective,
        reads
      ),
    Promise.resolve(state)
  );
}

/**
 * Queue — or refuse — the write for one artifact binding.
 *
 * The refusal arm is narrow on purpose. Five of the six sync artifacts are
 * written wholesale (`pointer: ""`), so a hand-edit to one is obviously wrong
 * and overwriting it is the point. `stryker.conf.json` is the lone partial
 * binding — the one file where editing its other keys is correct — and it is
 * the one that drifted: config declared a mutation floor of 60 while 32 was
 * enforced and ~58 was measured, so a silent write would have reddened the
 * mutation gate on code that had not changed (CodySwannGT/lisa#2968).
 * @param current - Current sync state
 * @param entry - Registry entry being synced
 * @param binding - Artifact binding to write
 * @param validatedEffective - Effective config value for the entry
 * @param reads - Project input readers
 * @returns Updated state
 */
async function syncOneArtifact(
  current: SyncState,
  entry: SyncedSetting,
  binding: ArtifactBinding,
  validatedEffective: JsonValue,
  reads: SyncReadDependencies
): Promise<SyncState> {
  const pending = current.artifactWrites.get(binding.file);
  const parsed = pending ?? (await reads.readJson(binding.file)) ?? undefined;
  if (parsed === undefined && !(await reads.pathExists(binding.file))) {
    return current;
  }
  const fileObject = isJsonObject(parsed) ? parsed : {};
  const onDisk = getAtPath(fileObject, binding.pointer);
  if (jsonEquals(onDisk, validatedEffective)) {
    return current;
  }
  if (
    onDisk !== undefined &&
    isMutationFloorBinding(entry.key, binding.file, binding.pointer)
  ) {
    return mutationFloorDisagreement(
      current,
      entry,
      fileObject,
      onDisk,
      validatedEffective
    );
  }
  return queueWrite(current, entry, binding, fileObject, validatedEffective);
}

/**
 * Resolve the two mutation floors disagreeing: honour a recorded divergence,
 * refuse an unrecorded one.
 *
 * Blocking the deliberate case too would make this guard the thing that gets
 * deleted the first time it stands between someone and routine work, so a
 * `_thresholdsDivergence` block that still records BOTH live numbers and a
 * reason lets the pass continue — loudly. Anything else is a managed value
 * someone edited with nothing saying why, which is the landmine.
 * @param current - Current sync state
 * @param entry - Registry entry being synced
 * @param fileObject - Parsed artifact content
 * @param onDisk - Floor the artifact currently enforces
 * @param validatedEffective - Floor the config declares
 * @returns Updated state
 */
function mutationFloorDisagreement(
  current: SyncState,
  entry: SyncedSetting,
  fileObject: JsonObject,
  onDisk: JsonValue,
  validatedEffective: JsonValue
): SyncState {
  const declaration = readMutationFloorDeclaration(
    fileObject,
    onDisk,
    validatedEffective
  );
  if (declaration === undefined) {
    return {
      ...current,
      divergence:
        current.divergence ??
        new MutationFloorDivergenceError(validatedEffective, onDisk),
    };
  }
  return {
    ...current,
    actions: [
      ...current.actions,
      {
        key: entry.key,
        kind: "divergence-honoured",
        detail: describeHonouredMutationFloorDivergence(declaration),
      },
    ],
  };
}

/**
 * Record one artifact write and its reportable action.
 * @param current - Current sync state
 * @param entry - Registry entry being synced
 * @param binding - Artifact binding to write
 * @param fileObject - Parsed artifact content
 * @param validatedEffective - Effective config value for the entry
 * @returns Updated state
 */
function queueWrite(
  current: SyncState,
  entry: SyncedSetting,
  binding: ArtifactBinding,
  fileObject: JsonObject,
  validatedEffective: JsonValue
): SyncState {
  const updated = setAtPath(fileObject, binding.pointer, validatedEffective);
  return {
    ...current,
    artifactWrites: new Map([
      ...current.artifactWrites,
      [binding.file, updated] as const,
    ]),
    actions: [
      ...current.actions,
      {
        key: entry.key,
        kind: "artifact-synced",
        detail: `${binding.file} updated from config`,
      },
    ],
  };
}
