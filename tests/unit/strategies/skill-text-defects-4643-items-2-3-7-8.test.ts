/**
 * Prose contract for four skill-text defects (CodySwannGT/lisa#4643, items
 * 2, 3, 7 and 8). Each assertion pins the corrected passage in the source
 * and in every generated copy a runtime reads, so a regeneration that drops
 * the fix fails here.
 *
 * - Item 2: `lisa-delivery-effectiveness` claimed first-pass yield shows every
 *   other failure, which its own definitions contradict.
 * - Item 3: `lisa-implement`'s human-only exit could leave only the local,
 *   gitignored verdict; it must leave a comment, the label and the blocked
 *   role on the work item, and the planning-miss evidence must cite that
 *   comment.
 * - Item 7: `learning-judge` condition 2 demanded missing information, so a
 *   decomposition miss (nothing missing, item unbuildable as scoped) could
 *   never classify.
 * - Item 8: `learning-judge` Step 3 set no precedence between `planning-miss`
 *   and `durable-learning`; its tie-break decides nothing between two
 *   persisting classes.
 * @module tests/unit/strategies/skill-text-defects-4643-items-2-3-7-8
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/** Every skill root a runtime reads: the source plus each projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

/** Every checked-in copy of the judge. Codex installs from plugins/lisa. */
const JUDGES = [
  "plugins/src/base/agents/learning-judge.md",
  "plugins/lisa/agents/learning-judge.md",
  "plugins/lisa-cursor/agents/learning-judge.md",
  "plugins/lisa-agy/agents/learning-judge.md",
  "plugins/lisa-copilot/agents/learning-judge.agent.md",
  "plugins/lisa-devin/agents/learning-judge.md",
] as const;

describe.each(SKILL_ROOTS)("skill text in %s", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);

  it("item 3: a human-only stop leaves its evidence on the work item", () => {
    const text = skill("lisa-implement");
    const exit = text.split("**Human-only blocker**")[1]?.split("\n")[0] ?? "";
    expect(exit).not.toContain("mark it `human_needed`");
    expect(exit).toContain("apply the configured `human_needed` label");
    expect(text).toContain(
      "`evidence_links` = the new ticket or the blocked-stop tracker comment"
    );
  });
});

describe.each(JUDGES)("learning-judge (%s)", judgePath => {
  const judge = read(judgePath);

  it("item 8: planning-miss takes precedence over durable-learning", () => {
    const step3 = judge.split("### Step 3:")[1]?.split("### Step 4")[0] ?? "";
    expect(step3).toContain(
      "**`planning-miss` takes precedence over `durable-learning`**"
    );
  });
});
