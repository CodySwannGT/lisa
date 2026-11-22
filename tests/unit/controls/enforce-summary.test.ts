/**
 * What the enforce report says about the required checks it ran on the
 * default branch, in its one-sentence summary and on the lines a person
 * reads.
 *
 * A check that could not be started, ran out of time or runs through the
 * project's task runner gives no answer. A run where every check ended that
 * way measured nothing, and must never read as "nothing fails"
 * (CodySwannGT/lisa#4994, R35).
 */
import { describe, expect, it } from "vitest";

import { runEnforceReport } from "../../../src/controls/commands/enforce-report.js";
import { summaryOf } from "../../../src/controls/enforce-summary.js";
import type {
  CurrentlyFailing,
  EnforceCounts,
  EnforceReport,
  FailingGate,
} from "../../../src/controls/enforce-types.js";

const COUNTS: EnforceCounts = {
  blocked: 0,
  ticketed: 0,
  wired: 2,
  "nothing-to-enforce": 0,
};

const STYLE_ENTRY = "code-style@.";
const TYPES_ENTRY = "types@api";

const FAILING_GATE: FailingGate = {
  command: ["ruff", "check", "."],
  criteria: ["SI7"],
  entry_id: STYLE_ENTRY,
  exit_status: 1,
  gate: "code-style",
  judged: "failed",
  matched_failure_shape: null,
  output_excerpt: "Found 1 error",
  output_truncated: false,
  scope: ".",
};

/**
 * A measurement of the default branch.
 * @param checked - How many checks ran to an answer
 * @param failing - How many of those do not pass
 * @param unanswered - The ids of the checks that gave no answer
 * @returns The section of the report
 */
function measurement(
  checked: number,
  failing: number,
  unanswered: readonly string[] = []
): CurrentlyFailing {
  return {
    checked,
    gates: Array.from({ length: failing }, () => FAILING_GATE),
    head: {
      branch: "main",
      chosen_by: "origin-head",
      commit: "0123456789abcdef",
      ref: "refs/remotes/origin/main",
    },
    measured: true,
    not_measured: unanswered.map(id => ({
      entry_id: id,
      reason: "It could not be started: the program is not on the PATH.",
    })),
    reason: "How the checks were run.",
  };
}

/**
 * Run the command on a ready-made report, catching what it tells a person.
 * @param failing - The report's measurement of the default branch
 * @returns The lines it wrote for a person
 */
async function linesFor(failing: CurrentlyFailing): Promise<readonly string[]> {
  const lines: string[] = [];
  const report: EnforceReport = {
    changes: [],
    counts: COUNTS,
    criteria: [],
    currently_failing: failing,
    entries: [],
    limits: [],
    reason: summaryOf(COUNTS, [], failing),
    requirements: 2,
    schema_version: 1,
  };
  await runEnforceReport(
    ".",
    {},
    {
      build: () => Promise.resolve({ problems: null, report }),
      stderr: line => lines.push(line),
      stdout: () => undefined,
    }
  );
  return lines;
}

describe("the summary of the checks run on the default branch", () => {
  it("says how many ran and how many of those do not pass", () => {
    expect(summaryOf(COUNTS, [], measurement(3, 1))).toContain(
      "3 required checks ran on main as it stands: 1 does not pass."
    );
  });

  it("also says how many gave no answer", () => {
    const summary = summaryOf(COUNTS, [], measurement(2, 0, [TYPES_ENTRY]));

    expect(summary).toContain(
      "2 required checks ran on main as it stands: 0 do not pass."
    );
    expect(summary).toContain(
      "1 more gave no answer, so nothing is known about it."
    );
  });

  it("does not read as a clean result when no check gave an answer", () => {
    const summary = summaryOf(
      COUNTS,
      [],
      measurement(0, 0, [STYLE_ENTRY, TYPES_ENTRY])
    );

    expect(summary).toContain(
      "None of the 2 required checks gave an answer on main as it stands, so whether they pass there is not known."
    );
    expect(summary).not.toContain("do not pass");
    expect(summary).not.toContain("does not pass");
  });

  it("says nothing about the checks when they were not run at all", () => {
    const summary = summaryOf(COUNTS, [], {
      ...measurement(0, 0),
      head: null,
      measured: false,
    });

    expect(summary).toMatch(/reported 0 changes\.$/u);
  });
});

describe("the lines a person reads", () => {
  it("name each check that gave no answer, with why", async () => {
    const lines = await linesFor(measurement(0, 0, [STYLE_ENTRY, TYPES_ENTRY]));

    expect(lines.filter(line => line.includes("gave no answer on"))).toEqual([
      "enforce-report: code-style@. gave no answer on main, so it is not known whether it passes there. It could not be started: the program is not on the PATH.",
      "enforce-report: types@api gave no answer on main, so it is not known whether it passes there. It could not be started: the program is not on the PATH.",
    ]);
  });

  it("do not open with a count of zero failing checks when nothing was measured", async () => {
    const [first] = await linesFor(measurement(0, 0, [STYLE_ENTRY]));

    expect(first).toContain("The 1 required check gave no answer on main");
    expect(first).not.toContain("0 required checks do not pass");
  });

  it("name no unanswered check when every check gave an answer", async () => {
    const lines = await linesFor(measurement(2, 1));

    expect(lines.some(line => line.includes("gave no answer"))).toBe(false);
  });
});
