/**
 * The mutation gate's selection accounting (CodySwannGT/lisa#3880).
 *
 * ## The defect
 *
 * A diff-scoped run reported a score and no DENOMINATOR. One such run — 90
 * mutants over seven changed line ranges in a single guard — took 61 minutes,
 * and the single number that explains it, `Ran 267.22 tests per mutant on
 * average.`, was printed by Stryker and read by nobody. 267 of a 500-test suite
 * is not selection; it is Stryker's silent fallback to running the whole suite
 * for every mutant, which it takes whenever the dry run yields no per-test
 * coverage. Same verdict, many times the cost, announced nowhere.
 *
 * `coverageAnalysis: "perTest"` was already configured, and still is. It is not
 * a switch this issue could flip: measured on the same guard at a comparable
 * scope (four changed line ranges, 70 mutants), selection was in effect and the
 * run cost `6.21` tests per mutant of a 500-test suite — 2 minutes 28 seconds
 * at load average 4.61. What was missing was the instrument, not the setting.
 *
 * ## What these cases pin
 *
 * Both transcripts are real. `6.21 / 500` and its timing are the measured
 * post-change run; `267.22 / 500` is the figure the issue reported. Nothing
 * here recomputes an expectation by calling the function under test, and
 * nothing here is a threshold invented for the occasion — the block applies no
 * ceiling, deliberately, because the share that counts as "too much of the
 * suite" depends on how big the suite is.
 * @module tests/unit/scripts/lisa-mutation-selection-accounting
 */
import { describe, expect, it, vi } from "vitest";

