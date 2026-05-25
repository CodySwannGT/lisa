/**
 * Regression tests for issue #730: PRD writers and tracker writers must preserve
 * the managed Lisa Usage ledger instead of dropping or duplicating it during
 * updates.
 *
 * Assert both the upstream source skills and the generated plugin artifacts so
 * `bun run build:plugins` remains a required parity step.
 * @module tests/unit/strategies/usage-accounting-writer-preservation
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const USAGE_SECTION = "## Lisa Usage";
const USAGE_RULE = "usage-accounting";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("writer shims preserve managed Lisa Usage ledgers", () => {
  describe.each(ROOTS)("%s", root => {
    it("threads PRD writes through usage-aware vendor writers", () => {
      const content = readSkill(root, "prd-source-write");
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/preserve/i);
      expect(content).toMatch(new RegExp(USAGE_RULE, "i"));
    });

    it("threads tracker writes through usage-aware vendor writers", () => {
      const content = readSkill(root, "tracker-write");
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/preserve/i);
      expect(content).toMatch(new RegExp(USAGE_RULE, "i"));
    });
  });
});

describe("per-vendor PRD writers preserve managed Lisa Usage ledgers", () => {
  const writers = [
    "github-write-prd",
    "linear-write-prd",
    "notion-write-prd",
    "confluence-write-prd",
  ] as const;

  describe.each(writers)("%s", writer => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, writer);

      it("mentions preserving the canonical usage section on update", () => {
        expect(content).toContain(USAGE_SECTION);
        expect(content).toMatch(/preserve/i);
        expect(content).toMatch(/update/i);
      });

      it("routes ledger rewrites through the shared usage-accounting contract", () => {
        expect(content).toMatch(new RegExp(USAGE_RULE, "i"));
        expect(content).toMatch(/serializer|merge path/i);
      });
    });
  });
});

describe("per-vendor tracker writers preserve managed Lisa Usage ledgers", () => {
  const writers = [
    "github-write-issue",
    "linear-write-issue",
    "jira-write-ticket",
  ] as const;

  describe.each(writers)("%s", writer => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, writer);

      it("requires preserving the canonical usage section during updates", () => {
        expect(content).toContain(USAGE_SECTION);
        expect(content).toMatch(/preserve/i);
        expect(content).toMatch(/update/i);
      });

      it("forbids duplicate or ad hoc ledger rewrites", () => {
        expect(content).toMatch(
          /never append a second usage section|silently drop ledger rows/i
        );
        expect(content).toMatch(new RegExp(USAGE_RULE, "i"));
      });
    });
  });
});
