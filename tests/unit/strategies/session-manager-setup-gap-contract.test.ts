/**
 * Prose contract for workers whose first prompt never ran (lisa#4503).
 *
 * `spawn` exits 2 when the new worker's transcript shows `/lisa:implement`
 * unknown in that repo or a `UserPromptSubmit` hook refusing the prompt, and
 * `classify` reports such a worker as `setup-gap`. The manager must treat
 * both as machine setup gaps: back to Ready, no attempt counted, no respawn,
 * no more dispatch to that repo, and a `recovery-required` cycle. Pinned in
 * the source and every runtime projection.
 * @module tests/unit/strategies/session-manager-setup-gap-contract
 */
import { describe, expect, it } from "vitest";

import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

describe.each(ALL_ROOTS)("session-manager setup-gap contract (%s)", root => {
  const manager = read(`${root}/lisa-session-manager/SKILL.md`);
  const cycle = section(manager, "## The cycle");

  it("has a setup-gap classify row that refunds the attempt and stops dispatch", () => {
    const row = cycle
      .split("\n")
      .find(line => line.startsWith("| `setup-gap` |"));
    expect(row).toBeDefined();
    expect(row).toContain("ledger finish <ref> --status FAILED --setup-gap");
    expect(row).toContain("`recovery-required`");
  });

  it("finishes a still-running earlier ledger row on spawn exit 2", () => {
    expect(cycle).toContain(
      "If the ledger already has an item for the ref and it is still\n        running, run `ledger finish <ref> --status FAILED --setup-gap`"
    );
  });
});
