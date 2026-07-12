/**
 * Config-sync engine: makes `.lisa.config.json` (plus the per-developer
 * `.lisa.config.local.json` overlay) the source of truth for every registry
 * setting.
 *
 * Populate direction (only when a config value is completely missing):
 * absorb the value from an existing artifact file if one holds it, otherwise
 * fall back to the built-in default. Pure-default populations are recorded in
 * the config's `_lisaSync.populated` block so a later Lisa version that ships
 * a changed default can distinguish "still the default" (safe to update) from
 * "the project chose this value" (never touched).
 *
 * Sync direction (always): the effective config value is written into every
 * artifact file that exists on disk — config wins.
 * @module sync/config-sync
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { deepMerge, readJsonOrNull, writeJson } from "../utils/index.js";
import {
  fillMissing,
  getAtPath,
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "./json-path.js";
import {
  REQUIRED_KEYS,
  SYNC_REGISTRY,
  type SyncedSetting,
} from "./registry.js";

/** Key holding sync provenance metadata inside `.lisa.config.json`. */
export const SYNC_METADATA_KEY = "_lisaSync";

/** What sync did (or would do, in dry-run) for one setting. */
export type SyncActionKind =
  | "absorbed-artifact"
  | "populated-default"
  | "filled-missing"
  | "default-evolved"
  | "artifact-synced"
  | "unchanged";

/** One reportable sync action. */
export interface SyncAction {
  /** Config key the action applies to */
  readonly key: string;
  /** What happened */
  readonly kind: SyncActionKind;
  /** Human-readable detail (e.g. which artifact file was involved) */
  readonly detail: string;
}

/** Result of one sync run. */
export interface SyncReport {
  /** Actions taken (or planned, when dryRun) — excludes unchanged entries */
  readonly actions: readonly SyncAction[];
  /** Required keys that are missing and cannot be defaulted */
  readonly missingRequired: readonly { key: string; setupHint: string }[];
  /** True when the run was a dry run (nothing written) */
  readonly dryRun: boolean;
}

/** Options for {@link runConfigSync}. */
export interface SyncOptions {
  /** Report without writing anything */
  readonly dryRun?: boolean;
}

/** Accumulated state threaded through the sync pass. */
interface SyncState {
  readonly committed: JsonObject;
  readonly actions: readonly SyncAction[];
  readonly artifactWrites: ReadonlyMap<string, JsonObject>;
}

/**
 * Check whether a registry relevance condition matches the merged config.
 * @param merged - Merged (committed + local) config view
 * @param condition - `"section"` (path exists) or `"path=value"` (equality)
 * @returns True when the condition matches
 */
function conditionMatches(merged: JsonObject, condition: string): boolean {
  const eqIndex = condition.indexOf("=");
  if (eqIndex === -1) {
    return getAtPath(merged, condition) !== undefined;
  }
  const value = getAtPath(merged, condition.slice(0, eqIndex));
  return value === condition.slice(eqIndex + 1);
}

/**
 * Whether a registry entry applies to this project's current config.
 * @param merged - Merged (committed + local) config view
 * @param relevantWhen - Entry conditions (absent = always relevant)
 * @returns True when the entry should be synced
 */
function isRelevant(
  merged: JsonObject,
  relevantWhen: readonly string[] | undefined
): boolean {
  if (relevantWhen === undefined) {
    return true;
  }
  return relevantWhen.some(condition => conditionMatches(merged, condition));
}

/**
 * Read the first existing artifact's value for a setting.
 * @param destDir - Project root
 * @param entry - Registry entry
 * @returns The artifact value, or undefined when no artifact holds one
 */
async function readArtifactValue(
  destDir: string,
  entry: SyncedSetting
): Promise<JsonValue | undefined> {
  const bindings = entry.artifacts ?? [];
  const reads = await Promise.all(
    bindings.map(async binding => {
      const parsed = await readJsonOrNull(path.join(destDir, binding.file));
      return parsed === null ? undefined : getAtPath(parsed, binding.pointer);
    })
  );
  return reads.find(value => value !== undefined);
}

/**
 * Read the recorded populated-default value for a key, if any. Provenance
 * keys are stored literally (dots included) inside `_lisaSync.populated`.
 * @param committed - Committed config object
 * @param key - Config key
 * @returns The value recorded at population time, or undefined
 */
