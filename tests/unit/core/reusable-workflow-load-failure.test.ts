/**
 * Detect a reusable workflow that failed to LOAD, not to run (#3581).
 *
 * When an upstream commit makes a reusable workflow unparseable, GitHub rejects
 * the file BEFORE creating any job. The run has zero jobs, no annotation naming
 * the line, and its display `name` degrades to its `path` because GitHub never
 * read the `name:` key. Nothing watching for a failing JOB can see it: there is
 * no red job to open. On the incident that prompted this, a consumer's handler
 * failed five times in a row before anyone noticed, ~40 minutes after the
 * upstream commit landed. The consumer had changed nothing.
 *
 * ## The arm that actually discriminates, and the three that do not
 *
 * `referenced_workflows` is populated with the resolved SHA of every reusable
 * workflow a run actually used. A caller that DECLARED one and RESOLVED ZERO
 * did not parse — there is no other way to reach that state.
 *
 * It must be read only INSIDE its population. Measured on one consumer, 19
 * failing runs in a day: 5 in population all resolved >= 1; 14 outside it all
 * resolved 0. Used bare it reports 14 false positives out of 19.
 *
 * Three shortcuts the ticket refutes with measured runs, each pinned below:
 *
 *  - `conclusion == "failure"` — six failures in the window, only four were
 *    load failures.
 *  - `jobs == 0` — a run IN the population resolved its workflow and still
 *    produced zero jobs.
 *  - `name == path` — a display coincidence; any workflow omitting `name:`
 *    satisfies it while healthy.
 *
 * ## The false-red this must not become
 *
 * A dead runner produces a near-empty run too: `conclusion: failure`, jobs that
 * EXIST but have no steps and no runner. Collapsing the two would make every
 * runner outage look like a Lisa regression. Load failure is NO JOBS AT ALL; a
 * dead runner is JOBS THAT EXIST AND ARE EMPTY. A skipped run is excluded for
 * the same reason — it never intended to resolve anything, and reporting it
 * would be #3565's shape: a control that can only manufacture a red.
 * @module tests/unit/core/reusable-workflow-load-failure
 */
import { describe, expect, it } from "vitest";

import {
  callerDeclaresReusableWorkflow,
  classifyRunLoad,
  windowCoverage,
} from "../../../src/core/reusable-workflow-load-failure.js";

/** The start of the window used by the coverage assertions. */
const WINDOW_START = "2026-09-02T00:00:00Z";

/** A caller that calls a Lisa reusable workflow. */
const CALLER = [
  "jobs:",
  "  quality:",
  "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
].join("\n");

/** A caller that uses only step actions — outside the population. */
const STEPS_ONLY = [
  "jobs:",
  "  build:",
  "    steps:",
  "      - uses: actions/checkout@v6",
  "      - uses: actions/setup-node@v6",
].join("\n");

describe("the population gate: which callers the field can speak for", () => {
  it("includes a caller declaring a reusable workflow", () => {
    expect(callerDeclaresReusableWorkflow(CALLER)).toBe(true);
  });

  it("excludes a caller using only step actions", () => {
    // `actions/checkout@v6` is a step action and never populates the field.
    // Reading it as a declaration is what produced 14 false positives of 19.
    expect(callerDeclaresReusableWorkflow(STEPS_ONLY)).toBe(false);
  });

  it("excludes an empty or unreadable caller", () => {
    expect(callerDeclaresReusableWorkflow("")).toBe(false);
  });

  it("includes a caller of a reusable workflow in its own repository", () => {
    expect(
      callerDeclaresReusableWorkflow(
        "jobs:\n  q:\n    uses: ./.github/workflows/quality.yml"
      )
    ).toBe(true);
  });

  it("excludes a commented-out declaration, which invokes nothing", () => {
    expect(
      callerDeclaresReusableWorkflow(
        "#    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main"
      )
    ).toBe(false);
  });

  it("excludes a step action that merely has a path-like name", () => {
    // A sub-action lives at `<owner>/<repo>/<dir>@<ref>`, which is path-shaped
    // without being a reusable workflow. Only the `.github/workflows/` segment
    // and a `.yml` leaf make it one.
    expect(
      callerDeclaresReusableWorkflow("      - uses: actions/cache/restore@v4")
    ).toBe(false);
  });
});

