/**
 * The paired proof of a control, run for real (CodySwannGT/lisa#4995).
 *
 * Every case builds a repository with a declared control and its two patch
 * files, makes a disposable copy, and lets the runner plant each change and
 * start the control's own check there. The checks are small programs, but
 * they are started, stopped and read exactly as a gate's command is.
 * @module tests/unit/controls/proof-runner
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CONTROL_AUDIT_FIXTURE_FILES } from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  FAILS_FOR_ANOTHER_REASON,
  FAILURE_TEXT,
  NEVER_FINISHES,
  PROOFS,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
} from "../../helpers/control-proofs.js";
import { only, proved, removeCopies } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const ENTRY = "code-style@.";
const WORKING = checks(F_NONE_SOURCE);

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("a control whose check works", () => {
  it("passes: the violating change is rejected and the clean one accepted", async () => {
    const run = await proved(provedGates([{ command: WORKING }]));
    const entry = only(run);

    expect(entry).toMatchObject({
      entry_id: ENTRY,
      gate: "code-style",
      scope: ".",
      criteria: ["SI7"],
      moment: "commit",
      outcome: "passed",
      failed_halves: [],
      reason: "proved",
    });
    expect(entry.halves.map(half => [half.half, half.outcome])).toEqual([
      ["violation", "rejected"],
      ["clean", "accepted"],
    ]);
    expect(run.passed).toBe(true);
    expect(run.counts).toEqual({
      passed: 1,
      failed: 0,
      unproved: 0,
      unknown: 0,
    });
  });

  it("records each half as it happened", async () => {
    const [violation, clean] = only(
      await proved(provedGates([{ command: WORKING }]))
    ).halves;

    expect(violation).toEqual({
      entry_id: ENTRY,
      half: "violation",
      moment: "commit",
      patch: `${PROOFS}/lint.violation.patch`,
      command: WORKING,
      exit_status: 1,
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:00:01.000Z",
      output_excerpt: `${F_NONE_SOURCE}:1: planted violation\n${FAILURE_TEXT}\n`,
      output_truncated: false,
      matched_lines: [FAILURE_TEXT],
      outcome: "rejected",
      reason: "rejected-as-declared",
      detail: expect.stringContaining("turned this change away") as string,
    });
    expect(clean).toMatchObject({
      half: "clean",
      patch: `${PROOFS}/lint.clean.patch`,
      exit_status: 0,
      started_at: "2026-01-01T00:00:02.000Z",
      completed_at: "2026-01-01T00:00:03.000Z",
      output_excerpt: "All checks passed\n",
      matched_lines: [],
      outcome: "accepted",
      reason: "accepted",
    });
  });

  it("leaves the copy exactly as it found it", async () => {
    const { where } = await proved(provedGates([{ command: WORKING }]));

    expect(
      readFileSync(path.join(where.workspace, F_NONE_SOURCE), "utf8")
    ).toBe(CONTROL_AUDIT_FIXTURE_FILES["F-none"][F_NONE_SOURCE]);
  });

  it("never touches the repository the copy was made from", async () => {
    const { where } = await proved(provedGates([{ command: WORKING }]));

    expect(readFileSync(path.join(where.repoPath, F_NONE_SOURCE), "utf8")).toBe(
      CONTROL_AUDIT_FIXTURE_FILES["F-none"][F_NONE_SOURCE]
    );
  });

  it("passes in a copy that is not a git repository", async () => {
    const run = await proved(provedGates([{ command: WORKING }]), {
      withGit: false,
    });

    expect(only(run).outcome).toBe("passed");
  });
});

describe("a control whose check does not work", () => {
  it("fails on the clean half when the check rejects everything", async () => {
    const entry = only(
      await proved(provedGates([{ command: REJECTS_EVERYTHING }]))
    );

    expect(entry).toMatchObject({
      outcome: "failed",
      failed_halves: ["clean"],
      reason: "clean-rejected",
    });
    expect(entry.detail).toContain("clean change");
    expect(entry.halves.map(half => half.outcome)).toEqual([
      "rejected",
      "rejected",
    ]);
  });

  it("fails on the violating half when the check accepts everything", async () => {
    const run = await proved(provedGates([{ command: ACCEPTS_EVERYTHING }]));
    const entry = only(run);

    expect(entry).toMatchObject({
      outcome: "failed",
      failed_halves: ["violation"],
      reason: "violation-accepted",
    });
    expect(entry.detail).toContain("violating change");
    expect(run.passed).toBe(false);
  });

  it("is unknown when the violating change is rejected for another reason", async () => {
    const entry = only(
      await proved(provedGates([{ command: FAILS_FOR_ANOTHER_REASON }]))
    );

    expect(entry).toMatchObject({
      outcome: "unknown",
      failed_halves: [],
      reason: "wrong-reason",
    });
    expect(entry.halves[0]).toMatchObject({
      exit_status: 2,
      outcome: "unknown",
      reason: "wrong-reason",
      output_excerpt: "configuration file not found\n",
    });
    expect(entry.detail).toContain(FAILURE_TEXT);
  });

  it("is unknown when a half is still running at its time limit, and stops it", async () => {
    const entry = only(
      await proved(
        provedGates([{ command: NEVER_FINISHES, timeout_seconds: 1 }])
      )
    );

    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "timed-out",
      time_limit_seconds: 1,
    });
    expect(entry.halves.map(half => [half.exit_status, half.reason])).toEqual([
      [null, "timed-out"],
      [null, "timed-out"],
    ]);
    expect(entry.detail).toContain("1 second");
  });
});

describe("a control with half a proof", () => {
  it.each(["violation", "clean"] as const)(
    "is unproved when the declaration names no %s change, and runs nothing",
    async half => {
      const entry = only(
        await proved(provedGates([{ command: WORKING, without: [half] }]))
      );

      expect(entry).toMatchObject({
        outcome: "unproved",
        reason: "half-missing",
        failed_halves: [],
        halves: [],
        time_limit_seconds: null,
      });
      expect(entry.detail).toContain(half);
    }
  );

  it("is unproved when a named patch file is not there", async () => {
    const { violation } = proofPatches("F-none", F_NONE_SOURCE);
    const entry = only(
      await proved(provedGates([{ command: WORKING }]), {
        files: { [`${PROOFS}/lint.violation.patch`]: violation },
      })
    );

    expect(entry).toMatchObject({
      outcome: "unproved",
      reason: "half-missing",
      halves: [],
    });
    expect(entry.detail).toContain(`${PROOFS}/lint.clean.patch`);
  });

  it("goes from passed to unproved when one half is taken away", async () => {
    const files = proofFiles(proofPatches("F-none", F_NONE_SOURCE));
    const whole = await proved(provedGates([{ command: WORKING }]), { files });
    const halved = await proved(
      provedGates([{ command: WORKING, without: ["clean"] }]),
      { files }
    );

    expect([only(whole).outcome, only(halved).outcome]).toEqual([
      "passed",
      "unproved",
    ]);
  });

  it("is unproved with no proof declared at all", async () => {
    const entry = only(
      await proved(
        provedGates([{ command: WORKING, without: ["violation", "clean"] }])
      )
    );

    expect(entry.outcome).toBe("unproved");
    expect(entry.detail).toContain("violating");
    expect(entry.detail).toContain("clean");
  });
});
