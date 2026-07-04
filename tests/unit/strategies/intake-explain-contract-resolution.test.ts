/**
 * Regression coverage for intake-explain one-item contract resolution.
 *
 * Issue #846 extends the read-only operator surface so a single diagnosis must
 * resolve the same source lane, tracker lane, lifecycle namespace, and
 * repo/project scope the write-side intake flows already use. This keeps the
 * operator explanation contract aligned with the active intake scanners rather
 * than inventing a second resolver.
 * @module tests/unit/strategies/intake-explain-contract-resolution
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain contract resolution (#846)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("ties one-item diagnosis to source/tracker config and fallback defaults", () => {
      const skill = read(root, "skills/lisa-intake-explain/SKILL.md");

      expect(skill).toContain(".lisa.config.json");
      expect(skill).toContain("source");
      expect(skill).toContain("tracker");
      expect(skill).toMatch(/same `source` \/ `tracker` settings/i);
      expect(skill).toMatch(/same config keys and fallback defaults/i);
      expect(skill).toMatch(/config-resolution/);
    });

    it("documents one-item routing against the existing queue and repo-scope contract", () => {
      const skill = read(root, "skills/lisa-intake-explain/SKILL.md");

      expect(skill).toMatch(/one-item routing helpers/i);
      expect(skill).toMatch(/queue family/i);
      expect(skill).toMatch(/source\/tracker contract/i);
      expect(skill).toMatch(/repo\/project scope|current-repo detection/i);
      expect(skill).toMatch(/MISCONFIGURED/);
    });
  });
});
