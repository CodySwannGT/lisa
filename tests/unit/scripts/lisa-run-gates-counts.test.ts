/**
 * Tests for the summary line that claims to state every count.
 *
 * The headline reads `N proved, M failed (optional), K not applicable here, of
 * T gate(s) declared`, under a comment saying "Every count is stated, including
 * the ones that are zero, so the headline can never imply more was proved than
 * actually ran." Two buckets were missing from it: `unprovable` and `killed`.
 *
 * Both are reachable on the path that prints this line. It is only reached when
 * the run is NOT blocked, and `blocked` is set exclusively by a REQUIRED gate
 * going unproved — so an OPTIONAL gate that was killed by the machine, or that
 * ran and proved nothing because a shared prover failed elsewhere, leaves the
 * run unblocked and lands in a bucket the headline never mentions.
 *
 * That is worse than a headline that never claimed completeness. A reader who
 * has been told every count is stated subtracts: `T` minus the numbers printed
 * is what they take to be unaccounted, and here it silently was not zero. The
 * summary above the line names each such gate individually, so the omission is
 * not invisible — it is contradicted, which is the more expensive shape,
 * because the two halves of the same report disagree.
 * @module tests/unit/scripts/lisa-run-gates-counts
 */

import { describe, expect, it } from "vitest";

import { runGates } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateRun,
  LEAKAGE,
  LINT_COMMAND,
  LINT_TASK,
  RUNNER,
  sink,
  STYLE,
  stubExec,
} from "./lisa-run-gates-fixtures.js";

/** A transcript nothing in the classifier recognises, so nothing is proved. */
const UNRECOGNISED = "the widget exploded, and took the build with it";

/** The unblocked headline every assertion below reads. */
const HEADLINE = /gate\(s\) declared\./u;

/**
 * The one summary line that carries the counts.
 * @param lines - Everything the runner printed
 * @returns The headline
 */
const headline = (lines: string[]): string =>
  lines.find(line => HEADLINE.test(line)) ?? "";

/**
 * Run a gates block with stubbed exit codes and return the printed lines.
 * @param gates - The gates block
 * @param codes - Exit code per command
 * @returns The run and the printed lines
 */
function run(
  gates: Record<string, unknown>,
  codes: Record<string, number | null>
): { result: GateRun; lines: string[] } {
  const { exec } = stubExec(codes);
  const { lines, out } = sink();
  const result = runGates({
    gates,
    moment: COMMIT,
    runner: RUNNER,
    exec,
    out,
  }) as GateRun;
  return { result, lines };
}

describe("the counts line on an unblocked run", () => {
  it("states the killed count when an optional gate was killed", () => {
    // `null` is what the executor reports for a command a signal terminated.
    const { result, lines } = run(
      {
        [STYLE]: { [COMMIT]: { level: "optional", run: LINT_TASK } },
        [LEAKAGE]: { [COMMIT]: "required" },
      },
      { [LINT_COMMAND]: null }
    );

    expect(result.blocked).toBe(false);
    expect(result.killed).toHaveLength(1);
    expect(headline(lines)).toContain("1 killed");
  });

  it("states the unprovable count when an optional gate proved nothing", () => {
    // Exit 1 with a transcript carrying no recognised failure signature: the
    // command ran, and nothing it printed says the property was found wanting.
    const { lines, out } = sink();
    const result = runGates({
      gates: {
        [STYLE]: { [COMMIT]: { level: "optional", run: LINT_TASK } },
        [LEAKAGE]: { [COMMIT]: "required" },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec: (command: string) =>
        command === LINT_COMMAND ? { code: 1, output: UNRECOGNISED } : 0,
      out,
    }) as GateRun;

    expect(result.blocked).toBe(false);
    expect(result.unprovable).toHaveLength(1);
    expect(headline(lines)).toContain("1 not proved");
  });

  it("states both counts as zero when neither bucket has anything in it", () => {
    // The comment's own claim: the zeroes are stated too, so a reader never
    // has to decide whether an absent number means zero or means unmeasured.
    const { result, lines } = run({ [LEAKAGE]: { [COMMIT]: "required" } }, {});

    expect(result.blocked).toBe(false);
    expect(headline(lines)).toContain("0 not proved");
    expect(headline(lines)).toContain("0 killed");
  });

  it("prints counts that sum to the declared total", () => {
    // The invariant the comment asserts. Every gate reachable on this path is
    // in exactly one of the five buckets, so the numbers add up to `total` —
    // which is the only thing that makes subtracting from `total` meaningful.
    const { result, lines } = run(
      {
        [STYLE]: { [COMMIT]: { level: "optional", run: LINT_TASK } },
        [LEAKAGE]: { [COMMIT]: "required" },
      },
      { [LINT_COMMAND]: null }
    );

    const stated = [...headline(lines).matchAll(/(\d+) [a-z]/gu)].map(match =>
      Number(match[1])
    );
    // The last number in the line is `of T gate(s) declared`, not a bucket.
    const buckets = stated.slice(0, -1);
    expect(buckets.reduce((sum, count) => sum + count, 0)).toBe(result.total);
  });
});
