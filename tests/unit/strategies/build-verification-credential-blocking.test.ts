/**
 * Regression coverage for build-side credential-gated verification.
 *
 * Issue #1229: build/runtime verification must exhaust project credentials
 * before declaring them unavailable, and genuine absence must block the work
 * item with a human-needed signal instead of completing on artifact-only proof.
 *
 * Both source and generated plugin roots are asserted so artifact-only edits
 * and missed plugin rebuilds fail the suite.
 *
 * @module tests/unit/strategies/build-verification-credential-blocking
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-cursor",
] as const;

const VERIFICATION_RULE_PATHS = [
  "plugins/src/base/rules/eager/verification.md",
  "plugins/src/base/rules/reference/verification.md",
  "plugins/lisa/rules/eager/verification.md",
  "plugins/lisa/rules/reference/verification.md",
  "plugins/lisa-copilot/rules/eager/verification.md",
  "plugins/lisa-copilot/rules/reference/verification.md",
  "plugins/lisa-cursor/rules/verification.mdc",
  "plugins/lisa-cursor/rules/verification-reference.mdc",
] as const;

const HUMAN_REVIEW_LABEL_TEXT = "`needs-human` / `human-review`";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

const readPath = (rel: string): string =>
  readFileSync(path.resolve(rel), "utf8");

describe("build-side credential-gated verification (#1229)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("verification lifecycle documents the credential lookup order", () => {
      const content = read(root, "skills/lisa-verification-lifecycle/SKILL.md");

      const fixtureIndex = content.indexOf("e2e/fixtures/api-login.ts");
      const localConfigIndex = content.indexOf(
        "`.lisa.config.local.json` and environment variables"
      );
      const ticketIndex = content.indexOf("Documented ticket credentials");

      expect(fixtureIndex).toBeGreaterThan(-1);
      expect(localConfigIndex).toBeGreaterThan(fixtureIndex);
      expect(ticketIndex).toBeGreaterThan(localConfigIndex);

      expect(content).toContain("Project e2e / Playwright config and fixtures");
      expect(content).toContain("e2e/constants.ts");
      expect(content).toContain("e2e/fixtures/api-login.ts");
      expect(content).toContain("555555");
      expect(content).toContain(
        "`.lisa.config.local.json` and environment variables"
      );
      expect(content).toContain("Documented ticket credentials");
      expect(content).toContain("Sign-in Required");
    });

    it("verification lifecycle blocks genuine credential absence with a human label", () => {
      const content = read(root, "skills/lisa-verification-lifecycle/SKILL.md");

      expect(content).toMatch(/configured blocked state/i);
      expect(content).toContain(HUMAN_REVIEW_LABEL_TEXT);
      expect(content).toMatch(/artifact-only \/ verification deferred/i);
      expect(content).toMatch(/verified empirically/i);
      expect(content).toMatch(
        /cannot mark a required runtime verification complete/i
      );
    });

    it("verify flow applies the shared behavior during remote verification", () => {
      const content = read(root, "skills/lisa-verify/SKILL.md");

      expect(content).toContain(
        "shared `verification-lifecycle` credential lookup order"
      );
      expect(content).toContain(
        "project e2e / Playwright config and fixtures first"
      );
      expect(content).toMatch(
        /do not complete the item on artifact-only evidence/i
      );
      expect(content).toMatch(/configured blocked state/i);
      expect(content).toContain(HUMAN_REVIEW_LABEL_TEXT);
    });
  });

  describe.each(VERIFICATION_RULE_PATHS)("%s", rulePath => {
    it("verification rule surfaces the non-silent artifact-only outcome", () => {
      const content = readPath(rulePath);

      expect(content).toMatch(
        /Exhaust credential sources|Credential-Gated Verification/
      );
      expect(content).toMatch(/e2e \/ Playwright config and fixtures/i);
      expect(content).toMatch(/artifact-only \/ verification deferred/i);
      expect(content).toMatch(/configured blocked state/i);
      expect(content).toContain(HUMAN_REVIEW_LABEL_TEXT);
    });
  });
});
