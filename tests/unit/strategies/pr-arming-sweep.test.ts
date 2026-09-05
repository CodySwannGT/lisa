/**
 * Regression coverage for unarmed-pull-request detection (#3903).
 *
 * A green PR with `autoMergeRequest: null` waits forever and nothing reports
 * it, because green-and-unarmed and green-and-waiting read identically on every
 * surface anyone checks. The detector added here is the positive assertion that
 * was missing.
 *
 * Two properties carry the weight, and both are pinned here rather than left to
 * the happy path:
 *
 * 1. **The detector must FIRE.** Its healthy state is an empty report, so a
 *    mistyped field path returns empty and looks exactly like a clean queue.
 *    The rejection control below runs it against a recorded unarmed pull
 *    request and asserts it is reported.
 * 2. **"Unarmed" and "not checked" are different answers.** A payload with no
 *    `autoMergeRequest` key was never asked, and must not be reported as armed
 *    or folded into a clean sweep.
 * @module tests/unit/strategies/pr-arming-sweep
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_PR_FIELDS,
  classifyPullRequestArming,
  formatPullRequestArmingReport,
  pullRequestArmingExitCode,
  sweepPullRequestArming,
} from "../../../plugins/src/base/scripts/pr-arming-sweep.mjs";

/**
 * A real `autoMergeRequest` object, recorded from `gh pr list --json` on this
 * repository. Hardcoded rather than synthesised so the ARMED path is pinned to
 * the shape GitHub actually returns.
 */
const RECORDED_AUTO_MERGE_REQUEST = {
  authorEmail: null,
  commitBody: null,
  commitHeadline: null,
  mergeMethod: "MERGE",
  enabledAt: "2026-09-05T10:05:10Z",
  enabledBy: {
    id: "MDQ6VXNlcjI5MjkyMw==",
    is_bot: false,
    login: "CodySwannGT",
    name: "Cody Swann",
  },
};

/** The unarmed pull request observed in #3903, in `gh pr list --json` shape. */
const RECORDED_UNARMED_PR = {
  number: 3762,
  title: "A pull request that had been open longest of thirteen",
  url: "https://github.com/CodySwannGT/lisa/pull/3762",
  isDraft: false,
  labels: [],
  body: "Ordinary pull request body with no deliberate hold declared.",
  autoMergeRequest: null,
};

/** The same pull request, armed. */
const RECORDED_ARMED_PR = {
  number: 3982,
  title: "test(vacuity): pin the two findings that stand",
  url: "https://github.com/CodySwannGT/lisa/pull/3982",
  isDraft: false,
  labels: [],
  body: "Ordinary pull request body.",
  autoMergeRequest: RECORDED_AUTO_MERGE_REQUEST,
};

