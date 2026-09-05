/**
 * The live sweep: every remedy the shipped guard actually prints, classified.
 *
 * `remedy-conformance.test.ts` pins the classifier's behaviour on fixtures.
 * **This file is the one that would have caught the three instances #3825 was
 * filed from**, because it reads no fixture: it triggers the shipped guard,
 * takes whatever text comes back, and runs every command in it through that
 * same guard. A reworded remedy is covered the moment it is written, with
 * nobody adding a case.
 *
 * The distinction matters and this repository has paid for it twice this week:
 * a fixture suite passed the entire time a live path was broken. Fixtures test
 * the classifier against inputs somebody imagined; only live text tests it
 * against the inputs that exist.
 *
 * ## The triggers are curated; the remedies are not
 *
 * There is no way to make a guard refuse without proposing something it
 * refuses, so the TRIGGER per guard is a maintained list. That list is the
 * one place this control can silently under-cover, so it is not allowed to
 * fail quiet: a trigger that stops firing yields `refusal: null`, which makes
 * the sweep `NOT_MEASURED` rather than `CONFORMING`. A guard whose refusal was
 * never read is an unanswered question, never a clean result.
 *
 * **Every trigger must refuse regardless of repository state**, and that rule
 * was learned here rather than assumed. The first draft triggered guard 3 with
 * `git reset --hard HEAD~1`, which guard 3 refuses only on a DIRTY working
 * tree. It refused in a scoped run against a dirty worktree and permitted in
 * the push gate against a clean one, so the suite's colour depended on
 * uncommitted state rather than on the guards. The `NOT_MEASURED` rule is what
 * surfaced it: the sweep reported an unanswered question instead of a clean
 * queue, which is exactly the outcome that rule exists for.
 *
 * Guard 3's remedy text is not lost by dropping it. `PRESERVE_GUIDANCE` is one
 * shell variable shared by guards 3, 4, 5 and 6, so the same remedy lines are
 * read through the three triggers that refuse unconditionally.
 *
 * ## Expected verdict today
 *
 * `CONFORMING`. Measured while building this: 15 refusals, 81 commands, all
 * permitted. Stated here so a future reader knows the green is a measurement
 * rather than a suite that never had teeth — the bite direction is proved in
 * the sibling file by widening a real guard and watching this go red.
 * @module tests/unit/hooks/remedy-conformance-live
 */
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  guardChainClassifier,
  sweepRemedyConformance,
} from "../../../scripts/remedy-conformance.mjs";

/** The BUILT guard, which is what consumers receive. */
const GUARD = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

/**
 * One command per refusing guard whose refusal carries remedy text.
 *
 * Every entry was verified to actually refuse. An entry that stops refusing
 * turns the sweep `NOT_MEASURED`, which is the designed outcome rather than a
 * silent reduction in coverage.
 */
const TRIGGERS: readonly (readonly [string, string])[] = [
  ["guard 1: delete outside the project", "rm -rf /etc/passwd"],
  ["guard 1: delete the git control plane", "rm -rf .git"],
  ["guard 1: delete the current directory", "rm -rf ."],
  ["guard 4: destructive checkout", "git checkout -- src/index.ts"],
  ["guard 4: checkout --force", "git checkout --force main"],
  ["guard 4: bare checkout dot", "git checkout ."],
  ["guard 5: switch --discard-changes", "git switch --discard-changes main"],
  ["guard 6: restore worktree", "git restore --worktree -- src/index.ts"],
  ["guard 7: stash drop", "git stash drop"],
  ["guard 8: clean --force", "git clean -fd"],
  ["guard 9: branch force-delete", "git branch -D feature/x"],
];

/**
 * Trigger one guard and capture what it prints.
 * @param command - The proposed shell command.
 * @returns The refusal text, or null when the guard permitted the command.
 */
function refusalFor(command: string): string | null {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [GUARD],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });
  return outcome.status === 0 ? null : (outcome.stderr ?? "");
}

describe("live remedy conformance (#3825)", () => {
  const probes = TRIGGERS.map(([label, command]) => ({
    label,
    refusal: refusalFor(command),
  }));
  const sweep = sweepRemedyConformance({
    probes,
    permits: guardChainClassifier(GUARD, process.cwd()),
  });

  it("every trigger still refuses, so every remedy was actually read", () => {
    // The under-coverage guard. If this fails, the sweep below proved nothing
    // about the guards whose text it never saw.
    expect(sweep.notExamined).toEqual([]);
    expect(sweep.examinedCount).toBe(TRIGGERS.length);
  });

  it("reads a non-trivial amount of remedy text, so the sweep is not vacuous", () => {
    // A regex that silently matched nothing would make every assertion below
    // pass against no data at all.
    expect(sweep.commandCount).toBeGreaterThan(20);
  });

  it("every command the shipped guard prints is permitted and allowed", () => {
    expect(sweep.findings).toEqual([]);
    expect(sweep.verdict).toBe("CONFORMING");
  });
});
