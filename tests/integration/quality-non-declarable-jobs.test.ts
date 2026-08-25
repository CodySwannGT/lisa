/**
 * A gate whose job is to detect silencing cannot itself be silenceable.
 *
 * `NON_DECLARABLE_JOBS` states that rule; this file is what makes it bite. The
 * defect it pins is not hypothetical and is not symmetrical:
 * `skipped_required_checks` was exempt from the gate registry AS A META-GATE and
 * carried a `skip_jobs` token the whole time, so the exemption bought it
 * nothing — the off-switch it was exempted from acquiring already existed one
 * layer down. `gate_config_validity`, exempt for the identical reason, had no
 * token, which is why nothing could silence it. One rule, two opposite
 * outcomes, and nothing anywhere said which was correct (#2933).
 *
 * Three clauses, asserted separately, because two of the three were already
 * true of the job that was broken. A test that checked only "no gate row" would
 * have passed against the defect.
 *
 * The workflow is READ rather than restated. A consumer holds no copy of
 * `quality.yml` — it calls the reusable workflow by ref — so this repository is
 * the only place the table and the workflow can be compared at all, and a
 * second hand-written list here would recreate the drift it exists to catch.
 *
 * @module tests/integration/quality-non-declarable-jobs
 */

import { describe, expect, it } from "vitest";

import { committedCaseTable } from "../helpers/committed-case-table.js";
import {
  NON_DECLARABLE_JOBS,
  QUALITY_JOB_GATES,
  RETIRED_SKIP_JOB_TOKENS,
  SKIP_JOB_TOKENS,
  UNGATED_QUALITY_JOBS,
  gateForSkipJob,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  WORKFLOW_FILES,
  workflow,
  workflowIn,
} from "./quality-gate-facade-fixture.js";

/** One recorded non-declarable job, as the shipped table holds it. */
interface NonDeclarable {
  /** Why an off-switch here would be circular. */
  reason: string;
}

/** The shipped rule table, as this file consumes it. */
const RULED = NON_DECLARABLE_JOBS as Record<string, NonDeclarable | undefined>;

/** The shipped job → gate table, as this file consumes it. */
const GOVERNED = QUALITY_JOB_GATES as Record<string, string | undefined>;

/** The shipped "no gate yet" table, as this file consumes it. */
const EXEMPT = UNGATED_QUALITY_JOBS as Record<string, unknown>;

/**
 * Shortest reason that can tell a reader why an off-switch would be circular.
 *
 * Same bar as `quality-ungated-jobs.test.ts` uses for an exemption, and for the
 * same purpose: a one-word reason is a placeholder wearing a reason's clothes.
 */
const USABLE_REASON_LENGTH = 60;

/** Every job every `skip_jobs` token suppresses, per the shipped table. */
const SUPPRESSIBLE_JOBS = new Set(Object.values(SKIP_JOB_TOKENS).flat());

/**
 * The `if:` condition each named job carries, across every shipped workflow.
 *
 * @param job - Job id
 * @returns The conditions found, one per workflow declaring the job
 */
function conditionsFor(job: string): string[] {
  return WORKFLOW_FILES.flatMap(file => {
    const definition = workflowIn(file).jobs[job];
    return definition === undefined ? [] : [String(definition.if ?? "")];
  });
}

// Committed, not derived. Every clause below is generated from the shipped
// table, so emptying it registers ZERO cases and the file still reports green
// (CodySwannGT/lisa#3043). The key set makes retiring a rule a two-place edit.
const NOT_DECLARABLE: readonly string[] = [
  "gate_config_validity",
  "skipped_required_checks",
];

describe.each(committedCaseTable("non-declarable job", RULED, NOT_DECLARABLE))(
  "%s is not declarable",
  (job, entry) => {
    it("exists as a job in a shipped workflow", () => {
      // Guards the table against naming a job that was renamed or deleted, which
      // would make every other clause below pass vacuously.
      expect(conditionsFor(job).length).toBeGreaterThan(0);
    });

    it("gives a reason a reader can act on", () => {
      expect(entry?.reason.length).toBeGreaterThanOrEqual(USABLE_REASON_LENGTH);
    });

    it("has no QUALITY_JOB_GATES row — nothing to declare off", () => {
      expect(GOVERNED[job]).toBeUndefined();
    });

    it("is suppressed by no skip_jobs token", () => {
      // Clause two, and the one that was false. Both halves are asserted: the
      // shipped token table, and the job's own condition in the workflow, because
      // a token removed from one and left in the other still silences the job.
      expect([...SUPPRESSIBLE_JOBS]).not.toContain(job);
      for (const condition of conditionsFor(job)) {
        expect(condition).not.toContain("skip_jobs");
      }
    });

    it("carries no UNGATED_QUALITY_JOBS exemption", () => {
      // The two tables say opposite things. An exemption records a gate that is
      // still OWED; this table records that none is coming. A job in both tells
      // a reader a gate is on its way when the ruling was that it never is.
      expect(EXEMPT[job]).toBeUndefined();
    });
  }
);

describe("a token this workflow deleted is not a token it never had", () => {
  /** One recorded retirement, as the shipped table holds it. */
  interface Retirement {
    retiredIn: string;
    reason: string;
  }

  const RETIRED = RETIRED_SKIP_JOB_TOKENS as Record<
    string,
    Retirement | undefined
  >;

  it("classifies the retired token as retired, not unknown", () => {
    // `unknown` tells an operator to check for a space after a comma. That is
    // wrong advice for a token they spelled correctly and which this workflow
    // really did honour, and the remedy is different: delete it, do not fix it.
    const resolved = gateForSkipJob("skipped_required_checks") as {
      status: string;
    };
    expect(resolved.status).toBe("retired");
  });

  it("still calls a token this workflow never had unknown", () => {
    // The other half. If everything unrecognised became `retired`, the typo
    // advice would vanish for the case it was written for.
    const resolved = gateForSkipJob("lint_slwo") as { status: string };
    expect(resolved.status).toBe("unknown");
  });

  // Committed, not derived — same reason as the table above.
  const RETIREMENTS: readonly string[] = [
    "skipped_required_checks",
    "zap_baseline",
  ];

  it.each(committedCaseTable("retirement", RETIRED, RETIREMENTS))(
    "the %s retirement",
    (token, entry) => {
      // Every entry, not just the one the two cases above name by hand. A second
      // retirement added later would otherwise inherit their coverage without
      // being checked, and the shape matters as much as the status: a `retired`
      // answer carrying jobs or a gate would send an operator to a control that
      // is not there.
      expect(gateForSkipJob(token)).toMatchObject({
        status: "retired",
        jobs: [],
        gates: [],
        gate: null,
        ungated: [],
      });
      // A retired token must genuinely be gone. An entry for a token still in
      // SKIP_JOB_TOKENS would tell an operator to delete a working control.
      expect(Object.keys(SKIP_JOB_TOKENS)).not.toContain(token);
      expect(entry?.retiredIn).toMatch(/^#\d+$/u);
      expect(entry?.reason.length).toBeGreaterThanOrEqual(60);
    }
  );
});

describe("the rule is a rule, not a list", () => {
  it("is not advertised as a skip token by the input's own description", () => {
    const description = String(
      workflow.on?.workflow_call?.inputs?.["skip_jobs"]?.description ?? ""
    );
    // The description is what a caller copies from. A token advertised there
    // and honoured nowhere is still a token someone will write.
    expect(description).not.toBe("");
    for (const job of Object.keys(RULED)) {
      expect(description).not.toContain(job);
    }
  });
});
