/**
 * The joins between one project's declarations and the world outside it.
 *
 * Three of them, and each is a place two sources of truth are compared for the
 * first time: the ruleset against the declaration (#2854's finding — nothing
 * compares these today, so they are only ever equal by hand), every required
 * context against who owns it, and one gate's implied context against the
 * moment a ruleset can actually guard.
 *
 * Kept out of the report assembly because the assembly is a list of steps and
 * these are the reasoning. Every one of them carries an unknown through rather
 * than resolving it: a run that could not read branch protection has nothing to
 * compare, and an empty comparison would report agreement.
 * @module cli/gate-report-joins
 */
import {
  contextOwners,
  type ContextOwner,
} from "../core/gate-context-owners.js";
import {
  classifyDeclarationDrift,
  type DeclarationDriftReport,
  type DriftSurface,
  type EnforcedContext,
} from "../core/gate-declaration-drift.js";
import {
  classifyRequiredContexts,
  lisaContextUniverse,
} from "./gate-report-contexts.js";
import type { FacadeFacts } from "./gate-report-facade.js";
import type { GateRegistryModule } from "./gate-report-registry.js";
import { compareContexts } from "./gate-report-ruleset.js";
import type {
  Finding,
  MergeBlock,
  RequiredContextRow,
  RulesetComparison,
} from "./gate-report-types.js";

/** Everything the joins need about this run. */
export interface JoinContext {
  /** The shipped registry. */
  readonly registry: GateRegistryModule;
  /** The project's gates block. */
  readonly gates: Record<string, unknown>;
  /** The live required contexts, or an unknown. */
  readonly contexts: Finding<readonly string[]>;
  /** What the project's own workflows say. */
  readonly facade: FacadeFacts;
  /** The moment a ruleset guards. */
  readonly mergeMoment: string;
  /** The workflow name a run gate's context is built from. */
  readonly workflowName: string;
}

/**
 * The contexts a gates block implies at the merge moment.
 * @param context - The join inputs
 * @returns The contexts, or null when the block cannot be resolved
 */
function declaredContexts(context: JoinContext): string[] | null {
  try {
    return context.registry.contextsFor(context.gates, {
      moment: context.mergeMoment,
      workflowName: context.workflowName,
    });
  } catch {
    return null;
  }
}

/**
 * The Tier 2 answer for one cell, never defaulted to a verdict.
 * @param context - The join inputs
 * @returns A resolver for one cell's expected context
 */
export function mergeBlockResolver(
  context: JoinContext
): (moment: string, expectedContext: string | null) => Finding<MergeBlock> {
  return (moment, expectedContext) => {
    if (moment !== context.mergeMoment) {
      return {
        state: "not-applicable",
        reason: "moment-produces-no-merge-context",
        message: `A ruleset guards a merge, and only the ${context.mergeMoment} gate set produces the status contexts it names. A declaration at ${moment} is enforced by a hook, not by branch protection.`,
      };
    }
    if (expectedContext === null) {
      return {
        state: "not-applicable",
        reason: "no-required-declaration",
        message:
          "Only a `required` declaration produces a status context, so there is nothing here for a ruleset to require.",
      };
    }
    if (context.contexts.state !== "verified") return context.contexts;
    const required = context.contexts.value.includes(expectedContext);
    return {
      state: "verified",
      value: { required, context: required ? expectedContext : null },
    };
  };
}

/**
 * The ruleset comparison, or the same unknown the contexts came back with.
 * @param context - The join inputs
 * @returns The comparison
 */
export function buildRulesetFinding(
  context: JoinContext
): Finding<RulesetComparison> {
  if (context.contexts.state !== "verified") return context.contexts;
  const declared = declaredContexts(context);
  if (declared === null) {
    return {
      state: "unknown",
      reason: "declarations-unresolvable",
      message:
        "The gates block could not be resolved, so the contexts it implies cannot be compared with the ruleset.",
    };
  }
  return {
    state: "verified",
    value: compareContexts(declared, context.contexts.value),
  };
}

