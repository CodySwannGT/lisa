/**
 * The dry-run report must reach an operator, and must never be silent.
 *
 * A verb that finds nothing and exits 0 without printing is indistinguishable
 * from one that did not run, one whose probe failed, and one that found
 * candidates and printed none. These cases drive the real CLI runners against a
 * real repository and read the REAL stdout stream, because that is the only
 * thing that proves the wiring prints — a report unit test passes happily while
 * nothing reaches the terminal.
 * @module tests/integration/prune-report-reachability
 */
import { describe, expect, it } from "vitest";
import {
  runStashPruneCli,
  runWorktreePruneCli,
} from "../../src/cli/prune-commands.js";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";
import { NO_IDLE_WINDOW, usePruneFixtures } from "../support/prune-fixtures.js";

const fixtures = usePruneFixtures();

describe("the dry-run report", () => {
  it(
    "prints the scope it searched and the candidate count",
    async () => {
      const root = await fixtures.createPublishedRepo();
      fixtures.addPublishedWorktree(root, "finished");
      const written = fixtures.captureStdout();

      const code = await runWorktreePruneCli(root, NO_IDLE_WINDOW);

      const output = written.text();
      expect(code).toBe(0);
      expect(output).not.toBe("");
      expect(output).toContain("Inspected 2 worktree(s) registered for");
      expect(output).toContain("1 of 2 worktrees are candidates");
      expect(output).toContain("dry run");
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "names every worktree it kept, and why",
    async () => {
      const root = await fixtures.createPublishedRepo();
      const sibling = fixtures.addPublishedWorktree(root, "sibling");
      await fixtures.holdDirectoryOpen(sibling);
      const written = fixtures.captureStdout();

      await runWorktreePruneCli(root, NO_IDLE_WINDOW);

      const output = written.text();
      expect(output).toContain(`KEEP    ${sibling}`);
      expect(output).toContain("live process is working inside it right now");
      expect(output).toContain("0 of 2 worktrees are candidates");
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "says an empty stash inspection is empty rather than exiting in silence",
    async () => {
      const root = await fixtures.createPublishedRepo();
      const written = fixtures.captureStdout();

      const code = await runStashPruneCli(root, {});

      const output = written.text();
      expect(code).toBe(0);
      expect(output).toContain("Inspected 0 stash entr(ies)");
      expect(output).toContain("empty inspection, not a clean result");
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "emits JSON that carries the same verdicts when --json is passed",
    async () => {
      const root = await fixtures.createPublishedRepo();
      fixtures.addPublishedWorktree(root, "finished");
      const written = fixtures.captureStdout();

      await runWorktreePruneCli(root, { ...NO_IDLE_WINDOW, json: true });

      const parsed = JSON.parse(written.text()) as {
        plan: { verdicts: readonly { eligible: boolean }[] };
      };
      expect(parsed.plan.verdicts).toHaveLength(2);
      expect(
        parsed.plan.verdicts.filter(verdict => verdict.eligible)
      ).toHaveLength(1);
    },
    ioLatencyBudgetMs(120_000)
  );
});
