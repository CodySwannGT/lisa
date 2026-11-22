/**
 * Which of two roads the configure step takes for a repository.
 *
 * - **paved**: the whole repository or each folder part is on a project type
 *   Lisa ships checks for. Lisa declares those checks by code, so two runs
 *   give the same declaration.
 * - **discovery**: anything else. The checks are declared from what the audit
 *   found, one decision at a time, and every part names what supports it.
 *
 * The decision uses the audit's folder list and the project types detected at
 * the root and in each listed folder.
 * @module controls/configure-road
 */
import { describeScope } from "./audit-report-wording.js";
import { WHOLE_REPOSITORY_SCOPE } from "./register-types.js";

/** The two roads, the repeatable one first. */
export const CONFIGURE_ROADS = ["paved", "discovery"] as const;

/** One of the two roads. */
export type ConfigureRoad = (typeof CONFIGURE_ROADS)[number];

/** What the road is decided from. */
export interface ConfigureRoadFacts {
  /** The supported project types detected at the repository root. */
  readonly projectTypes: readonly string[];
  /** The parts the audit report names, or `null` when there is no report. */
  readonly parts: readonly string[] | null;
  /** The supported project types detected in each audited folder. */
  readonly partTypes?: Readonly<Record<string, readonly string[]>>;
}

/** The road, and why, in words an operator can be told. */
export interface ConfigureRoadDecision {
  readonly road: ConfigureRoad;
  readonly reason: string;
}

/**
 * Decide which road the configure step takes.
 * @param facts - The detected project types and the audit's parts
 * @returns The road and the reason for it
 */
export function decideConfigureRoad(
  facts: ConfigureRoadFacts
): ConfigureRoadDecision {
  const { projectTypes, parts, partTypes } = facts;
  const folders = (parts ?? []).filter(part => part !== WHOLE_REPOSITORY_SCOPE);
  if (folders.length > 0 && partTypes !== undefined) {
    const unknown = folders.filter(
      folder => !Object.hasOwn(partTypes, folder) || !partTypes[folder]?.length
    );
    return unknown.length > 0
      ? {
          road: "discovery",
          reason: `Lisa found no supported project type in ${unknown.map(describeScope).join(", ")}. The checks for this repository are declared from what the audit found.`,
        }
      : {
          road: "paved",
          reason: `Lisa ships checks for every audited part (${folders.map(folder => `${describeScope(folder)}: ${partTypes[folder]?.join(", ")}`).join("; ")}). Each part has its own declared tasks.`,
        };
  }
  if (folders.length > 0) {
    return {
      road: "discovery",
      reason: `The audit found ${folders.length === 1 ? "a separate part" : "separate parts"} in this repository (${folders.map(folder => describeScope(folder)).join(", ")}). The checks Lisa ships cover a repository that is one piece of software, so here each part's checks are declared from what the audit found.`,
    };
  }
  if (projectTypes.length === 0) {
    return {
      road: "discovery",
      reason:
        "This repository is not one of the project types Lisa ships checks for, so its checks are declared from what the audit found.",
    };
  }
  return {
    road: "paved",
    reason: `This repository is one piece of software on a project type Lisa ships checks for (${projectTypes.join(", ")}), so its checks are declared from the ones Lisa ships.${parts === null ? " No audit report was found, so the repository was taken to be one piece of software." : ""}`,
  };
}
