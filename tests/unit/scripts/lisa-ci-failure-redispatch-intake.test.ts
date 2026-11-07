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
    expect(claim).toMatch(/CI rework/u);
    expect(claim).toMatch(/no rejection learning/iu);
  });

  it("dispatches lisa-drive-pr-to-merge on the PR the marker names, not lisa-implement", () => {
    const dispatch = section(
      "3c. Run the per-issue lifecycle in-session (never as a subagent)"
    );
    expect(dispatch).toContain(MARKER);
    expect(dispatch).toMatch(/lisa-drive-pr-to-merge[^\n]*pr=<n>/u);
    expect(dispatch).toMatch(/instead of `lisa-implement`/u);
  });

  it("states that the work is not complete while the marker is uncleared", () => {
    expect(SKILL).toMatch(
      /not complete while a `\[lisa-ci-failed\]` marker is uncleared/u
    );
  });
});

describe("the rejection-detection rule", () => {
  it("exempts an uncleared CI-failure bounce from rejection-reclaim in both the head and the body", () => {
    const head = RULE.slice(0, RULE.indexOf("\n---\n"));
    const body = RULE.slice(RULE.indexOf("\n---\n"));
    for (const part of [head, body]) {
      expect(part).toContain(MARKER);
      expect(part).toMatch(/CI rework/u);
    }
  });
});
