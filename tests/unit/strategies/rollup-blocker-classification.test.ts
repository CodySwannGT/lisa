/**
 * Regression coverage for rollup blocker classification.
 *
 * Issue #3045: a container's lifecycle rollup propagated "blocked" as a single
 * bit. A leaf waiting on an external event and a leaf whose acceptance
 * criteria are unbuildable rendered identically, so the second class waited
 * forever — measured at 32 identical hold comments over six weeks on one Epic
 * that was two-thirds complete.
 *
 * Every assertion here reads the OPERATOR-VISIBLE report, not the
 * classification field. A test that checked only that an item was classified
 * `spec-defect` and never read what the operator was told would have left the
 * defect exactly where it was.
 * @module tests/unit/strategies/rollup-blocker-classification
 */
import { describe, expect, it } from "vitest";

import {
  BLOCKER_ACTOR,
  classifyHeldItem,
  classifyRollupBlockers,
  describeRollupBlockerChange,
  renderRollupBlockerReport,
  rollupBlockerFingerprint,
} from "../../../plugins/src/base/scripts/rollup-blocker-classification.mjs";
import {
  BLOCKED,
  DONE,
  EPIC,
  SPEC_DEFECT_MARKER,
  hardBlockerLeaf,
  inProgressLeaf,
  specDefectLeaf,
  transparentParent,
  unclassifiedLeaf,
} from "./support/rollup-blocker-fixtures.js";

const NOT_ALL_CLEAR = "This is not an all-clear";
const REWRITE_HEADING = "Waiting on a rewrite";
const OTHER_WORK_HEADING = "Waiting on other work";
const UNKNOWN_HEADING = "Nobody is assigned";

/**
 * Classify a child graph under the standard Epic and render it for an operator.
 *
 * @param children - The container's child graph for this case.
 * @returns The operator-visible rollup report.
 */
function report(children: readonly unknown[]): string {
  return renderRollupBlockerReport(
    classifyRollupBlockers({ container: EPIC, children })
  );
}

