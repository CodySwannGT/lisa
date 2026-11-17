/**
 * Turning one declared gate into its control register entries.
 *
 * A gate with `parts` becomes one entry per part, each for the part's folder.
 * A gate with no parts becomes one entry for the whole repository. Either way
 * the entry carries every field the register promises, including the ones the
 * declaration leaves out: a tier and the requirements served are filled in by
 * the rules below, and anything else not declared is written as `null` or as
 * an empty list, never left off.
 * @module controls/register-entries
 */
import { canonicalText, compareCodeUnits } from "./canonical-json.js";
import { inScopeCriteria, type CriterionCatalogue } from "./catalogue.js";
import type { DeclaredGate } from "./gates-declaration.js";
import type { ResolvedPoint } from "./register-points.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  controlEntryId,
  type ControlParameter,
  type ControlProof,
  type ControlRegisterEntry,
  type ControlTier,
  type EnforcementLocation,
  type EnforcementPoint,
  type MeasuringMechanism,
} from "./register-types.js";

/** A part's paired proof, as a validated declaration writes it. */
interface DeclaredProof {
  readonly violation?: string;
  readonly clean?: string;
  readonly failure_shape?: readonly string[];
  readonly timeout_seconds?: number;
  readonly external_effects?: readonly string[];
}

/** One entry of a gate's `parts`, as a validated declaration writes it. */
interface DeclaredPart {
  readonly scope: string;
  readonly command: readonly string[];
  readonly parameters?: Readonly<Record<string, ControlParameter>>;
  readonly proof?: DeclaredProof;
}

/**
 * The places a rule is enforced that the author of a change does not control.
 * A git hook in the author's checkout can be skipped and a coding agent's
 * session is the author's own, so neither is here.
 */
const BEYOND_THE_AUTHOR: ReadonlySet<EnforcementLocation> = new Set([
  "hosting-platform",
  "deployment-pipeline",
  "scheduled-run",
]);

/**
 * The requirements a gate serves, in catalogue order.
 *
 * The gate's own `criteria` when it declares them. Otherwise the requirements
 * the catalogue maps to the gate, which is how a repository on a supported
 * project type gets them without writing any.
 * @param gateId - The gate's id
 * @param gate - Its declaration
 * @param catalogue - The criterion catalogue
 * @returns The requirement ids
 */
function criteriaOf(
  gateId: string,
  gate: DeclaredGate,
  catalogue: CriterionCatalogue
): readonly string[] {
  const declared = Array.isArray(gate.criteria)
    ? (gate.criteria as readonly unknown[])
    : null;
  return inScopeCriteria(catalogue)
    .filter(criterion =>
      declared === null
        ? Array.isArray(criterion.gates) && criterion.gates.includes(gateId)
        : declared.includes(criterion.id)
    )
    .map(criterion => criterion.id);
}

/**
 * The tier of a gate's entries.
 *
 * The tier the gate declares. Otherwise `authoritative` when the rule is
 * required somewhere the author of a change does not control, and `advisory`
 * when it is not: a rule the author can skip is feedback, whatever it is
 * called.
 * @param gate - The gate's declaration
 * @param points - The entry's enforcement points
 * @returns The tier
 */
function tierOf(
  gate: DeclaredGate,
  points: readonly ResolvedPoint[]
): ControlTier {
  if (gate.tier === "authoritative" || gate.tier === "advisory") {
    return gate.tier;
  }
  return points.some(
    point => point.level === "required" && BEYOND_THE_AUTHOR.has(point.location)
  )
    ? "authoritative"
    : "advisory";
}

/**
 * A part's named settings, holding only what the register records.
 * @param parameters - The part's `parameters`, when it declares any
 * @returns The settings by name
 */
function parametersOf(
  parameters: DeclaredPart["parameters"]
): Readonly<Record<string, ControlParameter>> {
  return Object.fromEntries(
    Object.entries(parameters ?? {}).map(([name, { value, direction }]) => [
      name,
      direction === undefined ? { value } : { value, direction },
    ])
  );
}

/**
 * A part's paired proof with every key present.
 * @param proof - The part's `proof`, when it declares one
 * @returns The proof, `null` wherever the declaration does not say
 */
function proofOf(proof: DeclaredProof = {}): ControlProof {
  const {
    violation = null,
    clean = null,
    failure_shape: shape,
    timeout_seconds: timeout = null,
    external_effects: effects,
  } = proof;
  return {
    violation,
    clean,
    failure_shape: shape === undefined ? null : [...shape],
    timeout_seconds: timeout,
    external_effects: effects === undefined ? null : [...effects],
  };
}

/**
 * Tell whether two mechanisms are the same.
 * @param left - First mechanism
 * @param right - Second mechanism
 * @returns Whether every field of both is equal
 */
function sameMechanism(
  left: MeasuringMechanism,
  right: MeasuringMechanism
): boolean {
  return canonicalText(left) === canonicalText(right);
}

/**
 * Write an entry's enforcement points, naming a mechanism on a point only
 * where it differs from the entry's own.
 * @param points - The points as resolved
 * @param own - The entry's mechanism
 * @returns The points as the register writes them
 */
function enforcementPoints(
  points: readonly ResolvedPoint[],
  own: MeasuringMechanism
): readonly EnforcementPoint[] {
  return points.map(({ moment, level, location, mechanism }) =>
    sameMechanism(mechanism, own)
      ? { moment, level, location }
      : { moment, level, location, measuring_mechanism: mechanism }
  );
}

/** What building one gate's entries needs. */
export interface GateEntriesInput {
  /** The gate's id in the `gates` block. */
  readonly gateId: string;
  /** Its validated declaration. */
  readonly gate: DeclaredGate;
  /** Every enforcement point, from `resolveEnforcementPoints`. */
  readonly points: readonly ResolvedPoint[];
  /** The criterion catalogue. */
  readonly catalogue: CriterionCatalogue;
}

/**
 * The register entries of one gate, ordered by folder.
 *
 * An entry's own mechanism is its part's command. For a gate with no parts it
 * is what measures the gate at its first enforcement point, or nothing when
 * the gate is enforced nowhere.
 * @param input - The gate, its enforcement points and the catalogue
 * @returns One entry per part, or one for the whole repository
 */
export function entriesForGate(
  input: GateEntriesInput
): readonly ControlRegisterEntry[] {
  const { gateId, gate, catalogue } = input;
  const parts = Array.isArray(gate.parts)
    ? (gate.parts as readonly DeclaredPart[])
    : null;
  const units: readonly (DeclaredPart | null)[] =
    parts === null
      ? [null]
      : [...parts].sort((left, right) =>
          compareCodeUnits(left.scope, right.scope)
        );
  return units.map(part => {
    const scope = part?.scope ?? WHOLE_REPOSITORY_SCOPE;
    const points = input.points.filter(
      point => point.gate === gateId && point.scope === scope
    );
    const own: MeasuringMechanism =
      part === null
        ? (points[0]?.mechanism ?? { kind: "none" })
        : { kind: "command", argv: [...part.command] };
    return {
      id: controlEntryId(gateId, scope),
      gate: gateId,
      criteria: criteriaOf(gateId, gate, catalogue),
      scope,
      tier: tierOf(gate, points),
      enforcement_points: enforcementPoints(points, own),
      measuring_mechanism: own,
      parameters: parametersOf(part?.parameters),
      proof: proofOf(part?.proof),
      accountable_party: typeof gate.owner === "string" ? gate.owner : null,
    };
  });
}
