/**
 * Which coding agents `lisa controls install-carriers --agents` carries.
 *
 * The roster comes from one of two places, and the flag says which:
 *
 * - `--agents` on its own reads the `harness` setting of `.lisa.config.json`,
 *   the setting that already says which agents a repository is set up for.
 *   `fleet` (or its alias `all`) is every agent; any other value is that one
 *   agent.
 * - `--agents=<names>` names them, separated by commas: any of the agent
 *   names, or `fleet` or `all` for every agent. This is the only form that
 *   works in a repository with no `.lisa.config.json`, or with one that has
 *   no `harness` setting.
 *
 * Nothing is guessed. Lisa's other commands treat a missing `harness` as
 * Claude Code, because that is what they have always emitted. Here that
 * would write down, as the repository's roster, an agent nobody named, and
 * leave every other agent unrecorded; so a roster that cannot be read is
 * refused with the form of the flag that names it.
 * @module controls/carrier-roster
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_ALIASES,
  LEGACY_HARNESS_ALIASES,
  type Harness,
} from "../core/config.js";
import { normalizeHarness } from "../core/project-config.js";
import { isJsonObject } from "../sync/json-path.js";

import { pathKind } from "./audit-report-file.js";
import {
  INSTALL_CARRIERS_INVOCATION,
  type CarrierRoster,
} from "./carrier-types.js";
import {
  CODING_AGENTS,
  EVERY_AGENT,
  inAgentOrder,
  isCodingAgent,
  type CodingAgent,
} from "./coding-agents.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";

/** How a run was asked for its agents. */
export type AgentSelection =
  | { readonly from: "harness" }
  | { readonly from: "named"; readonly names: readonly string[] };

/** The roster of a run, or why there is none. */
export type RosterRead =
  | { readonly problems: null; readonly roster: CarrierRoster }
  | { readonly problems: readonly string[] };

/** Every word that names every agent at once. */
const EVERY_AGENT_WORDS: readonly string[] = [
  EVERY_AGENT,
  ...Object.keys(HARNESS_ALIASES),
];

/** How the agents are named on the flag, for a message. */
const HOW_TO_NAME = `Name the agents instead: "${INSTALL_CARRIERS_INVOCATION} --agents=<names>", with any of ${CODING_AGENTS.join(", ")} separated by commas, or ${EVERY_AGENT} for all of them.`;

/**
 * Turn the value of the `--agents` flag into a selection.
 * @param flag - `true` for the flag on its own, or the text given to it
 * @returns The selection
 */
export function agentSelectionOf(flag: true | string): AgentSelection {
  return flag === true
    ? { from: "harness" }
    : {
        from: "named",
        names: flag
          .split(",")
          .map(name => name.trim())
          .filter(name => name !== ""),
      };
}

/**
 * The agents a harness value stands for.
 * @param harness - A valid harness value
 * @returns Every agent for `fleet`, otherwise the one agent
 */
function agentsOf(harness: Harness): readonly CodingAgent[] {
  return isCodingAgent(harness) ? [harness] : CODING_AGENTS;
}

/**
 * Read the roster the flag names.
 * @param names - The names given, already split
 * @returns The roster, or one line per name that is not an agent
 */
function namedRoster(names: readonly string[]): RosterRead {
  if (names.length === 0) {
    return { problems: [`--agents= names no coding agent. ${HOW_TO_NAME}`] };
  }
  const unknown = names.filter(
    name => !isCodingAgent(name) && !EVERY_AGENT_WORDS.includes(name)
  );
  if (unknown.length > 0) {
    return {
      problems: [
        ...unknown.map(
          name =>
            `--agents names ${JSON.stringify(name)}, which is not a coding agent Lisa knows. Write any of ${CODING_AGENTS.join(", ")}, or ${EVERY_AGENT} for all of them.`
        ),
        // `--agents some/folder` reads the folder as the names.
        `When --agents is meant on its own, write the repository's path before it, or write the names with an equals sign: --agents=<names>.`,
      ],
    };
  }
  const every = names.some(name => EVERY_AGENT_WORDS.includes(name));
  return {
    problems: null,
    roster: {
      agents: every ? CODING_AGENTS : inAgentOrder(names.filter(isCodingAgent)),
      harness: null,
      source: "named",
    },
  };
}

/**
 * Read the `harness` setting of a repository as it is written.
 * @param root - Real path of the repository
 * @returns The value, `undefined` when the file or the key is not there, or
 *   why the file cannot be read
 */
async function writtenHarness(
  root: string
): Promise<{ readonly value: unknown } | { readonly problem: string }> {
  const file = path.join(root, GATES_DECLARATION_PATH);
  if ((await pathKind(file)) === "missing") return { value: undefined };
  try {
    const document: unknown = JSON.parse(await readFile(file, "utf8"));
    return isJsonObject(document)
      ? { value: document.harness }
      : {
          problem: `${GATES_DECLARATION_PATH} does not hold a JSON object, so its "harness" setting cannot be read.`,
        };
  } catch (error) {
    return {
      problem: `${GATES_DECLARATION_PATH} could not be read as JSON (${error instanceof Error ? error.message : String(error)}), so its "harness" setting cannot be read.`,
    };
  }
}

/**
 * Read the roster from the repository's `harness` setting.
 * @param root - Real path of the repository
 * @returns The roster, or why the setting does not give one
 */
async function harnessRoster(root: string): Promise<RosterRead> {
  const written = await writtenHarness(root);
  if ("problem" in written) {
    return { problems: [`${written.problem} ${HOW_TO_NAME}`] };
  }
  if (written.value === undefined) {
    return {
      problems: [
        `--agents on its own reads the coding agents from the "harness" setting of ${GATES_DECLARATION_PATH}, and this repository has none. ${HOW_TO_NAME}`,
      ],
    };
  }
  const harness =
    typeof written.value === "string"
      ? (LEGACY_HARNESS_ALIASES[written.value] ??
        normalizeHarness(written.value))
      : undefined;
  if (harness === undefined) {
    return {
      problems: [
        `The "harness" setting of ${GATES_DECLARATION_PATH} is ${JSON.stringify(written.value)}, which names no coding agent Lisa knows. Correct it, or ${HOW_TO_NAME.charAt(0).toLowerCase()}${HOW_TO_NAME.slice(1)}`,
      ],
    };
  }
  return {
    problems: null,
    roster: { agents: agentsOf(harness), harness, source: "harness" },
  };
}

/**
 * Work out which coding agents a run carries.
 * @param root - Real path of the repository
 * @param selection - How the run was asked for its agents
 * @returns The roster, or one line per reason there is none
 */
export function resolveRoster(
  root: string,
  selection: AgentSelection
): Promise<RosterRead> {
  return selection.from === "named"
    ? Promise.resolve(namedRoster(selection.names))
    : harnessRoster(root);
}
