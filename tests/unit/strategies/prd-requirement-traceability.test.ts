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

const VALIDATE_SKILLS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("PRD requirement traceability", () => {
  describe.each(SKILL_ROOTS)("%s validators", root => {
    describe.each(VALIDATE_SKILLS)("%s", skill => {
      const content = readSkill(root, skill);

      it("declares the S16 gate in the gate table and details", () => {
        expect(content).toContain(
          "- [PASS|FAIL|N/A] S16 Source Requirement traceability"
        );
      });
    });
  });
});
