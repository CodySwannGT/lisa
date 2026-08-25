/**
 * The mutation gate's timeout accounting (CodySwannGT/lisa#2989).
 *
 * ## The defect
 *
 * **Stryker scores a timed-out mutant as KILLED.** A mutant whose covering
 * tests exceed the per-mutant budget is counted as detected, identically to one
 * an assertion caught — and which mutants land in that bucket depends on how
 * busy the machine was. The consequence is perverse and worth stating plainly:
 * **a slower box yields a better score.**
 *
 * One whole-list run measured `killed 3338 | timedOut 117 | survived 1027 |
 * noCoverage 1371 | errors 191`, scoring 59.03 total and 77.09 covered. That is
 * 117 of 3,455 detected — 3.39% — and reclassifying every timeout as survived
 * gives 57.03 and 74.48. **Up to 2.00 points of that score were decided by a
 * stopwatch.**
 *
 * ## What these cases pin
 *
 * Every number in this file is the measured run above, hardcoded. Nothing here
 * recomputes an expectation by calling the function under test, and nothing
 * here is a threshold invented for the occasion.
 *
 * The load-bearing case is `fails a run that cleared the floor only because
 * timeouts were credited`. Under the pre-fix gate that run exits 0 — Stryker
 * said so, and the gate passed Stryker's status straight through. It is the
 * whole difference between reporting the inflation and refusing it.
 * @module tests/unit/scripts/lisa-mutation-timeout-accounting
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TIMEOUT_SHARE_CEILING_PCT,
  MIN_DETECTED_FOR_SHARE,
  OUTCOMES,
  accountForTimeouts,
  judgeTimeoutAccounting,
  parseMutantTally,
  resolveBreakThreshold,
  resolveTimeoutShareCeiling,
  timeoutAccounting,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";

/**
 * The clear-text reporter's table, as it is actually drawn.
 *
 * Transcribed from `ClearTextScoreTable` rendering the measured run, not
 * paraphrased: the column order, the separators and the padding are the format
 * the parser has to survive, and a hand-written approximation of them would
 * pass a parser that the real thing defeats.
 * @param row - The `All files` row's cells, already padded
 * @returns The whole table
 */
const table = (row: string): string =>
  [
    "-----------|------------------|----------|-----------|------------|----------|----------|",
    "           | % Mutation score |          |           |            |          |          |",
    "File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |",
    "-----------|--------|---------|----------|-----------|------------|----------|----------|",
    row,
    " guard.mjs |  12.50 |   20.00 |        1 |         0 |         7 |        0 |        0 |",
    "-----------|--------|---------|----------|-----------|------------|----------|----------|",
  ].join("\n");

/** The measured whole-list run's `All files` row. */
const MEASURED_ROW =
  "All files  |  59.03 |   77.09 |     3338 |       117 |       1027 |     1371 |      191 |";

/** The same run, as a whole transcript. */
const MEASURED_TABLE = table(MEASURED_ROW);

/** One escape byte, so a colour sequence can be written without a control literal. */
const ESCAPE = String.fromCharCode(27);

/** The Stryker config file name the gate reads a break threshold from. */
const STRYKER_CONF = "stryker.conf.json";

describe("reading the mutant tally", () => {
  it("reads the All files row of a real clear-text table", () => {
    expect(parseMutantTally(MEASURED_TABLE)).toEqual({
      killed: 3338,
      timedOut: 117,
      survived: 1027,
      noCoverage: 1371,
      errors: 191,
    });
  });

  it("reads the aggregate row, not a per-file one", () => {
    // The table lists every file under `All files`. A parser that took the
    // first numeric row it found would report one guard's counts as the run's,
    // which on this table is 1 killed of 8.
    expect(parseMutantTally(MEASURED_TABLE)?.killed).toBe(3338);
  });

  it("reads a row chalk has coloured", () => {
    // The score cells are coloured, and FORCE_COLOR in CI turns that on even
    // under a pipe. A parser that assumed a plain pipe would go blind exactly
    // where the output is being read from a CI log.
    const coloured = table(
      `All files  | ${ESCAPE}[33m 59.03${ESCAPE}[39m | ${ESCAPE}[33m  77.09${ESCAPE}[39m |     3338 |       117 |       1027 |     1371 |      191 |`
    );

    expect(parseMutantTally(coloured)?.timedOut).toBe(117);
  });

  it("returns null when no table was printed, rather than zero", () => {
    // The distinction the whole gate turns on. Null means the share was not
    // measured; zero would mean it was measured and found clean.
    expect(parseMutantTally("Mutation testing 100% 40/40 tested")).toBeNull();
    expect(parseMutantTally("")).toBeNull();
    expect(parseMutantTally(null)).toBeNull();
  });
});

