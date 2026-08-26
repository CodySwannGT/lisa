/**
 * Concurrent consolidation must not destroy the losing writer's learning.
 *
 * PR #2008 added `readSupersedeIdsPresentBeforeLock`: a snapshot taken BEFORE
 * the writer lock, used to excuse a supersede target that vanished while the
 * writer waited. That only rescues a writer whose snapshot predates the
 * removal, so it narrows the window instead of closing it — and the window
 * widens under exactly the contention the feature exists to serve. It surfaced
 * as intermittent CI failures from `learnings-concurrency.test.ts`:
 *
 *     error: Cannot supersede unknown learning id(s): learning-base
 *
 * These tests force the losing-writer sequence deterministically instead of
 * racing children and hoping. No interleaving is needed: a writer whose
 * supersede target was already consolidated by an earlier writer reproduces it
 * every time, because its pre-lock snapshot sees the id already gone.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
const BASE_ID = "learning-base";
const FIRST_WINNER = "learning-a";
const SECOND_WRITER = "learning-b";

/**
 * Build a compact valid entry.
 * @param id - Stable entry id
 * @returns Valid learning entry
 */
function entry(id: string) {
  return {
    id,
    fingerprint: id,
    rule: `Rule ${id}.`,
    why: `Why ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "high",
  } as const;
}

const BASE_STAMP = { id: BASE_ID, fingerprint: BASE_ID } as const;

describe("concurrent consolidation of the same supersede target", () => {
  let projectRoot: string;

  /**
   * Read persisted entry ids.
   * @returns Ids currently in the ledger
   */
  async function persistedIds(): Promise<readonly string[]> {
    const content = await readFile(path.join(projectRoot, LEDGER), "utf8");
    return parseLearningsFile(content).map(current => current.id);
  }

  beforeEach(async () => {
    projectRoot = await createTempDir();
    await persistConsolidatedLearning(projectRoot, entry(BASE_ID));
  });

  afterEach(async () => {
    await cleanupTempDir(projectRoot);
  });

  it("keeps the second writer's learning when the target was already consolidated", async () => {
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [BASE_STAMP],
    });
    // The losing writer: its supersede target is already gone. Throwing here
    // discards its ENTIRE learning — the #1995 symptom in the other direction.
    await persistConsolidatedLearning(projectRoot, entry(SECOND_WRITER), {
      supersede: [BASE_STAMP],
    });
    expect(await persistedIds()).toEqual([SECOND_WRITER, BASE_ID]);
  });

  it("keeps the stable target identity while never resurrecting its old content", async () => {
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [BASE_STAMP],
    });
    await persistConsolidatedLearning(projectRoot, entry(SECOND_WRITER), {
      supersede: [BASE_STAMP],
    });
    const content = await readFile(path.join(projectRoot, LEDGER), "utf8");
    const persisted = parseLearningsFile(content);
    expect(persisted.find(value => value.id === BASE_ID)?.fingerprint).toBe(
      FIRST_WINNER
    );
  });

  it("survives many writers all consolidating the same target", async () => {
    // The shape of the flaky cross-process suite, made deterministic.
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      await persistConsolidatedLearning(
        projectRoot,
        entry(`learning-${index}`),
        {
          supersede: [BASE_STAMP],
        }
      );
    }
    const ids = await persistedIds();
    expect(ids).toHaveLength(9);
    expect(ids).toContain(BASE_ID);
  });

  it("reports the changed target as a stale diagnostic", async () => {
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [BASE_STAMP],
    });
    const stale: unknown[] = [];
    await persistConsolidatedLearning(projectRoot, entry(SECOND_WRITER), {
      supersede: [BASE_STAMP],
      onStaleSupersede: targets => stale.push(targets),
    });
    expect(stale).toEqual([
      [
        {
          expected: BASE_STAMP,
          actualFingerprint: FIRST_WINNER,
          reason: "fingerprint-mismatch",
        },
      ],
    ]);
  });

  it("does not report a diagnostic when the supersede actually applied", async () => {
    const absent: string[][] = [];
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [BASE_STAMP],
      onAbsentSupersede: ids => absent.push([...ids]),
    });
    expect(absent).toEqual([]);
  });

  it("keeps the deprecated absent-only callback during the compatibility window", async () => {
    const absent: string[][] = [];
    const missing = {
      id: "learning-missing",
      fingerprint: "learning-missing",
    } as const;
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [missing],
      onAbsentSupersede: ids => absent.push([...ids]),
    });
    expect(absent).toEqual([[missing.id]]);
  });

  it("still removes a supersede target that IS present", async () => {
    await persistConsolidatedLearning(projectRoot, entry(FIRST_WINNER), {
      supersede: [BASE_STAMP],
    });
    expect(await persistedIds()).toEqual([BASE_ID]);
  });

  it("keeps rejecting a duplicate id", async () => {
    // Tolerating absent supersede targets must not weaken the duplicate guard.
    await expect(
      persistConsolidatedLearning(projectRoot, entry(BASE_ID))
    ).rejects.toThrow(/Duplicate learning fingerprint/);
  });
});
