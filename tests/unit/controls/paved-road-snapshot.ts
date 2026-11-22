/**
 * Resolves the pinned configurations and reads and writes their snapshots.
 * @remarks
 * The snapshots live in one committed JSON file rather than in the test
 * runner's own snapshot format, for two reasons. The runner writes a missing
 * snapshot for itself outside CI, so a deleted pin would come back green
 * holding whatever resolves that day. And its failure names the test, not the
 * gate. Here a missing snapshot is a failure, and nothing is written unless
 * the regression test is told to record.
 *
 * Each resolved gate is stored on one line, so a change shows in review as one
 * changed line that starts with the gate's id.
 * @module tests/unit/controls/paved-road-snapshot
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  isMoment,
  MOMENTS,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  SUITE_CONFIGURATIONS,
  type PavedRoadConfiguration,
} from "./paved-road-configurations.js";
import type { ResolvedGate } from "./paved-road-drift.js";
import { REGISTRY_PIN_CONFIGURATIONS } from "./paved-road-registry-pin.js";

/** Stored resolutions: configuration name, then moment, then the gates. */
export type Snapshots = Readonly<
  Record<string, Readonly<Record<string, readonly ResolvedGate[]>>>
>;

/** The committed file every snapshot is stored in. */
export const SNAPSHOT_PATH = path.join(
  import.meta.dirname,
  "paved-road-resolution.snapshot.json"
);

/** Every pinned configuration: the suites' first, then the registry pin. */
export const PAVED_ROAD_CONFIGURATIONS: readonly PavedRoadConfiguration[] = [
  ...SUITE_CONFIGURATIONS,
  ...REGISTRY_PIN_CONFIGURATIONS,
];

/**
 * The moments one configuration is resolved at.
 *
 * Every fixed moment, then each environment-suffixed moment the configuration
 * itself declares. Those have to be included: a gate that is only legal at a
 * deploy or continuous moment resolves nowhere else, so leaving them out would
 * leave its defaults unpinned.
 * @param configuration - A pinned configuration
 * @returns The moments, fixed ones first
 */
export function momentsOf(configuration: PavedRoadConfiguration): string[] {
  const fixed: readonly string[] = MOMENTS;
  const declared = Object.values(configuration.gates).flatMap(gate =>
    gate !== null && typeof gate === "object" ? Object.keys(gate) : []
  );
  const suffixed = [...new Set(declared)]
    .filter(key => !fixed.includes(key) && isMoment(key))
    .sort((left, right) => left.localeCompare(right));
  return [...fixed, ...suffixed];
}

/**
 * What one configuration resolves to at one moment, as it would be stored.
 * @param configuration - A pinned configuration
 * @param moment - The moment to resolve at
 * @returns The resolved gates, in the order the registry runs them
 */
export function resolveAt(
  configuration: PavedRoadConfiguration,
  moment: string
): ResolvedGate[] {
  const resolved: unknown = resolveMoment({
    gates: configuration.gates,
    moment,
    // Left undefined when the configuration names none, so each takes the
    // registry's own default exactly as a caller that omits it does.
    runner: configuration.runner,
    scripts: configuration.scripts,
    ...(configuration.includeOff === undefined
      ? {}
      : { includeOff: configuration.includeOff }),
  });
  // Through JSON, because that is the form it is compared and stored in.
  return JSON.parse(JSON.stringify(resolved)) as ResolvedGate[];
}

/**
 * Resolve every configuration at every one of its moments.
 * @returns The snapshots as they stand now
 */
export function resolveEverything(): Snapshots {
  return Object.fromEntries(
    PAVED_ROAD_CONFIGURATIONS.map(configuration => [
      configuration.name,
      Object.fromEntries(
        momentsOf(configuration).map(moment => [
          moment,
          resolveAt(configuration, moment),
        ])
      ),
    ])
  );
}

/**
 * The snapshot file's text: one line per resolved gate.
 * @param snapshots - The resolutions to store
 * @returns JSON, ending in a newline
 */
export function serialiseSnapshots(snapshots: Snapshots): string {
  const configurations = Object.entries(snapshots).map(([name, moments]) => {
    const stored = Object.entries(moments).map(([moment, gates]) => {
      const lines = gates.map(gate => `      ${JSON.stringify(gate)}`);
      const body = lines.length === 0 ? "" : `\n${lines.join(",\n")}\n    `;
      return `    ${JSON.stringify(moment)}: [${body}]`;
    });
    return `  ${JSON.stringify(name)}: {\n${stored.join(",\n")}\n  }`;
  });
  return `{\n${configurations.join(",\n")}\n}\n`;
}

/**
 * The stored snapshots, or none when the file does not exist.
 * @returns What the committed file holds
 */
export function readSnapshots(): Snapshots {
  if (!existsSync(SNAPSHOT_PATH)) return {};
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshots;
}
