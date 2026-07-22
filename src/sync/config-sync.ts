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
import { aliasCompatibleDefault, hasLegacyAlias } from "./legacy-aliases.js";
import { applyLegacyMonitorThresholdMigration } from "./legacy-monitor-thresholds.js";
import { recordedPopulation, recordPopulation } from "./sync-population.js";

/** What sync did (or would do, in dry-run) for one setting. */
export type SyncActionKind =
  | "absorbed-artifact"
  | "populated-default"
  | "filled-missing"
  | "default-evolved"
  | "artifact-synced";

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
  /** Optional confined readers used by side-effect-free callers. */
  readonly reads?: SyncReadDependencies;
}

/** Read-only project inputs consumed by the sync planner. */
export interface SyncReadDependencies {
  readonly readJson: (relativePath: string) => Promise<unknown | null>;
  readonly pathExists: (relativePath: string) => Promise<boolean>;
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
  if (relevantWhen === undefined) return true;
  return relevantWhen.some(condition => conditionMatches(merged, condition));
}

/**
 * Read the first existing artifact's value for a setting.
 * @param entry - Registry entry
 * @param reads - Project input readers
 * @returns The artifact value, or undefined when no artifact holds one
 */
async function readArtifactValue(
  entry: SyncedSetting,
  reads: SyncReadDependencies
): Promise<JsonValue | undefined> {
  const bindings = entry.artifacts ?? [];
  const values = await Promise.all(
    bindings.map(async binding => {
      const parsed = await reads.readJson(binding.file);
      return parsed === null ? undefined : getAtPath(parsed, binding.pointer);
    })
  );
  return values.find(value => value !== undefined);
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
    const absorbed = validateEntryValue(
      entry,
      fillMissing(artifactValue, entry.defaultValue)
    );
    return withAction(state, setAtPath(state.committed, entry.key, absorbed), {
      key: entry.key,
      kind: "absorbed-artifact",
      detail: `value absorbed from ${entry.artifacts?.[0]?.file ?? "artifact"}`,
    });
  }
  const defaultValue = validateEntryValue(entry, entry.defaultValue);
  const committed = recordPopulation(
    setAtPath(state.committed, entry.key, defaultValue),
    entry.key,
    defaultValue
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
 * @param local - Local config overlay
 * @param artifactValue - Value found in an existing artifact, if any
 * @returns Updated state
 */
function populateEntry(
  state: SyncState,
  entry: SyncedSetting,
  merged: JsonObject,
  local: JsonObject,
  artifactValue: JsonValue | undefined
): SyncState {
  const stateAfterMigration = applyLegacyMonitorThresholdMigration(
    state,
    entry.key
  );
  const mergedAfterMigration =
    stateAfterMigration === state
      ? merged
      : (deepMerge(stateAfterMigration.committed, local) as JsonObject);
  const rawConfigValue = getAtPath(mergedAfterMigration, entry.key);
  if (rawConfigValue === undefined) {
    return populateMissing(stateAfterMigration, entry, artifactValue);
  }
  const configValue = validateEntryValue(entry, rawConfigValue);
  const committedValue = getAtPath(stateAfterMigration.committed, entry.key);
  const localValue = getAtPath(local, entry.key);
  const recorded = recordedPopulation(stateAfterMigration.committed, entry.key);
  const evolutionValue =
    entry.legacyAliases === undefined ? configValue : committedValue;
  if (
    recorded !== undefined &&
    jsonEquals(evolutionValue, recorded) &&
    !jsonEquals(evolutionValue, entry.defaultValue) &&
    !hasLegacyAlias(localValue, entry.legacyAliases)
  ) {
    const committed = recordPopulation(
      setAtPath(stateAfterMigration.committed, entry.key, entry.defaultValue),
      entry.key,
      entry.defaultValue
    );
    return withAction(stateAfterMigration, committed, {
      key: entry.key,
      kind: "default-evolved",
      detail: "value still matched the old default; updated to the new one",
    });
  }
  const hasEffectiveAlias = hasLegacyAlias(configValue, entry.legacyAliases);
  if (hasEffectiveAlias && committedValue === undefined) {
    return stateAfterMigration;
  }
  // Compatibility fills are based only on committed state. Each present alias
  // prunes its own mapped current default while unrelated defaults still fill.
  const fillSource = hasEffectiveAlias ? committedValue : configValue;
  const fallback = hasEffectiveAlias
    ? aliasCompatibleDefault(
        configValue,
        entry.defaultValue,
        entry.legacyAliases
      )
    : entry.defaultValue;
  const filled = fillMissing(fillSource, fallback);
  if (!jsonEquals(filled, fillSource)) {
    return withAction(
      stateAfterMigration,
      setAtPath(stateAfterMigration.committed, entry.key, filled),
      {
        key: entry.key,
        kind: "filled-missing",
        detail: "missing sub-keys filled with defaults",
      }
    );
  }
  return stateAfterMigration;
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
async function syncArtifacts(
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
  return bindings.reduce<Promise<SyncState>>(async (statePromise, binding) => {
    const current = await statePromise;
    const pending = current.artifactWrites.get(binding.file);
    const parsed = pending ?? (await reads.readJson(binding.file)) ?? undefined;
    if (parsed === undefined && !(await reads.pathExists(binding.file))) {
      return current;
    }
    const fileObject = isJsonObject(parsed) ? parsed : {};
    if (
      jsonEquals(getAtPath(fileObject, binding.pointer), validatedEffective)
    ) {
      return current;
    }
    const updated = setAtPath(fileObject, binding.pointer, validatedEffective);
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
 * Apply an entry's optional executable value contract.
 * @param entry - Registry entry owning the value
 * @param value - Untrusted effective value
 * @returns Validated or unchanged JSON value
 */
function validateEntryValue(entry: SyncedSetting, value: JsonValue): JsonValue {
  return entry.validate?.(value) ?? value;
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
  const reads = options.reads ?? defaultSyncReads(destDir);
  const committedRaw = await reads.readJson(".lisa.config.json");
  const localRaw = await reads.readJson(".lisa.config.local.json");
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
      const artifactValue = await readArtifactValue(entry, reads);
      const populated = populateEntry(
        state,
        entry,
        merged,
        local,
        artifactValue
      );
      return syncArtifacts(populated, entry, local, reads);
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
 * Build the normal filesystem-backed readers used by mutating and CLI sync.
 * @param destDir - Project root
 * @returns Default sync input readers
 */
const defaultSyncReads = (destDir: string): SyncReadDependencies => ({
  readJson: relativePath => readJsonOrNull(path.join(destDir, relativePath)),
  pathExists: relativePath => fse.pathExists(path.join(destDir, relativePath)),
});

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
