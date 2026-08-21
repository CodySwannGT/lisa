/**
 * Hold the gates declaration against each surface that enforces it.
 *
 * Split from the report builder so neither half can quietly acquire the
 * other's shape. The builder decides WHAT to read; this module decides what a
 * reading means — and, more importantly, what an unreading means. A surface
 * this run could not reach returns its own `unknown` unchanged rather than a
 * comparison of the little that was read, because a comparison against nothing
 * would report every declaration as enforcing nothing, which is a false claim
 * rather than a missing one.
 * @module cli/gate-report-drift
 */
import {
  classifyDeclarationDrift,
  contextOwners,
  type DeclarationDriftReport,
  type DriftSurface,
  type EnforcedContext,
} from "../core/gate-declaration-drift.js";
import type { GateRegistryModule } from "./gate-report-registry.js";
import type { Finding } from "./gate-report-types.js";

/**
 * The workflow whose name prefixes a run gate's status context.
 *
 * A ruleset names contexts by exact string, so there is exactly one of these
 * and every caller imports it. Two copies would be two answers to what a
 * required context is called, and the wrong one would be the copy nobody
 * measured.
 */
export const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";

/**
 * Hold the declaration against one enforcing surface.
 *
 * The surface's own `unknown` is returned unchanged rather than replaced with a
 * comparison of what little was read. A run that could not reach a surface has
 * not compared anything, and saying so is the whole contract.
 * @param options - Inputs
 * @param options.surface - Which surface `enforced` came from
 * @param options.registry - The shipped registry
 * @param options.gates - The gates block
 * @param options.enforced - What the surface requires, or why it is unknown
 * @returns The comparison, or the surface's unknown
 */
export function driftAgainst(options: {
  surface: DriftSurface;
  registry: GateRegistryModule;
  gates: Record<string, unknown>;
  enforced: Finding<readonly EnforcedContext[]>;
}): Finding<DeclarationDriftReport> {
  const { surface, registry, gates, enforced } = options;
  if (enforced.state !== "verified") return enforced;
  return {
    state: "verified",
    value: classifyDeclarationDrift({
      surface,
      owners: contextOwners({
        registry,
        gates,
        workflowName: QUALITY_WORKFLOW_NAME,
      }),
      enforced: enforced.value,
    }),
  };
}

/**
 * The live required contexts, restated as attributed enforcement.
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
