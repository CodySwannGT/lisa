/**
 * The claim-time estimate step of `lisa-track` (CodySwannGT/lisa#4955), on
 * every agent surface the skill ships to: an estimate failure never blocks
 * the claimed work but leaves a plain-English trace on the item, and each
 * tracker names a search that really exists for the calibration history.
 * @module tests/unit/skills/lisa-track-estimate-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/** Skill roots per agent surface; the first is the source the rest are built from. */
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/**
 * The estimate step (step 4) of one surface's `lisa-track` skill.
 * @param surface - A skill root, relative to the repository.
 * @returns The step's text.
 */
function estimateStep(surface: string): string {
  const skill = readFileSync(
    path.join(REPO_ROOT, surface, "lisa-track", "SKILL.md"),
    "utf8"
  );
  const start = skill.indexOf("**Token estimate before any work**");
  const end = skill.indexOf("**Ignore guard before any write.**");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return skill.slice(start, end);
}

describe.each(SURFACES)("lisa-track estimate step on %s", surface => {
  const step = estimateStep(surface);

  it("continues the claimed work when estimating fails", () => {
    expect(step).toContain("An estimate failure never blocks the work.");
    expect(step).toContain(
      "continue to step 5 with `estimate_outcome: failed`"
    );
    expect(step).not.toMatch(/blocks durable work like a failed claim/);
  });

  it("leaves a plain-English comment on the item saying why", () => {
    expect(step).toMatch(
      /post one comment on the item through `lisa-tracker-write` that a non-technical reader can follow/
    );
    expect(step).toContain("Name the real reason in plain words");
  });

  it("names a real calibration search for every tracker", () => {
    expect(step).toContain("gh issue list --repo <org>/<repo> --state closed");
    expect(step).toMatch(
      /`lisa-atlassian-access`, `operation: search-issues jql:/
    );
    expect(step).toMatch(/`lisa-linear-access`, `operation: list-issues /);
    expect(step).not.toContain("the equivalent search");
  });

  it("scopes the Jira and Linear searches to this repository", () => {
    expect(step).toContain('AND labels = \\"repo:<name>\\"');
    expect(step).toContain(
      "operation: list-issues team:<ID> label:repo:<name>"
    );
  });

  it("reads each Linear candidate's full description before matching", () => {
    expect(step).toContain("`operation: get-issue id:<ID>`");
    expect(step).toMatch(
      /a `## Lisa Estimate` section in that full description/
    );
  });

  it("reports the failed outcome and its reason in the result", () => {
    const skill = readFileSync(
      path.join(REPO_ROOT, surface, "lisa-track", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("estimate_outcome: present|written|failed|n/a");
    expect(skill).toContain("estimate_failure: <plain-English reason>|null");
  });
});

describe("the operations the step names exist in their access layers", () => {
  const access = (skill: string): string =>
    readFileSync(
      path.join(REPO_ROOT, "plugins/src/base/skills", skill, "SKILL.md"),
      "utf8"
    );

  it("finds search-issues in lisa-atlassian-access", () => {
    expect(access("lisa-atlassian-access")).toContain("search-issues jql:");
  });

  it("finds list-issues with label and state_type, and get-issue, in lisa-linear-access", () => {
    expect(access("lisa-linear-access")).toMatch(
      /operation: list-issues .*\[label:<NAME>\].*\[state_type:<arr>\]/
    );
    expect(access("lisa-linear-access")).toContain(
      "operation: get-issue id:<ID>"
    );
  });
});