function recordedPopulation(
  committed: JsonObject,
  key: string
): JsonValue | undefined {
  const populated = getAtPath(committed, `${SYNC_METADATA_KEY}.populated`);
  return isJsonObject(populated) ? populated[key] : undefined;
}

/**
 * Record that a key was auto-populated with a default value, storing the key
 * literally (dots included) so later runs can detect default evolution.
 * @param committed - Committed config object
 * @param key - Config key
 * @param value - The default value written
 * @returns Updated committed config
 */
function recordPopulation(
  committed: JsonObject,
  key: string,
  value: JsonValue
): JsonObject {
  const populated = getAtPath(committed, `${SYNC_METADATA_KEY}.populated`);
  const populatedObject = isJsonObject(populated) ? populated : {};
  return setAtPath(committed, `${SYNC_METADATA_KEY}.populated`, {
    ...populatedObject,
    [key]: value,
  });
}

/**
 * Build the next state with an updated committed config and appended action.
 * @param state - Current sync state
 * @param committed - Updated committed config
 * @param action - Action to append to the report
 * @returns Updated state
 */
function withAction(
  state: SyncState,
  committed: JsonObject,
  action: SyncAction
): SyncState {
  return { ...state, committed, actions: [...state.actions, action] };
}

/**
 * Populate a config key that is completely missing: absorb the artifact
 * value when one exists, otherwise write the built-in default and record it.
 * @param state - Current sync state
 * @param entry - Registry entry
 * @param artifactValue - Value found in an existing artifact, if any
 * @returns Updated state
 */
function populateMissing(
  state: SyncState,
  entry: SyncedSetting,
  artifactValue: JsonValue | undefined
): SyncState {
  if (artifactValue !== undefined) {
    const absorbed = fillMissing(artifactValue, entry.defaultValue);
    return withAction(state, setAtPath(state.committed, entry.key, absorbed), {
      key: entry.key,
      kind: "absorbed-artifact",
      detail: `value absorbed from ${entry.artifacts?.[0]?.file ?? "artifact"}`,
    });
  }
  const committed = recordPopulation(
    setAtPath(state.committed, entry.key, entry.defaultValue),
    entry.key,
    entry.defaultValue
  );
  return withAction(state, committed, {
    key: entry.key,
    kind: "populated-default",
    detail: "built-in default written to .lisa.config.json",
  });
}

/**
 * Resolve the next committed config for one entry (populate direction).
 * @param state - Current sync state
 * @param entry - Registry entry
 * @param merged - Merged config view (local overlay applied)
 * @param artifactValue - Value found in an existing artifact, if any
 * @returns Updated state
 */
function populateEntry(
  state: SyncState,
  entry: SyncedSetting,
  merged: JsonObject,
  artifactValue: JsonValue | undefined
): SyncState {
  const configValue = getAtPath(merged, entry.key);
  if (configValue === undefined) {
    return populateMissing(state, entry, artifactValue);
  }
  const recorded = recordedPopulation(state.committed, entry.key);
  if (
    recorded !== undefined &&
    jsonEquals(configValue, recorded) &&
    !jsonEquals(configValue, entry.defaultValue)
  ) {
    const committed = recordPopulation(
      setAtPath(state.committed, entry.key, entry.defaultValue),
      entry.key,
      entry.defaultValue
    );
    return withAction(state, committed, {
      key: entry.key,
      kind: "default-evolved",
      detail: "value still matched the old default; updated to the new one",
    });
  }
  const filled = fillMissing(configValue, entry.defaultValue);
  if (!jsonEquals(filled, configValue)) {
    return withAction(state, setAtPath(state.committed, entry.key, filled), {
      key: entry.key,
      kind: "filled-missing",
      detail: "missing sub-keys filled with defaults",
    });
  }
  return state;
}

/**
 * Queue artifact writes for one entry (sync direction: config wins). Only
 * files that already exist on disk are written — sync never scaffolds
 * artifacts into stacks that do not use them.
 * @param state - Current sync state
 * @param entry - Registry entry
 * @param destDir - Project root
 * @param local - Local config overlay
 * @returns Updated state
 */