describe("the arithmetic", () => {
  const accounting = timeoutAccounting({
    killed: 3338,
    timedOut: 117,
    survived: 1027,
    noCoverage: 1371,
  });

  it("reproduces the score Stryker reported", () => {
    expect(accounting.reported).toBeCloseTo(59.03, 2);
    expect(accounting.reportedCovered).toBeCloseTo(77.09, 2);
  });

  it("recomputes it with the timeouts not credited", () => {
    expect(accounting.withoutTimeouts).toBeCloseTo(57.03, 2);
    expect(accounting.coveredWithoutTimeouts).toBeCloseTo(74.48, 2);
  });

  it("reports the share of detection that was a stopwatch reading", () => {
    expect(accounting.detected).toBe(3455);
    expect(accounting.timedOutShare).toBeCloseTo(3.39, 2);
  });

  it("leaves errors out of every denominator, as Stryker does", () => {
    // 3338 + 117 + 1027 + 1371 = 5853. Including the 191 errors would give
    // 6044 and a reported score of 57.16 — a number Stryker never printed.
    expect(accounting.total).toBe(5853);
  });

  it("says n/a rather than dividing by nothing", () => {
    const empty = timeoutAccounting({
      killed: 0,
      timedOut: 0,
      survived: 0,
      noCoverage: 0,
    });

    expect(Number.isNaN(empty.reported)).toBe(true);
    expect(Number.isNaN(empty.timedOutShare)).toBe(true);
  });
});

