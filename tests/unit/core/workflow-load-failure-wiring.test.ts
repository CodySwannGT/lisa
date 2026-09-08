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
} from "../../../scripts/check-workflow-load-failures.js";

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
const ENTRY = "scripts/check-workflow-load-failures.ts";

/** The scheduled workflow that runs it. */
const WORKFLOW = ".github/workflows/workflow-load-failure-sweep.yml";

/** The npm script name the workflow invokes. */
const SCRIPT_NAME = "check:workflow-load-failures";

describe("the entry point actually calls the detector", () => {
  it("imports the scanner and the adapter", () => {
    const entry = source(ENTRY);

    expect(entry).toContain("reusable-workflow-load-scan.js");
    expect(entry).toContain("reusable-workflow-load-adapter.js");
    expect(entry).toContain("reusable-workflow-load-failure.js");
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
    // The one-page implementation's false green is a two-condition exit here.
    expect(source(ENTRY)).toContain(
      "result.covered && result.loadFailures.length === 0 ? 0 : 1"
    );
  });
});

describe("a scheduled surface runs it at the failing moment", () => {
  it("registers an npm script for the entry point", () => {
    const pkg = JSON.parse(source("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts[SCRIPT_NAME]).toContain(
      "scripts/check-workflow-load-failures.ts"
    );
  });

  it("ships a workflow that runs on a schedule", () => {
    // A gate moment would not do: on a pull request this failure is already
    // caught, and the incident happened on a push handler where no gate looks.
    const workflow = source(WORKFLOW);

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("cron:");
  });

  it("has that workflow invoke the npm script", () => {
    expect(source(WORKFLOW)).toContain(SCRIPT_NAME);
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

    // `ci.yml` calls a Lisa reusable workflow; `quality.yml` IS one, which is
    // the distinction the gate turns on — a callee is not a caller. The sweep
    // workflow added by this lane uses only step actions, so it is out too.
    expect(inPopulation(".github/workflows/ci.yml")).toBe(true);
    expect(inPopulation(".github/workflows/quality.yml")).toBe(false);
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
          path: ".github/workflows/nightly.yml",
          verdict: "load-failure",
        },
      ],
      inspected: 40,
      covered: true,
      reason: "",
    });

    expect(text).toContain("run 7");
    expect(text).toContain(".github/workflows/nightly.yml");
    expect(text).toContain("NO jobs");
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
