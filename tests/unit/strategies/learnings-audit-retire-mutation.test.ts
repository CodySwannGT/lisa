/**
 * The gardener's RETIRE mutation proof runs on a scratch copy and records
 * where it ran (CodySwannGT/lisa#4875).
 *
 * `lisa-learnings-audit` proves a test owns a learning by breaking the rule
 * and watching the test fail. Done in place, that break is a write into
 * whatever worktree the gardener shares, and a failed restore leaves the rule
 * broken with nothing recording which file changed. The skill must delegate
 * the copy recipe to the `falsifiable-checks` rule, record the mutated
 * location before breaking anything, and file no RETIRE row when the restore
 * fails.
 *
 * Assertions are structural per #4867: they check that the delegation, the
 * recorded field and the blocking outcome exist in the right order, not how
 * the prose is worded. The scratch-copy phrase itself is checked across every
 * shipped copy by `falsification-scratch-copy.test.ts`.
 * @module tests/unit/strategies/learnings-audit-retire-mutation
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_PATHS = [
  "plugins/src/base/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-agy/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-devin/skills/lisa-learnings-audit/SKILL.md",
] as const;

const SECTION_START = "A RETIRE owned by a test needs a mutation proof";
const SECTION_END = "**Learned planning checks.**";

describe.each(SKILL_PATHS)("RETIRE mutation proof (%s)", skillPath => {
  const skill = readFileSync(path.resolve(skillPath), "utf8");
  const start = skill.indexOf(SECTION_START);
  const end = skill.indexOf(SECTION_END, start);
  const section = skill.slice(start, end);
  const recordAt = section.indexOf("`mutation_location`");
  const blockAt = section.indexOf("`mutation-restore-failed`");

  it("delegates the copy recipe to the falsifiable-checks rule by slug", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(section).toContain("`falsifiable-checks`");
    expect(section).toMatch(
      /"Break on a scratch copy, never in a\s+shared worktree"/
    );
  });

  it("records mutation_location before the failed-restore exit, and the row carries it", () => {
    expect(recordAt).toBeGreaterThan(0);
    expect(blockAt).toBeGreaterThan(recordAt);
    // The batch-ticket RETIRE row description names the same field.
    expect(skill.slice(end)).toContain("`mutation_location`");
  });

  it("routes a failed restore to recovery-required with no RETIRE row", () => {
    const exit = section.slice(Math.max(0, blockAt - 400), blockAt + 300);
    expect(blockAt).toBeGreaterThan(0);
    expect(exit).toMatch(/\*\*no\*\* RETIRE row/);
    expect(exit).toContain("`recovery-required`");
  });
});
