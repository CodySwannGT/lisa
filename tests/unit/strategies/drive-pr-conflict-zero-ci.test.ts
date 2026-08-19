/**
 * Pins the pre-merge zero-CI diagnostic in `lisa-drive-pr-to-merge`, on every
 * agent's copy.
 *
 * A conflicted pull request dispatches **zero** workflows. `pull_request` runs
 * are evaluated against GitHub's computed merge ref — "base with this PR merged
 * in" — and a conflict means that ref cannot be built, so nothing is created.
 * The PR then shows an empty check list, which is indistinguishable from an
 * Actions outage, a slow queue, or workflows not being configured.
 *
 * That ambiguity has cost real time: an agent concluded CI was down and waited
 * for runs that were never going to be dispatched.
 *
 * The skill already carried the post-merge twin of this rule — zero deploy runs
 * after a merge must not be read as "shipped". These assertions cover the
 * pre-merge half, and exist because prose drifts: the guidance is only useful
 * if the ORDER (check conflicts before waiting on checks) and the
 * `null`-is-not-clean caveat both survive future edits.
 * @module tests/unit/strategies/drive-pr-conflict-zero-ci
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe.each(ROOTS)("conflict means zero CI runs (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  it("names the merge ref as the reason no runs are dispatched", () => {
    // Without the mechanism the rule reads as superstition, and the next
    // person to hit an empty check list has no way to tell it apart from an
    // outage.
    expect(content).toContain("merge ref");
    expect(content).toMatch(/zero\*{0,2}\s+workflows|no run is created/i);
  });

  it("requires BOTH signals, not an empty check list alone", () => {
    // An empty check list on its own is genuinely ambiguous. Only paired with
    // CONFLICTING does it identify a conflict, and the skill must say so or it
    // teaches a false positive.
    expect(content).toContain("CONFLICTING");
    expect(content).toContain("total_count");
  });

  it("tells the agent to check conflicts BEFORE waiting on checks", () => {
    // The ordering is the entire value. Diagnosing it correctly after a
    // twenty-minute wait saves nothing.
    expect(content).toMatch(/check this first/i);
  });

  it("treats an async `null` mergeable as unknown, never as clean", () => {
    // GitHub computes `mergeable` asynchronously and returns null meanwhile, so
    // a single read on a fresh PR can say null on a clean branch. Reading that
    // as "fine" would make this check an instance of the defect it exists to
    // catch.
    expect(content).toMatch(/asynchronous|asynchronously/i);
    expect(content).toContain("cannot tell yet");
  });
});
