/**
 * Prose contract: the cycle's duplicate-manager check never flags the manager
 * itself (CodySwannGT/lisa#4496).
 *
 * A manager running in its own tmux session saw "the tmux manager is running"
 * and "this session has a loop", concluded there were two managers, and
 * offered to `CronDelete` its own loop, which would have silently stopped all
 * dispatch. These assertions pin, in the source and every generated root, that
 * "The cycle" decides by `status` `manager.self`: a manager never reports
 * itself or stops its own loop, only a session outside the tmux manager is a
 * duplicate, and only that session's loop is the one to stop.
 * @module tests/unit/strategies/session-manager-duplicate-manager-contract
 */
import { describe, expect, it } from "vitest";

import { USAGE } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/cli-usage.mjs";
import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

/**
 * Collapse line wraps, so an assertion does not depend on where the runbook
 * text happens to break.
 * @param text - Markdown text
 * @returns The text with every whitespace run as one space
 */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/**
 * The duplicate-manager paragraph of "The cycle", flattened.
 * @param skill - SKILL.md text
 * @returns The paragraph, or "" when it is absent
 */
function duplicateCheck(skill: string): string {
  const cycle = section(skill, "## The cycle");
  const start = cycle.indexOf("**Duplicate-manager check.**");
  if (start === -1) return "";
  const end = cycle.indexOf("\n\n", start);
  return flat(cycle.slice(start, end === -1 ? cycle.length : end));
}

describe.each(ALL_ROOTS)("duplicate-manager check (%s)", root => {
  const skill = read(`${root}/lisa-session-manager/SKILL.md`);
  const check = duplicateCheck(skill);

  it("decides by status manager.self", () => {
    expect(check).toContain("`manager.self`");
    expect(check).toContain("`manager.running`");
  });

  it("never reports the manager itself or stops its own loop", () => {
    expect(check).toContain(
      "When `manager.self` is true, this session **is** the manager"
    );
    expect(check).toContain(
      "never report it as a second manager, and never recommend `CronDelete` or stopping it"
    );
  });

  it("names only the session outside tmux as the duplicate to stop", () => {
    expect(check).toContain(
      "When `manager.running` is true, `manager.self` is false"
    );
    expect(check).toContain(
      "recommend stopping **this** session's loop, never the tmux manager"
    );
  });

  it("decides who the manager is only from manager.self, loops from CronList", () => {
    expect(check).toContain(
      "Decide **who** the manager is only from `status` `manager.self`"
    );
    expect(check).toContain("check this session's own loops with `CronList`");
    expect(check).toContain(
      "Never infer a second manager from the tmux session existing plus a loop being present"
    );
  });

  it("stops nothing when self-identification failed", () => {
    expect(check).toContain(
      "When `manager.self` is `null`, recommend stopping nothing"
    );
    expect(check).toContain("report that self-identification failed");
  });

  it("leaves the warning to the non-tmux session; the manager invents none", () => {
    expect(check).toContain(
      "The tmux manager cannot see another session's loop"
    );
    expect(check).toContain("the manager must not invent one");
  });

  it("says self covers any session inside the manager's tmux session", () => {
    expect(check).toContain(
      "`manager.self` means running inside the manager's tmux session"
    );
  });
});

describe("status usage text", () => {
  it("documents manager.self as true, false or null", () => {
    const usage = flat(USAGE);
    expect(usage).toContain("manager:{name,running,self}");
    expect(usage).toContain("manager.self is true when the caller runs inside");
    expect(usage).toContain("null when tmux cannot say");
  });
});
