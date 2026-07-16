/**
 * Compatibility helpers for migrating deprecated monitor threshold keys.
 * @module sync/legacy-monitor-thresholds
 */
import {
  getAtPath,
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
} from "./json-path.js";
import {
  recordedPopulation,
  recordPopulation,
  removePopulation,
} from "./sync-population.js";

const LEGACY_MONITOR_THRESHOLD_MIGRATIONS = [
  {
    legacyKey: "monitor.thresholds.sentryMinEvents24h",
    currentKey: "monitor.thresholds.minEvents24h",
  },
  {
    legacyKey: "monitor.thresholds.xrayFaultRatePct",
    currentKey: "monitor.thresholds.faultRatePct",
  },
] as const;

/** Result of applying legacy monitor-threshold migration to one config. */
export interface LegacyMonitorThresholdMigration {
  /** Updated committed config object */
  readonly committed: JsonObject;
  /** Reportable migration actions */
  readonly actions: readonly { key: string; detail: string }[];
}

/** Minimal sync-state shape needed to append migration actions. */
interface MigrationState {
  /** Updated committed config object */
  readonly committed: JsonObject;
  /** Existing reportable sync actions */
  readonly actions: readonly {
    readonly key: string;
    readonly kind: string;
    readonly detail: string;
  }[];
}

/**
 * Return a copy of an object with one dot-path property removed.
 * @param root - Object to copy
 * @param dotPath - Dot-separated key path to remove
 * @returns Updated object without the path
 */
function removeAtPath(root: JsonObject, dotPath: string): JsonObject {
  const dotIndex = dotPath.indexOf(".");
  const head = dotIndex === -1 ? dotPath : dotPath.slice(0, dotIndex);
  const rest = dotIndex === -1 ? "" : dotPath.slice(dotIndex + 1);
  if (rest === "") {
    const { [head]: _removed, ...remaining } = root;
    return remaining;
  }
  const child = root[head];
  if (!isJsonObject(child)) {
    return root;
  }
  return { ...root, [head]: removeAtPath(child, rest) };
}

/**
 * Move legacy monitor thresholds to provider-neutral keys when provenance
 * proves Lisa populated the legacy value.
 * @param committed - Committed config object
 * @returns Updated config and migration actions
 */
export function migrateLegacyMonitorThresholds(
  committed: JsonObject
): LegacyMonitorThresholdMigration {
  return LEGACY_MONITOR_THRESHOLD_MIGRATIONS.reduce<LegacyMonitorThresholdMigration>(
    (current, migration) => {
      const legacyValue = getAtPath(current.committed, migration.legacyKey);
      const currentValue = getAtPath(current.committed, migration.currentKey);
      const recorded = recordedPopulation(
        current.committed,
        migration.legacyKey
      );
      if (
        legacyValue === undefined ||
        currentValue !== undefined ||
        recorded === undefined ||
        !jsonEquals(legacyValue, recorded)
      ) {
        return current;
      }
      const committed = recordPopulation(
        removePopulation(
          removeAtPath(
            setAtPath(current.committed, migration.currentKey, legacyValue),
            migration.legacyKey
          ),
          migration.legacyKey
        ),
        migration.currentKey,
        legacyValue
      );
      return {
        committed,
        actions: [
          ...current.actions,
          {
            key: migration.currentKey,
            detail: `auto-populated legacy ${migration.legacyKey} migrated to provider-neutral key`,
          },
        ],
      };
    },
    { committed, actions: [] }
  );
}

/**
 * Append legacy monitor-threshold migration actions to a sync state.
 * @param state - Sync state containing committed config and actions
 * @param entryKey - Registry entry key currently being populated
 * @returns Updated state with migration actions appended
 */
export function applyLegacyMonitorThresholdMigration<T extends MigrationState>(
  state: T,
  entryKey: string
): T {
  if (entryKey !== "monitor") {
    return state;
  }
  const migration = migrateLegacyMonitorThresholds(state.committed);
  if (migration.actions.length === 0) {
    return state;
  }
  return {
    ...state,
    committed: migration.committed,
    actions: [
      ...state.actions,
      ...migration.actions.map(action => ({
        ...action,
        kind: "default-evolved" as const,
      })),
    ],
  } as T;
}
