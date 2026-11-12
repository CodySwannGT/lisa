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

/** The one comparison that makes a job pull-request-only. */
const PULL_REQUEST_ONLY_CONJUNCT = "github.event_name == 'pull_request'";

/**
 * A job condition split at one operator at parenthesis depth zero, `${{ }}`
 * stripped. An operator nested inside a parenthesised operand stays inside it.
 *
 * @param condition - A job's `if:`
 * @param operator - `&&` or `||`
 * @returns Each top-level operand, trimmed
 */
function splitTopLevel(condition: string, operator: "&&" | "||"): string[] {
  const body = condition
    .trim()
    .replace(/^\$\{\{/u, "")
    .replace(/\}\}$/u, "")
    .trim();
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && body.startsWith(operator, index)) {
      parts.push(body.slice(start, index).trim());
      start = index + operator.length;
    }
  }
  parts.push(body.slice(start).trim());
  return parts;
}

/** An event mention this test cannot classify without a deliberate decision. */
const UNDECIDED = "undecided";

/** A condition that requires `pull_request`. */
const PULL_REQUEST_ONLY = "pull-request-only";

/**
 * How a job's condition treats the event, decided strictly.
 *
 * `pull-request-only` only when the condition REQUIRES `pull_request`: the
 * condition has no top-level `||` (which binds looser than `&&`, so
 * `A && B || C` could run without A), the comparison is a top-level `&&`
 * conjunct, and it is the condition's only mention of `github.event_name`.
 * Any other mention is `undecided`, so the test asks for a deliberate
 * decision instead of guessing.
 *
 * @param condition - A job's `if:`, or empty
 * @returns The classification
 */
function eventShape(
  condition: string
): "none" | typeof PULL_REQUEST_ONLY | typeof UNDECIDED {
  const mentions = condition.split("github.event_name").length - 1;
  if (mentions === 0) return "none";
  const required =
    splitTopLevel(condition, "||").length === 1 &&
    splitTopLevel(condition, "&&").includes(PULL_REQUEST_ONLY_CONJUNCT);
  return mentions === 1 && required ? PULL_REQUEST_ONLY : UNDECIDED;
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

  it("names every needed job that runs only on pull requests — and only those (#4620)", () => {
    // A manual, push or scheduled run skips these jobs by their own `if:`, and
    // the prover excuses exactly the jobs listed here on those events. A job
    // that gains the condition without being listed reddens every manual run;
    // a job listed without the condition would have its skip excused while it
    // could have run. Derived from the conditions, so both directions fail.
    const byName = (left: string, right: string): number =>
      left.localeCompare(right);
    const listed = JSON.parse(
      String(guardStep?.env?.LISA_PULL_REQUEST_ONLY_JOBS ?? "")
    ) as string[];
    const shapes = needsOf(guard).map(
      id => [id, eventShape(String(jobs[id]?.if ?? ""))] as const
    );
    for (const [id, shape] of shapes) {
      expect(
        shape,
        `job \`${id}\` mentions github.event_name in a shape other than a required top-level \`&& ${PULL_REQUEST_ONLY_CONJUNCT}\`. Decide deliberately whether its skip may be excused on workflow_dispatch/push/schedule, then list it in LISA_PULL_REQUEST_ONLY_JOBS (and teach this test the shape) or leave it judged.`
      ).not.toBe(UNDECIDED);
    }
    const derived = shapes
      .filter(([, shape]) => shape === PULL_REQUEST_ONLY)
      .map(([id]) => id);
    expect(derived.length).toBeGreaterThan(0);
    expect([...listed].sort(byName)).toEqual([...derived].sort(byName));
  });

  it("counts a job as pull-request-only only when its condition REQUIRES pull_request", () => {
    expect(eventShape("always()")).toBe("none");
    expect(
      eventShape(
        "${{ always() && github.event_name == 'pull_request' && (a || b) }}"
      )
    ).toBe(PULL_REQUEST_ONLY);
    expect(
      eventShape("${{ github.event_name == 'pull_request' || inputs.force }}")
    ).toBe(UNDECIDED);
    expect(
      eventShape(
        "${{ github.event_name == 'pull_request' && x || inputs.force }}"
      )
    ).toBe(UNDECIDED);
    expect(
      eventShape(
        "${{ (github.event_name == 'pull_request' || github.event_name == 'push') && x }}"
      )
    ).toBe(UNDECIDED);
    expect(
      eventShape(
        "${{ github.event_name == 'pull_request' && github.event_name != 'merge_group' }}"
      )
    ).toBe(UNDECIDED);
    expect(eventShape("${{ github.event_name != 'schedule' }}")).toBe(
      UNDECIDED
    );
  });

  it("passes results, names, moment and event through env, never into run", () => {
    expect(guardStep?.env?.LISA_JOB_RESULTS).toBe("${{ toJSON(needs) }}");
    expect(guardStep?.env?.LISA_GATE_MOMENT).toBe("${{ inputs.moment }}");
    expect(guardStep?.env?.LISA_EVENT_NAME).toBe("${{ github.event_name }}");
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