describe("a load failure is in-population with nothing resolved", () => {
  it("classifies the measured signature", () => {
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 0,
        jobCount: 0,
        conclusion: "failure",
      })
    ).toBe("load-failure");
  });
});

describe("rejection controls: the shapes that must NOT be load failures", () => {
  it("does not flag a run outside the population that resolved nothing", () => {
    // THE control for the population gate: 14 of the 19 measured runs.
    expect(
      classifyRunLoad({
        inPopulation: false,
        referencedCount: 0,
        jobCount: 0,
        conclusion: "failure",
      })
    ).toBe("out-of-population");
  });

  it("does not flag an in-population run that resolved and had zero jobs", () => {
    // Measured refutation: `jobs == 0` is not the signature.
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 1,
        jobCount: 0,
        conclusion: "failure",
      })
    ).toBe("resolved");
  });

  it("does not flag a dead runner, which has jobs that exist and are empty", () => {
    // Collapsing this into load-failure makes every runner outage look like a
    // Lisa regression.
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 0,
        jobCount: 2,
        conclusion: "failure",
      })
    ).toBe("dead-runner");
  });

  it("does not flag a SKIPPED run, which never intended to resolve anything", () => {
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 0,
        jobCount: 0,
        conclusion: "skipped",
      })
    ).toBe("skipped");
  });

  it("does not flag a run still in flight", () => {
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 0,
        jobCount: 0,
        conclusion: null,
      })
    ).toBe("in-flight");
  });

  it("does not flag a CANCELLED run that never reached a job", () => {
    // Same empty shape as a load failure, reached by someone pressing cancel.
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 0,
        jobCount: 0,
        conclusion: "cancelled",
      })
    ).toBe("inconclusive");
  });

  it("treats resolution as settling the question before the population gate", () => {
    // The ordering claim made in the module: a run that resolved something
    // loaded, whatever the gate thinks. This is what makes an under-detecting
    // population gate cause a MISS rather than a false positive.
    expect(
      classifyRunLoad({
        inPopulation: false,
        referencedCount: 2,
        jobCount: 4,
        conclusion: "failure",
      })
    ).toBe("resolved");
  });

  it("does not flag a healthy successful run", () => {
    expect(
      classifyRunLoad({
        inPopulation: true,
        referencedCount: 1,
        jobCount: 3,
        conclusion: "success",
      })
    ).toBe("resolved");
  });
});

describe("the window must be covered, or the scan reports an error", () => {
  it("accepts a page set reaching past the window start", () => {
    // A first implementation read one page and filtered by timestamp; on a busy
    // repository the window's start fell off page one and the detector reported
    // "OK, 100 runs inspected" across a period containing four known load
    // failures. Clean because it could not see.
    expect(
      windowCoverage({
        oldestSeen: "2026-09-01T00:00:00Z",
        windowStart: WINDOW_START,
        exhausted: false,
      }).covered
    ).toBe(true);
  });

  it("refuses a page set that stopped short of the window start", () => {
    const verdict = windowCoverage({
      oldestSeen: "2026-09-03T00:00:00Z",
      windowStart: WINDOW_START,
      exhausted: false,
    });

    expect(verdict.covered).toBe(false);
    expect(verdict.reason).toContain("did not reach");
  });

  it("accepts an exhausted history even when it stops short", () => {
    // A repository younger than the window has no earlier runs to read. That is
    // covered, not truncated, and refusing it would be a red nobody can clear.
    expect(
      windowCoverage({
        oldestSeen: "2026-09-03T00:00:00Z",
        windowStart: WINDOW_START,
        exhausted: true,
      }).covered
    ).toBe(true);
  });

  it("refuses an unreadable timestamp rather than passing it", () => {
    const verdict = windowCoverage({
      oldestSeen: "not-a-timestamp",
      windowStart: WINDOW_START,
      exhausted: false,
    });

    expect(verdict.covered).toBe(false);
    expect(verdict.reason).toContain("not a satisfied one");
  });

  it("refuses when nothing was read at all", () => {
    expect(
      windowCoverage({
        oldestSeen: null,
        windowStart: WINDOW_START,
        exhausted: false,
      }).covered
    ).toBe(false);
  });
});