async function syncArtifacts(
  state: SyncState,
  entry: SyncedSetting,
  destDir: string,
  local: JsonObject
): Promise<SyncState> {
  const bindings = entry.artifacts ?? [];
  if (bindings.length === 0) {
    return state;
  }
  const effective = getAtPath(deepMerge(state.committed, local), entry.key);
  if (effective === undefined) {
    return state;
  }
  return bindings.reduce<Promise<SyncState>>(async (statePromise, binding) => {
    const current = await statePromise;
    const filePath = path.join(destDir, binding.file);
    const pending = current.artifactWrites.get(binding.file);
    const parsed =
      pending ?? (await readJsonOrNull<unknown>(filePath)) ?? undefined;
    if (parsed === undefined && !(await fse.pathExists(filePath))) {
      return current;
    }
    const fileObject = isJsonObject(parsed) ? parsed : {};
    if (jsonEquals(getAtPath(fileObject, binding.pointer), effective)) {
      return current;
    }
    const updated = setAtPath(fileObject, binding.pointer, effective);
    const writes = new Map([
      ...current.artifactWrites,
      [binding.file, updated] as const,
    ]);
    return {
      ...current,
      artifactWrites: writes,
      actions: [
        ...current.actions,
        {
          key: entry.key,
          kind: "artifact-synced",
          detail: `${binding.file} updated from config`,
        },
      ],
    };
  }, Promise.resolve(state));
}

/**
 * Report required keys that are missing from the merged config.
 * @param merged - Merged config view
 * @returns Missing required keys with their setup hints
 */
function findMissingRequired(
  merged: JsonObject
): readonly { key: string; setupHint: string }[] {
  return REQUIRED_KEYS.filter(
    required =>
      isRelevant(merged, required.relevantWhen) &&
      getAtPath(merged, required.key) === undefined
  ).map(required => ({ key: required.key, setupHint: required.setupHint }));
}

/**
 * Run one populate-and-sync pass over a project.
 *
 * Precedence per setting: existing config value → existing artifact value →
 * built-in default. After population, every existing artifact file is
 * rewritten from the (local-overlaid) config value.
 * @param destDir - Absolute path to the project root
 * @param options - Sync options
 * @returns Report of every action taken (or planned, when dryRun)
 */
export async function runConfigSync(
  destDir: string,
  options: SyncOptions = {}
): Promise<SyncReport> {
  const committedPath = path.join(destDir, ".lisa.config.json");
  const localPath = path.join(destDir, ".lisa.config.local.json");
  const committedRaw = await readJsonOrNull<unknown>(committedPath);
  const localRaw = await readJsonOrNull<unknown>(localPath);
  const committed = isJsonObject(committedRaw) ? committedRaw : {};
  const local = isJsonObject(localRaw) ? localRaw : {};

  const initial: SyncState = {
    committed,
    actions: [],
    artifactWrites: new Map(),
  };
  const finalState = await SYNC_REGISTRY.reduce<Promise<SyncState>>(
    async (statePromise, entry) => {
      const state = await statePromise;
      const merged = deepMerge(state.committed, local) as JsonObject;
      if (!isRelevant(merged, entry.relevantWhen)) {
        return state;
      }
      const artifactValue = await readArtifactValue(destDir, entry);
      const populated = populateEntry(state, entry, merged, artifactValue);
      return syncArtifacts(populated, entry, destDir, local);
    },
    Promise.resolve(initial)
  );

  const mergedFinal = deepMerge(finalState.committed, local) as JsonObject;
  if (options.dryRun !== true) {
    await persistState(destDir, committed, finalState);
  }
  return {
    actions: finalState.actions,
    missingRequired: findMissingRequired(mergedFinal),
    dryRun: options.dryRun === true,
  };
}

/**
 * Write the updated committed config and every queued artifact file.
 * @param destDir - Project root
 * @param originalCommitted - Committed config as read at the start of the run
 * @param state - Final sync state
 */
async function persistState(
  destDir: string,
  originalCommitted: JsonObject,
  state: SyncState
): Promise<void> {
  if (!jsonEquals(originalCommitted, state.committed)) {
    await writeJson(path.join(destDir, ".lisa.config.json"), state.committed);
  }
  await Promise.all(
    Array.from(state.artifactWrites.entries()).map(([file, content]) =>
      writeJson(path.join(destDir, file), content)
    )
  );
}
