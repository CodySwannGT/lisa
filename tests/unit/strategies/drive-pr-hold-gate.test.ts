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

  /**
   * The watch loop only. The mid-loop assertions are scoped here on purpose:
   * the defect is that the signal was caller-time, so prose in section 0 saying
   * "re-read it" does not establish that the LOOP does.
   *
   * @returns The watch-loop section, from its heading to the first blocker class
   */
  const watchLoop = (): string => {
    const start = content.indexOf("\n## 2. The watch loop");
    const end = content.indexOf("\n### a. Branch behind base", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return content.slice(start, end);
  };

  /**
   * Terminal states only.
   *
   * @returns Section 4 to the end of the document
   */
  const terminal = (): string => {
    const start = content.indexOf("\n## 4. Terminal states");
    expect(start).toBeGreaterThanOrEqual(0);
    return content.slice(start);
  };

  it("resolves a configurable label with a default, once", () => {
    const gate = holdGate();
    expect(gate).toMatch(/`lisa:hold` by default/);
    expect(gate).toMatch(/github\.labels\.merge\.hold/);
    // Re-resolving the NAME each iteration is a different bug from re-reading
    // the label: the identity of the thing being watched would change mid-run.
    expect(gate).toMatch(/Resolve it ONCE at startup/i);
  });

  it("means auto_merge=false rather than inventing a second concept", () => {
    // The correction on #3558 established that the disarm, the fail-closed
    // re-read and the terminal state already existed. A fix that builds a
    // parallel mechanism has misread the ticket.
    const gate = holdGate();
    expect(gate).toMatch(/exactly `auto_merge=false`/);
    expect(gate).toMatch(/only new surface is\s+one label read/i);
  });

  it("states the defect it fixes: the signal was caller-time only", () => {
    const gate = holdGate();
    expect(gate).toMatch(
      /`auto_merge` is decided by the caller at invocation, and\s+nothing re-reads it/i
    );
    expect(gate).toMatch(/The hold did not fail; it lost a race/);
    expect(gate).toMatch(/#3558/);
  });

  // --- THE ACCEPTANCE CASE: a label applied mid-loop -----------------------

  it("re-reads the label on every watch-loop iteration, not once at startup", () => {
    // This is the assertion that discriminates a real fix from a caller-time
    // check that happens to sit inside a loop. It is scoped to the watch-loop
    // section deliberately.
    const loop = watchLoop();
    expect(loop).toMatch(/Re-read the hold label on every iteration/i);
    expect(loop).toMatch(/before handling any blocker/i);
  });

  it("says in the gate itself that a startup-only read is not a fix", () => {
    // Without this the next reader "simplifies" the per-iteration read into a
    // single check and reintroduces exactly the defect, with every other
    // assertion here still passing.
    const gate = holdGate();
    expect(gate).toMatch(
      /a label applied \*\*after\*\* the loop is already running/i
    );
    expect(gate).toMatch(/caller-time signal wearing a loop's clothing/i);
    expect(gate).toMatch(/you have\s+reintroduced the defect/i);
  });

  it("binds at both evaluation points, arming included", () => {
    const gate = holdGate();
    expect(gate).toMatch(/Before arming/i);
    expect(gate).toMatch(/On every watch-loop iteration/i);
    // Ordering is the whole point: checking after arming authorises the merge
    // the label exists to prevent.
    expect(content).toMatch(
      /Evaluate the hold gate BEFORE anything in this section/
    );
    expect(content).toMatch(/Checking after arming would authorise the merge/);
  });

  it("does not clear the label", () => {
    // Removing a human's signal is unrecoverable from inside the loop.
    const gate = holdGate();
    expect(gate).toMatch(/\*\*Do not remove the label\.\*\*/);
    expect(gate).toMatch(/unrecoverable from\s+inside the loop/i);
  });

  it("is terminal for the run rather than a wait", () => {
    const gate = holdGate();
    expect(gate).toMatch(/Do not keep polling while held/i);
  });

  // --- FAIL DIRECTION ------------------------------------------------------

  it("fails toward hold, and argues the asymmetry rather than asserting it", () => {
    const gate = holdGate();
    expect(gate).toMatch(/\*\*Fail toward hold\.\*\*/);
    expect(gate).toMatch(/a false hold costs one cycle/i);
    expect(gate).toMatch(/cannot be undone/i);
  });

  it("separates 'a human held this' from 'I could not tell'", () => {
    // Collapsing them would file a broken permission as a human decision, which
    // is the one shape nobody investigates.
    const gate = holdGate();
    expect(gate).toMatch(/awaiting-human:hold-unknown/);
    expect(gate).toMatch(/retry the read once/i);
    expect(gate).toMatch(/different facts/i);
  });

  it("reports both hold outcomes as distinct terminal states", () => {
    const end = terminal();
    expect(end).toMatch(/\*\*`awaiting-human:held`\*\*/);
    expect(end).toMatch(/\*\*`awaiting-human:hold-unknown`\*\*/);
    // Operator English at a gate facing outward.
    expect(end).toMatch(/Remove that label when you want it to continue/i);
    expect(end).toMatch(
      /would file a broken permission or a rate limit as a human decision/i
    );
  });

  it("keeps a hold out of the blocked:* classification in report mode", () => {
    // `blocked:*` means the PR cannot proceed yet; a hold means someone asked it
    // not to. Reporting the second as the first files a human's decision as a
    // defect for something else to clear.
    expect(content).toMatch(/\*\*The hold gate binds in report mode too\*\*/);
    expect(content).toMatch(
      /Hold is not a blocker classification and\s+never returns as one/i
    );
  });

  // --- REJECTION CONTROLS --------------------------------------------------

  it("REJECTION CONTROL: an unlabelled PR is driven exactly as before", () => {
    // A gate that only ever says stop is satisfied by a skill that always stops.
    const gate = holdGate();
    expect(gate).toMatch(
      /\*\*A PR with no hold label is driven exactly as it is today\.\*\*/
    );
    expect(gate).toMatch(/adds a\s+stop; it does not add a block/i);
  });

  it("REJECTION CONTROL: the skill's own lease label does not trip the gate", () => {
    // `lisa:babysitter-on-duty` is applied by this skill to itself and shares
    // the `lisa:` prefix. A prefix match would deadlock the loop on its own
    // lease while looking exactly like a human decision.
    const gate = holdGate();
    expect(gate).toMatch(/Match the resolved name exactly — never a prefix/i);
    expect(gate).toContain("lisa:babysitter-on-duty");
    expect(gate).toMatch(/stop on its own lease/i);
  });
});

describe.each(ROOTS)("git-submit-pr needs no hold check (%s)", root => {
  const content = readSkill(root, "lisa-git-submit-pr");

  it("explains why the second check #3558 asked for is now dead code", () => {
    // #3558's acceptance asked for a check in BOTH skills, because step 5 armed
    // the latch at creation and a loop-only hold left that arm open. #3439
    // removed the arm entirely, so the criterion is satisfied by absence. Saying
    // so is what stops someone adding an unreachable check to close the ticket
    // literally.
    expect(content).toMatch(/The hold label needs no check here/i);
    expect(content).toMatch(/Step 5 no longer arms/i);
    expect(content).toMatch(/#3558/);
  });

  it("still never arms, which is what makes the delegation sufficient", () => {
    // The guarantee depends entirely on this remaining true.
    expect(content).toMatch(/Never run `gh pr merge --auto` in this skill/i);
  });
});
