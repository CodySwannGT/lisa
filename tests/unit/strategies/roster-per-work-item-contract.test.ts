/**
 * Contract coverage for the per-work-item Roster Decision path in
 * `lisa-implement`, pinned across the canonical source and all five checked-in
 * runtime projections.
 *
 * The requirement is that two flows running concurrently in one repository never
 * write the same roster file. The trap it must never fall back into is a single
 * shared `.lisa/roster.md`: the first time each branch creates it the merge is
 * **add/add**, which git cannot three-way, so resolution is a coin flip that
 * silently discards one flow's roster while the survivor belongs to a different
 * flow than the one being audited. Because the file reads as scratch, that
 * discard looks harmless and gets done without thought.
 *
 * The roster is written by an agent following skill prose, not by a code path,
 * so the instruction text is the contract surface and these assertions pin it.
 * The one mechanically observable half — that a per-work-item roster stays
 * trackable under the shipped ignore template rather than being reclassified as
 * runtime scratch — is adjudicated by git in
 * `tests/unit/strategies/copy-contents-gitignore.test.ts`.
 * @module tests/unit/strategies/roster-per-work-item-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Canonical source plus every checked-in runtime projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

/** The one skill that tells a flow where to persist its Roster Decision. */
const SKILL = "lisa-implement";

/** The per-work-item path every surface must name. */
const PER_ITEM_PATH = "/.lisa/roster/<work-item-slug>.md";

/**
 * The shared write target this contract removes. Pinned as the full expression
 * rather than the bare filename, because the prose still has to name
 * `.lisa/roster.md` when it tells flows to leave a legacy file alone.
 */
const SHARED_WRITE_TARGET =
  "${LISA_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-.}}/.lisa/roster.md";

/** The character class the slug rule preserves; everything else becomes `-`. */
const SLUG_CHARACTER_CLASS = "[A-Za-z0-9._-]";

/** The single input the slug derives from, so every runtime agrees. */
const SLUG_INPUT = "work_item_ref";

/**
 * Read a skill body from one plugin root.
 * @param root - Plugin skills root (canonical source or generated fanout)
 * @returns SKILL.md contents
 */
const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL, "SKILL.md"), "utf8");

describe("roster-per-work-item contract", () => {
  it.each(SKILL_ROOTS)("%s writes one roster file per work item", root => {
    expect(readSkill(root)).toContain(PER_ITEM_PATH);
  });

  it.each(SKILL_ROOTS)(
    "%s no longer directs flows at a shared roster file",
    root => {
      expect(readSkill(root)).not.toContain(SHARED_WRITE_TARGET);
    }
  );

  it.each(SKILL_ROOTS)(
    "%s defines a slug so one work item maps to one filename",
    root => {
      const body = readSkill(root);
      expect(body).toContain(SLUG_CHARACTER_CLASS);
      expect(body).toContain(SLUG_INPUT);
    }
  );

  it.each(SKILL_ROOTS)(
    "%s states why a shared roster file is the defect, not merely a preference",
    root => {
      expect(readSkill(root)).toContain("add/add");
    }
  );

  it.each(SKILL_ROOTS)(
    "%s leaves an already-committed legacy roster alone",
    root => {
      const body = readSkill(root);
      expect(body).toContain("legacy `.lisa/roster.md`");
      expect(body).toMatch(/Do not migrate or delete a legacy/);
    }
  );

  it.each(SKILL_ROOTS)(
    "%s keeps the roster an audit record rather than reclassifying it as scratch",
    root => {
      expect(readSkill(root)).toContain(
        "absence of the artifact is a workflow failure"
      );
    }
  );
});
