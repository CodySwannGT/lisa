/**
 * Prose contract for workers blocked on a prompt nobody can answer
 * (lisa#4522).
 *
 * `classify` reports a worker whose agent row has a non-subagent `waitingFor`
 * (e.g. "permission prompt") as `blocked-on-prompt`. The manager must restart
 * it as a fresh, counted attempt and tell the operator once, and a cycle that
 * did so is `change-proved`. Kept apart from lisa#4503's `setup-gap`, which
 * refunds the attempt instead. Pinned in the source and every projection.
 * @module tests/unit/strategies/session-manager-blocked-on-prompt-contract
 */
import { describe, expect, it } from "vitest";

import { ALL_ROOTS, read, section } from "./session-manager-skill-helpers.js";

describe.each(ALL_ROOTS)(
  "session-manager blocked-on-prompt contract (%s)",
  root => {
    const manager = read(`${root}/lisa-session-manager/SKILL.md`);
    const cycle = section(manager, "## The cycle");
    const row = cycle
      .split("\n")
      .find(line => line.startsWith("| `blocked-on-prompt` |"));

    it("restarts the worker as a fresh counted attempt", () => {
      expect(row).toBeDefined();
      expect(row).toContain("`claude stop <worker>` if it is still listed");
      expect(row).toContain("`spawn` a **fresh** attempt");
      expect(row).toContain("the CLI counts attempts");
      expect(row).not.toContain("--setup-gap");
    });

    it("tells the operator once, naming the item and the waitingFor text", () => {
      expect(row).toContain("one plain-English line");
      expect(row).toContain("`waitingFor`");
      expect(row).toContain("once per occurrence");
    });

    it("records the retry as change-proved", () => {
      expect(manager).toContain(
        "a stalled or `blocked-on-prompt` item retried"
      );
    });
  }
);
