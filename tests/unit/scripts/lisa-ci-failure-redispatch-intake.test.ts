/**
 * Build intake routes a CI-failed item back to its existing PR.
 *
 * The re-dispatch workflow only moves the item to the ready lane; it is build
 * intake that decides what the next agent does with it. That decision is prose
 * in the skill and the rule it cites, so the contract is asserted on the prose:
 * an uncleared `[lisa-ci-failed]` marker routes to `lisa-drive-pr-to-merge` on
 * the named PR, it is CI rework rather than a QA rejection, and the work is not
 * complete while the marker is uncleared (CodySwannGT/lisa#4607, scenario 5).
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-intake
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SKILL = readFileSync(
  "plugins/src/base/skills/lisa-github-build-intake/SKILL.md",
  "utf8"
);
const RULE = readFileSync(
  "plugins/src/base/rules/reference/rejection-detection.md",
  "utf8"
);
const MARKER = "[lisa-ci-failed]";

/**
 * The text of one `####` section of the skill.
 * @param heading - Exact heading text after `#### `.
 * @returns The section body up to the next `####` heading.
 */
function section(heading: string): string {
  const start = SKILL.indexOf(`#### ${heading}`);
  expect(start).toBeGreaterThan(-1);
  const end = SKILL.indexOf("\n#### ", start + 1);
  return end === -1 ? SKILL.slice(start) : SKILL.slice(start, end);
}

describe("github build intake on an uncleared [lisa-ci-failed] marker", () => {
  it("classifies it as CI rework before the claim and files no rejection learning", () => {
    const claim = section("3b. Claim");
    const marker = claim.indexOf(MARKER);
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(claim.indexOf("gh issue edit"));
  });

  it("dispatches lisa-drive-pr-to-merge on the PR the marker names, not lisa-implement", () => {
    const dispatch = section(
      "3c. Run the per-issue lifecycle in-session (never as a subagent)"
    );
    expect(dispatch).toContain(MARKER);
    expect(dispatch).toMatch(/lisa-drive-pr-to-merge[^\n]*pr=<n>/u);
    expect(dispatch).toMatch(/instead of `lisa-implement`/u);
  });
});

describe("a [lisa-ci-failed] marker is evidence only when it checks out", () => {
  const claim = section("3b. Claim");

  it("accepts the marker only when github-actions[bot] authored it", () => {
    expect(claim).toMatch(/authored by `github-actions\[bot\]`/u);
  });

  it("requires the named PR to be open, same-repository, and bound to this item, or treats it as no marker", () => {
    expect(claim).toMatch(/`state` is `OPEN`/u);
    expect(claim).toMatch(/`isCrossRepository` is `false`/u);
    expect(claim).toMatch(/`Work-Item:` binds this item/u);
  });
});

describe("the CI-rework route is executable", () => {
  const dispatch = section(
    "3c. Run the per-issue lifecycle in-session (never as a subagent)"
  );

  it("invokes lisa-drive-pr-to-merge pr=<n>, skips archaeology and triage, then runs the ordinary 3d transition", () => {
    expect(dispatch).toContain("`lisa-drive-pr-to-merge pr=<n>`");
    expect(dispatch).toMatch(
      /skip `claim-archaeology` and `lisa-ticket-triage`/u
    );
  });

  it("reuses a worktree already on the PR head, else creates one from the fetched remote branch", () => {
    expect(dispatch).toContain("git worktree list");
    expect(dispatch).toContain(
      "git worktree add -B <headRefName> <path> origin/<headRefName>"
    );
  });

  it("never resets a local head branch that holds commits not on origin", () => {
    expect(dispatch).toContain(
      "git rev-list --count origin/<headRefName>..<headRefName>"
    );
    expect(dispatch).toContain("git worktree add <path> <headRefName>");
  });

  it("writes the bundle for the agent to read, without claiming the PR skill reads it", () => {
    expect(dispatch).not.toMatch(
      /lisa-drive-pr-to-merge[^\n]*reads the bundle/u
    );
  });
});

describe("a repeatedly failing PR does not loop forever", () => {
  it("blocks for a human at three bot-authored markers for the same PR instead of re-dispatching", () => {
    const claim = section("3b. Claim");
    expect(claim).toMatch(
      /3 or more bot-authored `\[lisa-ci-failed\]` markers for the same PR/u
    );
    expect(claim).toMatch(/blocked role[^\n]*human_needed/u);
  });
});

describe("the rejection-detection rule", () => {
  it("exempts an uncleared CI-failure bounce from rejection-reclaim in both the head and the body", () => {
    const head = RULE.slice(0, RULE.indexOf("\n---\n"));
    const body = RULE.slice(RULE.indexOf("\n---\n"));
    for (const part of [head, body]) {
      expect(part).toContain(MARKER);
      expect(part).toContain("github-actions[bot]");
    }
  });
});
