/**
 * Keeps the 100k temp-scan benchmark on an automated surface.
 *
 * `tests/unit/scripts/measure-tmpdir-growth-performance.test.ts` asserts a
 * wall-clock claim: six real command runs over a 100,000-entry root, each
 * inside `TMPDIR_GROWTH_COMMAND_BUDGET_MS`. CodySwannGT/lisa#3925 removed it
 * from the pre-push task on the stated grounds that CI still ran it every pull
 * request, and that was false. The case is
 * `it.runIf(process.platform === "darwin")` and every CI runner is
 * `ubuntu-latest`, so CI skipped it and always had. What the move removed was
 * the only automated surface that had ever executed it (CodySwannGT/lisa#3935).
 *
 * ## Why a config assertion alone is what got us here
 *
 * The guard #3925 shipped asserted that the pull-request task does not EXCLUDE
 * the file. That is true, and it is hollow: not excluding a file is not running
 * it, and a platform guard one layer down skipped the case anyway. A skipped
 * case is a green case, so nothing reported it.
 *
 * So this file pins the CONFIGURATION half only, and says so. It cannot prove
 * execution and does not pretend to — execution is proved in the lane itself,
 * by `scripts/check-test-case-executed.mjs` reading the run's own vitest JSON
 * report. What this file guarantees is that the lane still exists, still points
 * at this benchmark, still runs on the platform the case's guard admits, and
 * still asks for that proof. Break any of those and this fails in milliseconds
 * and names which one; the alternative is finding out a night, or a quarter,
 * later.
 *
 * ## The runner and the guard are one fact in two files
 *
 * `runs-on: macos-latest` is not incidental. A lane on `ubuntu-latest` would
 * skip the case and pass — the exact defect. The pairing is asserted here so
 * that changing the runner without changing the guard is a red unit test rather
 * than a silently empty nightly run.
 * @module tests/unit/config/tmpdir-growth-benchmark-scheduled
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Repository-relative path of the suite carrying the benchmark. */
const BENCHMARK_SUITE =
  "tests/unit/scripts/measure-tmpdir-growth-performance.test.ts";

/** The scheduled workflow that owns the benchmark's execution. */
const SCHEDULED = ".github/workflows/nightly-tmpdir-growth-benchmark.yml";

/** The script that turns "the suite was green" into "the case executed". */
const EXECUTION_PROVER = "scripts/check-test-case-executed.mjs";

/** The runner family the case's own `runIf` admits. */
const REQUIRED_RUNNER = "macos-latest";

/** The benchmark's `describe` title, exactly as written. */
const SUITE_TITLE = "temp growth command-route performance";

/** The benchmark case's `it` title, exactly as written. */
const CASE_TITLE =
  "records real 100k command-route timings across three independent roots";

/**
 * The case's name as vitest's JSON reporter emits it.
 *
 * `fullName` is `ancestorTitles` joined to the title by a SPACE, not by the
 * ` > ` separator the human-readable reporters print. Measured against a real
 * report on vitest 4.1.9; writing the separator form here would have made the
 * nightly lane red for a reason that is not a regression.
 */
const FULL_NAME = `${SUITE_TITLE} ${CASE_TITLE}`;

/**
 * A file's source with its COMMENT lines removed.
 *
 * Every assertion below is a substring search, and this file's own subject
 * matter is documented at length in the files it searches — the workflow header
 * names the prover script, and the benchmark's header quotes its own `runIf`
 * while explaining it. Searching the raw text therefore let two mutants live:
 * deleting the prover step and deleting the platform guard both left this file
 * green, because the prose above each still contained the string. That is the
 * inert-guard shape this whole change is about, arriving through the remedy.
 *
 * Stripping comments first is what makes these assertions bite on CODE. It is
 * line-based and deliberately crude — enough for YAML `#` lines and for the
 * `*`, `/*` and `//` forms this repository writes — because a real parser here
 * would be a second thing to get wrong.
 * @param source - Raw file text
 * @returns The same text with comment-only lines blanked
 */
const codeOnly = (source: string): string =>
  source
    .split("\n")
    .map(line => (/^\s*(?:#|\*|\/\*|\/\/)/u.test(line) ? "" : line))
    .join("\n");

const benchmarkSource = codeOnly(
  readFileSync(path.join(REPO_ROOT, BENCHMARK_SUITE), "utf8")
);
const workflow = codeOnly(
  readFileSync(path.join(REPO_ROOT, SCHEDULED), "utf8")
);

describe("the benchmark the schedule owns", () => {
  it("still declares the titles the lane proves by name", () => {
    // The lane addresses the case by string. A rename that misses the workflow
    // must fail HERE, on every pull request, rather than in a nightly run that
    // nobody is watching and that would report only "absent from the report".
    expect(benchmarkSource).toContain(`describe("${SUITE_TITLE}"`);
    expect(benchmarkSource).toContain(`"${CASE_TITLE}"`);
  });

  it("is still gated to the platform the lane runs on", () => {
    // Not a claim that darwin is REQUIRED — nothing in the measured path needs
    // it, and the guard was inherited from a genuinely-darwin sibling in the
    // same helper file. It is a claim that the guard and the runner still
    // agree. The reasons the pairing stays on darwin are in the workflow header.
    expect(benchmarkSource).toContain(
      'it.runIf(process.platform === "darwin")'
    );
  });
});

describe("the schedule that keeps running it", () => {
  it("runs nightly and can be dispatched by hand", () => {
    expect(workflow).toMatch(/^\s{2}schedule:$/mu);
    expect(workflow).toMatch(/^ {4}- cron: '/mu);
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:$/mu);
  });

  it("runs on the platform the case's guard admits", () => {
    // A lane on ubuntu-latest would skip the case and pass. That is the defect.
    expect(workflow).toContain(`runs-on: ${REQUIRED_RUNNER}`);
  });

  it("runs the benchmark suite and asks for a machine-readable report", () => {
    expect(workflow).toContain(BENCHMARK_SUITE);
    expect(workflow).toContain("--reporter=json");
    expect(workflow).toContain("--outputFile=");
  });

  it("proves the case EXECUTED, not merely that the suite was green", () => {
    // The whole point of CodySwannGT/lisa#3935. Without this step the job is
    // green whether the case ran or was skipped by a platform guard.
    expect(workflow).toContain(EXECUTION_PROVER);
    expect(workflow).toContain(`--name "${FULL_NAME}"`);
  });

  it("is not triggered by pull requests or pushes", () => {
    // The cost is why the benchmark left the push gate; a path-filtered trigger
    // would hand it straight back to the branches most likely to touch it.
    expect(workflow).not.toMatch(/^\s{2}pull_request:/mu);
    expect(workflow).not.toMatch(/^\s{2}push:/mu);
  });

  it("files an issue when the scheduled run goes red", () => {
    // Including red because the case was skipped: that failure now has a voice.
    expect(workflow).toContain("create-github-issue-on-failure.yml");
    expect(workflow).toMatch(/if:.*failure\(\)/u);
  });
});
