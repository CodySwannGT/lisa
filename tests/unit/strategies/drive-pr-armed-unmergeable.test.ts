/**
 * Regression tests for issue #3720: auto-merge can be armed on a PR that will
 * never merge, with zero failing checks and nothing reporting it.
 *
 * `reviewDecision` is not part of `statusCheckRollup`. That single fact is why
 * this class was invisible: a failing-check count reads ZERO on a permanently
 * unmergeable PR, and the checks tab is entirely green. So every assertion here
 * is written against a PR with NO red checks — a test over a PR with a failing
 * check is satisfied by the behaviour that already existed and proves nothing.
 *
 * ## Why the fix is not only at arm time
 *
 * The ticket's own preferred direction was to refuse at arm time. Checking the
 * two live examples it was filed on shows that would have caught neither,
 * because in both the blocking review arrived AFTER the latch went on:
 *
 *   #3686   armed 22:16:03   review submitted 22:21:44   (+5m41s)
 *   #3697   armed 23:29:59   review submitted 23:38:24   (+8m25s)
 *
 * A verdict is knowable at arm time only if it exists at arm time. So the
 * arm-time gate is the smaller half — it covers a verdict that predates arming —
 * and the load-bearing half is the exit obligation: a run that STOPS while the
 * PR is armed and blocked must say so. While the loop runs this is already
 * covered (the watch poll reads `reviewDecision`, step (e) handles it); the hole
 * is a run that concludes it is finished because arming looked like completion.
 *
 * Every plugin root — including Devin and the Codex root — is asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-armed-unmergeable
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe.each(ROOTS)("drive-pr-to-merge armed-unmergeable (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  /**
   * The arm-time gate, sliced by its own heading. Headings are anchored to a
   * line start: `## 2. The watch loop` and similar strings also appear quoted
   * in prose, and an unanchored search can find the mention and slice backwards
   * into an empty range that passes vacuously.
   *
   * @returns The mergeability-gate section
   */
  const mergeGate = (): string => {
    const start = content.indexOf("\n### The mergeability gate");
    const end = content.indexOf("\n## 2. The watch loop", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return content.slice(start, end);
  };

  /**
   * The exit obligation, sliced by its own heading.
   *
   * @returns The "Before you stop" section
   */
  const exitCheck = (): string => {
    const start = content.indexOf("\n### Before you stop");
    const end = content.indexOf("\nAt every terminal state, release", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return content.slice(start, end);
  };

  // --- THE DISCRIMINATING FACT --------------------------------------------

  it("says reviewDecision is absent from the check rollup, which is why this hid", () => {
    // Everything else follows from this. A reader who does not know it will
    // "simplify" the explicit read into a rollup check and restore the defect
    // with every test still green.
    const gate = mergeGate();
    expect(gate).toMatch(
      /`reviewDecision` is \*\*not part of `statusCheckRollup`\*\*/
    );
  });

  it("requires an explicit read, never an inferred one", () => {
    const gate = mergeGate();
    expect(gate).toMatch(
      /\*\*Read `reviewDecision` explicitly\. Never infer it from a check count\.\*\*/
    );
    expect(gate).toMatch(/gh api graphql --paginate --slurp/);
    expect(gate).toMatch(/state reviewDecision autoMergeRequest/);
  });

  it("refuses to arm on CHANGES_REQUESTED, and says why arming is a claim", () => {
    const gate = mergeGate();
    expect(gate).toMatch(
      /\*\*Do not arm while `reviewDecision == CHANGES_REQUESTED`\.\*\*/
    );
  });

  it("names both ruleset settings and says neither one clears a change request", () => {
    // Without these the reader assumes pushing a fix clears the verdict, which
    // is the intuition that let three PRs sit parked. The block is indefinite
    // whenever a stale change request stands, whatever either setting says.
    const gate = mergeGate();
    expect(gate).toContain("dismiss_stale_reviews_on_push");
    expect(gate).toContain("required_approving_review_count: 0");
    // And they are to be verified per repo, not assumed from this one.
    expect(gate).toMatch(
      /gh api repos\/<owner>\/<repo>\/rules\/branches\/<base>/
    );
  });

  it("treats unresolved threads as a second, independent blocker", () => {
    // A PR can have a clear reviewDecision and still be unmergeable on threads,
    // and that is equally invisible to a check count. Naming the wrong one sends
    // the operator to the wrong place.
    const gate = mergeGate();
    expect(gate).toContain("required_review_thread_resolution: true");
  });

  // --- THE LOAD-BEARING HALF: the exit obligation --------------------------

  it("binds at every exit that leaves the PR open, not just the listed terminals", () => {
    const exit = exitCheck();
    expect(exit).toMatch(
      /\*\*This applies at every exit that leaves the PR OPEN\*\*/
    );
  });

  it("re-reads live state immediately before reporting", () => {
    const exit = exitCheck();
    expect(exit).toMatch(/state reviewDecision autoMergeRequest/);
  });

  it("says WHY the loop is not enough — the hole is a run that stops", () => {
    // This is the reasoning that separates the real fix from an arm-time-only
    // one. Losing it invites someone to delete the exit check as redundant with
    // step (e), which is exactly the argument that leaves the hole open.
    const exit = exitCheck();
    expect(exit).toMatch(
      /found only because a person queried\s+`reviewDecision` by hand/i
    );
  });
});
