/** Pure ownership decision shared by Lisa apply and deterministic health. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed private helpers are self-describing */
import type { CopyStrategy } from "./config.js";

const CREATE_ONLY = "create-only";
const COPY_OVERWRITE = "copy-overwrite";

/** Inputs required to route one template candidate. */
export interface TemplateOwnershipInput {
  readonly relativePath: string;
  readonly strategy: CopyStrategy;
  readonly currentType: string;
  readonly orderedTypes: readonly string[];
  readonly ignored: boolean;
  readonly pendingDeletion: boolean;
  readonly projectLearningsPath: string | undefined;
  readonly suppressLearningsSeed: boolean;
  readonly createOnlyOwner: string | undefined;
  readonly copyOverwriteOwner: string | undefined;
}

/** Stable reason why apply and health omit a template candidate. */
export type TemplateSkipReason =
  | "ignored"
  | "suppressed-learnings-seed"
  | "pending-deletion"
  | "project-learnings-owned"
  | "create-only-override"
  | "create-only-cross-owner"
  | "copy-overwrite-override";

/** Pure routing decision for one template candidate. */
export type TemplateOwnershipDecision =
  | { readonly process: true }
  | {
      readonly process: false;
      readonly reason: TemplateSkipReason;
      readonly owner?: string;
    };

/**
 * Apply Lisa's exact ignore, deletion, learnings, and ownership precedence.
 * @param input - Candidate plus precomputed project ownership state
 * @returns Whether the candidate is applicable and, when omitted, why
 */
export function decideTemplateOwnership(
  input: TemplateOwnershipInput
): TemplateOwnershipDecision {
  if (input.ignored) return { process: false, reason: "ignored" };
  const isLearnings =
    input.projectLearningsPath !== undefined &&
    input.relativePath === input.projectLearningsPath;
  if (
    isLearnings &&
    input.strategy === CREATE_ONLY &&
    input.suppressLearningsSeed
  ) {
    return { process: false, reason: "suppressed-learnings-seed" };
  }
  if (input.pendingDeletion && !isLearnings) {
    return { process: false, reason: "pending-deletion" };
  }
  if (isLearnings && input.strategy !== CREATE_ONLY) {
    return { process: false, reason: "project-learnings-owned" };
  }
  const createOnlyDecision = createOnlyOwnership(input);
  if (createOnlyDecision !== undefined) return createOnlyDecision;
  if (input.strategy !== COPY_OVERWRITE) return { process: true };
  return copyOverwriteOwnership(input);
}

/**
 * Resolve same-strategy create-only ownership.
 * @param input - Ownership inputs
 * @returns Skip decision when another stack owns the path
 */
function createOnlyOwnership(
  input: TemplateOwnershipInput
): TemplateOwnershipDecision | undefined {
  return input.strategy === CREATE_ONLY &&
    input.createOnlyOwner !== undefined &&
    input.createOnlyOwner !== input.currentType
    ? {
        process: false,
        reason: "create-only-override",
        owner: input.createOnlyOwner,
      }
    : undefined;
}

/**
 * Resolve cross-strategy and same-strategy overwrite ownership.
 * @param input - Ownership inputs
 * @returns Process or skip decision
 */
function copyOverwriteOwnership(
  input: TemplateOwnershipInput
): TemplateOwnershipDecision {
  if (
    input.createOnlyOwner !== undefined &&
    input.createOnlyOwner !== input.currentType &&
    isMoreSpecific(input.createOnlyOwner, input.currentType, input.orderedTypes)
  ) {
    return {
      process: false,
      reason: "create-only-cross-owner",
      owner: input.createOnlyOwner,
    };
  }
  if (
    input.copyOverwriteOwner !== undefined &&
    input.copyOverwriteOwner !== input.currentType
  ) {
    return {
      process: false,
      reason: "copy-overwrite-override",
      owner: input.copyOverwriteOwner,
    };
  }
  return { process: true };
}

/**
 * Render one stable human-readable skip reason.
 * @param decision - Skip decision
 * @returns Stable operator-facing reason
 */
export function templateSkipDescription(
  decision: Exclude<TemplateOwnershipDecision, { readonly process: true }>
): string {
  const owner = decision.owner;
  switch (decision.reason) {
    case "suppressed-learnings-seed":
      return "legacy learnings ledger pending relocation";
    case "pending-deletion":
      return "pending deletion by detected type";
    case "project-learnings-owned":
      return "owned by all/create-only";
    case "create-only-override":
      return `overridden by ${owner}/create-only`;
    case "create-only-cross-owner":
      return `owned by ${owner}/create-only`;
    case "copy-overwrite-override":
      return `overridden by ${owner}/copy-overwrite`;
    case "ignored":
      return "ignored";
  }
}

/**
 * Parse one trusted deletions manifest using Lisa's paths-minus-keep contract.
 * @param candidate - Parsed deletions.json value
 * @returns Paths that remain pending deletion
 */
export function pendingDeletionPaths(candidate: unknown): readonly string[] {
  if (candidate === null || typeof candidate !== "object") return [];
  const paths = Reflect.get(candidate, "paths");
  const keep = Reflect.get(candidate, "keep");
  if (!Array.isArray(paths) || !paths.every(path => typeof path === "string")) {
    return [];
  }
  const kept = new Set(
    Array.isArray(keep) ? keep.filter(item => typeof item === "string") : []
  );
  return paths.filter(path => !kept.has(path));
}

/**
 * Compare canonical stack specificity.
 * @param candidate - Candidate stack type
 * @param current - Current stack type
 * @param orderedTypes - Canonical stack order
 * @returns Whether the candidate is more specific
 */
function isMoreSpecific(
  candidate: string,
  current: string,
  orderedTypes: readonly string[]
): boolean {
  return orderedTypes.indexOf(candidate) > orderedTypes.indexOf(current);
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
