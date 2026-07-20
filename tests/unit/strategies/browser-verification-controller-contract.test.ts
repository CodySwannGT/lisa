/**
 * Regression coverage for controller-neutral empirical browser verification.
 *
 * A Playwright test run is a quality/regression gate, not the initial evidence.
 * Interactive Playwright control is still a valid way to drive the live browser.
 * Both source and generated plugin roots are asserted so the contract cannot
 * drift across supported agent surfaces.
 *
 * @module tests/unit/strategies/browser-verification-controller-contract
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

const RULE_PATHS = [
  "plugins/src/base/rules/eager/verification.md",
  "plugins/src/base/rules/reference/verification.md",
  "plugins/lisa/rules/eager/verification.md",
  "plugins/lisa/rules/reference/verification.md",
  "plugins/lisa-copilot/rules/eager/verification.md",
  "plugins/lisa-copilot/rules/reference/verification.md",
  "plugins/lisa-cursor/rules/verification.mdc",
  "plugins/lisa-cursor/rules/verification-reference.mdc",
] as const;

const VERIFIER_PATHS = [
  "plugins/src/base/agents/verification-specialist.md",
  "plugins/lisa/agents/verification-specialist.md",
  "plugins/lisa-agy/agents/verification-specialist.md",
  "plugins/lisa-cursor/agents/verification-specialist.md",
] as const;
const LIFECYCLE_SKILL = "skills/lisa-verification-lifecycle/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

const readPath = (rel: string): string =>
  readFileSync(path.resolve(rel), "utf8");

describe("browser verification controller contract", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("accepts interactive browser control without requiring one backend", () => {
      const lifecycle = read(root, LIFECYCLE_SKILL);
      const productUse = read(root, "skills/lisa-use-the-product/SKILL.md");

      expect(lifecycle).toMatch(/interactive Playwright control/i);
      expect(lifecycle).toMatch(/controller as implementation-neutral/i);
      expect(lifecycle).toMatch(/do not declare a tooling block/i);

      expect(productUse).toMatch(/Playwright MCP\/API\/ad hoc script/i);
      expect(productUse).toMatch(/controller is an implementation detail/i);
      expect(productUse).toMatch(/not a blocker/i);
    });

    it("keeps live evidence distinct from the codified test", () => {
      const lifecycle = read(root, LIFECYCLE_SKILL);
      const productUse = read(root, "skills/lisa-use-the-product/SKILL.md");

      expect(lifecycle).toMatch(
        /Running an automated Playwright or Maestro test is not a substitute/i
      );
      expect(lifecycle).toMatch(/after the empirical journey passes/i);
      expect(productUse).toMatch(
        /Playwright test run alone is not this evidence/i
      );
    });

    it("captures UI evidence through the selected interactive controller", () => {
      const evidence = read(root, "skills/lisa-tracker-evidence/SKILL.md");
      const verify = read(root, "skills/lisa-verify/SKILL.md");

      expect(evidence).toMatch(/interactive browser controller/i);
      expect(evidence).toMatch(/do not require one named backend/i);
      expect(verify).toMatch(/interactive browser controller/i);
      expect(verify).not.toMatch(/one Playwright-MCP screenshot per step/i);
    });

    it("distributes the same guarded Kane provider contract", () => {
      const provider = read(root, "skills/lisa-kane-browser/SKILL.md");
      const setup = read(root, "skills/lisa-setup-kane/SKILL.md");
      const lifecycle = read(root, LIFECYCLE_SKILL);
      const codify = read(root, "skills/lisa-codify-verification/SKILL.md");

      expect(provider).toMatch(/cloudUploadApproved/i);
      expect(provider).toMatch(/non-production/i);
      expect(provider).toMatch(/mutation policy.*`full`/i);
      expect(provider).toMatch(/tool_failed.*product regression/is);
      expect(provider).toMatch(/local evidence pack.*source artifact/is);
      expect(setup).toMatch(/Kane CLI `0\.6\.3`/i);
      expect(setup).toMatch(/Ask exactly one approval question/i);
      expect(lifecycle).toMatch(/project-native Playwright\/Cypress\/Maestro/i);
      expect(codify).toMatch(/Do not commit Kane `_test\.md` recordings/i);
    });
  });

  describe.each(VERIFIER_PATHS)("%s", verifierPath => {
    it("teaches the verifier to use any capable interactive controller", () => {
      const content = readPath(verifierPath);

      expect(content).toMatch(/interactive Playwright control/i);
      expect(content).toMatch(/controller is implementation-neutral/i);
      expect(content).toMatch(
        /Do not block merely because a preferred backend/i
      );
      expect(content).toMatch(
        /test alone does not qualify as the initial evidence/i
      );
    });
  });

  describe.each(RULE_PATHS)("%s", rulePath => {
    it("states the controller-versus-test distinction", () => {
      const content = readPath(rulePath);

      expect(content).toMatch(/Browser-controller neutrality/i);
      expect(content).toMatch(/interactive Playwright control/i);
      expect(content).toMatch(
        /automated Playwright or Maestro test.*not the initial empirical/i
      );
      expect(content).toMatch(/codify/i);
    });
  });
});
