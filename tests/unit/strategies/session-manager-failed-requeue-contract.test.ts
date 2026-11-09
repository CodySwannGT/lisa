/**
 * Prose contract: an answer to a FAILED worker's question returns the item to
 * Ready (CodySwannGT/lisa#4643, item 11).
 *
 * A worker's `FAILED` moves its item to the `blocked` role, and nothing else
 * moves a blocked item with no dependency edges back. The runbook used to say
 * the answer is recorded on the item and "the next attempt reads it there",
 * with no step that ever dispatched that attempt. These assertions pin, in the
 * source and every generated root, that Clearing moves the item to the
 * `ready` role (as it does for `exhausted`) when `answer-plan` returns
 * `requeue: true`, in the same update that removes the manager's hold, and
 * that a `DONE` worker's item is left where it is.
 * @module tests/unit/strategies/session-manager-failed-requeue-contract
 */
import { describe, expect, it } from "vitest";

import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

/**
 * Collapse line wraps, so an assertion does not depend on where the runbook
 * text happens to break.
 * @param text - Markdown text
 * @returns The text with every whitespace run as one space
 */
const flat = (text: string): string => text.replace(/\s+/g, " ");

describe.each(ALL_ROOTS)("FAILED worker answer requeue (%s)", root => {
  const skill = read(`${root}/lisa-session-manager/SKILL.md`);
  const mark = section(skill, "## Mark and move on");
  const clearing = mark.slice(mark.indexOf("**Clearing**"));

  it("moves a FAILED worker's item to ready when answer-plan says requeue", () => {
    const finished = clearing.slice(
      clearing.indexOf("whose worker already reported `DONE` or `FAILED`")
    );
    const bullet = flat(finished.slice(0, finished.indexOf("\n\n")));
    expect(bullet).toContain("`requeue: true`");
    expect(bullet).toMatch(/move it to the `ready` role/);
    expect(bullet).toContain("A `DONE` worker's item is left where it is");
  });

  it("moves it only from the blocked role, never over a human's move", () => {
    const finished = clearing.slice(
      clearing.indexOf("whose worker already reported `DONE` or `FAILED`")
    );
    const bullet = flat(finished.slice(0, finished.indexOf("\n\n")));
    expect(bullet).toContain(
      "Only when the read-back shows it **in the `blocked` role**"
    );
    expect(bullet).toContain("`requeue` never overrides a human's move");
    expect(bullet).toContain("`stop REF`");
    // A FAILED handled as `--kind decision` is held, not moved, on FAILED.
    expect(bullet).not.toContain(
      "A worker's `FAILED` moved the item to the `blocked` role"
    );
  });

  it("makes the step 2 update carry the move only from the blocked role", () => {
    const step2 = flat(
      clearing.slice(
        clearing.indexOf("2. **Remove the manager's own marker**"),
        clearing.indexOf("3. `ledger clear-question")
      )
    );
    expect(step2).toContain(
      "returned `requeue: true` and the read-back shows the item in the `blocked` role"
    );
    expect(step2).toContain("moves it to the `ready` role");
    expect(step2).toContain("in any other role, leave the item where it is");
  });

  it("reads requeue whatever record says, an item answer included", () => {
    expect(clearing).toMatch(
      /`requeue: true`[^.]*`record: false`[^.]*`answered-on-item`|`answered-on-item`[^.]*`requeue: true`/
    );
  });
});
