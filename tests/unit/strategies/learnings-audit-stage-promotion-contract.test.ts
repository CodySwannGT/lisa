/**
 * Prose contract: the gardener promotes a recurring learned planning check
 * into the stage its rule names (CodySwannGT/lisa#4643, item 4).
 *
 * A `Planning (<stage>): …` learning binds to one owner —
 * `lisa-task-decomposition` step 0 says which. Promoting every recurring one
 * into the ready gate would hand a `prd`, `decomposition` or `filing` check to
 * a stage that never runs it, so the gardener routes each by its stage.
 * @module tests/unit/strategies/learnings-audit-stage-promotion-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

/**
 * The gardener's learned-planning-checks paragraph, up to the next bold lead.
 * @param root - Skill root to read from
 * @returns The paragraph text
 */
const plannedChecksPassage = (root: string): string => {
  const audit = readFileSync(
    path.resolve(root, "lisa-learnings-audit/SKILL.md"),
    "utf8"
  );
  const start = audit.indexOf("**Learned planning checks.**");
  const end = audit.indexOf("**Auto-merged low-confidence", start);
  expect(start, "learned planning checks passage").toBeGreaterThan(-1);
  return audit.slice(start, end === -1 ? audit.length : end);
};

describe.each(SKILL_ROOTS)("gardener stage-routed promotion (%s)", root => {
  const passage = plannedChecksPassage(root);

  it("promotes each recurring check into the owner its stage names", () => {
    expect(passage).toContain(
      "- `decomposition` → the decomposition obligations in `lisa-task-decomposition`"
    );
    expect(passage).toContain(
      "- `ready-gate` → the `work-item-definition-of-ready` rule or the validators' S18"
    );
    expect(passage).toContain("- `filing` → the `ready-role-filing` rule");
  });
});
