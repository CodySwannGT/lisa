/**
 * Regression coverage for GitHub issue #1595.
 *
 * S14 evidence markers are binding to the current work unit. Agents need a
 * separate syntax for citing a sibling artifact without accidentally inflating
 * the current issue's evidence manifest.
 * @module tests/unit/strategies/evidence-ref-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
] as const;

const VALIDATOR_SKILLS = [
  "lisa-github-validate-issue",
  "lisa-jira-validate-ticket",
  "lisa-linear-validate-issue",
] as const;

const JOURNEY_WRITER_SKILLS = [
  "lisa-github-add-journey",
  "lisa-jira-add-journey",
  "lisa-linear-add-journey",
] as const;

const EVIDENCE_REF_PREFIX = "[EVIDENCE-REF: <tracker-ref>";

const read = (filePath: string): string =>
  readFileSync(path.resolve(filePath), "utf8");

const readSkill = (root: string, skill: string): string =>
  read(path.join(root, skill, "SKILL.md"));

describe("EVIDENCE-REF non-binding cross-reference contract (#1595)", () => {
  it("documents the non-binding grammar in the verification rule", () => {
    const referenceRule = read(
      "plugins/src/base/rules/reference/verification.md"
    );
    const eagerRule = read("plugins/src/base/rules/eager/verification.md");

    expect(referenceRule).toContain(
      "[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]"
    );
    expect(referenceRule).toMatch(/MUST ignore `EVIDENCE-REF`/);
    expect(referenceRule).toMatch(
      /Never quote a sibling's `\[EVIDENCE: \.\.\.\]`/
    );
    expect(eagerRule).toContain(EVIDENCE_REF_PREFIX);
    expect(eagerRule).toMatch(/validators ignore `EVIDENCE-REF`/);
  });

  describe.each(SKILL_ROOTS)("%s validators", root => {
    describe.each(VALIDATOR_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("ignores EVIDENCE-REF markers while deriving S14's manifest", () => {
        expect(content).toContain(EVIDENCE_REF_PREFIX);
        expect(content).toMatch(/S14 MUST ignore `EVIDENCE-REF`/);
        expect(content).toMatch(
          /does not satisfy the "at least one marker" requirement/
        );
        expect(content).toMatch(/zero binding `\[EVIDENCE: \.\.\.\]` markers/);
      });
    });
  });

  describe.each(SKILL_ROOTS)("%s journey writers", root => {
    describe.each(JOURNEY_WRITER_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("requires EVIDENCE-REF for sibling artifact citations", () => {
        expect(content).toContain(EVIDENCE_REF_PREFIX);
        expect(content).toMatch(
          /Do not paste a sibling (issue|ticket|item)'s `\[EVIDENCE: \.\.\.\]` marker/
        );
        expect(content).toMatch(
          /S14 treats `\[EVIDENCE: \.\.\.\]` as this (issue|ticket|item)'s own manifest/
        );
        expect(content).toMatch(
          /`EVIDENCE-REF` never satisfies or extends the manifest/
        );
      });
    });
  });
});
