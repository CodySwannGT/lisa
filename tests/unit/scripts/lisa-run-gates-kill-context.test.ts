/**
 * Tests that the kill note actually reaches the report a reader sees.
 *
 * `kill-marks.test.ts` proves the note's content. This file proves it is
 * emitted, and — the half that is easy to get wrong — that it is emitted
 * ONLY beside a result that went wrong. Attached to a clean pass it would
 * appear on every run for an hour after any kill, and a line nobody reads is
 * a line that cannot help the one time it matters (CodySwannGT/lisa#3653).
 * @module tests/unit/scripts/lisa-run-gates-kill-context
 */

import { describe, expect, it } from "vitest";

import { runGates } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateRun,
  LINT_COMMAND,
  REQUIRED_AT_COMMIT,
  RUNNER,
  sink,
  stubExec,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

/** The phrase that opens the note, and the thing every case keys off. */
const NOTE = "CONTEXT, not a cause";

/** One mark, as an earlier run would have left it. */
const EARLIER = [
  {
    kind: "killed",
    gateId: "test-correctness",
    at: Date.now() - 60_000,
    pid: 111,
  },
];

/**
 * Run one required gate with a stated exit code and a stated machine history.
 * @param code - Exit code for the lint command
 * @param priorKills - Marks left by earlier runs
 * @returns The printed lines.
 */
function report(code: number, priorKills: readonly object[]): string[] {
  const { exec } = stubExec({ [LINT_COMMAND]: code });
  const { lines, out } = sink();
  runGates({
    gates: { [STYLE]: REQUIRED_AT_COMMIT },
    moment: COMMIT,
    runner: RUNNER,
    exec,
    out,
    priorKills,
  }) as GateRun;
  return lines;
}

describe("a failure that follows a killed run says so", () => {
  it("prints the note when a gate went unproved", () => {
    expect(report(1, EARLIER).join("\n")).toContain(NOTE);
  });

  it("names when the earlier run was terminated", () => {
    // The criterion asks for the time explicitly: a reader needs to line the
    // kill up against their own timeline to judge whether it is relevant.
    expect(report(1, EARLIER).join("\n")).toMatch(/killed at \d{2}:\d{2}/);
  });

  it("does not assert the kill caused this failure", () => {
    const text = report(1, EARLIER).join("\n");

    expect(text).toContain("does NOT explain the result above");
    expect(text).not.toMatch(/caused by|because of the kill|explains this/i);
  });
});

describe("the note stays out of the way when it would be noise", () => {
  it("is absent from a clean pass, even with a recent kill on record", () => {
    // The whole run passed. Nothing here needs context, and an unexplained
    // interruption on a green report teaches the reader to skip the line.
    expect(report(0, EARLIER).join("\n")).not.toContain(NOTE);
  });

  it("is absent when no earlier run was terminated", () => {
    expect(report(1, []).join("\n")).not.toContain(NOTE);
  });

  it("does not displace the failure it accompanies", () => {
    // The verdict stays the headline. A context line that pushed the actual
    // result out of view would be a worse report than no line at all.
    const lines = report(1, EARLIER);

    expect(lines.some(line => line.includes("required gate FAILED"))).toBe(
      true
    );
  });
});