/**
 * Every context a merge is blocked on, with who owns it.
 * @param context - The join inputs
 * @returns One row per required context, or the same unknown
 */
export function buildRequiredContexts(
  context: JoinContext
): Finding<readonly RequiredContextRow[]> {
  return classifyRequiredContexts(context.contexts, {
    declared: declaredContexts(context) ?? [],
    lisaUniverse: lisaContextUniverse({
      gateIds: Object.entries(context.registry.REGISTRY)
        .filter(([, gate]) => gate.moments.includes(context.mergeMoment))
        .map(([id]) => id),
      moment: context.mergeMoment,
      workflowName: context.workflowName,
      contextsFor: context.registry.contextsFor,
    }),
    projectContexts: context.facade.projectContexts,
  });
}

/**
 * Hold the declaration against one enforcing surface.
 *
 * The fourth join, and the one #2854 filed: `buildRulesetFinding` above says
 * WHICH contexts differ, and `buildRequiredContexts` says WHO owns each live
 * one, but neither says what the difference MEANS for the declaration that was
 * supposed to govern it. A gate declared `off` and a gate never declared at all
 * both show up as "required, not declared" in a set comparison, and they are
 * opposite problems: one is a contradiction, the other is silence.
 *
 * The surface's own `unknown` is returned unchanged rather than replaced with a
 * comparison of what little was read. A run that could not reach a surface has
 * not compared anything, and saying so is the whole contract.
 * @param context - The join inputs
 * @param surface - Which surface `enforced` came from
 * @param enforced - What the surface requires, or why it is unknown
 * @returns The comparison, or the surface's unknown
 */
export function buildDeclarationDrift(
  context: JoinContext,
  surface: DriftSurface,
  enforced: Finding<readonly EnforcedContext[]>
): Finding<DeclarationDriftReport> {
  if (enforced.state !== "verified") return enforced;
  const owners = declarationOwners(context);
  if (owners.state !== "verified") return owners;
  return {
    state: "verified",
    value: classifyDeclarationDrift({
      surface,
      owners: owners.value,
      enforced: enforced.value,
    }),
  };
}

/**
 * The context-to-gate map, or why it could not be built.
 *
 * Fails CLOSED, which is why it is a `Finding` rather than a map. A
 * declaration may name the chain of jobs its own prover is reached through,
 * and a chain that cannot be turned into a context leaves exactly two options:
 * report that nothing was compared, or fall back to the caller-wide name for a
 * gate whose declaration has just said that name is wrong. The second reports
 * agreement about a check that never reports — and a required check nothing
 * posts is the one failure nobody can see, because GitHub holds it at
 * "Expected — Waiting for status to be reported" instead of failing it.
 * @param context - The join inputs
 * @returns The owner map, or an unknown
 */
function declarationOwners(
  context: JoinContext
): Finding<ReadonlyMap<string, ContextOwner>> {
  try {
    return {
      state: "verified",
      value: contextOwners({
        registry: context.registry,
        gates: context.gates,
        workflowName: context.workflowName,
      }),
    };
  } catch (error) {
    return {
      state: "unknown",
      reason: "undeterminable-context",
      message: `A declaration's required context could not be determined: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The live required contexts, restated as attributed enforcement.
 *
 * The live reader answers with bare strings because that is all branch
 * protection gives it; the comparison wants to say WHERE a requirement was
 * read, so the attribution is added here rather than invented downstream.
 * @param contexts - Contexts read from the live ruleset, or an unknown
 * @returns The same finding, in the comparison's shape
 */
export function liveEnforcement(
  contexts: Finding<readonly string[]>
): Finding<readonly EnforcedContext[]> {
  if (contexts.state !== "verified") return contexts;
  return {
    state: "verified",
    value: contexts.value.map(context => ({
      context,
      ruleset: "the branch's live rules",
      source: "the repository's live branch protection",
    })),
  };
}
