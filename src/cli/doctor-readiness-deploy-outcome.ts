/**
 * Report a deploy job that goes SILENT when its release fails
 * (CodySwannGT/lisa#3740).
 *
 * ## What this reports and what actually repairs it
 *
 * #3467 fixed the shape in Lisa's deploy templates, and #3738 shipped that fix.
 * Those templates are `create-only` — Lisa seeds the file once and never
 * overwrites it — so the fix reaches new adoptions and nothing else. The
 * `ensure-deploy-outcome-guard` migration is what repairs an already-seeded
 * `deploy.yml`; this finding is its reporting complement, covering the files
 * that migration deliberately declines: a workflow whose condition it cannot
 * rewrite without guessing, and a postinstall-mode run, where rewriting a
 * reviewed, checked-in declaration is not something a dependency install gets
 * to do.
 *
 * A finding here therefore means one of two things, and the operator does not
 * need to know which: either the migration has not run yet, or it looked and
 * decided this file was not one it could safely edit.
 *
 * ## Why this is NOT a ship blocker, decided rather than defaulted
 *
 * `doctor-readiness-blockers.ts` maps findings to a deliberately closed set of
 * seven blockers, and #3740 required whoever implemented it to say, explicitly,
 * which of three things this is. It reports as a **non-blocking readiness
 * observation**, carrying no `blocker` key, for a reason that is about the
 * property rather than about convenience:
 *
 * None of the seven describes it. B2 is "a release path bypasses the validated
 * artifact" — nothing ships here at all, so nothing bypasses validation. B4 is
 * "a consequential operation has no gate and no recovery", and the deploy has
 * both; what it lacks is a *report*. The defect is the observability of a
 * non-event, which the v1 rubric simply does not have a blocker for.
 *
 * Opening the closed set is a rule edit to `readiness-rubric` (intake decision
 * O4) and is not something a reporting change gets to do as a side effect —
 * which is exactly why #3740 called it out rather than letting it be smuggled
 * in. Reporting it non-blocking is honest about the evidence: it is real,
 * it is actionable, and it does not on its own make "an unattended fleet may
 * run here" false, because the migration repairs the ordinary case.
 * @module cli/doctor-readiness-deploy-outcome
 */
import { deployJobsSkippedByFailedRelease } from "../core/deploy-release-dependence.js";
import type { ParsedWorkflow } from "./doctor-readiness-workflows.js";

/**
 * The remediation, written for whoever is standing at the gate.
 *
 * Deliberately free of GitHub Actions vocabulary beyond the two words that name
 * the thing to edit. #3740 makes this an acceptance criterion, and the reason is
 * the factory's own: everything that crosses a gate outward is read by an
 * operator who is not an engineer, and a remediation they cannot act on is a
 * finding that stays open.
 */
const REMEDIATION =
  "Right now, if the release step fails, this deploy is quietly stepped over " +
  "and the run still looks green — so nobody is told that the new version " +
  "never went out. Make the deploy run anyway and stop with a clear error " +
  "instead: in the deploy job add `if: ${{ !cancelled() }}` to its conditions, " +
  "and make its first step check whether the release succeeded and fail with a " +
  "message when it did not. Lisa's own deploy templates show the exact wording, " +
  "and `lisa` normally makes this edit for you on your next update.";

/**
 * Describe one skipping deploy job as an evidence line.
 * @param workflow - Repo-relative workflow path
 * @param job - The deploy job's id
 * @param release - The release job whose failure skips it
 * @returns A single operator-readable observation
 */
function observation(workflow: string, job: string, release: string): string {
  return (
    `${workflow} job \`${job}\` is skipped rather than failed when \`${release}\` ` +
    "does not succeed. A skipped job shows as neutral and counts as a satisfied " +
    `required check, so a deploy that never happened reports nothing. ${REMEDIATION}`
  );
}

/**
 * Find every deploy job across the repository that goes silent on a failed
 * release.
 * @param workflows - Parsed workflows
 * @returns One observation per affected job, in workflow order
 */
export function deployOutcomeObservations(
  workflows: readonly ParsedWorkflow[]
): readonly string[] {
  return workflows.flatMap(workflow =>
    deployJobsSkippedByFailedRelease(
      workflow.jobs.map(job => ({
        id: job.id,
        name: job.name,
        needs: job.needs,
        ifCondition: job.ifCondition,
        environment: job.environment,
      }))
    ).map(found => observation(workflow.file, found.job.id, found.release))
  );
}
