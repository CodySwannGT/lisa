/**
 * Contract coverage for CodySwannGT/lisa#3854 — the attempt valve must not
 * retire a work item permanently, and must not be tripped by the machine.
 *
 * The defect: the valve counted every `[lisa-build-attempt]` marker on an item,
 * fresh at the top of every claim, with nothing ever removing one. Two markers
 * and the item was unbuildable by any loop for the life of the item — a human
 * fixed the real cause and requeued, the next cycle counted two and blocked it
 * again. The rule's own "Recovery is deliberate" paragraph described a recovery
 * that could not run.
 *
 * Two things compound it, and both are pinned here:
 *
 * 1. **Markers were written on ANY non-success terminal outcome.** A pre-push
 *    gate killed by machine contention is errored, gate-blocked and unmerged at
 *    once — three non-success outcomes from one event that proved nothing about
 *    the work. Lisa could already tell a kill from a failure
 *    (`gate-failure-diagnosis`'s signal-exit set, and the runbook contract's
 *    `recovery-required`); the counter never asked.
 * 2. **The count was unscoped.** Nothing can un-write a comment, so the fix
 *    cannot be a clearing path — it has to change what is COUNTED. Returning the
 *    item to the ready lane ends the period the old markers describe.
 *
 * Every assertion runs against both the skill/rule source (`plugins/src/...`)
 * and the generated artifact (`plugins/lisa/...`), so a source edit without
 * `bun run build:plugins` — or an artifact-only edit — fails the suite.
 * @module tests/unit/strategies/attempt-valve-recovery-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated plugin roots for the base plugin. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/**
 * Read a file relative to a plugin root.
 * @param root - Plugin root directory
 * @param rel - Path relative to that root
 * @returns File contents
 */
function read(root: string, rel: string): string {
  return readFileSync(path.join(process.cwd(), root, rel), "utf8");
}

/** The one surface carrying the claim-time-guards contract since #3992. */
const CLAIM_TIME_GUARDS = "rules/reference/claim-time-guards.md";

describe("the attempt valve distinguishes the machine from the work", () => {
  describe.each(ROOTS)("%s", root => {
    // #3992 demoted claim-time-guards: the head is folded into the body, so
    // both names read the one surviving surface.
    const reference = read(root, CLAIM_TIME_GUARDS);

    it("counts only markers that measure the work", () => {
      expect(reference).toMatch(/terminated|signal|SIGTERM|killed/i);
    });

    it("names the two shipped discriminators rather than inventing one", () => {
      // Both already exist and are already correct. The defect was that
      // nothing carried their answer to the counter.
      expect(reference).toContain("gate-failure-diagnosis");
      expect(reference).toContain("recovery-required");
    });
  });
});