import {
  OUTCOMES,
  accountForSelection,
  hasSelectionNumbers,
  parseSelection,
  reportRun,
  selectionBlock,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";

/** One escape byte, so a colour sequence can be written without a control literal. */
const ESCAPE = String.fromCharCode(27);

/** Stryker's dry-run line, as the logger actually draws it at `info`. */
const DRY_RUN_LINE =
  "01:08:54 (41665) INFO DryRunExecutor Initial test run succeeded. " +
  "Ran 500 tests in 1 minute and 2 seconds (net 57500.462 ms, overhead 4852.537 ms).";

/** Stryker's closing line. */
const DONE_LINE =
  "01:09:40 (41665) INFO MutationTestExecutor Done in 2 minutes and 28 seconds.";

/**
 * A whole transcript, with the clear-text reporter's cost line spliced in.
 * @param perMutant - The average the reporter printed
 * @returns The transcript
 */
const transcript = (perMutant: string): string =>
  [
    DRY_RUN_LINE,
    "Ran 70 mutants in 45 seconds.",
    `Ran ${perMutant} tests per mutant on average.`,
    DONE_LINE,
  ].join("\n");

/** The measured run in which per-mutant selection was in effect. */
const SELECTED = transcript("6.21");

/** The run the issue reported, in which it was not. */
const FULL_SUITE = transcript("267.22");

/** The clear-text table of a run that killed one mutant, so `reportRun` scores. */
const ONE_KILLED_TABLE = [
  "File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |",
  "All files  | 100.00 |  100.00 |        1 |         0 |          0 |        0 |        0 |",
].join("\n");

describe("parseSelection", () => {
  it("reads the suite size, the per-mutant average and the elapsed time", () => {
    expect(parseSelection(SELECTED)).toEqual({
      suiteTests: 500,
      testsPerMutant: 6.21,
      elapsed: "2 minutes and 28 seconds",
    });
  });

  it("reads the degraded run the issue measured", () => {
    expect(parseSelection(FULL_SUITE)).toEqual({
      suiteTests: 500,
      testsPerMutant: 267.22,
      elapsed: "2 minutes and 28 seconds",
    });
  });

  it("survives the colour the clear-text reporter writes under FORCE_COLOR", () => {
    const coloured = [
      `${ESCAPE}[32m${DRY_RUN_LINE}${ESCAPE}[39m`,
      `${ESCAPE}[1mRan 6.21 tests per mutant on average.${ESCAPE}[22m`,
    ].join("\n");

    expect(parseSelection(coloured)).toEqual({
      suiteTests: 500,
      testsPerMutant: 6.21,
      elapsed: null,
    });
  });

  it("reports each reading it did not get as null, never as zero", () => {
    // The two numbers come from surfaces that can be turned off separately —
    // the suite size from the logger, the average from the `clear-text`
    // reporter — so a run can lose one and keep the other. Zero is a
    // measurement; neither of these was taken.
    expect(parseSelection("Ran 6.21 tests per mutant on average.")).toEqual({
      suiteTests: null,
      testsPerMutant: 6.21,
      elapsed: null,
    });
    expect(parseSelection(DRY_RUN_LINE)).toEqual({
      suiteTests: 500,
      testsPerMutant: null,
      elapsed: null,
    });
  });

  it("returns null when there is no transcript at all", () => {
    expect(parseSelection("")).toBeNull();
    expect(parseSelection(null)).toBeNull();
    expect(parseSelection(undefined)).toBeNull();
  });
});

describe("hasSelectionNumbers", () => {
  it("is false when only the elapsed time was read", () => {
    // A timing with no denominator beside it is the shape this block replaces:
    // it is a fact about the machine and says nothing about the run's cost.
    expect(hasSelectionNumbers(parseSelection(DONE_LINE))).toBe(false);
  });

  it("is true when either number was read", () => {
    expect(hasSelectionNumbers(parseSelection(SELECTED))).toBe(true);
    expect(hasSelectionNumbers(parseSelection(DRY_RUN_LINE))).toBe(true);
  });

  it("is false for no transcript", () => {
    expect(hasSelectionNumbers(null)).toBe(false);
  });
});

describe("selectionBlock", () => {
  it("states the cost fraction, the elapsed time and the load beside it", () => {
    const block = selectionBlock(
      parseSelection(SELECTED),
      "4.61 / 4.00 / 4.62"
    );

    expect(block).toContain(OUTCOMES.selectionAccounting);
    expect(block).toContain(
      "6.21 test(s) ran per mutant, against an un-mutated suite of 500 — 1.24% of it."
    );
    expect(block).toContain(
      "elapsed 2 minutes and 28 seconds, at load average 4.61 / 4.00 / 4.62."
    );
  });

  it("prints the degraded run's fraction as the fraction it was", () => {
    // 267.22 of 500 is 53.44% of the suite per mutant. The block names the
    // number rather than a verdict about it: no ceiling is applied, because the
    // share that reads as degraded depends on how big the suite is.
    const block = selectionBlock(parseSelection(FULL_SUITE), "167 / 120 / 90");

    expect(block).toContain(
      "267.22 test(s) ran per mutant, against an un-mutated suite of 500 — 53.44% of it."
    );
    expect(block).not.toContain(OUTCOMES.selectionUnmeasured);
  });

  it("says NOT measured rather than guessing when a reading is missing", () => {
    const noAverage = selectionBlock(parseSelection(DRY_RUN_LINE), "1 / 1 / 1");
    const noSuite = selectionBlock(
      parseSelection("Ran 6.21 tests per mutant on average."),
      "1 / 1 / 1"
    );

    expect(noAverage).toContain("tests per mutant: NOT measured");
    expect(noSuite).toContain("un-mutated suite size: NOT measured");
    expect(noAverage).toContain("elapsed: NOT measured");
  });

  it("reports an unaccounted run as unaccounted, not as a cheap one", () => {
    const block = selectionBlock(parseSelection(DONE_LINE), "1 / 1 / 1");

    expect(block).toContain(OUTCOMES.selectionUnmeasured);
    expect(block).not.toContain(OUTCOMES.selectionAccounting);
  });
});

describe("reportRun prints the denominator beside the verdict", () => {
  it("prints it on a run that scored and passed", () => {
    // THE BITE. Pre-fix this run printed the timeout accounting and stopped,
    // so a 61-minute scoped run and a 2-minute one were indistinguishable in
    // the log that reported them.
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const reported = reportRun(process.cwd(), {
        code: 0,
        output: `${SELECTED}\n${ONE_KILLED_TABLE}`,
      });

      expect(reported.code).toBe(0);
      const printed = log.mock.calls.flat().join("\n");
      expect(printed).toContain(OUTCOMES.selectionAccounting);
      expect(printed).toContain("6.21 test(s) ran per mutant");
    } finally {
      log.mockRestore();
    }
  });

  it("stays silent about cost on a failure that never reached the mutant phase", () => {
    // A dry run killed by the clock has no denominator to report, and the
    // unmeasured block would be noise on a failure that already explained
    // itself. CONTROL for the case above: a fix that prints the block
    // unconditionally cannot pass both.
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      reportRun(process.cwd(), {
        code: 1,
        output: "Initial test run timed out!",
      });

      const printed = error.mock.calls.flat().join("\n");
      expect(printed).not.toContain(OUTCOMES.selectionAccounting);
      expect(printed).not.toContain(OUTCOMES.selectionUnmeasured);
    } finally {
      error.mockRestore();
    }
  });
});

describe("accountForSelection", () => {
  it("reads the machine's own load rather than taking one from the caller", () => {
    const block = accountForSelection(SELECTED);

    expect(block).toContain(OUTCOMES.selectionAccounting);
    expect(block).toContain("core(s).");
  });
});
