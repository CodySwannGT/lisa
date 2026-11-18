/**
 * Deciding, by reading only, which entries a before-enforce run can
 * exercise.
 *
 * What can be exercised is exactly what a paired proof needs, so the same
 * plan decides it (`./proof-plan.ts`): a commit or push enforcement point, a
 * command that measures the entry, and both patch files. One more is left
 * out here: an entry declared optional at its moment, which reports and
 * never refuses anything, so there is no refusal to look for before or
 * after the enforce step.
 *
 * Everything is settled before a clone is made. An entry that cannot be
 * exercised gets its result here, with the reason in plain words, and no
 * file is touched for it.
 * @module controls/before-enforce-plan
 */
import {
  NOT_EXERCISED_REASONS,
  type BeforeEnforceEntry,
  type BeforeEnforceReason,
} from "./before-enforce-types.js";
import {
  notExercisedDetail,
  optionalDetail,
} from "./before-enforce-wording.js";
import { planProof, proofPoint, type RunnableProof } from "./proof-plan.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "./register-types.js";

/** An entry's plan: its result when nothing is tried, or what to try. */
export type BeforeEnforcePlan =
  | { readonly exercise: false; readonly entry: BeforeEnforceEntry }
  | { readonly exercise: true; readonly proof: RunnableProof };

/** What planning is given beside the register. */
export interface BeforeEnforcePlanContext {
  /** Real path of the repository the patch files are read from. */
  readonly root: string;
  /** Whether proofs that say they reach outside the repository may run. */
  readonly acknowledgeExternalEffects: boolean;
}

/** The fields every result of one entry carries. */
export type NamedEntry = Pick<
  BeforeEnforceEntry,
  "entry_id" | "gate" | "scope" | "criteria" | "moment"
>;

/**
 * The fields every result of one entry carries.
 * @param entry - The register entry
 * @param moment - The moment that was, or would be, triggered
 * @returns The fields
 */
export function namedEntry(
  entry: ControlRegisterEntry,
  moment: string | null
): NamedEntry {
  return {
    entry_id: entry.id,
    gate: entry.gate,
    scope: entry.scope,
    criteria: entry.criteria,
    moment,
  };
}

/**
 * The result of an entry nothing is tried for.
 * @param named - Which entry, and its moment
 * @param reason - Why nothing is tried
 * @param detail - The same as a sentence
 * @returns The plan
 */
function settled(
  named: NamedEntry,
  reason: BeforeEnforceReason,
  detail: string
): BeforeEnforcePlan {
  return {
    exercise: false,
    entry: {
      ...named,
      result: "not-exercised",
      reason,
      detail,
      canary: null,
      tool: null,
    },
  };
}

/**
 * Decide whether one entry can be exercised.
 * @param entry - The register entry
 * @param context - The repository, and whether outside effects are allowed
 * @returns What to try, or the entry's result when nothing is tried
 */
async function planEntry(
  entry: ControlRegisterEntry,
  context: BeforeEnforcePlanContext
): Promise<BeforeEnforcePlan> {
  const point = proofPoint(entry);
  if (point?.level === "optional") {
    return settled(
      namedEntry(entry, point.moment),
      "optional-at-moment",
      optionalDetail(point.moment)
    );
  }
  const plan = await planProof(entry, context);
  if (plan.run) return { exercise: true, proof: plan };
  const reason: BeforeEnforceReason =
    NOT_EXERCISED_REASONS.find(known => known === plan.result.reason) ??
    "no-proof-moment";
  return settled(
    namedEntry(entry, plan.result.moment),
    reason,
    notExercisedDetail(plan.result.detail, reason === "half-missing")
  );
}

/**
 * Decide for every entry of a register whether it can be exercised. Nothing
 * is changed anywhere.
 * @param register - The control register
 * @param context - The repository, and whether outside effects are allowed
 * @returns One plan per entry, in register order
 */
export async function planBeforeEnforce(
  register: ControlRegister,
  context: BeforeEnforcePlanContext
): Promise<readonly BeforeEnforcePlan[]> {
  return Promise.all(register.entries.map(entry => planEntry(entry, context)));
}
