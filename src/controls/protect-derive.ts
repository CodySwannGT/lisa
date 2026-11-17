/**
 * The checks a pull request must pass, derived from the control register.
 *
 * Only an entry the register marks `authoritative` and `required` at the
 * pull-request moment asks the hosting platform to refuse a merge. For those
 * entries the check names come from `contextsFor` in the shipped gate
 * registry — the same function the ruleset applier and the reconciler use —
 * called on the gates those entries were generated from and on no others. An
 * `advisory` rule, or one that is only `optional` on a pull request, derives
 * nothing here, even where the paved-road applier would require its check.
 *
 * A gate with several `parts` has several entries and one check: `contextsFor`
 * gives a gate one name whatever its parts. That is right for a required
 * check, because the platform keeps one requirement per name and cannot hold
 * the same name twice. It is sound only while one status is reported under
 * that name and that status fails when any part fails, which is the
 * pull-request carrier's job.
 * @module controls/protect-derive
 */
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { compareCodeUnits } from "./canonical-json.js";
import type { ProtectionModules } from "./protect-modules.js";
import {
  PULL_REQUEST_MOMENT,
  type CheckState,
  type RequiredCheck,
} from "./protect-types.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "./register-types.js";

/** One check the register derives, before the platform has been asked. */
export interface DerivedCheck {
  readonly context: string;
  /** Whether another app reports it, rather than a pipeline job. */
  readonly awaited: boolean;
  /** The app the declaration pins an awaited check to, or `null`. */
  readonly appId: number | null;
  readonly gates: readonly string[];
  /** Why it must not be required as things stand, or `null` when it may be. */
  readonly held: Extract<CheckState, "not-ready" | "excluded"> | null;
}

/** One register entry the hosting platform is asked to enforce. */
export interface ProtectedEntry {
  readonly entry: ControlRegisterEntry;
  /** The names of the checks that prove it; empty when it has none. */
  readonly checks: readonly string[];
}

/** Everything the register asks of merge protection. */
export interface DerivedProtection {
  readonly entries: readonly ProtectedEntry[];
  /** Each distinct check, ordered by name. */
  readonly checks: readonly DerivedCheck[];
  /** The gates the entries came from, as the declaration writes them. */
  readonly gates: Readonly<Record<string, unknown>>;
}

/** What deriving needs to know about the repository beyond the register. */
export interface DeriveInputs {
  readonly register: ControlRegister;
  /** The `gates` block the register was generated from. */
  readonly gates: Readonly<Record<string, unknown>>;
  readonly modules: ProtectionModules;
  /** Check names the repository's configuration says never to require. */
  readonly dropped?: ReadonlySet<string> | undefined;
  /** Whether a pipeline job can report a check. `false` holds those back. */
  readonly canReportWorkflowChecks?: boolean | undefined;
}

/**
 * Tell whether an entry asks the hosting platform to refuse a merge.
 * @param entry - A register entry
 * @returns Whether it is authoritative and required on a pull request
 */
export function isProtectedEntry(entry: ControlRegisterEntry): boolean {
  return (
    entry.tier === "authoritative" &&
    entry.enforcement_points.some(
      point =>
        point.moment === PULL_REQUEST_MOMENT && point.level === "required"
    )
  );
}

/**
 * Derive the required checks of a register.
 * @param inputs - The register, its declaration and the shipped scripts
 * @returns The protected entries and the checks that prove them
 */
export function deriveRequiredChecks(inputs: DeriveInputs): DerivedProtection {
  const { register, modules } = inputs;
  const protectedEntries = register.entries.filter(isProtectedEntry);
  const gateIds = [...new Set(protectedEntries.map(entry => entry.gate))];
  const gates = Object.fromEntries(
    gateIds.map(id => [id, inputs.gates[id]] as const)
  );
  const byGate = new Map(
    gateIds.map(id => [
      id,
      modules.gates.contextsFor(
        { [id]: inputs.gates[id] },
        { moment: PULL_REQUEST_MOMENT }
      ),
    ])
  );
  const awaited = new Set(
    modules.reconcile.awaitedContexts(gates, PULL_REQUEST_MOMENT)
  );
  const pins = modules.reconcile.awaitedPins(gates, PULL_REQUEST_MOMENT);
  const names = [...new Set([...byGate.values()].flat())].sort(
    compareCodeUnits
  );
  const heldBack = (context: string): DerivedCheck["held"] => {
    if (inputs.dropped?.has(context) === true) return "excluded";
    return inputs.canReportWorkflowChecks === false && !awaited.has(context)
      ? "not-ready"
      : null;
  };
  return {
    entries: protectedEntries.map(entry => ({
      entry,
      checks: byGate.get(entry.gate) ?? [],
    })),
    checks: names.map(context => ({
      context,
      awaited: awaited.has(context),
      appId: pins[context] ?? null,
      gates: gateIds.filter(id => byGate.get(id)?.includes(context) === true),
      held: heldBack(context),
    })),
    gates,
  };
}

/**
 * Say where each derived check stands, given the ones the platform requires.
 * @param checks - The derived checks
 * @param required - The names the platform requires on the branch, or `null`
 *   when the platform was not read
 * @returns The checks as the result document lists them
 */
export function checkStates(
  checks: readonly DerivedCheck[],
  required: ReadonlySet<string> | null
): readonly RequiredCheck[] {
  const stateOf = (check: DerivedCheck): CheckState => {
    if (required?.has(check.context) === true) return "required";
    if (check.held !== null) return check.held;
    return required === null ? "unknown" : "missing";
  };
  return checks.map(check => ({
    context: check.context,
    source: check.awaited ? "external" : "workflow",
    app_id: check.appId,
    gates: check.gates,
    state: stateOf(check),
  }));
}

/**
 * Read the check names a repository's configuration says never to require.
 * @param config - The parsed `.lisa.config.json`, or nothing
 * @returns The names under `github.rulesets.dropRequiredChecks`
 */
export function droppedChecks(
  config: Readonly<Record<string, unknown>> | undefined
): ReadonlySet<string> {
  const dropped = rulesetsBlock(config)?.dropRequiredChecks;
  return new Set(
    Array.isArray(dropped)
      ? dropped.filter((name): name is string => typeof name === "string")
      : []
  );
}

/**
 * Read the `github.rulesets` block of a repository's configuration.
 * @param config - The parsed `.lisa.config.json`, or nothing
 * @returns The block, or `undefined` when there is none
 */
export function rulesetsBlock(
  config: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> | undefined {
  const github = config?.github;
  const rulesets =
    github !== null && typeof github === "object"
      ? (Reflect.get(github, "rulesets") as unknown)
      : undefined;
  return rulesets !== null &&
    typeof rulesets === "object" &&
    !Array.isArray(rulesets)
    ? (rulesets as Readonly<Record<string, unknown>>)
    : undefined;
}

/**
 * Tell whether a pipeline job could report a check in this repository.
 *
 * A GitHub Actions check only ever reports when the repository has workflows.
 * Requiring one in a repository that has none holds every pull request
 * waiting for a result that never arrives, with no failure to read. The
 * ruleset applier drops such checks for the same reason.
 * @param root - Real path of the repository
 * @returns Whether `.github/workflows` is a folder
 */
export async function hasWorkflowFolder(root: string): Promise<boolean> {
  return (await pathKind(path.join(root, ".github", "workflows"))) === "folder";
}