describe("judging a completed run", () => {
  it("passes a run whose honest score still clears the floor", () => {
    const verdict = judgeTimeoutAccounting(
      { killed: 3338, timedOut: 117, survived: 1027, noCoverage: 1371 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.measured).toBe(true);
    expect(verdict.message).toContain(OUTCOMES.timeoutAccounting);
    expect(verdict.message).toContain("117 of 3455 detected");
    expect(verdict.message).toContain("59.03");
    expect(verdict.message).toContain("57.03");
    expect(verdict.message).toContain("3.39%");
  });

  it("fails a run that cleared the floor only because timeouts were credited", () => {
    // Reported 40.00, honest 20.00, floor 32. Stryker exits 0 on this run —
    // it scores the 20 timeouts as kills — and the gate used to pass that
    // status straight through. THE BITE.
    const verdict = judgeTimeoutAccounting(
      { killed: 20, timedOut: 20, survived: 60, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain(OUTCOMES.inflatedByTimeouts);
    expect(verdict.message).toContain("20.00 against a break threshold of 32");
    expect(verdict.message).toContain("a slower box would have");
    // Naming the wrong remedy is half the point: raising the budget converts
    // a timeout into a slow pass and hides the identical gap.
    expect(verdict.message).toContain('Do NOT raise\n   "timeoutMS"');
  });

  it("fails a run where too much of the detection was the clock", () => {
    // Honest score 60.00 clears the floor, so the check above says nothing.
    // 40 of 100 detected is 40% — the score is a fact about the machine.
    const verdict = judgeTimeoutAccounting(
      { killed: 60, timedOut: 40, survived: 0, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain(OUTCOMES.timeoutShareExceeded);
    expect(verdict.message).toContain("40.00% of what this run counted");
    expect(verdict.message).toContain("ceiling of 5%");
  });

  it("reports the share without enforcing it on too small a sample", () => {
    // 1 of 8 detected is 12.5%, over the ceiling — and it is one mutant. The
    // diff-only gate runs at this size routinely, and failing a push on it
    // would be the false red this gate's own "a timeout is not a score"
    // section exists to prevent.
    const verdict = judgeTimeoutAccounting(
      { killed: 7, timedOut: 1, survived: 0, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain("12.50%");
    expect(verdict.message).toContain(
      `NOT enforced below ${MIN_DETECTED_FOR_SHARE} detected mutants`
    );
  });

  it("does not invent a floor for a project that declared none", () => {
    // Stryker's own default is no breaking threshold at all. Failing a gate
    // against a number nobody chose is the defect one section up in the gate,
    // arriving from the other direction.
    const verdict = judgeTimeoutAccounting(
      { killed: 1, timedOut: 39, survived: 60, noCoverage: 0 },
      null,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.message).not.toContain(OUTCOMES.inflatedByTimeouts);
  });

  it("names the inflation before the share when both are true", () => {
    // Both fire on this run. The inflation is the one that says the FLOOR was
    // not really cleared, which is the more consequential of the two.
    const verdict = judgeTimeoutAccounting(
      { killed: 1, timedOut: 60, survived: 39, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain(OUTCOMES.inflatedByTimeouts);
    expect(verdict.message).not.toContain(OUTCOMES.timeoutShareExceeded);
  });
});

describe("the ceiling in force", () => {
  const saved = process.env["MUTATION_TIMEOUT_SHARE_MAX"];

  afterEach(() => {
    if (saved === undefined) delete process.env["MUTATION_TIMEOUT_SHARE_MAX"];
    else process.env["MUTATION_TIMEOUT_SHARE_MAX"] = saved;
  });

  it("defaults to the committed constant", () => {
    delete process.env["MUTATION_TIMEOUT_SHARE_MAX"];

    expect(resolveTimeoutShareCeiling()).toBe(5);
    expect(DEFAULT_TIMEOUT_SHARE_CEILING_PCT).toBe(5);
  });

  it("takes an override for one run", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "1.5";

    expect(resolveTimeoutShareCeiling()).toBe(1.5);
  });

  it("falls back rather than reading nonsense as a ceiling", () => {
    // `MUTATION_TIMEOUT_SHARE_MAX=huge` must not become NaN, which compares
    // false against everything and would disable the check in silence.
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "huge";

    expect(resolveTimeoutShareCeiling()).toBe(5);
  });

  // CodySwannGT/lisa#3078. Empty was the ONE non-numeric spelling that did not
  // fall back: `Number("")` is 0, and 0 passes `Number.isFinite` and `>= 0`, so
  // the case just above resolved 5 and this one resolved 0 — the strictest
  // ceiling available, failing on the first timed-out mutant, chosen by nobody.
  // Set-but-empty is what Actions produces when an unset input is mapped into
  // `env:`, so the value is the harness's silence, not a declaration.
  it("reads a set-but-empty variable as unset, not as a ceiling of 0", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "";

    expect(resolveTimeoutShareCeiling()).toBe(5);
  });

  it("reads a whitespace-only variable as unset too", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "   ";

    expect(resolveTimeoutShareCeiling()).toBe(5);
  });

  // Control for the two cases above: a ceiling of 0 stays reachable, because a
  // project may genuinely want to refuse any clock-decided mutant. What changes
  // is that it must be asked for in a character rather than arrived at through
  // an absent one.
  it("still honours an explicit zero", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "0";

    expect(resolveTimeoutShareCeiling()).toBe(0);
  });

  // Control for the two cases above: a real number is still read as itself, so
  // the empty-string handling narrowed nothing that was working.
  it("still reads an ordinary integer override as itself", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "12";

    expect(resolveTimeoutShareCeiling()).toBe(12);
  });

  // The consequence, not just the number. A run with 2 timeouts in 100 detected
  // is 2% — inside the committed 5% ceiling — and used to go red under an empty
  // variable purely because the ceiling had collapsed to 0.
  it("does not fail a run the default clears when the variable is empty", () => {
    process.env["MUTATION_TIMEOUT_SHARE_MAX"] = "";

    const verdict = judgeTimeoutAccounting(
      { killed: 98, timedOut: 2 },
      null,
      resolveTimeoutShareCeiling()
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.message).not.toContain(OUTCOMES.timeoutShareExceeded);
  });
});

describe("the break threshold the accounting is judged against", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-thresholds-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads thresholds.break from the project's Stryker config", () => {
    fs.writeFileSync(
      path.join(root, STRYKER_CONF),
      JSON.stringify({ thresholds: { high: 80, low: 40, break: 32 } })
    );

    expect(resolveBreakThreshold(root)).toBe(32);
  });

  it("returns null when the project declared none", () => {
    fs.writeFileSync(
      path.join(root, STRYKER_CONF),
      JSON.stringify({ thresholds: { high: 80, low: 40 } })
    );

    expect(resolveBreakThreshold(root)).toBeNull();
  });

  it("returns null when there is no config at all", () => {
    expect(resolveBreakThreshold(root)).toBeNull();
  });
});

describe("accounting for a run end to end", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-accounting-"));
    fs.writeFileSync(
      path.join(root, STRYKER_CONF),
      JSON.stringify({ thresholds: { break: 32 } })
    );
    vi.stubEnv("MUTATION_TIMEOUT_SHARE_MAX", "");
    delete process.env["MUTATION_TIMEOUT_SHARE_MAX"];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accounts for a transcript that carries a table", () => {
    const verdict = accountForTimeouts(MEASURED_TABLE, root);

    expect(verdict.measured).toBe(true);
    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain("57.03");
  });

  it("says the share was not measured rather than assuming it was zero", () => {
    const verdict = accountForTimeouts("Stryker said nothing useful", root);

    expect(verdict.measured).toBe(false);
    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain(OUTCOMES.timeoutUnmeasured);
    expect(verdict.message).toContain("NOT measured");
    expect(verdict.message).toContain("not a claim it was zero");
  });
});

