/**
 * Every skill that pushes tells the agent to run `lisa check` and fix failures
 * before `git push` (CodySwannGT/lisa#4601), on every agent surface the skill
 * ships to.
 *
 * The source under `plugins/src/base/skills/` is the reference (Claude); the
 * generated copies are what Claude, Codex, Cursor, Antigravity, Copilot and
 * Devin actually read. OpenCode installs its skills from the Claude copy
 * (`plugins/lisa/skills/`) at apply time, so that copy covers it.
 * @module tests/unit/skills/pushing-skills-run-lisa-check
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const SKILLS = [
  "lisa-git-submit-pr",
  "lisa-drive-pr-to-merge",
  "lisa-implement",
] as const;

/** Skill roots per agent surface, relative to the repository. */
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

const CASES = SURFACES.flatMap(surface =>
  SKILLS.map(skill => [surface, skill] as const)
);

describe("pushing skills run lisa check before git push", () => {
  it.each(CASES)("%s/%s instructs lisa check first", (surface, skill) => {
    const text = readFileSync(
      path.join(REPO_ROOT, surface, skill, "SKILL.md"),
      "utf8"
    );
    expect(text).toContain("lisa check");
    expect(text).toContain("bunx @codyswann/lisa check");
    // The instruction is about ordering and about fixing, not just running it.
    expect(text).toMatch(/lisa check[^\n]*(?:before|fix)/u);
  });

  it("puts lisa check ahead of the push step in submit-pr", () => {
    const text = readFileSync(
      path.join(REPO_ROOT, SURFACES[0], "lisa-git-submit-pr", "SKILL.md"),
      "utf8"
    );
    const step = text.split("\n").find(line => line.startsWith("3. **Push**"));
    expect(step).toBeDefined();
    const check = step?.indexOf("lisa check") ?? -1;
    const push = step?.indexOf("push current branch") ?? -1;
    expect(check).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(check);
  });
});
