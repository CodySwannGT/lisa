/**
 * Regression coverage for automation-status operator guidance.
 *
 * Issue #804 adds the operator-facing usage and remediation documentation on
 * top of the command/skill scaffold. This suite keeps both plugin roots in
 * sync and proves the docs stay actionable for Codex and Claude operators.
 * @module tests/unit/strategies/automation-status-operator-docs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("automation-status operator docs (#804)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("documents operator entrypoints in the command surface", () => {
      const command = read(root, "commands/lisa/automation-status.md");

      expect(command).toContain("/lisa:automation-status");
      expect(command).toContain("--verbose");
      expect(command).toMatch(/read-only/i);
      expect(command).toContain("/lisa:setup-automations");
      expect(command).toContain("/lisa:intake");
      expect(command).toContain("/lisa:repair-intake");
    });

    it("documents runtime differences and remediation guidance in the skill", () => {
      const skill = read(root, "skills/lisa-automation-status/SKILL.md");

      expect(skill).toContain("## Operator usage");
      expect(skill).toContain("## Runtime differences");
      expect(skill).toContain("## Verdicts and remediation");
      expect(skill).toContain("Codex");
      expect(skill).toContain("Claude");
      expect(skill).toMatch(/unsupported for that runtime/i);
      expect(skill).toContain("HEALTHY");
      expect(skill).toContain("PARTIAL_SUPPORT");
      expect(skill).toContain("ATTENTION_NEEDED");
      expect(skill).toContain("MISSING");
      expect(skill).toContain("DRIFTED");
      expect(skill).toContain("STALE");
      expect(skill).toContain("FAILING");
      expect(skill).toContain("UNSUPPORTED");
      expect(skill).toContain("/lisa:setup-automations");
      expect(skill).toContain("/lisa:intake");
      expect(skill).toContain("/lisa:repair-intake");
    });
  });
});
