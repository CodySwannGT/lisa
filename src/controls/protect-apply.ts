/**
 * Planning and sending the change that makes the hosting platform require the
 * derived checks.
 *
 * Nothing about a ruleset is built here. The steps of the change come from
 * the shipped reconciler's `planRepairs`, which adds the missing checks to the
 * ruleset each belongs in and keeps everything that ruleset already holds.
 * Where the repository has no ruleset that requires checks, the one to create
 * takes its branches, enforcement and bypass list from the shipped ruleset
 * generator — the repository's own `policy` block, or Lisa's defaults — and
 * holds the status-check rule only.
 *
 * The plan is all or nothing: any step the reconciler could not place stops
 * the whole change before a request is sent.
 * @module controls/protect-apply
 */
import {
  governing,
  type Comparison,
  type Requirement,
} from "./protect-live.js";
import type {
  GhRunner,
  LiveRuleset,
  ProtectionModules,
  RepairAction,
} from "./protect-modules.js";

/** The ruleset the ruleset applier keeps pipeline-reported checks in. */
export const DEFAULT_RULESET_NAME = "quality checks";

/** What planning needs to know. */
export interface PlanInputs {
  readonly comparison: Comparison;
  readonly requirement: Requirement;
  /** Every branch ruleset the repository has. */
  readonly rulesets: readonly LiveRuleset[];
  /** The ones enforced on the branch. */
  readonly enforced: readonly LiveRuleset[];
  readonly branch: string;
  readonly defaultBranch: string | null;
  /** The ruleset the operator named, or `null`. */
  readonly rulesetName: string | null;
  /** The repository's `policy` block, as the declaration reader returned it. */
  readonly policy: unknown;
  readonly modules: ProtectionModules;
}

/** The steps to send, or the reasons nothing may be sent. */
export interface ChangePlan {
  readonly actions: readonly RepairAction[];
  readonly blockers: readonly string[];
}

/** Where a check with no ruleset of its own goes. */
interface Target {
  /** The ruleset's name, or `null` to let the reconciler pick the only one. */
  readonly name: string | null;
  /** A ruleset to create, when none exists to add to. */
  readonly seed: LiveRuleset | null;
  readonly blocker: string | null;
}

/**
 * Tell whether a ruleset requires any status check.
 * @param ruleset - A ruleset as the platform returned it
 * @returns Whether it holds a status-check rule
 */
function requiresChecks(ruleset: LiveRuleset): boolean {
  const rules = ruleset.rules;
  return (
    Array.isArray(rules) &&
    rules.some(
      rule =>
        rule !== null &&
        typeof rule === "object" &&
        Reflect.get(rule, "type") === "required_status_checks"
    )
  );
}

/**
 * Build the ruleset to create, with no rules in it yet.
 * @param name - The new ruleset's name
 * @param inputs - The planning inputs
 * @returns The ruleset, or the reason it would not protect the branch
 */
function seedRuleset(name: string, inputs: PlanInputs): Target {
  const { modules, branch, defaultBranch } = inputs;
  const seed: LiveRuleset = {
    ...modules.payload.buildRulesetPayload({
      gates: {},
      policy: inputs.policy ?? {},
    }),
    name,
    id: null,
    rules: [],
  };
  return governing([seed], branch, defaultBranch, modules).length === 1
    ? { name, seed, blocker: null }
    : {
        name,
        seed: null,
        blocker: `A new ruleset built from this repository's policy would not be enforced on \`${branch}\`, so none was created. Check policy.ruleset in .lisa.config.json (its enforcement, and the branches it includes), or name an existing ruleset with --ruleset.`,
      };
}

/**
 * Decide where a check that names no ruleset is written.
 *
 * In order: the ruleset the operator named, or the one the ruleset applier
 * uses, when it is enforced on the branch; else the only enforced ruleset
 * that already requires checks; else a new one. Two candidates with nothing
 * to choose between them is a refusal, not a guess.
 * @param inputs - The planning inputs
 * @returns The target ruleset, one to create, or why neither
 */