describe("naming the floor a verdict was judged against", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-floor-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("names the floor and its value on a run that cleared it", () => {
    // The measured whole-list run: reported 59.03, honest 57.03, floor 32.
    // Pre-fix this verdict printed the accounting block and stopped, so a
    // reader could not tell a run that cleared 60 from one that cleared 5.
    // THE BITE.
    const verdict = judgeTimeoutAccounting(
      { killed: 3338, timedOut: 117, survived: 1027, noCoverage: 1371 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain(OUTCOMES.clearedBreakThreshold);
    expect(verdict.message).toContain("57.03 against a break threshold of 32");
  });

  it("names WHICH floor, not just a number, on a run that cleared it", () => {
    // Two mutation floors exist and deliberately differ, so a bare value is
    // still ambiguous about which one was enforced.
    const verdict = judgeTimeoutAccounting(
      { killed: 3338, timedOut: 117, survived: 1027, noCoverage: 1371 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.message).toContain('"thresholds.break" in your');
  });

  it("says no floor was applied rather than naming 0 when none is declared", () => {
    // A project that declared no break threshold has not asked for a floor.
    // Reporting one as `0` would invent a number nobody chose — the same
    // defect `resolveBreakThreshold` returns null to avoid.
    const verdict = judgeTimeoutAccounting(
      { killed: 3338, timedOut: 117, survived: 1027, noCoverage: 1371 },
      null,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain(OUTCOMES.noFloorApplied);
    expect(verdict.message).not.toContain(OUTCOMES.clearedBreakThreshold);
    expect(verdict.message).not.toContain("break threshold of 0");
  });

  it("says no floor was applied when the run produced no score", () => {
    // A floor is declared, but an empty tally scores NaN: there is nothing to
    // judge against it, and claiming it cleared 32 would be a fabrication.
    const verdict = judgeTimeoutAccounting(
      { killed: 0, timedOut: 0, survived: 0, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain(OUTCOMES.noFloorApplied);
    expect(verdict.message).toContain("no score to");
    expect(verdict.message).not.toContain(OUTCOMES.clearedBreakThreshold);
  });

  it("names the floor end to end on a transcript that cleared it", () => {
    fs.writeFileSync(
      path.join(root, STRYKER_CONF),
      JSON.stringify({ thresholds: { break: 32 } })
    );

    const verdict = accountForTimeouts(MEASURED_TABLE, root);

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain(OUTCOMES.clearedBreakThreshold);
    expect(verdict.message).toContain("57.03 against a break threshold of 32");
  });

  it("CONTROL: the failing verdict still names its floor and its value", () => {
    // The failing arm already named both numbers before this change. If a fix
    // to the passing path breaks the failing one, the pass above is worthless
    // — this is what makes it a measurement rather than a broken harness.
    const verdict = judgeTimeoutAccounting(
      { killed: 20, timedOut: 20, survived: 60, noCoverage: 0 },
      32,
      DEFAULT_TIMEOUT_SHARE_CEILING_PCT
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain(OUTCOMES.inflatedByTimeouts);
    expect(verdict.message).toContain("20.00 against a break threshold of 32");
    expect(verdict.message).not.toContain(OUTCOMES.clearedBreakThreshold);
  });
});