describe("rollup blocker classification (#3045)", () => {
  describe("the two states are distinguished in the rollup", () => {
    it("tells the operator a spec defect waits on a rewrite and never clears itself", () => {
      const text = report([inProgressLeaf, specDefectLeaf]);

      expect(text).toContain(REWRITE_HEADING);
      expect(text).toContain(
        "A person must rewrite this item's acceptance criteria"
      );
      expect(text).toContain("Nothing external will ever clear it");
    });

    it("tells the operator a hard blocker needs nobody and clears on its own", () => {
      const text = report([inProgressLeaf, hardBlockerLeaf]);

      expect(text).toContain(OTHER_WORK_HEADING);
      expect(text).toContain("Nobody has to act");
      expect(text).toContain(
        "clears by itself when the work it names below closes"
      );
    });

    it("renders the two kinds of hold as separate sections, not one blocked count", () => {
      const text = report([inProgressLeaf, specDefectLeaf, hardBlockerLeaf]);

      expect(text).toContain(`${REWRITE_HEADING} (1)`);
      expect(text).toContain(`${OTHER_WORK_HEADING} (1)`);
      expect(text.indexOf(REWRITE_HEADING)).not.toBe(
        text.indexOf(OTHER_WORK_HEADING)
      );
    });

    it("names a different actor for each kind of hold", () => {
      const text = report([specDefectLeaf, hardBlockerLeaf]);

      expect(text).toContain(`who must act: ${BLOCKER_ACTOR["spec-defect"]}`);
      expect(text).toContain(`who must act: ${BLOCKER_ACTOR["hard-blocker"]}`);
      expect(BLOCKER_ACTOR["spec-defect"]).not.toBe(
        BLOCKER_ACTOR["hard-blocker"]
      );
    });

    it("omits a class heading entirely when nothing is in that class", () => {
      const text = report([inProgressLeaf, hardBlockerLeaf]);

      expect(text).not.toContain(REWRITE_HEADING);
      expect(text).not.toContain("Waiting on a person");
      expect(text).not.toContain(UNKNOWN_HEADING);
    });
  });

  describe("the blocking leaf is identifiable without descending the tree", () => {
    it("names the blocking leaf of a nested chain and the path to it", () => {
      const text = report([inProgressLeaf, transparentParent]);

      expect(text).toContain(specDefectLeaf.ref);
      expect(text).toContain("via #1495 -> #1515 -> #1547");
    });

    it("does not report the transparent intermediate parent as the blocker", () => {
      const result = classifyRollupBlockers({
        container: EPIC,
        children: [transparentParent],
      });

      expect(
        result.blockers.map((blocker: { ref: string }) => blocker.ref)
      ).toEqual([specDefectLeaf.ref]);
    });

    it("prints the recorded signal that produced each classification", () => {
      const text = report([specDefectLeaf, hardBlockerLeaf]);

      expect(text).toContain(`marked \`${SPEC_DEFECT_MARKER}\``);
      expect(text).toContain("blocked by #1700");
    });
  });

  describe("it never decides that a criterion is bad", () => {
    it("says unknown, and who must resolve it, when nothing recorded classifies the hold", () => {
      const text = report([unclassifiedLeaf]);

      expect(text).toContain(UNKNOWN_HEADING);
      expect(text).toContain(
        "Nothing recorded on this item says which kind of hold it is"
      );
      expect(text).toContain(SPEC_DEFECT_MARKER);
      expect(text).toContain("is blocked by");
    });

    it("does not guess spec-defect from prose on the item", () => {
      const verdict = classifyHeldItem({
        ref: specDefectLeaf.ref,
        labels: [BLOCKED],
        body: "The acceptance criteria name a dev environment this repo does not have.",
        title: "bad acceptance criterion",
      });

      expect(verdict.class).toBe("unknown");
    });

    it("prefers the human-written marker over an automated dependency link", () => {
      expect(
        classifyHeldItem({
          ref: specDefectLeaf.ref,
          labels: [SPEC_DEFECT_MARKER],
          blockedBy: [{ ref: "#1700", open: true }],
        }).class
      ).toBe("spec-defect");
    });

    it("ignores a dependency the caller resolved as already closed", () => {
      expect(
        classifyHeldItem({
          ref: hardBlockerLeaf.ref,
          labels: [BLOCKED],
          blockedBy: [{ ref: "#1700", open: false }],
        }).class
      ).toBe("unknown");
    });
  });

  describe("it fails rather than reporting all-clear", () => {
    it("refuses to report when the tracker could not be read", () => {
      const result = classifyRollupBlockers({
        container: EPIC,
        readError: "gh: 502 Bad Gateway",
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("container-unreadable");
      expect(renderRollupBlockerReport(result)).toContain("NOT CLASSIFIED");
      expect(renderRollupBlockerReport(result)).toContain(NOT_ALL_CLEAR);
    });

    it("refuses to report a rollup that has no children", () => {
      const result = classifyRollupBlockers({ container: EPIC, children: [] });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("rollup-has-no-children");
      expect(renderRollupBlockerReport(result)).toContain("NOT CLASSIFIED");
    });

    it("refuses to report when children were listed but none could be examined", () => {
      const result = classifyRollupBlockers({
        container: EPIC,
        children: [{ title: "no ref, no state" }, { ref: "", state: "" }],
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("no-child-could-be-examined");
      expect(result.examined).toBe(0);
      expect(renderRollupBlockerReport(result)).toContain(NOT_ALL_CLEAR);
    });

    it("reports the count it examined so an empty run cannot read as a clean one", () => {
      const result = classifyRollupBlockers({
        container: EPIC,
        children: [inProgressLeaf, specDefectLeaf],
      });

      expect(result.examined).toBe(2);
      expect(renderRollupBlockerReport(result)).toContain(
        "1 of 2 item(s) examined are held"
      );
    });
  });

  describe("negative control: ordinary work in flight is not a hold", () => {
    it("does not report an ordinary in-progress item as either kind of hold", () => {
      const result = classifyRollupBlockers({
        container: EPIC,
        children: [inProgressLeaf],
      });
      const text = renderRollupBlockerReport(result);

      expect(result.verdict).toBe("not-blocked");
      expect(result.blockers).toEqual([]);
      expect(text).toContain("not blocked");
      expect(text).toContain("1 item(s) examined, none held");
      expect(text).not.toContain(REWRITE_HEADING);
      expect(text).not.toContain(OTHER_WORK_HEADING);
      expect(text).not.toContain(UNKNOWN_HEADING);
    });
  });

  describe("a repeated hold does not restate an unchanged verdict", () => {
    it("reports no change when the same items are held in the same classes", () => {
      const first = classifyRollupBlockers({
        container: EPIC,
        children: [specDefectLeaf, hardBlockerLeaf],
      });
      const second = classifyRollupBlockers({
        container: EPIC,
        children: [hardBlockerLeaf, specDefectLeaf],
      });

      expect(
        describeRollupBlockerChange(rollupBlockerFingerprint(first), second)
      ).toMatchObject({ changed: false });
    });

    it("names what changed when a hold is reclassified between cycles", () => {
      const before = classifyRollupBlockers({
        container: EPIC,
        children: [{ ...specDefectLeaf, labels: [BLOCKED] }],
      });
      const after = classifyRollupBlockers({
        container: EPIC,
        children: [specDefectLeaf],
      });
      const change = describeRollupBlockerChange(
        rollupBlockerFingerprint(before),
        after
      );

      expect(change.changed).toBe(true);
      expect(change.summary).toContain(
        "#1547 is now spec-defect (was unknown)"
      );
    });

    it("names a hold that cleared between cycles", () => {
      const before = classifyRollupBlockers({
        container: EPIC,
        children: [specDefectLeaf, hardBlockerLeaf],
      });
      const after = classifyRollupBlockers({
        container: EPIC,
        children: [{ ...specDefectLeaf, state: DONE }, hardBlockerLeaf],
      });
      const change = describeRollupBlockerChange(
        rollupBlockerFingerprint(before),
        after
      );

      expect(change.changed).toBe(true);
      expect(change.summary).toContain("#1547 no longer held");
    });
  });

  describe("vendor lifecycle vocabularies", () => {
    it("recognizes the JIRA and Linear blocked state names, not only the GitHub label", () => {
      const result = classifyRollupBlockers({
        container: { ref: "LISA-1495", type: "Epic" },
        children: [
          { ref: "LISA-1547", state: "Blocked", labels: ["Human Needed"] },
        ],
        markerNames: { humanNeeded: "Human Needed" },
      });

      expect(result.verdict).toBe("blocked");
      expect(renderRollupBlockerReport(result)).toContain(
        "Waiting on a person"
      );
    });
  });
});
