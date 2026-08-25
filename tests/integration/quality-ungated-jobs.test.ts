/**
 * Every job a `skip_jobs` token suppresses is either governed or exempted, out
 * loud.
 *
 * The defect this closes is not that some jobs are ungoverned. It is that
 * nothing SAID SO anywhere a consumer could read. `list`, `validate`,
 * `contextsFor` and `lisa doctor` all read the registry, so a property the
 * registry does not name is reported by none of them — a project reads as
 * fully governed while several jobs enforce beneath the floor, and the
 * migration `lisa doctor` recommends off `skip_jobs` onto `gates` silently
 * takes the only control away.
 *
 * So an ungated job is allowed, and only on one condition: it carries a
 * reasoned entry in `UNGATED_QUALITY_JOBS` naming the issue that decides the
 * question. A job in neither table fails here. That is the property that
 * survives the individual entries being retired one by one, which is why the
 * suite asserts the invariant rather than a snapshot of today's list.
 * @module tests/integration/quality-ungated-jobs
 */

import { describe, expect, it } from "vitest";

import { committedCaseTable } from "../helpers/committed-case-table.js";
import {
  QUALITY_JOB_GATES,
  REGISTRY,
  SKIP_JOB_TOKENS,
  UNGATED_QUALITY_JOBS,
  gateForSkipJob,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** One recorded exemption, as the shipped table holds it. */
interface Exemption {
  /** Why no gate names this job's property yet. */
  reason: string;
  /** The issue that decides the question, so the exemption expires. */
  owner: string;
}

/** The shipped exemption table, as this file consumes it. */
const EXEMPT = UNGATED_QUALITY_JOBS as Record<string, Exemption | undefined>;

/** The shipped job → gate table, as this file consumes it. */
const GOVERNED = QUALITY_JOB_GATES as Record<string, string | undefined>;

/**
 * Shortest reason that can tell a reader why the gap is still open.
 *
 * Borrowed from the `declareOnly` bar in `gate-default-tasks-resolve.test.ts`,
 * and for the same purpose: a one-word reason is a placeholder wearing a
 * reason's clothes.
 */
const USABLE_REASON_LENGTH = 60;

/** Every job any `skip_jobs` token suppresses, deduplicated, in token order. */
const SUPPRESSIBLE_JOBS: string[] = [
  ...new Set(Object.values(SKIP_JOB_TOKENS).flat()),
];

/** The suppressible jobs no `QUALITY_JOB_GATES` row governs. */
const UNGOVERNED = SUPPRESSIBLE_JOBS.filter(job => GOVERNED[job] === undefined);

/**
 * Alphabetical order both sides of a set comparison are put into.
 * @param left One id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

describe("every suppressible job is governed or exempted", () => {
  it("leaves no job in neither table", () => {
    const orphans = SUPPRESSIBLE_JOBS.filter(
      job => GOVERNED[job] === undefined && EXEMPT[job] === undefined
    ).sort(byName);

    // The message matters as much as the assertion: this fails on someone
    // adding a job, and what they need to be told is that a third option
    // (leave it out of both) does not exist.
    expect(
      orphans,
      `These jobs are suppressible by a skip_jobs token and appear in neither ` +
        `QUALITY_JOB_GATES nor UNGATED_QUALITY_JOBS in ` +
        `all/copy-overwrite/scripts/lisa-gates.mjs. Add a gate row, or an ` +
        `exemption naming the issue that decides the question. Silence is not ` +
        `an option: a consumer holds no copy of quality.yml, so an ungated ` +
        `job that nothing records reads as governed.`
    ).toEqual([]);
  });

  it("never records a job as both governed and exempt", () => {
    const both = SUPPRESSIBLE_JOBS.filter(
      job => GOVERNED[job] !== undefined && EXEMPT[job] !== undefined
    ).sort(byName);
    expect(both).toEqual([]);
  });

  it("exempts exactly the jobs no gate governs", () => {
    // Not a subset check. An exemption for a job that DOES have a gate is a
    // stale record that would keep telling an operator the property has no
    // name after it acquired one.
    const exempted = Object.keys(EXEMPT).sort(byName);
    const ungoverned = [...UNGOVERNED].sort(byName);
    expect(exempted).toEqual(ungoverned);
  });

  // The key set is COMMITTED here, not derived, and it is deliberately empty.
  //
  // Every assertion above compares one derived set against another, so all of
  // them are satisfied by both sides being empty — which is precisely the state
  // this file is in. #2938 retired the last exemption, the three cases below
  // stopped registering, and the file went 15 green to 12 green with nothing
  // red and nothing said (CodySwannGT/lisa#3043).
  //
  // A non-empty assertion would be the wrong fix: an empty table is the GOAL,
  // so `toBeGreaterThan(0)` would redden a healthy repository for reaching it.
  // The committed key set keeps empty legitimate while making any CHANGE loud —
  // a new exemption fails here until it is written down and reviewed, and a
  // retired one fails naming what it took with it.
  const EXEMPTIONS: readonly string[] = [];

  describe.each(committedCaseTable("exemption", EXEMPT, EXEMPTIONS))(
    "the %s exemption",
    (job, entry) => {
      it("gives a reason a reader can act on", () => {
        expect(entry?.reason.length).toBeGreaterThanOrEqual(
          USABLE_REASON_LENGTH
        );
      });

      it("names the issue that decides it, so the exemption expires", () => {
        expect(entry?.owner).toMatch(/^#\d+$/);
      });

      it(`is not silently governed as well (${job})`, () => {
        expect(GOVERNED[job]).toBeUndefined();
      });
    }
  );
});

describe("the three newly named properties", () => {
  const NAMED = [
    { job: "e2e_coverage", gate: "journey-coverage" },
    { job: "state_classification", gate: "state-classification" },
    { job: "floor_collisions", gate: "security-floor-integrity" },
  ] as const;

  it.each(NAMED)("$job now resolves to $gate", ({ job, gate }) => {
    expect(GOVERNED[job]).toBe(gate);
  });

  it.each(NAMED)(
    "$job's skip token is replaceable rather than unmappable",
    ({ job, gate }) => {
      // The migration `lisa doctor` recommends is only honest if the token has
      // somewhere to go. Before these gates existed the answer was
      // `unmappable` — a correct refusal with no remedy on the other side.
      const resolved = gateForSkipJob(job) as {
        status: string;
        gate: string | null;
      };
      expect(resolved.status).toBe("replaceable");
      expect(resolved.gate).toBe(gate);
    }
  );

  it.each(NAMED)(
    "$gate declares why its default task does not ship as a script",
    ({ gate }) => {
      const definition = (REGISTRY as Record<string, { declareOnly?: string }>)[
        gate
      ];
      expect(definition?.declareOnly?.length).toBeGreaterThanOrEqual(
        USABLE_REASON_LENGTH
      );
    }
  );
});
