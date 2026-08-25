/**
 * Operator-readable reports for the prune verbs.
 *
 * Every candidate appears in the output, kept ones included, with the reason it
 * was kept, and nothing is ever truncated.
 *
 * The harder half is the EMPTY case. A verb that finds nothing and exits 0 in
 * silence is indistinguishable from one that did not run, one that found
 * nothing because its probe failed, and one that found candidates and printed
 * none — and the operator has no way to tell those apart. So both reports
 * always open by naming the scope they searched and how much was in it, and
 * always close with an explicit "N of M are candidates" verdict. An empty
 * inspection and a clean tree must never print the same thing.
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

/** Closing line when a dry run performed nothing. */
const DRY_RUN_SUFFIX =
  "This was a dry run — nothing was changed. Re-run with --apply to perform it.";

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
 * Close the worktree report with an explicit candidate count.
 *
 * The zero cases are spelled out separately rather than folded into one
 * "0 of N" line, because "there was nothing to look at", "everything was
 * refused on its merits", and "nothing could be assessed at all" are three
 * different situations that call for three different operator responses.
 * @param plan - Plan produced by the prune verb
 * @param applied - Whether removals were actually performed
 * @returns Closing line
 */
function summarizeWorktreePlan(
  plan: WorktreePrunePlan,
  applied: boolean
): string {
  const inspected = plan.verdicts.length;
  const eligible = plan.verdicts.filter(verdict => verdict.eligible).length;
  if (inspected === 0) {
    return (
      `No worktrees are registered for ${plan.repoPath}, so there was nothing ` +
      "to assess. This is an empty inspection, not a clean result."
    );
  }
  if (!plan.livenessAvailable) {
    return (
      `0 of ${inspected} worktrees are candidates: every one was refused ` +
      "because the live-process probe could not run, so NOTHING here was " +
      "assessed on its merits."
    );
  }
  if (eligible === 0) {
    return (
      `0 of ${inspected} worktrees are candidates — each was refused for the ` +
      "reason named on its line above."
    );
  }
  return applied
    ? `Removed ${eligible} of ${inspected} worktrees.`
    : `${eligible} of ${inspected} worktrees are candidates. ${DRY_RUN_SUFFIX}`;
}

/**
 * Close the stash report with an explicit candidate count.
 * @param plan - Plan produced by the stash prune verb
 * @param applied - Whether drops were actually performed
 * @returns Closing line
 */
function summarizeStashPlan(plan: StashPrunePlan, applied: boolean): string {
  const inspected = plan.verdicts.length;
  const eligible = plan.verdicts.filter(verdict => verdict.eligible).length;
  if (inspected === 0) {
    return (
      `No stash entries exist in ${plan.repoPath}, so there was nothing to ` +
      "assess. This is an empty inspection, not a clean result."
    );
  }
  if (eligible === 0) {
    return (
      `0 of ${inspected} stash entries are candidates — each was kept for the ` +
      "reason named on its line above."
    );
  }
  return applied
    ? `Dropped ${eligible} of ${inspected} stash entries. Each was first ` +
        "anchored under refs/lisa/pruned-stashes/<sha> and can be restored " +
        "with `git stash apply <ref>`."
    : `${eligible} of ${inspected} stash entries are candidates. ${DRY_RUN_SUFFIX}`;
}

/**
 * Render the worktree plan for a human.
 *
 * Never returns an empty list. The opening line names the scope and the count
 * inspected even when that count is zero, so the operator can always tell the
 * verb ran.
 * @param plan - Plan produced by the prune verb
 * @param applied - Whether removals were actually performed
 * @returns Report lines
 */
export function renderWorktreePlan(
  plan: WorktreePrunePlan,
  applied: boolean
): readonly string[] {
  return [
    `Inspected ${plan.verdicts.length} worktree(s) registered for ${plan.repoPath}.`,
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
    summarizeWorktreePlan(plan, applied),
  ];
}

/**
 * Render the stash plan for a human.
 *
 * Never returns an empty list, for the same reason as the worktree report.
 * @param plan - Plan produced by the stash prune verb
 * @param applied - Whether drops were actually performed
 * @returns Report lines
 */
export function renderStashPlan(
  plan: StashPrunePlan,
  applied: boolean
): readonly string[] {
  return [
    `Inspected ${plan.verdicts.length} stash entr(ies) in ${plan.repoPath}.`,
    ...plan.verdicts.map(describeStashVerdict),
    summarizeStashPlan(plan, applied),
  ];
}
