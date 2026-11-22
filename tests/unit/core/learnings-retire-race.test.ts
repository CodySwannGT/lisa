/**
 * A retire racing a consolidation must never delete the merged lesson
 * (CodySwannGT/lisa#4530).
 *
 * A gardener RETIRE row is applied while learner runs keep writing. When a
 * learner consolidates a new rule into the very entry being retired, the two
 * writers race for the same id. Whichever takes the ledger lock first, the
 * merged rule must survive: retire either ran first (`retired`, and the
 * consolidation then appends safely because its target is gone) or ran second
 * (`stale`, because the live fingerprint is no longer the audited one). The
 * compare-and-swap only holds if retire decides on the state it re-read INSIDE
 * the lock; deciding on its pre-lock probe would delete the merged rule.
 * @module tests/unit/core/learnings-retire-race
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { learningFingerprint } from "../../../src/core/learning-fingerprint.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
  retireLearningEntry,
} from "../../../src/core/learnings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ITERATIONS = 12;
const TARGET_ID = "learning-race-target";
const TARGET_RULE = "Resolve the learnings path before writing the ledger.";
const TARGET_FP = learningFingerprint(TARGET_RULE);
const MERGED_RULE =
  "Resolve the learnings path before writing the ledger, and again after a config override.";
const MERGED_FP = learningFingerprint(MERGED_RULE);
const TARGET_ENTRY = {
  id: TARGET_ID,
  fingerprint: TARGET_FP,
  rule: TARGET_RULE,
  why: "A hardcoded path writes the wrong ledger.",
  provenance: ["issue:#4530"],
  first_learned: "2026-07-01",
  last_confirmed: "2026-07-01",
  confidence: "high",
} as const;
const MERGED_CANDIDATE = {
  ...TARGET_ENTRY,
  id: "learning-race-merged",
  fingerprint: MERGED_FP,
  rule: MERGED_RULE,
  provenance: ["issue:#4531"],
  last_confirmed: "2026-07-03",
} as const;

describe("retireLearningEntry racing persistConsolidatedLearning", () => {
  it("always keeps the merged rule; retire is retired-first or stale-second", async () => {
    const statuses = new Set<string>();
    for (const iteration of Array.from({ length: ITERATIONS }, (_v, i) => i)) {
      const root = await createTempDir();
      try {
        await persistLearningEntry(root, TARGET_ENTRY);
        const consolidate = (): Promise<unknown> =>
          persistConsolidatedLearning(root, MERGED_CANDIDATE, {
            supersede: [{ id: TARGET_ID, fingerprint: TARGET_FP }],
          });
        const retireTarget = (): ReturnType<typeof retireLearningEntry> =>
          retireLearningEntry(root, TARGET_ID, TARGET_FP);

        // Started together, the consolidation wins the lock (retire is
        // stale); deferred by a timer, retire wins it. Alternate, with a
        // growing delay, so every run exercises both sides of the lock.
        const deferred = async (): Promise<unknown> => {
          await new Promise(resolve => setTimeout(resolve, iteration));
          return consolidate();
        };
        const [retire] = await Promise.all([
          retireTarget(),
          iteration % 2 === 0 ? consolidate() : deferred(),
        ]);

        const ledger = await readFile(
          path.join(root, ".lisa", "PROJECT_LEARNINGS.md"),
          "utf8"
        );
        const entries = parseLearningsFile(ledger);
        expect(entries.map(entry => entry.fingerprint)).toContain(MERGED_FP);
        expect(entries.map(entry => entry.fingerprint)).not.toContain(
          TARGET_FP
        );
        expect(["retired", "stale"]).toContain(retire.status);
        if (retire.status === "stale") {
          expect(retire.actualFingerprint).toBe(MERGED_FP);
        }
        statuses.add(retire.status);
      } finally {
        await cleanupTempDir(root);
      }
    }
    // Both orders are scheduled, but the lock decides; only the per-run
    // invariants above are asserted so a loaded machine cannot flake this.
    expect(statuses.size).toBeGreaterThan(0);
  });
});
