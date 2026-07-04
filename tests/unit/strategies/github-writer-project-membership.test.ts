/**
 * Regression tests for GitHub writer integration with the shared ProjectV2
 * coordination utility.
 *
 * Issue #701 threads `github-write-prd` and `github-write-issue` through
 * `github-project-v2` so real GitHub Issues are added to the configured shared
 * Project without replacing GitHub Issues as the lifecycle source of truth.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/github-writer-project-membership
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const WRITERS = ["lisa-github-write-issue", "lisa-github-write-prd"] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("github writer project membership", () => {
  describe.each(WRITERS)("%s", writer => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, writer);

      it("delegates project membership through the shared utility", () => {
        expect(content).toMatch(/lisa-github-project-v2/);
        expect(content).toMatch(/operation:\s*ensure-item/i);
        expect(content).toMatch(/content_node_id/i);
      });

      it("keeps GitHub Issues as the lifecycle source of truth", () => {
        expect(content).toMatch(/lifecycle source of truth/i);
        expect(content).toMatch(
          /labels, body, comments|durable success|report Project coordination as completed/i
        );
      });

      it("branches by required vs best-effort project mode", () => {
        expect(content).toMatch(/outcome:\s*warning/i);
        expect(content).toMatch(/required:\s*false/i);
        expect(content).toMatch(/outcome:\s*blocked/i);
        expect(content).toMatch(/required:\s*true/i);
      });

      it("reuses membership idempotently on update", () => {
        expect(content).toMatch(/outcome:\s*reused|added` or `reused`/i);
        expect(content).toMatch(
          /without duplicating membership writes|membership is now present/i
        );
      });
    });
  });
});
