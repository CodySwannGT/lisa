/**
 * Build intake routes a CI-failed item back to its existing PR.
 *
 * The re-dispatch workflow only moves the item to the ready lane; it is build
 * intake that decides what the next agent does with it. The routing prose is
 * guidance and is reviewed, not pinned (#4867). What stays pinned is the
 * machine-read `[lisa-ci-failed]` marker, which `scripts/lisa-ci-rework-route.mjs`
 * parses: the skill's dispatch section and both halves of the rule it cites
 * must carry it, so an agent recognises the marker the script writes
 * (CodySwannGT/lisa#4607, scenario 5).
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
  it("names the marker in the per-issue dispatch section", () => {
    const dispatch = section(
      "3c. Run the per-issue lifecycle in-session (never as a subagent)"
    );
    expect(dispatch).toContain(MARKER);
  });
});

describe("the rejection-detection rule", () => {
  it("names the marker in both the head and the body", () => {
    const head = RULE.slice(0, RULE.indexOf("\n---\n"));
    const body = RULE.slice(RULE.indexOf("\n---\n"));
    for (const part of [head, body]) {
      expect(part).toContain(MARKER);
    }
  });
});
