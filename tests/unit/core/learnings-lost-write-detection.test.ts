/**
 * A lost learning must never be silent.
 *
 * The lock is what keeps two writers from publishing over each other, but the
 * failure mode this guards is defined by nothing noticing — 19 entries once
 * sat lost until an audit went looking, and CodySwannGT/lisa#2488's lock race
 * reported success on every write it dropped. These cover the second line: a
 * locked transaction refuses to publish over bytes it did not read.
 */
import * as fs from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LearningsConcurrentWriteError,
  assertLearningsUnchanged,
} from "../../../src/core/learnings-file-safety.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const VALID_ENTRY = {
  id: "learning-detection",
  fingerprint: "learning-detection-fingerprint",
  rule: "Refuse to publish over an unread ledger image.",
  why: "A silent lost learning is worse than a failed capture.",
  provenance: ["issue:#2488"],
  first_learned: "2026-08-13",
  last_confirmed: "2026-08-13",
  confidence: "high",
} as const;

const interloper = vi.hoisted(() => ({
  content: undefined as undefined | string,
}));

vi.mock("../../../src/utils/atomic-file-write.js", () => ({
  /**
   * Publish exactly like the real writer, but let a test slip a concurrent
   * writer's document in during the window the real rename cannot be split.
   * @param target - Path being published
   * @param content - Payload the caller intends to publish
   * @param options - Real options forwarded by the writer
   * @param options.beforeRename - Pre-rename safety and pre-image re-check
   */
  writeFileAtomically: async (
    target: string,
    content: string,
    options: { readonly beforeRename?: () => Promise<void> } = {}
  ): Promise<void> => {
    if (interloper.content !== undefined) {
      await writeFile(target, interloper.content, "utf8");
    }
    await options.beforeRename?.();
    await writeFile(target, content, "utf8");
  },
}));

describe("learnings lost-write detection", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    interloper.content = undefined;
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    interloper.content = undefined;
    await cleanupTempDir(tempDir);
  });

  it("accepts a publish when the ledger still holds the bytes that were read", async () => {
    await fs.outputFile(learningsPath, "# Ledger\n");
    await expect(
      assertLearningsUnchanged(learningsPath, "# Ledger\n")
    ).resolves.toBeUndefined();
  });

  it("rejects a publish when the ledger changed after it was read", async () => {
    await fs.outputFile(learningsPath, "# Ledger\n\nsomeone else's entry\n");
    await expect(
      assertLearningsUnchanged(learningsPath, "# Ledger\n")
    ).rejects.toBeInstanceOf(LearningsConcurrentWriteError);
  });

  it("rejects a publish when a ledger appeared where none was read", async () => {
    await fs.outputFile(learningsPath, "# Ledger\n");
    await expect(
      assertLearningsUnchanged(learningsPath, undefined)
    ).rejects.toThrow(/changed after this write read it/u);
  });

  it("accepts a publish when no ledger existed and none appeared", async () => {
    await expect(
      assertLearningsUnchanged(learningsPath, undefined)
    ).resolves.toBeUndefined();
  });

  it("persists normally while nothing interferes", async () => {
    const { persistLearningEntry } =
      await import("../../../src/core/learnings-writer.js");
    await persistLearningEntry(tempDir, VALID_ENTRY);
    expect(await readFile(learningsPath, "utf8")).toContain(VALID_ENTRY.id);
  });

  it("fails the write loudly instead of erasing a concurrent writer's entry", async () => {
    const { persistLearningEntry } =
      await import("../../../src/core/learnings-writer.js");
    await persistLearningEntry(tempDir, VALID_ENTRY);
    const survivor = await readFile(learningsPath, "utf8");

    // A second writer's document lands after this write read the ledger and
    // before it publishes — precisely what a broken lock allows.
    interloper.content = `${survivor}\n<!-- concurrent writer -->\n`;
    await expect(
      persistLearningEntry(tempDir, {
        ...VALID_ENTRY,
        id: "learning-later",
        fingerprint: "learning-later-fingerprint",
      })
    ).rejects.toThrow(LearningsConcurrentWriteError);

    // The interloper's bytes are still there: nothing was erased.
    expect(await readFile(learningsPath, "utf8")).toContain(
      "<!-- concurrent writer -->"
    );
  });
});
