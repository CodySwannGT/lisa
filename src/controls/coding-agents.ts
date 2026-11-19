/**
 * The coding agents Lisa supports, as the control commands name them.
 *
 * One vocabulary is used everywhere an agent is named: the values the
 * `harness` setting of `.lisa.config.json` already takes. The gates
 * declaration names agents with them (`unenforceable_on`), the control
 * register carries them, and `lisa controls install-carriers --agents` takes
 * them. `fleet` is not an agent; it is the harness value that selects all of
 * them.
 *
 * This module imports nothing from the other control modules, so any of them
 * can use it.
 * @module controls/coding-agents
 */
import { HARNESS_VALUES, type Harness } from "../core/config.js";

/** The harness value that selects every agent rather than naming one. */
export const EVERY_AGENT: Harness = "fleet";

/** One coding agent. */
export type CodingAgent = Exclude<Harness, "fleet">;

/**
 * Every coding agent, in the order the harness setting lists them. This is
 * the order a list of agents is written in wherever Lisa writes one.
 */
export const CODING_AGENTS: readonly CodingAgent[] = HARNESS_VALUES.filter(
  (harness): harness is CodingAgent => harness !== EVERY_AGENT
);

/**
 * The moments a coding agent's own hooks carry, as the gate registry names
 * them. A rule declared at any other moment is carried by something that is
 * not an agent.
 */
export const AGENT_MOMENTS = [
  "session-start",
  "pre-tool",
  "post-tool",
] as const;

/** The moment an agent's hook carries after one of its tools wrote a file. */
export const EDIT_TIME_MOMENT = "post-tool";

/**
 * Tell whether a value is the name of a coding agent.
 * @param value - Any value
 * @returns Whether it is one of {@link CODING_AGENTS}
 */
export function isCodingAgent(value: unknown): value is CodingAgent {
  return CODING_AGENTS.some(agent => agent === value);
}

/**
 * Put agents in the order Lisa writes them, each once.
 * @param agents - The agents, in any order
 * @returns The same agents in {@link CODING_AGENTS} order
 */
export function inAgentOrder(
  agents: readonly CodingAgent[]
): readonly CodingAgent[] {
  return CODING_AGENTS.filter(agent => agents.includes(agent));
}
