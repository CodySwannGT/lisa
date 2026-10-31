/**
 * Prose contract for "mark and move on" (CodySwannGT/lisa#4555, part 3).
 *
 * The manager is an agent following `lisa-session-manager`, so the runbook
 * text is the contract. These assertions pin, in the source and in every
 * generated root: the four cases that need a human, each with its `--kind`;
 * the order (plan, ledger first, tracker write, read back, record the mark,
 * continue); that the cycle continues and dispatches the next item; how a
 * question is cleared; that the manager never asks in its terminal; and the
 * run outcome the automation-runbook contract assigns to marking an item.
 * @module tests/unit/strategies/session-manager-human-needed-contract
 */
import { describe, expect, it } from "vitest";

import { AUTOMATION_RUN_OUTCOMES } from "../../../plugins/src/base/scripts/automation-run-record.mjs";
import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

const MANAGER = "lisa-session-manager";
const HEADING = "## Mark and move on";
const CONTRACT =
  "plugins/src/base/rules/reference/automation-runbook-contract.md";

/** The contract line that names the outcome for holding an item for a human. */
const CONTRACT_LINE =
  "A healthy cycle that routes a work item to `Blocked` with clarifying questions is\n`candidate-proposed`";

describe("the automation-runbook contract the runbook cites", () => {
  it("assigns candidate-proposed to routing an item to a hold with questions", () => {
    expect(read(CONTRACT)).toContain(CONTRACT_LINE);
    expect(AUTOMATION_RUN_OUTCOMES).toContain("candidate-proposed");
  });
});

describe.each(ALL_ROOTS)("mark and move on (%s)", root => {
  const skill = read(`${root}/${MANAGER}/SKILL.md`);
  const mark = section(skill, HEADING);

  it("names the four cases, each with its kind", () => {
    const cases = [
      { label: "A worker's question", kind: "worker-question" },
      { label: "An ambiguous repo route", kind: "repo-route" },
      { label: "An `exhausted` item", kind: "exhausted" },
      { label: "A design or product decision", kind: "decision" },
    ] as const;
    for (const { label, kind } of cases) {
      expect(mark).toContain(`| ${label} | \`${kind}\` |`);
    }
  });

  it("marks in order: plan, ledger first, tracker, read back, record, continue", () => {
    const steps = [
      "1. **Plan.**",
      'mark-plan <ref> --kind <kind> --project-root "$ROOT" < .lisa/session-manager/msg.txt',
      "2. **Ledger first.** `ledger set-question <ref> --kind <kind>`",
      "3. **Tracker.** One `lisa-tracker-write` update",
      "4. **Read back** with `lisa-tracker-read`",
      "5. **Record the mark:** `ledger marked <ref> --marker-type <marker.type> --marker <marker.value> --comment-id <id>`",
      "6. **Continue the cycle.**",
    ];
    const positions = steps.map(step => mark.indexOf(step));
    for (const [index, position] of positions.entries()) {
      expect(position, steps[index]).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(mark).toContain(
      "for `exhausted` also move the\n   item to the `blocked` role"
    );
  });

  it("continues the cycle and dispatches the next item", () => {
    expect(mark).toContain(
      "**continue the cycle and dispatch the next item**. One item needing a human never stops dispatch of\nthe others"
    );
    expect(mark).toContain("Then go on with the next item.");
    expect(mark).toContain(
      "never ask in this terminal\n(never `AskUserQuestion`), and never end a turn on the question."
    );
  });

  it("clears by delivering the answer, removing the marker, then the question", () => {
    const clearing = mark.slice(mark.indexOf("**Clearing**"));
    const order = [
      "1. **Deliver the answer.**",
      "2. **Remove the manager's own marker**",
      "3. `ledger clear-question <ref>` (`--reset-attempts` for an `exhausted` item).",
    ].map(step => clearing.indexOf(step));
    expect(order.every(position => position > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(clearing).toContain("`resume <ref>` with the answer on STDIN");
    expect(clearing).toContain(
      "stamp `repo:<name>` through `lisa-tracker-write`"
    );
  });

  it("routes every case through the section, and picks up answers each cycle", () => {
    const cycle = section(skill, "## The cycle");
    expect(cycle).toContain(
      'follow "Mark and move on" with `--kind repo-route`'
    );
    expect(cycle).toContain(
      'follow "Mark and move on" with `--kind exhausted`'
    );
    expect(cycle).toContain("**Waiting on a human.**");
    expect(cycle).toContain("`item-answer <ref>`");
    const handling = section(
      skill,
      "## Handling messages (any time, not only during a cycle)"
    );
    expect(handling).toContain(
      'follow "Mark and move on" with `--kind worker-question`'
    );
    expect(handling).toContain(
      'mark it instead ("Mark and move on", `--kind decision`)'
    );
  });

  it("records the contract's outcome for a marking cycle", () => {
    const outcome = section(skill, "## Run outcome");
    expect(outcome).toMatch(
      /\| An item was marked human-needed[^\n]*\| `candidate-proposed` \|/
    );
    expect(outcome).toContain(
      "`candidate-proposed` is the outcome for marking an item human-needed."
    );
    expect(outcome).not.toContain("is **not used**");
    // A worker FAILED routed to the blocked role is a healthy hold, not a
    // broken loop (automation-runbook-contract.md, "A run outcome is NOT a
    // work-item lifecycle terminal state").
    const rows = outcome.split("\n");
    const row = (result: string) =>
      rows.find(line => line.endsWith(`| \`${result}\` |`));
    expect(row("candidate-proposed")).toContain(
      "a worker `FAILED` moved the item to the `blocked` role"
    );
    const recovery = row("recovery-required");
    expect(recovery).toBeDefined();
    expect(recovery).not.toMatch(/a `FAILED` arrived/);
    expect(recovery).toContain(
      "a worker `FAILED`'s move to the `blocked` role could not be written or read back"
    );
    expect(outcome).not.toContain(
      "an item moved to Blocked after `maxAttempts`"
    );
  });
});
