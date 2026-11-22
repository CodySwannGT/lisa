/**
 * Reading the criterion catalogue's gate mappings against the gate registry
 * (CodySwannGT/lisa#4976).
 *
 * A requirement of the gate kind names the registered gates that can satisfy
 * it, or says that the registry has none and why. The registry is the one
 * every host repository is shipped; it is imported rather than copied, so a
 * gate that leaves it is noticed here.
 * @module tests/helpers/criterion-gate-mapping
 */
import { REGISTRY } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  catalogueSchemaErrors,
  type Catalogue,
  type InScopeCriterion,
} from "./criterion-catalogue.js";

/** A catalogue entry that names a gate the registry does not have. */
export interface UnregisteredGate {
  readonly criterion: string;
  readonly gate: string;
}

/** A gate-kind requirement that no registered gate protects, and why. */
export interface UnprotectedCriterion {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

/**
 * The id of every gate in the registry.
 * @returns Gate ids, in the registry's order
 */
export function registeredGateIds(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * The in-scope entries whose requirement is met by a gate.
 * @param catalogue - The criterion catalogue
 * @returns Every in-scope entry of kind `gate`, in catalogue order
 */
export function gateKindCriteria(catalogue: Catalogue): InScopeCriterion[] {
  return catalogue.criteria.filter(
    (criterion): criterion is InScopeCriterion =>
      criterion.in_scope && criterion.kind === "gate"
  );
}

/**
 * Every mapping to a gate that is not registered.
 * @param criteria - Catalogue entries to read
 * @param registered - Ids of the gates the registry has
 * @returns One finding per criterion and unregistered gate it names
 */
export function unregisteredGates(
  criteria: readonly InScopeCriterion[],
  registered: readonly string[]
): UnregisteredGate[] {
  return criteria.flatMap(criterion =>
    (criterion.gates ?? [])
      .filter(gate => !registered.includes(gate))
      .map(gate => ({ criterion: criterion.id, gate }))
  );
}

/**
 * The requirements that name no gate.
 * @param criteria - Gate-kind catalogue entries
 * @returns Each entry with no gate and the reason it states; an entry that
 *   states none is listed with an empty reason so it cannot go unnoticed
 */
export function unprotectedCriteria(
  criteria: readonly InScopeCriterion[]
): UnprotectedCriterion[] {
  return criteria
    .filter(criterion => (criterion.gates ?? []).length === 0)
    .map(criterion => ({
      id: criterion.id,
      title: criterion.title,
      reason: criterion.no_gate_reason ?? "",
    }));
}

/**
 * The unprotected requirements as text a person can read in a test log.
 * @param unprotected - Requirements with no gate
 * @param total - How many gate-kind requirements there are in all
 * @returns A heading and one line per requirement: id, title and reason
 */
export function unprotectedReport(
  unprotected: readonly UnprotectedCriterion[],
  total: number
): string {
  return [
    `${unprotected.length} of ${total} gate-kind criteria have no gate in the registry:`,
    ...unprotected.map(
      criterion => `  ${criterion.id} ${criterion.title} — ${criterion.reason}`
    ),
  ].join("\n");
}

/**
 * The schema's findings for a catalogue with one entry replaced.
 * @param catalogue - The catalogue to start from
 * @param index - Position of the entry
 * @param replacement - The entry to put there
 * @returns One line per finding; empty when the result is still valid
 */
export function schemaErrorsWithEntry(
  catalogue: Catalogue,
  index: number,
  replacement: object
): string[] {
  return catalogueSchemaErrors({
    ...catalogue,
    criteria: catalogue.criteria.map((criterion, position) =>
      position === index ? replacement : criterion
    ),
  });
}
