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
  "plugins/lisa/.codex-plugin/skills",
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

const EVIDENCE_REF_GRAMMAR =
  "[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]";

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

    expect(referenceRule).toContain(EVIDENCE_REF_GRAMMAR);
    expect(referenceRule).toMatch(/pointer only/);
    expect(referenceRule).toMatch(
      /rather than quoting a sibling's `\[EVIDENCE: \.\.\.\]` marker/
    );
    expect(eagerRule).toContain(EVIDENCE_REF_GRAMMAR);
    expect(eagerRule).toMatch(
      /never enters or satisfies the local S14 manifest/
    );
  });

  describe.each(SKILL_ROOTS)("%s validators", root => {
    describe.each(VALIDATOR_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("ignores EVIDENCE-REF markers while deriving S14's manifest", () => {
        expect(content).toContain(EVIDENCE_REF_GRAMMAR);
        expect(content).toMatch(/exclude it from the manifest/);
        expect(content).toMatch(/malformed reference FAILs S14/);
        expect(content).toMatch(
          /contains only `EVIDENCE-REF` entries FAILs S14/
        );
      });
    });
  });

  describe.each(SKILL_ROOTS)("%s journey writers", root => {
    describe.each(JOURNEY_WRITER_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("requires EVIDENCE-REF for sibling artifact citations", () => {
        expect(content).toContain(EVIDENCE_REF_GRAMMAR);
        expect(content).toMatch(
          /Never paste, quote, or code-format the sibling's/
        );
        expect(content).toMatch(/exact prefix creates a local obligation/);
        expect(content).toMatch(/`EVIDENCE-REF` never satisfies/);
      });
    });
  });
});
