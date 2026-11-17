/**
 * Which of two roads the configure step takes for a repository.
 *
 * - **paved**: the whole repository is one piece of software on a project
 *   type Lisa ships checks for. Its checks are declared from the ones Lisa
 *   ships, by code, so two runs give the same declaration and nobody has to
 *   discover anything.
 * - **discovery**: anything else. The checks are declared from what the audit
 *   found, one decision at a time, and every part names what supports it.
 *
 * The decision is made here, from two facts and nothing else, so an agent
 * never has to judge it: the project types detected at the repository root,
 * and the parts the audit report names, when there is a report.
 *
 * A repository with more than one part is always on the discovery road, even
 * when a part is itself a supported project type. The checks Lisa ships run
 * through the task runner at the repository root and cover the repository as
 * one piece; applying a project type to one folder of a mixed repository is
 * not something Lisa does.
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
  const { projectTypes, parts } = facts;
  const folders = (parts ?? []).filter(part => part !== WHOLE_REPOSITORY_SCOPE);
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
