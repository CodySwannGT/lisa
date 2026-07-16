/**
 * Regression tests for PRD requirement traceability across the decomposition,
 * write, validate, back-link, and coverage skills.
 *
 * Every ticket generated from a PRD must answer "why was this done?" by
 * carrying a `Source Requirement` section that quotes the originating
 * requirement verbatim — at every level of the hierarchy, sub-tasks included,
 * so a leaf claimed by build-intake in isolation is self-explanatory.
 *
 * Enforcement is layered:
 * - The four `*-to-tracker` skills build a Requirement Register (R-ids +
 *   verbatim quotes) while parsing the PRD and thread it into every planned
 *   ticket spec, passing `prd_source` to arm the validators.
 * - The three vendor write skills make the section a required description
 *   part for PRD-sourced tickets.
 * - The three validators gate it (S16), keeping intake comment formatting
 *   shared across vendors.
 * - `lisa-prd-backlink` records the requirement ids in its machine-readable
 *   `lisa:gw` tokens (`reqs=` field) so requirement → tickets is parseable
 *   from the PRD alone.
 * - `lisa-prd-ticket-coverage` prefers declared traces over keyword
 *   inference, making the coverage audit deterministic.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-requirement-traceability
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const TO_TRACKER_SKILLS = [
  "lisa-notion-to-tracker",
  "lisa-confluence-to-tracker",
  "lisa-github-to-tracker",
  "lisa-linear-to-tracker",
] as const;

const WRITE_SKILLS = [
  "lisa-jira-write-ticket",
  "lisa-github-write-issue",
  "lisa-linear-write-issue",
] as const;

const VALIDATE_SKILLS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

const SECTION_NAME = "Source Requirement";
const REGISTER_HEADING = "Requirement Register";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("PRD requirement traceability", () => {
  describe.each(SKILL_ROOTS)("%s decomposition skills", root => {
    describe.each(TO_TRACKER_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("builds a Requirement Register while parsing the PRD", () => {
        expect(content).toContain(REGISTER_HEADING);
        expect(content).toContain("verbatim");
      });

      it("threads requirements into every planned ticket, sub-tasks included", () => {
        expect(content).toContain(SECTION_NAME);
        // The dry-run hierarchy tags every node with register ids.
        expect(content).toContain("requirements: [R1]");
      });

      it("passes prd_source so the validator's S16 gate arms", () => {
        expect(content).toContain("prd_source");
        expect(content).toContain("S16");
      });
    });
  });

  describe.each(SKILL_ROOTS)("%s write skills", root => {
    describe.each(WRITE_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("requires the Source Requirement section for PRD-sourced tickets", () => {
        expect(content).toContain(`${SECTION_NAME}\n`);
        expect(content).toContain("prd_source");
        // Verbatim quoting is the load-bearing rule — the quote is the
        // durable trace that survives later PRD edits.
        expect(content.toLowerCase()).toContain("verbatim");
        expect(content).toContain("S16");
      });
    });
  });

  describe.each(SKILL_ROOTS)("%s validators", root => {
    describe.each(VALIDATE_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("declares the S16 gate in the gate table and details", () => {
        expect(content).toContain(
          "| S16 Source Requirement traceability | `product-clarity` | true |"
        );
        expect(content).toContain("#### S16 — Source Requirement traceability");
        expect(content).toContain(
          "- [PASS|FAIL|N/A] S16 Source Requirement traceability"
        );
      });

      it("keys the gate off prd_source and shape-checks stray sections", () => {
        expect(content).toContain("prd_source");
        expect(content).toContain("never passes silently");
      });
    });
  });

  describe.each(SKILL_ROOTS)("%s back-link and coverage", root => {
    it("lisa-prd-backlink records requirement ids in the lisa:gw token", () => {
      const content = readSkill(root, "lisa-prd-backlink");
      expect(content).toContain(
        "reqs=<comma-separated requirement ids or empty>"
      );
      expect(content).toContain("requirement_register");
      // Field order is part of the byte-stable contract.
      expect(content).toContain("(`ref`, `url`, `type`, `parent`, `reqs`)");
    });

    it("lisa-prd-ticket-coverage prefers declared traces over inference", () => {
      const content = readSkill(root, "lisa-prd-ticket-coverage");
      expect(content).toContain("Declared trace");
      // Quotes, not ids, are the durable matching anchor.
      expect(content).toContain("quotes are the durable anchor");
    });
  });
});
