/**
 * Where and how each declared gate is enforced, for the control register.
 *
 * An enforcement point is a moment plus where the rule is enforced at it. The
 * moments a gate is declared at, and what proves it at each, are not worked
 * out here: every declared moment is handed to the shipped registry's
 * `resolveMoment`, the same call the gate runner makes, and its answer is
 * recorded. The register therefore states what runs, not a second reading of
 * the declaration.
 * @module controls/register-points
 */
import { compareCodeUnits } from "./canonical-json.js";
import {
  GATES_DECLARATION_PATH,
  type GatesDeclaration,
  type GatesModule,
  type ResolvedGate,
} from "./gates-declaration.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type EnforcementLevel,
  type EnforcementLocation,
  type MeasuringMechanism,
} from "./register-types.js";

/** The moment families enforced at each place. Every place is listed. */
const MOMENT_FAMILIES_BY_LOCATION: Readonly<
  Record<EnforcementLocation, readonly string[]>
> = {
  "coding-agent": ["session-start", "pre-tool", "post-tool"],
  "local-checkout": ["commit", "push"],
  "hosting-platform": ["pull-request"],
  "deployment-pipeline": ["pre-deploy", "post-deploy"],
  "scheduled-run": ["continuous"],
};

/**
 * Where each moment family is enforced.
 *
 * Keyed by family, so `pre-deploy:production` is looked up as `pre-deploy`. A
 * suite holds this table to the registry's own list of moments: a moment the
 * registry gains without a place here fails it.
 */
export const LOCATION_BY_MOMENT_FAMILY: Readonly<
  Record<string, EnforcementLocation>
> = Object.fromEntries(
  (
    Object.entries(MOMENT_FAMILIES_BY_LOCATION) as readonly (readonly [
      EnforcementLocation,
      readonly string[],
    ])[]
  ).flatMap(([location, families]) =>
    families.map(family => [family, location] as const)
  )
);

/** One enforcement point of one entry, with what measures the rule at it. */
export interface ResolvedPoint {
  /** The gate the point belongs to. */
  readonly gate: string;
  /** The folder of the entry the point belongs to. */
  readonly scope: string;
  readonly moment: string;
  readonly level: EnforcementLevel;
  readonly location: EnforcementLocation;
  readonly mechanism: MeasuringMechanism;
}

/** Every enforcement point, or why some could not be stated. */
export interface ResolvedPoints {
  /** Every point of every entry, in the order the moments happen. */
  readonly points: readonly ResolvedPoint[];
  /** One line per gate whose measuring mechanism cannot be recorded. */
  readonly problems: readonly string[];
}

/**
 * Every moment any gate is declared at, in the order the moments happen: the
 * fixed moments first, then deployments and scheduled runs, each environment
 * in name order.
 * @param declaration - The validated declaration
 * @param registry - The shipped gate registry
 * @returns The moments, each once
 */
function declaredMoments(
  declaration: GatesDeclaration,
  registry: GatesModule
): readonly string[] {
  const families = [...registry.MOMENTS, ...registry.MOMENT_FAMILIES];
  const rank = (moment: string): number =>
    families.indexOf(registry.momentFamily(moment));
  const moments = new Set(
    Object.values(declaration.gates).flatMap(gate =>
      Object.keys(gate).filter(key => registry.isMoment(key))
    )
  );
  return [...moments].sort(
    (left, right) => rank(left) - rank(right) || compareCodeUnits(left, right)
  );
}

/**
 * Where a moment is enforced.
 * @param moment - The moment
 * @param registry - The shipped gate registry
 * @returns The location
 * @throws {Error} When the registry knows a moment this module does not
 */
function locationOf(
  moment: string,
  registry: GatesModule
): EnforcementLocation {
  const location = LOCATION_BY_MOMENT_FAMILY[registry.momentFamily(moment)];
  if (location === undefined) {
    throw new Error(
      `This copy of Lisa does not know where "${moment}" is enforced, so it cannot write the register. Update Lisa.`
    );
  }
  return location;
}

/**
 * What measures a gate that runs a task, or nothing.
 * @param resolved - The gate at one moment, as the registry resolved it
 * @returns The mechanism, or `null` when the task is not named as text
 */
function taskMechanism(resolved: ResolvedGate): MeasuringMechanism | null {
  if (resolved.task === null) return { kind: "none" };
  return typeof resolved.task === "string" &&
    typeof resolved.command === "string"
    ? { kind: "task", task: resolved.task, command: resolved.command }
    : null;
}

/**
 * What measures a gate that waits for a check another system reports.
 * @param resolved - The gate at one moment, as the registry resolved it
 * @returns The mechanism, or `null` when the check is not named as text
 */
function awaitedMechanism(resolved: ResolvedGate): MeasuringMechanism | null {
  return typeof resolved.awaits === "string"
    ? {
        kind: "external-check",
        name: resolved.awaits,
        posted_by:
          typeof resolved.postedBy === "number" ? resolved.postedBy : null,
      }
    : null;
}

/**
 * What measures one resolved gate.
 * @param resolved - The gate at one moment, as the registry resolved it
 * @returns The mechanism, or `null` when the declaration names it as
 *   something other than text
 */
function mechanismOf(resolved: ResolvedGate): MeasuringMechanism | null {
  if (Array.isArray(resolved.argv)) {
    return { kind: "command", argv: [...resolved.argv] };
  }
  if (resolved.mode === "await") return awaitedMechanism(resolved);
  if (resolved.mode === "intercept") return { kind: "interceptor" };
  if (resolved.mode === "builtin") return { kind: "built-in" };
  return taskMechanism(resolved);
}

/** One resolved gate at one moment: its point, or why there is none. */
type PointOrProblem =
  | { readonly problem: null; readonly point: ResolvedPoint }
  | { readonly problem: string };

/**
 * Resolve every gate declared at one moment.
 * @param moment - The moment
 * @param declaration - The validated declaration
 * @param registry - The shipped gate registry
 * @returns One point, or one problem, per gate and folder enforced there
 */
function pointsAt(
  moment: string,
  declaration: GatesDeclaration,
  registry: GatesModule
): readonly PointOrProblem[] {
  const location = locationOf(moment, registry);
  return registry
    .resolveMoment({
      gates: declaration.gates,
      moment,
      runner: declaration.runner,
      scripts: declaration.scripts,
    })
    .map((resolved): PointOrProblem => {
      const mechanism = mechanismOf(resolved);
      return mechanism === null
        ? {
            problem: `The gate "${resolved.id}" in ${GATES_DECLARATION_PATH} does not name what checks it at "${moment}" as text. Write the task or the awaited check's name in quotes.`,
          }
        : {
            problem: null,
            point: {
              gate: resolved.id,
              scope: resolved.scope ?? WHOLE_REPOSITORY_SCOPE,
              moment,
              level: resolved.level as EnforcementLevel,
              location,
              mechanism,
            },
          };
    });
}

/**
 * Resolve every declared moment into the enforcement points of every entry.
 * @param declaration - The validated declaration
 * @param registry - The shipped gate registry
 * @returns Every enforcement point, and any gate that cannot be recorded
 */
export function resolveEnforcementPoints(
  declaration: GatesDeclaration,
  registry: GatesModule
): ResolvedPoints {
  const resolved = declaredMoments(declaration, registry).flatMap(moment =>
    pointsAt(moment, declaration, registry)
  );
  return {
    points: resolved.flatMap(each =>
      each.problem === null ? [each.point] : []
    ),
    problems: resolved.flatMap(each =>
      each.problem === null ? [] : [each.problem]
    ),
  };
}
