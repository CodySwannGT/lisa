/**
 * The register refuses a gate that calls itself authoritative and is not.
 *
 * A rule is authoritative when it is required somewhere the author of a
 * change does not control, and advisory when it is not: a rule the author
 * can skip is feedback, whatever it is called. The register works the tier
 * out that way for a gate that does not declare one.
 *
 * A gate may also declare its tier. Declaring `advisory` for a rule that is
 * required on the hosting platform only understates it, and is kept. Declaring
 * `authoritative` for a rule that is required nowhere beyond the author's own
 * machine is a different thing: the register would say a rule cannot be
 * skipped when a single flag skips it, and every reader of the register
 * would be told something untrue. So that declaration is refused, with a
 * sentence that says which of the two things to change.
 *
 * It is checked on the generated entries, one folder at a time, because a
 * gate with parts may be required in one folder and not in another.
 *
 * A leaf module on purpose: the rule and the working-out of an undeclared
 * tier (`./register-entries.ts`) share the one test below.
 * @module controls/register-tier-rule
 */
import {
  GATES_DECLARATION_PATH,
  type GatesDeclaration,
} from "./gates-declaration.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegisterEntry,
  type ControlTier,
  type EnforcementLevel,
  type EnforcementLocation,
} from "./register-types.js";

/** The tier that says a rule cannot be skipped by the author of a change. */
const AUTHORITATIVE: ControlTier = "authoritative";

/** The level at which a rule stops a change. */
const REQUIRED: EnforcementLevel = "required";

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

/** The part of an enforcement point the tier depends on. */
interface PlacedPoint {
  readonly moment: string;
  readonly level: EnforcementLevel;
  readonly location: EnforcementLocation;
}

/**
 * Tell whether a rule is required somewhere its author does not control.
 * @param points - The rule's enforcement points
 * @returns Whether one of them is required on the hosting platform, in a
 *   deployment pipeline or on a schedule
 */
export function isRequiredBeyondTheAuthor(
  points: readonly PlacedPoint[]
): boolean {
  return points.some(
    point => point.level === REQUIRED && BEYOND_THE_AUTHOR.has(point.location)
  );
}

/**
 * Say where an entry is required, for the sentence that refuses it.
 * @param entry - The entry
 * @returns For example `it is required only at commit and push, where the
 *   author of a change can skip it`
 */
function requiredWhere(entry: ControlRegisterEntry): string {
  const moments = entry.enforcement_points
    .filter(point => point.level === REQUIRED)
    .map(point => point.moment);
  return moments.length === 0
    ? "it is not required at any moment"
    : `it is required only at ${moments.join(" and ")}, where the author of a change can skip it`;
}

/**
 * Every entry of a gate that declares itself authoritative is required
 * somewhere the author of a change does not control.
 * @param entries - The generated entries
 * @param declaration - The declaration they were generated from
 * @returns One line per entry that is not
 */
export function declaredTiersHold(
  entries: readonly ControlRegisterEntry[],
  declaration: GatesDeclaration
): readonly string[] {
  return entries
    .filter(
      entry =>
        declaration.gates[entry.gate]?.tier === AUTHORITATIVE &&
        !isRequiredBeyondTheAuthor(entry.enforcement_points)
    )
    .map(entry => {
      const folder =
        entry.scope === WHOLE_REPOSITORY_SCOPE
          ? ""
          : ` for the folder "${entry.scope}"`;
      return `The gate "${entry.gate}" in ${GATES_DECLARATION_PATH} declares "tier": "authoritative"${folder}, but ${requiredWhere(entry)}. An authoritative check is one that is required somewhere the author does not control. Either require it at "pull-request", before a deployment or on a schedule, or change its tier to "advisory" (leave "tier" out and the register works it out).`;
    });
}
