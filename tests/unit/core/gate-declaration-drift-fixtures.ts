/**
 * Owners, enforced contexts and the names both drift suites are written in.
 *
 * Shared rather than duplicated because the two suites assert about the SAME
 * rename. `gate-declaration-drift` proves the general verdict table;
 * `gate-declaration-drift-retirement` proves the one verdict #3067 added. A
 * second copy of `retiredOwner` is how those two accounts of a rename start
 * disagreeing about what a rename looks like.
 *
 * Not a `.test.ts` file, deliberately — nothing here asserts.
 * @module tests/unit/core/gate-declaration-drift-fixtures
 */
import type { ContextOwner } from "../../../src/core/gate-context-owners.js";
import type { EnforcedContext } from "../../../src/core/gate-declaration-drift.js";

export const WORKFLOW = "🔍 Quality Checks";
export const SECURITY = `${WORKFLOW} / 🔒 Security Scan`;
export const LINT = `${WORKFLOW} / 🧹 Lint`;
export const TEMPLATE = "typescript/github-rulesets/quality-checks.json";
export const QUALITY_CHECKS = "quality checks";
export const CODERABBIT = "CodeRabbit";
export const TEMPLATES_SURFACE = "ruleset-templates";
export const LIVE_SURFACE = "live-ruleset";
export const REQUIRED = "required";
export const OFF = "off";
export const NOT_DECLARED = "not-declared";
export const DEPENDENCY_VULNERABILITY = "dependency-vulnerability";
export const ENFORCED_UNDECLARED = "enforced-undeclared";
/** The context 4.x renamed away, and the one the same job posts now. */
export const AST_GREP = `${WORKFLOW} / 🔎 AST Grep Scan`;
export const STRUCTURAL = `${WORKFLOW} / 🔎 Structural Rules`;
export const STRUCTURAL_RULES = "structural-rules";
export const RETIRED_VERDICT = "enforced-context-retired";
export const REMOVAL_REMEDY = "stop-requiring-the-retired-context";
/** The hand-made ruleset in #3067 — one Lisa does not manage. */
export const HAND_MADE = "enforce pr rules";
export const LIVE_SOURCE = "the repository’s live rulesets";
export const NOT_LISA_OWNED = "enforced-not-lisa-owned";
export const AWAITED_ELSEWHERE = "enforced-awaited-elsewhere";
export const LINT_LABEL = "🧹 Lint";
export const REVIEW_LABEL = "🤖 Code Review";
export const PULL_REQUEST = "pull-request";

/**
 * An owner for the retired half of a rename, at a given declaration.
 * @param declaration - What the settings file says about the gate
 * @returns The owner
 */
export function retiredOwner(
  declaration: ContextOwner["declaration"]
): ContextOwner {
  return {
    gateId: STRUCTURAL_RULES,
    declaration,
    legalAtMerge: true,
    retired: { label: "🔎 AST Grep Scan", replacement: STRUCTURAL },
    awaitedInstead: null,
  };
}

/**
 * An owner for a live label, at a given declaration.
 * @param declaration - What the settings file says about the gate
 * @returns The owner
 */
export function plainOwner(
  declaration: ContextOwner["declaration"]
): ContextOwner {
  return {
    gateId: STRUCTURAL_RULES,
    declaration,
    legalAtMerge: true,
    retired: null,
    awaitedInstead: null,
  };
}

/**
 * An owner for the facade name of a gate whose declaration awaits a signal.
 *
 * The context this owner is keyed by is NOT what the declaration promises —
 * the awaited signal's own name is, and it carries its own owner. See
 * `ContextOwner.awaitedInstead`.
 * @param declaration - What the settings file says about the gate
 * @param awaits - The signal the declaration awaits instead
 * @returns The owner
 */
export function awaitingOwner(
  declaration: ContextOwner["declaration"],
  awaits: string = CODERABBIT
): ContextOwner {
  return {
    gateId: "code-review",
    declaration,
    legalAtMerge: true,
    retired: null,
    awaitedInstead: awaits,
  };
}

/**
 * One enforced context, attributed to a template file.
 * @param context - The context string
 * @returns The enforced context
 */
export function fromTemplate(context: string): EnforcedContext {
  return { context, ruleset: QUALITY_CHECKS, source: TEMPLATE };
}

/**
 * Owners for a fixed set of contexts.
 * @param entries - Context to declaration
 * @returns The owner map
 */
export function owners(
  entries: Readonly<Record<string, ContextOwner["declaration"]>>
): ReadonlyMap<string, ContextOwner> {
  return new Map(
    Object.entries(entries).map(([context, declaration]) => [
      context,
      {
        gateId: `gate-for-${context}`,
        declaration,
        legalAtMerge: true,
        retired: null,
        awaitedInstead: null,
      },
    ])
  );
}
