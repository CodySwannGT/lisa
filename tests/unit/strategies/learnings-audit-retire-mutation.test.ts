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
const RECORD_ITEM = "1. **Record where before you break.**";
const LOCATION_FIELD = "`mutation_location`";
const BLOCK_ITEM = "2. **A failed restore blocks the row.**";

/**
 * The text between two markers; empty when either marker is missing, so a
 * missing marker fails the content assertions rather than matching elsewhere.
 * @param text - Document text
 * @param from - Start marker (included)
 * @param to - End marker (excluded); end of text when omitted
 * @returns The slice
 */
const between = (text: string, from: string, to?: string): string => {
  const start = text.indexOf(from);
  if (start < 0) return "";
  const end = to === undefined ? text.length : text.indexOf(to, start);
  return end < 0 ? "" : text.slice(start, end);
};

describe.each(SKILL_PATHS)("RETIRE mutation proof (%s)", skillPath => {
  const skill = readFileSync(path.resolve(skillPath), "utf8");
  const section = between(skill, SECTION_START, SECTION_END);
  const recordItem = between(section, RECORD_ITEM, BLOCK_ITEM);
  const blockItem = between(section, BLOCK_ITEM);

  it("delegates the copy recipe to the falsifiable-checks rule by slug, ahead of the steps", () => {
    const citeAt = section.indexOf("`falsifiable-checks`");
    expect(citeAt).toBeGreaterThan(0);
    expect(section).toMatch(
      /"Break on a scratch copy, never in a\s+shared worktree"/
    );
    expect(section.indexOf(RECORD_ITEM)).toBeGreaterThan(citeAt);
  });

  it("records mutation_location in its own step before the break, and the row carries it", () => {
    expect(recordItem).toContain(LOCATION_FIELD);
    expect(recordItem).toMatch(/Before applying the\s+mutation/);
    expect(section.indexOf(BLOCK_ITEM)).toBeGreaterThan(
      section.indexOf(RECORD_ITEM)
    );
    // The batch-ticket RETIRE row description names the same field.
    const batchDescription = between(
      skill,
      "**One batch ticket per run",
      "<!-- gardener-batch-ticket-template:start -->"
    );
    expect(batchDescription).toContain(LOCATION_FIELD);
  });

  // Codex and Antigravity ship this skill without the rules tree, so the
  // copy, baseline and discard steps must travel in the skill itself.
  it("carries its own scratch-copy recipe, before the numbered steps", () => {
    const recipe = between(section, "```sh", RECORD_ITEM);
    expect(recipe).toContain('git worktree add --detach "$tmp" HEAD');
    expect(recipe).toContain("git diff --binary HEAD");
    expect(recipe).toMatch(/baseline: run the named test in "\$tmp" BEFORE/);
    expect(recipe).toContain('git worktree remove --force "$tmp"');
    expect(recipe).toContain("EnterWorktree");
  });

  it("blocks the row on a failed restore and escalates with the location", () => {
    expect(blockItem).toMatch(/\*\*no\*\*\s+RETIRE\s+row/);
    expect(blockItem).toContain("`mutation-restore-failed`");
    expect(blockItem).toContain(LOCATION_FIELD);
    expect(blockItem).toMatch(/escalated\s+per\s+Escalation/);
    expect(blockItem).toContain("`recovery-required`");
  });

  it("names the failed restore in Run outcomes and the leftover copy in Recovery", () => {
    const outcomes = between(skill, "## Run outcomes");
    const recovery = between(skill, "## Recovery", "## Run outcomes");
    expect(outcomes).toMatch(
      /RETIRE\s+mutation\s+proof\s+whose\s+scratch\s+copy/
    );
    expect(recovery).toContain(LOCATION_FIELD);
  });
});