describe("pull request arming sweep (#3903)", () => {
  describe("rejection control — the detector must fire", () => {
    it("reports a recorded pull request whose auto-merge is unset", () => {
      const sweep = sweepPullRequestArming([RECORDED_UNARMED_PR]);

      expect(sweep.verdict).toBe("UNARMED_PRS_FOUND");
      expect(sweep.unarmed.map(entry => entry.number)).toEqual([3762]);
      expect(sweep.unarmed[0]).toMatchObject({
        verdict: "UNARMED",
        reason: "auto-merge-request-null",
        examined: true,
      });
    });

    it("names the unarmed pull request in the operator report", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([RECORDED_UNARMED_PR])
      );

      expect(report).toContain("UNARMED_PRS_FOUND");
      expect(report).toContain("#3762");
      expect(report).toContain("https://github.com/CodySwannGT/lisa/pull/3762");
    });

    it("finds the unarmed one among armed neighbours", () => {
      const sweep = sweepPullRequestArming([
        RECORDED_ARMED_PR,
        RECORDED_UNARMED_PR,
        { ...RECORDED_ARMED_PR, number: 3983 },
      ]);

      expect(sweep.verdict).toBe("UNARMED_PRS_FOUND");
      expect(sweep.unarmed.map(entry => entry.number)).toEqual([3762]);
      expect(sweep.armed.map(entry => entry.number)).toEqual([3982, 3983]);
      expect(sweep.examinedCount).toBe(3);
    });
  });

  describe("unarmed is not the same answer as not checked", () => {
    it("classifies an absent autoMergeRequest key as NOT_EXAMINED, never armed and never unarmed", () => {
      const classified = classifyPullRequestArming({
        number: 4001,
        title: "Queried without the autoMergeRequest field",
        url: "https://github.com/CodySwannGT/lisa/pull/4001",
      });

      expect(classified.verdict).toBe("NOT_EXAMINED");
      expect(classified.verdict).not.toBe("ARMED");
      expect(classified.verdict).not.toBe("UNARMED");
      expect(classified.reason).toBe("auto-merge-field-absent");
      expect(classified.examined).toBe(false);
    });

    it("keeps null and undefined apart: only null is an answer", () => {
      expect(classifyPullRequestArming(RECORDED_UNARMED_PR)).toMatchObject({
        verdict: "UNARMED",
        examined: true,
      });
      expect(
        classifyPullRequestArming({ number: 4001, autoMergeRequest: undefined })
      ).toMatchObject({ verdict: "NOT_EXAMINED", examined: false });
    });

    it("treats an unrecognized autoMergeRequest value as unexamined rather than armed", () => {
      for (const value of [false, true, "", "MERGE", 0]) {
        expect(
          classifyPullRequestArming({ number: 4002, autoMergeRequest: value })
        ).toMatchObject({
          verdict: "NOT_EXAMINED",
          reason: "auto-merge-field-unrecognized",
        });
      }
    });

    it("refuses to call a queue clean when any pull request went unexamined", () => {
      const sweep = sweepPullRequestArming([
        RECORDED_ARMED_PR,
        { number: 4001, title: "Field never requested", url: "" },
      ]);

      expect(sweep.verdict).toBe("NOT_MEASURED");
      expect(sweep.verdict).not.toBe("MEASURED_CLEAN");
      expect(sweep.reasons).toEqual(["auto-merge-field-absent"]);
      expect(sweep.notExamined.map(entry => entry.number)).toEqual([4001]);
      expect(sweep.examinedCount).toBe(1);
    });

    it("tells an operator the unmeasured sweep is an unanswered question, not a clean queue", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([{ number: 4001, title: "No field", url: "" }])
      );

      expect(report).toContain("NOT_MEASURED");
      expect(report).toContain("not a clean queue");
      expect(report).toContain(REQUIRED_PR_FIELDS.join(","));
    });

    it("separates an empty queue from a query that could not run", () => {
      const emptyQueue = sweepPullRequestArming([]);
      expect(emptyQueue.verdict).toBe("MEASURED_CLEAN");
      expect(emptyQueue.examinedCount).toBe(0);

      const brokenQuery = sweepPullRequestArming({
        fetchError: "gh: could not resolve repository",
      });
      expect(brokenQuery.verdict).toBe("NOT_MEASURED");
      expect(brokenQuery.reasons).toEqual(["pull-request-query-failed"]);

      const missingList = sweepPullRequestArming({});
      expect(missingList.verdict).toBe("NOT_MEASURED");
      expect(missingList.reasons).toEqual(["pull-request-list-unavailable"]);
    });

    it("does not describe an unreadable list as zero unexamined pull requests", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming({
          fetchError: "gh: could not resolve repository",
        })
      );

      expect(report).toContain("could not be read at all");
      expect(report).not.toContain("0 open pull request(s)");
    });
  });

  describe("a clean verdict is a positive assertion", () => {
    it("states what it examined rather than saying nothing", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([RECORDED_ARMED_PR])
      );

      expect(report).toContain("MEASURED_CLEAN");
      expect(report).toContain("Examined 1 open pull request(s)");
      expect(report).toContain("armed or deliberately unarmed");
    });

    it("reads current state only, so an arming that was silently dropped still reports", () => {
      // The same pull request, armed earlier in a session and observed null
      // later. Nothing about the prior arming is an input here.
      const sweep = sweepPullRequestArming([
        { ...RECORDED_ARMED_PR, autoMergeRequest: null },
      ]);

      expect(sweep.verdict).toBe("UNARMED_PRS_FOUND");
      expect(sweep.unarmed.map(entry => entry.number)).toEqual([3982]);
    });
  });

  describe("fail direction: report-only findings, fail-closed measurement", () => {
    it("marks every verdict as report-only, findings included", () => {
      expect(sweepPullRequestArming([RECORDED_UNARMED_PR]).reportOnly).toBe(
        true
      );
      expect(sweepPullRequestArming([RECORDED_ARMED_PR]).reportOnly).toBe(true);
      expect(sweepPullRequestArming({}).reportOnly).toBe(true);
    });

    it("never exits 0 on an unmeasured sweep", () => {
      expect(
        pullRequestArmingExitCode(sweepPullRequestArming([RECORDED_ARMED_PR]))
      ).toBe(0);
      expect(
        pullRequestArmingExitCode(sweepPullRequestArming([RECORDED_UNARMED_PR]))
      ).toBe(1);
      expect(pullRequestArmingExitCode(sweepPullRequestArming({}))).toBe(2);
      expect(
        pullRequestArmingExitCode(
          sweepPullRequestArming([{ number: 1, title: "no field", url: "" }])
        )
      ).toBe(2);
      expect(pullRequestArmingExitCode({})).toBe(2);
    });
  });

  it("keeps the distributed sweep artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/pr-arming-sweep.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/pr-arming-sweep.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });
});
