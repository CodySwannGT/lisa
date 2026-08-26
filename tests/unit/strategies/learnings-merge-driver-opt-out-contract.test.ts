/**
 * The operator-facing merge-driver contract is generated for every supported
 * coding agent from two canonical skills. Keep the safety-critical default and
 * exact opt-out semantics visible everywhere those agents resolve conflicts.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SKILLS = ["lisa-persist-learning", "lisa-drive-pr-to-merge"] as const;
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

describe("learnings merge-driver opt-out documentation", () => {
  it.each(SKILLS)(
    "publishes exact opt-out semantics in %s for every agent",
    skill => {
      for (const surface of SURFACES) {
        const content = readFileSync(
          path.join(ROOT, surface, skill, "SKILL.md"),
          "utf8"
        );
        expect(content).toContain("enabled by default");
        expect(content).toContain("learnings.mergeDriver: false");
        expect(content).toContain("does not uninstall");
      }
    }
  );
});
