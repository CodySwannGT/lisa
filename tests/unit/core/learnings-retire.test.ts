/**
 * Fingerprint-guarded retirement tests (CodySwannGT/lisa#4530).
 *
 * `retireLearningEntry` is the only sanctioned delete path for a gardener
 * RETIRE row. It is a compare-and-swap: inside the ledger lock it removes the
 * entry ONLY when the live fingerprint still equals the full fingerprint the
 * audit observed. A consolidation that merged new lessons into the same id
 * changes the fingerprint, so the retire must refuse, write nothing, and report
 * the drift instead of deleting lessons the audit never saw.
 * @module tests/unit/core/learnings-retire
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { learningFingerprint } from "../../../src/core/learning-fingerprint.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
  retireLearningEntry,
  type StaleSupersedeTarget,
} from "../../../src/core/learnings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const TARGET_ID = "learning-retire-target";
const BYSTANDER_ID = "learning-retire-bystander";
const TARGET_RULE =
  "Run the resolver before hardcoding the project learnings path.";
const LEGACY_ID = "learning-legacy";
const BYSTANDER_RULE = "Prefer jq over grep for JSON in shell scripts.";
const TARGET_FINGERPRINT = learningFingerprint(TARGET_RULE);
const TARGET_ENTRY = {
  id: TARGET_ID,
  fingerprint: TARGET_FINGERPRINT,
  rule: TARGET_RULE,
  why: "Hardcoded paths break when the learnings file is overridden.",
  provenance: ["issue:#4530"],
  first_learned: "2026-07-01",
  last_confirmed: "2026-07-01",
  confidence: "high",
} as const;
const BYSTANDER_ENTRY = {
  id: BYSTANDER_ID,
  fingerprint: learningFingerprint(BYSTANDER_RULE),
  rule: BYSTANDER_RULE,
  why: "Ad-hoc text parsing corrupts structured data.",
  provenance: ["issue:#1000"],
  first_learned: "2026-06-01",
  last_confirmed: "2026-06-15",
  confidence: "medium",
} as const;

describe("retireLearningEntry", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", "PROJECT_LEARNINGS.md");
    await persistLearningEntry(tempDir, TARGET_ENTRY);
    await persistLearningEntry(tempDir, BYSTANDER_ENTRY);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Lines of the ledger that mention one entry id.
   * @param content - Ledger document
   * @param id - Entry id to select
   * @returns Matching lines in order
   */
  const linesFor = (content: string, id: string): readonly string[] =>
    content.split("\n").filter(line => line.includes(id));

  it("removes exactly the matching entry and leaves bystanders byte-identical", async () => {
    const before = await readFile(learningsPath, "utf8");
    const onStale = vi.fn();

    const result = await retireLearningEntry(
      tempDir,
      TARGET_ID,
      TARGET_FINGERPRINT,
      { onStale }
    );

    expect(result).toEqual({
      status: "retired",
      id: TARGET_ID,
      file: learningsPath,
      expectedFingerprint: TARGET_FINGERPRINT,
      retired: TARGET_ENTRY,
    });
    expect(onStale).not.toHaveBeenCalled();
    const after = await readFile(learningsPath, "utf8");
    expect(parseLearningsFile(after)).toEqual([BYSTANDER_ENTRY]);
    expect(linesFor(after, BYSTANDER_ID)).toEqual(
      linesFor(before, BYSTANDER_ID)
    );
    expect(linesFor(after, TARGET_ID)).toEqual([]);
  });

  it("refuses a drifted fingerprint, writes nothing, and reports the actual fingerprint", async () => {
    const before = await readFile(learningsPath, "utf8");
    const reports: StaleSupersedeTarget[] = [];
    const observed = learningFingerprint("A different rule the audit saw.");

    const result = await retireLearningEntry(tempDir, TARGET_ID, observed, {
      onStale: target => reports.push(target),
    });

    expect(result).toEqual({
      status: "stale",
      id: TARGET_ID,
      file: learningsPath,
      expectedFingerprint: observed,
      actualFingerprint: TARGET_FINGERPRINT,
    });
    expect(reports).toEqual([
      {
        expected: { id: TARGET_ID, fingerprint: observed },
        actualFingerprint: TARGET_FINGERPRINT,
        reason: "fingerprint-mismatch",
      },
    ]);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("refuses to retire an entry a later consolidation merged into the same id", async () => {
    const mergedRule =
      "Run the resolver before hardcoding the learnings path, and re-run it after a config override lands.";
    await persistConsolidatedLearning(
      tempDir,
      {
        ...TARGET_ENTRY,
        id: "learning-merged-candidate",
        fingerprint: learningFingerprint(mergedRule),
        rule: mergedRule,
        provenance: ["issue:#4531"],
        last_confirmed: "2026-07-03",
      },
      { supersede: [{ id: TARGET_ID, fingerprint: TARGET_FINGERPRINT }] }
    );
    const before = await readFile(learningsPath, "utf8");
    const live = parseLearningsFile(before).find(
      entry => entry.id === TARGET_ID
    );
    expect(live?.fingerprint).toBe(learningFingerprint(mergedRule));
    const onStale = vi.fn();

    const result = await retireLearningEntry(
      tempDir,
      TARGET_ID,
      TARGET_FINGERPRINT,
      { onStale }
    );

    expect(result.status).toBe("stale");
    expect(result.actualFingerprint).toBe(learningFingerprint(mergedRule));
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("returns not-found for an unknown id without touching the file", async () => {
    const before = await readFile(learningsPath, "utf8");
    const onStale = vi.fn();

    const result = await retireLearningEntry(
      tempDir,
      "learning-missing",
      TARGET_FINGERPRINT,
      { onStale }
    );

    expect(result).toEqual({
      status: "not-found",
      id: "learning-missing",
      file: learningsPath,
      expectedFingerprint: TARGET_FINGERPRINT,
    });
    expect(onStale).not.toHaveBeenCalled();
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("is a no-op not-found when the ledger does not exist, creating nothing", async () => {
    const emptyRoot = await createTempDir();
    try {
      const result = await retireLearningEntry(
        emptyRoot,
        TARGET_ID,
        TARGET_FINGERPRINT
      );
      expect(result).toEqual({
        status: "not-found",
        id: TARGET_ID,
        expectedFingerprint: TARGET_FINGERPRINT,
      });
      expect(await fs.readdir(emptyRoot)).toEqual([]);
    } finally {
      await cleanupTempDir(emptyRoot);
    }
  });

  it.each([
    ["the 12-hex gardener marker hash", TARGET_FINGERPRINT.slice(9, 21)],
    ["a truncated entry fingerprint", TARGET_FINGERPRINT.slice(0, 21)],
    ["an over-long entry fingerprint", `${TARGET_FINGERPRINT}0`],
    ["an empty string", ""],
    ["a non-token value", "Learning Fingerprint"],
    ["a non-string value", 42 as never],
  ])(
    "rejects %s as expectedFingerprint without touching the file",
    async (_label, value) => {
      const before = await readFile(learningsPath, "utf8");
      await expect(
        retireLearningEntry(tempDir, TARGET_ID, value)
      ).rejects.toThrow(/expectedFingerprint/);
      expect(await readFile(learningsPath, "utf8")).toBe(before);
    }
  );

  it.each([LEGACY_ID, "learner-0123456789ab", "sll4-0123456789ab"])(
    "accepts the legacy non-hash fingerprint %s stored by an older writer",
    async legacyFingerprint => {
      const legacy = {
        ...BYSTANDER_ENTRY,
        id: LEGACY_ID,
        fingerprint: legacyFingerprint,
        rule: "A legacy rule kept its older writer's token as its fingerprint.",
      };
      await persistLearningEntry(tempDir, legacy);

      const result = await retireLearningEntry(
        tempDir,
        LEGACY_ID,
        legacyFingerprint
      );

      expect(result.status).toBe("retired");
    }
  );

  it("migrates a v1 ledger to v2 in the same write that retires the entry", async () => {
    const legacyEntries = [TARGET_ENTRY, BYSTANDER_ENTRY].map(
      ({ fingerprint: _fingerprint, ...entry }) => entry
    );
    const legacy = `# Project Learnings\n\n<!-- lisa-learnings-contract:v1 -->\n\n\`\`\`jsonl\n${legacyEntries.map(entry => JSON.stringify(entry)).join("\n")}\n\`\`\`\n`;
    await fs.outputFile(learningsPath, legacy);

    // A v1 entry's fingerprint is its id, so that is what the audit observed.
    const result = await retireLearningEntry(tempDir, TARGET_ID, TARGET_ID);

    expect(result.status).toBe("retired");
    const migrated = await readFile(learningsPath, "utf8");
    expect(migrated).toContain("lisa-learnings-contract:v2");
    expect(parseLearningsFile(migrated)).toEqual([
      { ...BYSTANDER_ENTRY, fingerprint: BYSTANDER_ID },
    ]);
  });

  it("rejects a non-string id without touching the file", async () => {
    const before = await readFile(learningsPath, "utf8");
    await expect(
      retireLearningEntry(tempDir, 42 as never, TARGET_FINGERPRINT)
    ).rejects.toThrow(/id/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("propagates malformed-document failures without mutating the file", async () => {
    await fs.outputFile(learningsPath, "# Project Learnings\n\nnot-jsonl\n");
    const before = await readFile(learningsPath, "utf8");
    await expect(
      retireLearningEntry(tempDir, TARGET_ID, TARGET_FINGERPRINT)
    ).rejects.toThrow(/format|json/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("rejects a symlinked learnings file before reading it", async () => {
    const external = path.join(tempDir, "external.md");
    await fs.move(learningsPath, external);
    await fs.symlink(external, learningsPath);
    await expect(
      retireLearningEntry(tempDir, TARGET_ID, TARGET_FINGERPRINT)
    ).rejects.toThrow(/not a regular file/i);
  });

  it("retires the last entry and leaves a valid empty ledger", async () => {
    await retireLearningEntry(
      tempDir,
      BYSTANDER_ID,
      BYSTANDER_ENTRY.fingerprint
    );

    const result = await retireLearningEntry(
      tempDir,
      TARGET_ID,
      TARGET_FINGERPRINT
    );

    expect(result.status).toBe("retired");
    const after = await readFile(learningsPath, "utf8");
    expect(parseLearningsFile(after)).toEqual([]);
    await persistLearningEntry(tempDir, TARGET_ENTRY);
    expect(parseLearningsFile(await readFile(learningsPath, "utf8"))).toEqual([
      TARGET_ENTRY,
    ]);
  });
});
