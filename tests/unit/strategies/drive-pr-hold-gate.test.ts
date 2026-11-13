/**
 * Regression tests for issue #3558: a human must be able to stop the merge loop
 * from outside the run.
 *
 * `auto_merge=false` already existed and was already well built — the disarm,
 * the fail-closed re-read and the `awaiting-human` terminal state all shipped
 * before this change. What did not exist is a way for anyone but the CALLER to
 * raise it. `auto_merge` is decided at invocation and nothing re-reads it, so a
 * reviewer who opened a PR mid-flight had no lever and lost the race: measured
 * on #3558, four explicit `--disable-auto` calls were each followed by a re-arm
 * 7-25 seconds later, and the PR merged two seconds after its last check went
 * green.
 *
 * So the defect under test is specifically CALLER-TIME-ONLY, and the assertions
 * are written to fail a fix that reads the label once at startup. A check that
 * runs before the loop is a caller-time signal wearing a loop's clothing; it
 * satisfies "a labelled PR does not merge" while fixing nothing. The acceptance
 * case is a label applied AFTER the loop is already running, which is why the
 * per-iteration assertions are sliced to the watch-loop section rather than
 * matched against the whole document.
 *
 * Two rejection controls run alongside, because a gate that only ever says
 * "stop" is satisfied by a skill that always stops:
 *   1. an unlabelled PR is driven exactly as before;
 *   2. the lease label this skill applies to ITSELF does not trip the gate.
 *
 * Both source and generated plugin roots — including the sixth Codex root — are
 * asserted so a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-hold-gate
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

describe.each(ROOTS)("drive-pr-to-merge hold gate (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  /**
   * The gate's definition, sliced by its own heading so an assertion cannot be
   * satisfied by prose living elsewhere in a 1000-line document.
   *
   * @returns The hold-gate section, from its heading to section 1
   */
  const holdGate = (): string => {
    // Headings are anchored to a line start. `## 1. Enable auto-merge` also
    // appears QUOTED inside the Inputs section, and an unanchored search finds
    // that mention first and slices backwards — a passing-looking empty range.
    const start = content.indexOf("\n### The hold gate");
    const end = content.indexOf("\n## 1. Enable auto-merge", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return content.slice(start, end);
  };

  it("means auto_merge=false rather than inventing a second concept", () => {
    // The correction on #3558 established that the disarm, the fail-closed
    // re-read and the terminal state already existed. A fix that builds a
    // parallel mechanism has misread the ticket.
    const gate = holdGate();
    expect(gate).toMatch(/exactly `auto_merge=false`/);
  });

  it("states the defect it fixes: the signal was caller-time only", () => {
    const gate = holdGate();
    expect(gate).toMatch(
      /`auto_merge` is decided by the caller at invocation, and\s+nothing re-reads it/i
    );
  });

  it("holds a low-confidence learning PR only under strict or an explicit human-triage (#4687)", () => {
    // The operator's hold label stays a stop; the default learning route no
    // longer is. Under access-only a low-confidence learning PR auto-merges.
    expect(content).toMatch(
      /only when a\s+low-confidence learning PR must wait for a human: under `humanGate\.mode:\s+"strict"`, or when the project sets `learnings\.lowConfidence: human-triage`\s+explicitly/
    );
    expect(content).toMatch(
      /Under the default `access-only` mode, low-confidence learning PRs\s+auto-merge like any other PR/
    );
  });
});

describe.each(ROOTS)("git-submit-pr needs no hold check (%s)", root => {
  const content = readSkill(root, "lisa-git-submit-pr");

  it("still never arms, which is what makes the delegation sufficient", () => {
    // The guarantee depends entirely on this remaining true.
    expect(content).toMatch(/Never run `gh pr merge --auto` in this skill/i);
  });
});
