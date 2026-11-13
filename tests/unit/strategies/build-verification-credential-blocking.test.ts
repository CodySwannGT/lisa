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

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

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
      expect(content).toContain("e2e/constants.ts");
      expect(content).toContain(
        "`.lisa.config.local.json` and environment variables"
      );
      expect(content).toContain("Sign-in Required");
    });

    it("verify flow applies the shared behavior during remote verification", () => {
      const content = read(root, "skills/lisa-verify/SKILL.md");

      expect(content).toContain(
        "shared `verification-lifecycle` credential lookup order"
      );
    });
  });
});
