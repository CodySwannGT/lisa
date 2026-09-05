/**
 * Suppression visibility for the unarmed-pull-request sweep (#3903).
 *
 * The sweep lets a pull request declare itself deliberately unarmed, which is
 * the right fix for `lisa-drive-pr-to-merge`'s `auto_merge=false` mode and also
 * the most likely way this control quietly dies. This repository has been bitten
 * by the shape before: an allowlist added to HARDEN a guard became its bypass.
 *
 * So the property pinned here is not "the marker works" — it is that using the
 * marker never makes a pull request disappear. A held PR leaves the findings and
 * enters a named, counted `Held (declared)` bucket, on the clean path as much as
 * the findings path, so a human can watch the label spread.
 *
 * Split from `pr-arming-sweep.test.ts` to stay inside the 300-line budget.
 * @module tests/unit/strategies/pr-arming-suppression
 */
import { describe, expect, it } from "vitest";

import {
  AUTO_MERGE_OFF_LABEL,
  AUTO_MERGE_OFF_MARKER,
  classifyPullRequestArming,
  formatPullRequestArmingReport,
  sweepPullRequestArming,
} from "../../../plugins/src/base/scripts/pr-arming-sweep.mjs";

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

/** An armed pull request, so the held bucket is exercised beside a real one. */
const RECORDED_ARMED_PR = {
  number: 3982,
  title: "test(vacuity): pin the two findings that stand",
  url: "https://github.com/CodySwannGT/lisa/pull/3982",
  isDraft: false,
  labels: [],
  body: "Ordinary pull request body.",
  autoMergeRequest: { mergeMethod: "MERGE", enabledAt: "2026-09-05T10:05:10Z" },
};