function chooseTarget(inputs: PlanInputs): Target {
  const { rulesets, enforced, branch, rulesetName } = inputs;
  const wanted = rulesetName ?? DEFAULT_RULESET_NAME;
  if (enforced.some(ruleset => ruleset.name === wanted)) {
    return { name: wanted, seed: null, blocker: null };
  }
  const carriers = rulesetName === null ? enforced.filter(requiresChecks) : [];
  if (carriers.length === 1) return { name: null, seed: null, blocker: null };
  if (carriers.length > 1) {
    const names = carriers
      .map(ruleset => JSON.stringify(String(ruleset.name)))
      .join(", ");
    return {
      name: null,
      seed: null,
      blocker: `More than one ruleset requires checks on \`${branch}\` (${names}). Say which one should hold these checks with --ruleset <name>.`,
    };
  }
  return rulesets.some(ruleset => ruleset.name === wanted)
    ? {
        name: wanted,
        seed: null,
        blocker: `The ruleset "${wanted}" exists but is not enforced on \`${branch}\` (it is disabled, or it covers other branches), so adding checks to it would require nothing. Enable it for \`${branch}\`, or name another ruleset with --ruleset.`,
      }
    : seedRuleset(wanted, inputs);
}

/**
 * Plan the change that makes the platform require every missing check.
 * @param inputs - The comparison and the repository's rulesets
 * @returns The steps to send, or the reasons nothing may be sent
 */
export function planChange(inputs: PlanInputs): ChangePlan {
  const { comparison, requirement, modules } = inputs;
  const homes = { ...comparison.awaitedHomes, ...requirement.configured.homes };
  const needsTarget = comparison.drift.missingRecords.some(
    record => (record.ruleset ?? homes[record.context]) === undefined
  );
  const target: Target = needsTarget
    ? chooseTarget(inputs)
    : { name: inputs.rulesetName, seed: null, blocker: null };
  if (target.blocker !== null) {
    return { actions: [], blockers: [target.blocker] };
  }
  const planned = modules.reconcile.planRepairs({
    contexts: { ...comparison.drift, extra: [] },
    settings: { drift: [] },
    live: {
      rulesets:
        target.seed === null
          ? inputs.enforced
          : [...inputs.enforced, target.seed],
    },
    prune: false,
    rulesetName: target.name,
    awaited: comparison.awaitedRecords,
    pins: { ...requirement.configured.pins, ...requirement.awaitedPins },
    homes,
  });
  const blockers = planned
    .filter(action => action.kind !== "contexts")
    .map(
      action => action.message ?? "A step of the change could not be planned."
    );
  return blockers.length > 0
    ? { actions: [], blockers }
    : { actions: planned, blockers: [] };
}

/**
 * Send a planned change.
 *
 * A step for an existing ruleset goes through the reconciler's `applyRepairs`
 * (one `PUT`). A step for a ruleset to create is one `POST` of the payload the
 * reconciler built.
 * @param repository - `owner/name`
 * @param gh - A runner allowed to write
 * @param actions - The planned steps
 * @param modules - The shipped scripts
 * @returns One line per step the platform refused; empty when all were kept
 */
export function sendChange(
  repository: string,
  gh: GhRunner,
  actions: readonly RepairAction[],
  modules: ProtectionModules
): readonly string[] {
  return actions.flatMap(action => {
    if (action.rulesetId !== null && action.rulesetId !== undefined) {
      return modules.reconcile
        .applyRepairs({ repo: repository, gh, plan: [action] })
        .filter(outcome => !outcome.applied)
        .map(outcome => outcome.note ?? "The platform refused the change.");
    }
    const created = gh(
      ["api", "-X", "POST", `repos/${repository}/rulesets`, "--input", "-"],
      { input: JSON.stringify(action.payload) }
    );
    return created.ok
      ? []
      : [
          `${created.stdout}\n${created.stderr}`.trim() ||
            "The platform refused the change.",
        ];
  });
}
