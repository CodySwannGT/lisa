/**
 * Pins how `🔒 Skipped Required Checks` is wired to see the OUTCOMES it judges.
 *
 * The prover's outcome arm is only as honest as its inputs, and every way those
 * inputs can rot produces a job that runs, prints, and is green over less than
 * it claims. A sibling missing from `needs:` reports no result. A name missing
 * from `LISA_JOB_NAMES` makes its required context invisible. A condition that
 * can skip this job silences the check on silenced checks. A prover taken from
 * the caller's pinned `scripts/` may predate `--outcomes` altogether. None of
 * those fails any other test.
 *
 * The workflow is READ rather than restated, so nothing listed here can drift
 * from it.
 *
 * @module tests/integration/skipped-required-checks-outcome-wiring
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  loadWorkflow,
  type WorkflowJob,
} from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The guard's job id. */
const GUARD = "skipped_required_checks";

/** Where the job checks the prover out. */
const PROVER_CHECKOUT = ".lisa-workflow-source";

/** The identity stamp, whose own control forbids a dependant that can fail. */
const IDENTITY = "lisa_identity";

/**
 * The one job the guard deliberately does not need.
 *
 * Named rather than derived, so removing the reason means editing this list.
 * `gate-output-names-its-lisa.test.ts` requires every job that needs the stamp
 * to be unable to fail, which is the opposite of this job's purpose.
 */
const NOT_NEEDED: readonly string[] = [IDENTITY];

/** A job as this file reads it: the shared shape plus `needs`. */
type Job = WorkflowJob & { needs?: string | string[] };

const jobs = loadWorkflow(
  path.join(REPO_ROOT, ".github", "workflows", "quality.yml")
).jobs as Record<string, Job>;
const guard = jobs[GUARD];
const siblings = Object.keys(jobs).filter(id => id !== GUARD);
const judged = siblings.filter(id => !NOT_NEEDED.includes(id));
const guardStep = guard?.steps?.find(step =>
  step.run?.includes("check-skipped-required-checks.mjs")
);

/**
 * A job's `needs`, normalised to a list.
 *
 * @param job - The job
 * @returns Job ids it needs
 */
function needsOf(job: Job | undefined): string[] {
  if (job?.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * The display name GitHub gives a job.
 *
 * @param id - Job id
 * @returns Its `name:`, or the id when none is set
 */
function nameOf(id: string): string {
  return String(jobs[id]?.name ?? id);
}

/**
 * The job-name map the workflow hands the prover.
 *
 * @returns Job id → display name
 */
function handedNames(): Record<string, string> {
  return JSON.parse(String(guardStep?.env?.LISA_JOB_NAMES ?? "")) as Record<
    string,
    string
  >;
}

describe("🔒 Skipped Required Checks sees every outcome it judges", () => {
  it("exists, with a step that runs the prover", () => {
    expect(guard).toBeDefined();
    expect(guardStep).toBeDefined();
    // Guards every clause below against a parse that found almost nothing.
    expect(siblings.length).toBeGreaterThan(20);
  });

  it("needs every other job it may judge, so each result is final when it runs", () => {
    const byName = (left: string, right: string): number =>
      left.localeCompare(right);
    expect([...needsOf(guard)].sort(byName)).toEqual([...judged].sort(byName));
  });

  it("gives up nothing by not needing the identity stamp", () => {
    // The exclusion is forced by that job's own control, so what it costs is
    // asserted rather than assumed: the stamp carries no `if:`, so it cannot be
    // skipped, and a context it posted could never be silenced the way this arm
    // looks for. If it ever grows a condition, this fails and the trade is back
    // on the table.
    expect(NOT_NEEDED).toEqual([IDENTITY]);
    expect(jobs[IDENTITY]).toBeDefined();
    expect(jobs[IDENTITY]?.if).toBeUndefined();
    expect(needsOf(jobs[IDENTITY])).toEqual([]);
  });

  it("cannot be skipped by a sibling — `always()`, and nothing else", () => {
    expect(guard?.if).toBe("always()");
  });

  it("is needed by no job, so the edge cannot form a cycle", () => {
    for (const id of siblings) {
      expect(needsOf(jobs[id]), id).not.toContain(GUARD);
    }
  });

  it("names every needed job whose name is static — and only those", () => {
    const names = handedNames();
    expect(names).toEqual(
      Object.fromEntries(
        judged
          .filter(id => !nameOf(id).includes("${{"))
          .map(id => [id, nameOf(id)])
      )
    );
    // What is left out must be left out for a stated reason, not forgotten:
    // either its name is a runtime expression, or it is the identity stamp.
    for (const id of siblings.filter(sibling => !(sibling in names))) {
      if (NOT_NEEDED.includes(id)) continue;
      expect(nameOf(id), id).toContain("${{");
    }
  });

  it("hands over no two names that one context could match", () => {
    const names = Object.values(handedNames());
    expect(new Set(names).size).toBe(names.length);
    for (const outer of names) {
      for (const inner of names) {
        if (outer === inner) continue;
        expect(
          outer.endsWith(` / ${inner}`),
          `"${outer}" ends with " / ${inner}"`
        ).toBe(false);
      }
    }
  });

  it("passes results, names and moment through env, never into run", () => {
    expect(guardStep?.env?.LISA_JOB_RESULTS).toBe("${{ toJSON(needs) }}");
    expect(guardStep?.env?.LISA_GATE_MOMENT).toBe("${{ inputs.moment }}");
    expect(guardStep?.run).toContain("--outcomes");
    expect(guardStep?.run).not.toContain("${{");
  });

  it("takes the prover from the workflow's own side, not the caller's pin", () => {
    const checkout = guard?.steps?.find(
      step => step.with?.path === PROVER_CHECKOUT
    );
    expect(checkout?.uses).toMatch(/^actions\/checkout@/u);
    expect(checkout?.with?.repository).toBe("CodySwannGT/lisa");
    expect(checkout?.with?.ref).toBe("main");
    // Skipped in THIS repository, where the workspace already holds the prover
    // at the revision under test — so a change to it is proved by the pull
    // request that makes it, rather than by a copy fetched from `main`.
    expect(String(checkout?.if)).toContain(
      "hashFiles('typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs') == ''"
    );
    expect(guardStep?.run).toContain(
      "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs"
    );
    expect(guardStep?.run).toContain(`.lisa-workflow-source/$template`);
    // No read of the caller's installed copy survives anywhere in the step.
    expect(guardStep?.run).not.toMatch(
      /(?:^|[\s="'])scripts\/check-skipped-required-checks\.mjs/mu
    );
  });
});
