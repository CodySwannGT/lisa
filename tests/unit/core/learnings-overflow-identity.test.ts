/** Collision-safe identity semantics for the durable learnings overflow. */
import * as fse from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import { readLearningsOverflow } from "../../../src/core/learnings-overflow.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 * Build a compact valid entry with a stable numeric suffix.
 * @param index - Stable numeric suffix
 * @returns Valid current-schema learning entry
 */
function numberedEntry(index: number) {
  return {
    id: `learner-${index}`,
    fingerprint: `learner-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

/**
 * Fill one ledger to its hard entry cap.
 * @param projectRoot - Existing project root
 */
async function fillLedger(projectRoot: string): Promise<void> {
  for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
    await persistLearningEntry(projectRoot, numberedEntry(index));
  }
}

describe("learnings overflow identity", () => {
  let tempDir: string;
  let overflowPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    overflowPath = path.join(tempDir, ".lisa", "PROJECT_LEARNINGS.overflow.md");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("preserves distinct fingerprints that arrive with the same public id", async () => {
    await fillLedger(tempDir);
    const first = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    const second = {
      ...numberedEntry(LEARNINGS_CONTRACT.maxEntries + 1),
      id: first.id,
    };

    await expect(persistLearningEntry(tempDir, first)).rejects.toThrow();
    await expect(persistLearningEntry(tempDir, second)).rejects.toThrow(
      /was preserved/
    );

    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries).toEqual([
      first,
      { ...second, id: second.fingerprint },
    ]);
  });

  it("assigns a colliding stable id independently of overflow arrival order", async () => {
    const forwardRoot = path.join(tempDir, "forward");
    const reverseRoot = path.join(tempDir, "reverse");
    await Promise.all([fse.ensureDir(forwardRoot), fse.ensureDir(reverseRoot)]);
    await Promise.all([fillLedger(forwardRoot), fillLedger(reverseRoot)]);
    const lower = {
      ...numberedEntry(30),
      id: "shared-overflow-id",
      fingerprint: "aaa-overflow-fingerprint",
    };
    const higher = {
      ...numberedEntry(31),
      id: lower.id,
      fingerprint: "zzz-overflow-fingerprint",
    };

    for (const [projectRoot, entries] of [
      [forwardRoot, [lower, higher]],
      [reverseRoot, [higher, lower]],
    ] as const) {
      for (const entry of entries) {
        await expect(persistLearningEntry(projectRoot, entry)).rejects.toThrow(
          /was preserved/
        );
      }
    }

    const forward = await readLearningsOverflow(forwardRoot);
    const reverse = await readLearningsOverflow(reverseRoot);
    expect(forward.entries).toEqual([
      lower,
      { ...higher, id: higher.fingerprint },
    ]);
    expect(reverse.entries).toEqual(forward.entries);
  });

  it("rejects a different public id that reuses an overflow fingerprint before writing", async () => {
    await fillLedger(tempDir);
    const first = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    const second = {
      ...numberedEntry(LEARNINGS_CONTRACT.maxEntries + 1),
      fingerprint: first.fingerprint,
    };

    await expect(persistLearningEntry(tempDir, first)).rejects.toThrow();
    const before = await readFile(overflowPath, "utf8");
    await expect(persistLearningEntry(tempDir, second)).rejects.toThrow(
      /duplicate learning fingerprint/i
    );
    expect(await readFile(overflowPath, "utf8")).toBe(before);
  });

  it("rejects changed content that reuses an exact overflow identity", async () => {
    await fillLedger(tempDir);
    const first = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    const changed = { ...first, rule: "Changed content." };

    await expect(persistLearningEntry(tempDir, first)).rejects.toThrow();
    const before = await readFile(overflowPath, "utf8");
    await expect(persistLearningEntry(tempDir, changed)).rejects.toThrow(
      /duplicate learning identity.*different content/i
    );
    expect(await readFile(overflowPath, "utf8")).toBe(before);
  });
});
