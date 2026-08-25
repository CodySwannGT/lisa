/**
 * Operator-readable reports for the prune verbs.
 *
 * Every candidate appears in the output, kept ones included, with the reason it
 * was kept. A cleaner that silently leaves things behind is as hard to trust as
 * one that silently takes them: the operator cannot tell "nothing was eligible"
 * from "the check never ran". Nothing here truncates the list for that reason.
 * @module cli/prune-report
 */
import {
  STASH_BLOCKER_EXPLANATIONS,
  type StashVerdict,
} from "./stash-prune-policy.js";
import type { StashPrunePlan } from "./stash-prune.js";
import type { WorktreePrunePlan } from "./worktree-prune.js";
import {
  BLOCKER_EXPLANATIONS,
  type WorktreeVerdict,
} from "./worktree-prune-policy.js";

/**
 * Describe one worktree verdict in a single line.
 * @param verdict - Verdict for one worktree
 * @returns Report line
 */
export function describeWorktreeVerdict(verdict: WorktreeVerdict): string {
  return verdict.eligible
    ? `  REMOVE  ${verdict.path}`
    : `  KEEP    ${verdict.path} — ${verdict.blockers
        .map(blocker => BLOCKER_EXPLANATIONS[blocker])
        .join("; ")}`;
}

/**
 * Describe one stash verdict in a single line.
 * @param verdict - Verdict for one stash entry
 * @returns Report line
 */
export function describeStashVerdict(verdict: StashVerdict): string {
  const label = `stash@{${verdict.index}} ${verdict.sha.slice(0, 8)}`;
  return verdict.eligible
    ? `  DROP    ${label} — ${verdict.redundancy ?? "redundant"}`
    : `  KEEP    ${label} — ${verdict.blockers
        .map(blocker => STASH_BLOCKER_EXPLANATIONS[blocker])
        .join("; ")}`;
}

/**
 * Render the worktree plan for a human.
 * @param plan - Plan produced by the prune verb
 * @param applied - Whether removals were actually performed
 * @returns Report lines
 */
export function renderWorktreePlan(
  plan: WorktreePrunePlan,
  applied: boolean
): readonly string[] {
  const eligible = plan.verdicts.filter(verdict => verdict.eligible).length;
  return [
    `${plan.verdicts.length} worktree(s) registered for ${plan.repoPath}.`,
    ...(plan.livenessAvailable
      ? []
      : [
          "The live-process probe could not run, so NOTHING is eligible. This " +
            "is unassessed, not clean: without it a worktree another agent is " +
            "working in right now is indistinguishable from an abandoned one.",
        ]),
    ...plan.verdicts.map(describeWorktreeVerdict),
    ...(plan.prunableRegistrations.length > 0
      ? [
          `${plan.prunableRegistrations.length} registration(s) point at a directory that is already gone and will be forgotten.`,
        ]
      : []),
    applied
      ? `${eligible} worktree(s) removed.`
      : `${eligible} worktree(s) would be removed. This was a dry run — re-run with --apply to perform it.`,
  ];
}

/**
 * Render the stash plan for a human.
 * @param plan - Plan produced by the stash prune verb
 * @param applied - Whether drops were actually performed
 * @returns Report lines
 */
export function renderStashPlan(
  plan: StashPrunePlan,
  applied: boolean
): readonly string[] {
  const eligible = plan.verdicts.filter(verdict => verdict.eligible).length;
  return [
    `${plan.verdicts.length} stash entr(ies) in ${plan.repoPath}.`,
    ...plan.verdicts.map(describeStashVerdict),
    applied
      ? `${eligible} entr(ies) dropped. Each one was first anchored under refs/lisa/pruned-stashes/<sha> and can be restored with \`git stash apply <ref>\`.`
      : `${eligible} entr(ies) would be dropped. This was a dry run — re-run with --apply to perform it.`,
  ];
}
