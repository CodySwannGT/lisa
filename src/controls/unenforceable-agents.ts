/**
 * The coding agents a declaration says a rule cannot be enforced on, and what
 * the control register records about them.
 *
 * A check declared at an agent moment runs because the agent's own hook calls
 * the gate runner. An agent with no hook that can refuse what it just did
 * never calls it. The declaration says so on the gate's moment entry:
 *
 * ```json
 * "post-tool": { "level": "required", "unenforceable_on": ["agy"] }
 * ```
 *
 * The register records the list on the enforcement point at that moment, on
 * every entry of the gate, in one fixed order. It is a statement about the
 * agent, not about the rule: the same rule is still enforced on every other
 * agent, and at every later moment on this one. A declaration that names no
 * agent produces the register it always did.
 *
 * `lisa controls install-carriers --agents` writes the key; see
 * `./carrier-unenforceable.ts`.
 * @module controls/unenforceable-agents
 */
import { isJsonObject } from "../sync/json-path.js";

import {
  inAgentOrder,
  isCodingAgent,
  type CodingAgent,
} from "./coding-agents.js";
import type { DeclaredGate, GatesDeclaration } from "./gates-declaration.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** The key of a moment entry that names the agents. */
export const UNENFORCEABLE_ON_KEY = "unenforceable_on";

/**
 * The agents one gate says a moment cannot be enforced on.
 * @param gate - The gate, from a validated declaration
 * @param moment - The moment
 * @returns The agents in the order Lisa writes them; none when the gate names
 *   none there
 */
function declaredUnenforceableAgents(
  gate: DeclaredGate,
  moment: string
): readonly CodingAgent[] {
  const entry = gate[moment];
  const named = isJsonObject(entry) ? entry[UNENFORCEABLE_ON_KEY] : undefined;
  return Array.isArray(named)
    ? inAgentOrder(named.filter(agent => isCodingAgent(agent)))
    : [];
}

/**
 * Record, on each enforcement point, the agents its gate says the moment
 * cannot be enforced on.
 * @param entries - The register's entries
 * @param declaration - The validated declaration they were built from
 * @returns The entries; a point whose gate names no agent is returned as it is
 */
export function withUnenforceableAgents(
  entries: readonly ControlRegisterEntry[],
  declaration: GatesDeclaration
): readonly ControlRegisterEntry[] {
  return entries.map(entry => {
    const gate = declaration.gates[entry.gate] ?? {};
    const points = entry.enforcement_points.map(point => {
      const agents = declaredUnenforceableAgents(gate, point.moment);
      return agents.length === 0
        ? point
        : { ...point, unenforceable_on: agents };
    });
    return points.every(
      (point, index) => point === entry.enforcement_points[index]
    )
      ? entry
      : { ...entry, enforcement_points: points };
  });
}
