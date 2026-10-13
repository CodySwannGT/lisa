/**
 * Prose contract for two setup steps found missing in live verification of
 * CodySwannGT/lisa#4448:
 * - D4: on a fresh machine `spawn` failed because Claude Code's workspace
 *   trust had never been accepted in the repo dir, and a background session
 *   cannot show that prompt. Setup now tells the operator to run `claude` once
 *   in each dir a worker starts in (the root, or every routed child repo) and
 *   accept the prompt, and the manager treats `spawn` exit 2 as a setup gap.
 * - D3: `start` exits 2 when the manager's tmux session dies right after it
 *   starts, printing a foreground command; setup tells the operator to run it
 *   to see claude's own error.
 * Pinned in the source and every runtime projection, like the other skill
 * contract suites.
 * @module tests/unit/strategies/session-manager-setup-trust-contract
 */
import { describe, expect, it } from "vitest";

import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

describe.each(ALL_ROOTS)("session-manager setup trust contract (%s)", root => {
  const setup = read(`${root}/lisa-setup-session-manager/SKILL.md`);
  const manager = read(`${root}/lisa-session-manager/SKILL.md`);

  it("has the operator accept workspace trust once in every repo a worker starts in", () => {
    const step = section(
      setup,
      "## Step 8: Accept workspace trust in each worker repo"
    );
    expect(step).toContain("once per routed repo");
    expect(step).toContain(
      'node "$SM/session-manager.mjs" trust-status --project-root "$ROOT"'
    );
    expect(step).toContain("run `claude` once in that directory");
    expect(step).toContain("accept the trust prompt");
  });

  // CodySwannGT/lisa#4465: trust Claude Code already recorded is not asked for again.
  it("asks the operator only about directories trust-status says still need trust", () => {
    const step = section(
      setup,
      "## Step 8: Accept workspace trust in each worker repo"
    );
    expect(step).toContain("For each directory in `needsTrust`");
    expect(step).toContain("When it is empty, this step is done");
  });

  it("tells the operator to run the printed foreground command when the manager dies at start", () => {
    const start = section(setup, "## Step 9: Start and pair");
    expect(start).toContain("exited right after starting");
    expect(start).toContain("run the printed foreground command");
  });

  it("treats spawn exit 2 as a setup gap, not a failed attempt", () => {
    const cycle = section(manager, "## The cycle");
    expect(cycle).toContain(
      "exit 2 (setup gap, e.g. workspace trust not accepted in the repo dir)"
    );
  });
});