describe("pull request arming suppression (#3903)", () => {
  describe("deliberate holds are not findings", () => {
    it("does not report a pull request carrying the auto-merge-off marker", () => {
      const sweep = sweepPullRequestArming([
        {
          ...RECORDED_UNARMED_PR,
          body: `Held for a human.\n\n<!-- ${AUTO_MERGE_OFF_MARKER} reason=awaiting-design -->`,
        },
      ]);

      expect(sweep.verdict).toBe("MEASURED_CLEAN");
      expect(sweep.unarmed).toEqual([]);
      expect(sweep.deliberatelyUnarmed[0]).toMatchObject({
        verdict: "DELIBERATELY_UNARMED",
        reason: "auto-merge-off-marker",
      });
    });

    it("accepts the label spelling of the same declaration", () => {
      const sweep = sweepPullRequestArming([
        {
          ...RECORDED_UNARMED_PR,
          labels: [{ name: "type:Bug" }, { name: AUTO_MERGE_OFF_LABEL }],
        },
      ]);

      expect(sweep.verdict).toBe("MEASURED_CLEAN");
      expect(sweep.deliberatelyUnarmed[0]?.reason).toBe("auto-merge-off-label");
    });

    it("excludes drafts, which GitHub will not arm in the first place", () => {
      const sweep = sweepPullRequestArming([
        { ...RECORDED_UNARMED_PR, isDraft: true },
      ]);

      expect(sweep.verdict).toBe("MEASURED_CLEAN");
      expect(sweep.deliberatelyUnarmed[0]?.reason).toBe("draft-pull-request");
    });

    it("still reports an unarmed pull request that only mentions the marker's family", () => {
      const sweep = sweepPullRequestArming([
        {
          ...RECORDED_UNARMED_PR,
          body: "Notes on [lisa-human-gate] and the auto merge off idea.",
          labels: [{ name: "lisa:babysitter-on-duty" }],
        },
      ]);

      expect(sweep.verdict).toBe("UNARMED_PRS_FOUND");
    });
  });

  describe("a mention of the marker is not a declaration", () => {
    /**
     * The real description of the pull request that introduced this marker,
     * abridged. It was suppressed by its own body on the first live run of the
     * sweep, because the body explains what the marker is.
     */
    const PR_BODY_THAT_DISCUSSES_THE_MARKER = [
      "This ships a suppression mechanism — `lisa:auto-merge-off` /",
      "`[lisa-auto-merge-off]` — which is the right fix for the deliberate-hold",
      "false positive and also the most likely way this control quietly dies.",
      "",
      "```",
      "<!-- [lisa-auto-merge-off] reason=<why a human owns this merge> -->",
      "```",
    ].join("\n");

    it("still reports a pull request that only writes ABOUT the marker", () => {
      const sweep = sweepPullRequestArming([
        { ...RECORDED_UNARMED_PR, body: PR_BODY_THAT_DISCUSSES_THE_MARKER },
      ]);

      expect(sweep.verdict).toBe("UNARMED_PRS_FOUND");
      expect(sweep.unarmed.map(entry => entry.number)).toEqual([3762]);
      expect(sweep.deliberatelyUnarmed).toEqual([]);
    });

    it("does not accept a backticked inline mention as a declaration", () => {
      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `We use the \`${AUTO_MERGE_OFF_MARKER}\` marker for deliberate holds.`,
        }).verdict
      ).toBe("UNARMED");
    });

    it("does not accept the marker mid-sentence outside a comment", () => {
      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `Someone should add ${AUTO_MERGE_OFF_MARKER} to this one.`,
        }).verdict
      ).toBe("UNARMED");
    });

    it("accepts the documented declaration on its own line", () => {
      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `Reasoning above.\n\n<!-- ${AUTO_MERGE_OFF_MARKER} reason=human owns this merge -->\n`,
        })
      ).toMatchObject({
        verdict: "DELIBERATELY_UNARMED",
        declaredReason: "human owns this merge",
      });
    });
  });

  describe("suppression is counted and named, never silent", () => {
    it("names every held pull request even when the sweep is otherwise clean", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([
          RECORDED_ARMED_PR,
          {
            ...RECORDED_UNARMED_PR,
            number: 3900,
            body: `Held.\n<!-- ${AUTO_MERGE_OFF_MARKER} reason=awaiting design sign-off -->`,
          },
          {
            ...RECORDED_UNARMED_PR,
            number: 3901,
            labels: [{ name: AUTO_MERGE_OFF_LABEL }],
          },
        ])
      );

      expect(report).toContain("MEASURED_CLEAN");
      expect(report).toContain("Held (declared, not merging): 2");
      expect(report).toContain("#3900");
      expect(report).toContain("reason: awaiting design sign-off)");
      expect(report).toContain("#3901");
      expect(report).toContain("no reason declared");
    });

    it("names held pull requests alongside findings too", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([
          RECORDED_UNARMED_PR,
          {
            ...RECORDED_UNARMED_PR,
            number: 3900,
            labels: [{ name: AUTO_MERGE_OFF_LABEL }],
          },
        ])
      );

      expect(report).toContain("UNARMED_PRS_FOUND");
      expect(report).toContain("#3762");
      expect(report).toContain("Held (declared, not merging): 1");
      expect(report).toContain("#3900");
    });

    it("carries the declared reason through classification", () => {
      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `<!-- ${AUTO_MERGE_OFF_MARKER} reason=holding for the release train -->`,
        })
      ).toMatchObject({
        verdict: "DELIBERATELY_UNARMED",
        declaredReason: "holding for the release train",
      });

      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `<!-- ${AUTO_MERGE_OFF_MARKER} -->`,
        })
      ).toMatchObject({
        verdict: "DELIBERATELY_UNARMED",
        declaredReason: null,
      });
    });

    it("strips the HTML comment terminator out of the declared reason", () => {
      expect(
        classifyPullRequestArming({
          ...RECORDED_UNARMED_PR,
          body: `<!-- ${AUTO_MERGE_OFF_MARKER} reason=awaiting design sign-off -->`,
        }).declaredReason
      ).toBe("awaiting design sign-off");
    });

    it("says nothing about holds when nothing is held", () => {
      const report = formatPullRequestArmingReport(
        sweepPullRequestArming([RECORDED_ARMED_PR])
      );

      expect(report).not.toContain("Held (declared");
    });
  });
});
