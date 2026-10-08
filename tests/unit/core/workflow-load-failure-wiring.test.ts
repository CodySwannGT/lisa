/**
 * Prove the #3581 detector is not just built but REACHABLE.
 *
 * This file exists because "shipped" and "shipped and reachable" are different
 * states that look identical from a green suite, and this batch found five
 * separate controls sitting in the gap between them — a gate declared required
 * with no artifact behind it, a worker cap nothing sets, a timeout helper
 * exported for a question with zero callers, a documented pagination ceiling
 * in a layer with no pagination, and a rule living in two executables that
 * never reached the two skills branching on it.
 *
 * A classifier with no caller detects nothing. So the assertions below are
 * about the wiring itself: the entry point calls the scanner, an npm script
 * invokes the entry point, and a scheduled workflow runs that script at the
 * moment the failure actually occurs. Each one is a link that has been
 * silently missing somewhere in this repository before.
 *
 * The instrument is borrowed from the doctor-registration lane, which asserts
 * that its new check is imported AND called for exactly this reason.
 * @module tests/unit/core/workflow-load-failure-wiring
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPopulationTest,
  describe as report,
} from "../../../all/copy-overwrite/scripts/check-workflow-load-failures.mjs";

/** Repository root, four levels up from this file. */
const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Read a repository file as text.
 * @param relative - Path relative to the repository root
 * @returns The file contents
 */
