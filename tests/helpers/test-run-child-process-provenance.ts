/** Pure provenance-combination helpers for child_process analysis. */
import {
  CHILD_PROCESS_APIS,
  type ChildProcessProvenance,
} from "./test-run-child-process-model.js";
import { isProcessBearing } from "./test-run-child-process-source.js";

/**
 * Merge control-flow alternatives without guessing which capability escapes.
 * @param values - Alternative control-flow provenance values
 * @param label - Stable ambiguity label
 * @returns Merged provenance
 */
export function mergeChildAlternatives(
  values: readonly ChildProcessProvenance[],
  label: string
): ChildProcessProvenance {
  const first = values[0] ?? { kind: "local" as const };
  const identical = values.every(
    value =>
      value.kind === first.kind &&
      (value.kind !== "api" ||
        (first.kind === "api" && value.api === first.api))
  );
  if (identical) return first;
  return values.some(isProcessBearing)
    ? { kind: "tainted", reason: `ambiguous child_process ${label}` }
    : { kind: "local" };
}

/**
 * Resolve access against an already resolved owner.
 * @param owner - Receiver provenance
 * @param property - Literal property or undefined for dynamic access
 * @returns Property access provenance
 */
export function childOwnerAccessProvenance(
  owner: ChildProcessProvenance,
  property: string | undefined
): ChildProcessProvenance {
  if (owner.kind === "container") {
    if (property !== undefined)
      return owner.values.get(property) ?? { kind: "local" };
    return [...owner.values.values()].some(isProcessBearing)
      ? { kind: "tainted", reason: "dynamic child_process container access" }
      : { kind: "local" };
  }
  if (owner.kind !== "namespace")
    return owner.kind === "api"
      ? { kind: "tainted", reason: "unsupported child_process API member" }
      : owner;
  if (property === undefined) {
    return { kind: "tainted", reason: "dynamic child_process property" };
  }
  return CHILD_PROCESS_APIS.has(property)
    ? { kind: "api", api: property }
    : {
        kind: "tainted",
        reason: `unsupported child_process property ${property}`,
      };
}

/**
 * Resolve a property selected from inherited binding provenance.
 * @param inherited - Inherited binding provenance
 * @param property - Selected property name
 * @returns Selected property provenance
 */
export function childBindingPropertyProvenance(
  inherited: ChildProcessProvenance,
  property: string
): ChildProcessProvenance {
  if (inherited.kind === "namespace") {
    return CHILD_PROCESS_APIS.has(property)
      ? { kind: "api", api: property }
      : {
          kind: "tainted",
          reason: `unsupported child_process property ${property}`,
        };
  }
  return inherited.kind === "container"
    ? (inherited.values.get(property) ?? { kind: "local" })
    : inherited;
}