function source(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** The production entry point. */
const ENTRY = "all/copy-overwrite/scripts/check-workflow-load-failures.mjs";

/**
 * A placeholder-attributed never-started run, shaped as `describe` consumes it.
 * @param id - The run id
 * @param createdAt - The run's timestamp
 * @returns One `startupFailures` entry
 */
function startupFailure(id: number, createdAt: string) {
  return { id, path: "BuildFailed", createdAt, verdict: "startup-failure" };
}

/** The scheduled workflow that runs it. */
const WORKFLOW = ".github/workflows/workflow-load-failure-sweep.yml";

/** The npm script name the workflow invokes. */
const SCRIPT_NAME = "check:workflow-load-failures";

/** First startup_failure timestamp shared by the outage-shape tests. */
const T_FIRST = "2026-09-27T05:00:00Z";

/** Last startup_failure timestamp shared by the outage-shape tests. */
const T_LAST = "2026-09-27T06:00:00Z";
const NIGHTLY_WORKFLOW_PATH = ".github/workflows/nightly.yml";

describe("the entry point actually calls the detector", () => {
  it("imports the scanner and the adapter", () => {
    const entry = source(ENTRY);

    expect(entry).toContain("reusable-workflow-load-scan.mjs");
    expect(entry).toContain("reusable-workflow-load-adapter.mjs");
    expect(entry).toContain("reusable-workflow-load-failure.mjs");
  });

  it("invokes the scan rather than merely importing it", () => {
    // Importing without calling is the precise shape of the defect this file
    // guards: the symbol resolves, the suite is green, nothing runs.
    expect(source(ENTRY)).toContain("scanForLoadFailures({");
  });

  it("derives the population from the callers rather than a roster", () => {
    expect(source(ENTRY)).toContain("callerDeclaresReusableWorkflow(source)");
  });

  it("treats an uncovered window as a non-zero exit, not a pass", () => {
    // The one-page implementation's false green is a three-condition exit:
    // covered window, no load failures, AND no never-started runs (#4276 —
    // a startup_failure run is attributed to a placeholder path and never
    // enters the load-failure population, so the second condition alone
    // reported OK through an org-wide outage).
    expect(source(ENTRY)).toContain("result.covered");
    expect(source(ENTRY)).toContain("result.loadFailures.length === 0");
    expect(source(ENTRY)).toContain("startupFailures.length === 0");
  });

  it("flags a run that never started, whatever workflow path carries it", () => {
    // CodySwannGT/lisa#4276: GitHub attributes a run it cannot build to the
    // placeholder workflow `BuildFailed`, out-of-population by construction.
    const text = report({
      loadFailures: [],
      startupFailures: [startupFailure(11, T_FIRST)],
      inspected: 12,
      covered: true,
      reason: "",
    });

    expect(text).toContain("startup_failure");
    expect(text).toContain("run 11");
    expect(text).toContain("BuildFailed");
    expect(text).not.toContain("OK.");
  });

  it("names the org-outage shape when every inspected run failed to start", () => {
    const text = report({
      loadFailures: [],
      startupFailures: [
        startupFailure(11, T_FIRST),
        startupFailure(12, T_LAST),
      ],
      inspected: 2,
      covered: true,
      reason: "",
    });

    expect(text).toContain("EVERY run in the window failed to start");
    expect(text).toContain(`First: ${T_FIRST}`);
    expect(text).toContain(`Last: ${T_LAST}`);
  });

  it("still names the outage shape when a tail row outside the window padded inspected", () => {
    // Paging ends on a run older than the window, so `inspected` can exceed
    // the in-window count by one. The outage call compares against `inWindow`.
    const text = report({
      loadFailures: [],
      startupFailures: [
        startupFailure(11, T_FIRST),
        startupFailure(12, T_LAST),
      ],
      inspected: 3,
      inWindow: 2,
      covered: true,
      reason: "",
    });

    expect(text).toContain("EVERY run in the window failed to start");
  });
});

describe("a scheduled surface runs it at the failing moment", () => {
  it("registers an npm script for the entry point", () => {
    const pkg = JSON.parse(source("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts[SCRIPT_NAME]).toContain(
      "scripts/check-workflow-load-failures.mjs"
    );
  });

  it("ships a workflow that runs on a schedule", () => {
    // A gate moment would not do: on a pull request this failure is already
    // caught, and the incident happened on a push handler where no gate looks.
    const workflow = source(WORKFLOW);

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("cron:");
  });

  it("has that workflow invoke the shared Node script", () => {
    expect(source(WORKFLOW)).toContain(
      "node scripts/check-workflow-load-failures.mjs"
    );
  });

  it("gives the workflow permission to read run history", () => {
    // Without `actions: read` the API returns nothing and the scan would
    // report a clean window it never actually saw — a missing permission
    // rendering as a pass is the same defect one layer down.
    //
    // Matched as a real YAML key rather than as a substring. The first version
    // of this assertion used `toContain("actions: read")`, which a commented
    // -out permission still satisfies — it passed against a workflow with the
    // line disabled, so it was proving nothing.
    expect(source(WORKFLOW)).toMatch(/^[ \t]+actions:[ \t]+read[ \t]*$/mu);
  });
});

describe("the entry point's own behaviour, executed", () => {
  it("derives the population from this repository's real workflows", async () => {
    const inPopulation = await buildPopulationTest(ROOT);

    // `quality.yml` is both a reusable callee and a caller of its same-commit
    // nested history gate. Population follows actual `uses:` edges; being a
    // callee does not exclude a nested caller. The sweep uses only step actions.
    expect(inPopulation(".github/workflows/ci.yml")).toBe(true);
    expect(inPopulation(".github/workflows/quality.yml")).toBe(true);
    expect(inPopulation(".github/workflows/quality-rails.yml")).toBe(true);
    expect(inPopulation(".github/workflows/history-secrets.yml")).toBe(false);
    expect(
      inPopulation(".github/workflows/workflow-load-failure-sweep.yml")
    ).toBe(false);
  });

  it("returns false for a workflow that does not exist", async () => {
    const inPopulation = await buildPopulationTest(ROOT);

    expect(inPopulation(".github/workflows/not-a-real-file.yml")).toBe(false);
  });

  it("renders an uncovered window as INCOMPLETE, never as a pass", () => {
    // The load-bearing claim of the whole scan half.
    const text = report({
      loadFailures: [],
      inspected: 100,
      covered: false,
      reason: "paging stopped short.",
    });

    expect(text).toContain("INCOMPLETE");
    expect(text).toContain("not the same as having covered the window");
    expect(text).not.toContain("OK.");
  });

  it("names every load failure it found, not a count", () => {
    const text = report({
      loadFailures: [
        {
          id: 7,
          path: NIGHTLY_WORKFLOW_PATH,
          verdict: "load-failure",
        },
      ],
      inspected: 40,
      covered: true,
      reason: "",
    });

    expect(text).toContain("run 7");
    expect(text).toContain(NIGHTLY_WORKFLOW_PATH);
    expect(text).toContain("NO jobs");
  });

  it("retains both kinds of known failure beside incomplete coverage", () => {
    const text = report({
      loadFailures: [
        {
          id: 7,
          path: NIGHTLY_WORKFLOW_PATH,
          verdict: "load-failure",
        },
      ],
      startupFailures: [startupFailure(11, T_FIRST)],
      inspected: 100,
      covered: false,
      reason: "paging stopped short.",
    });
    expect(text).toContain("INCOMPLETE");
    expect(text).toContain("run 7");
    expect(text).toContain("run 11");
    expect(text).toContain("at least 1");
    expect(text).not.toContain("EVERY run in the window");
    expect(text).not.toContain("OK.");
  });

  it("reports a covered clean window plainly", () => {
    const text = report({
      loadFailures: [],
      inspected: 40,
      covered: true,
      reason: "",
    });

    expect(text).toContain("OK.");
    expect(text).toContain("40 run(s) inspected");
  });
});
