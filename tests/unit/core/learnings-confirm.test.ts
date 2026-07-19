/**
 * Surgical `last_confirmed` bump tests (#1579).
 *
 * `confirmLearningEntry` advances ONLY the `last_confirmed` timestamp of one
 * existing entry — never the rule text, why, provenance, `first_learned`, or
 * confidence — using the same lock/safety/atomic machinery as the persist
 * writers. A missing id or missing file is a structured no-op result, never a
 * throw, so claim-time callers can bump without risking the build.
 * @module tests/unit/core/learnings-confirm
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  confirmLearningEntry,
  parseLearningsFile,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const APPLIED_ID = "learning-applied";
const BYSTANDER_ID = "learning-bystander";
const ORIGIN_DATE = "2026-07-01";
const CONFIRM_DATE = "2026-07-19";
const APPLIED_ENTRY = {
  id: APPLIED_ID,
  rule: "Always run the resolver before hardcoding the learnings path.",
  why: "Hardcoded paths break when projectRulesFile is overridden.",
  provenance: ["issue:#1579"],
  first_learned: ORIGIN_DATE,
  last_confirmed: ORIGIN_DATE,
  confidence: "high",
} as const;
const BYSTANDER_ENTRY = {
  id: BYSTANDER_ID,
  rule: "Prefer jq over grep for JSON in shell scripts.",
  why: "Ad-hoc text parsing corrupts structured data.",
  provenance: ["issue:#1000"],
  first_learned: "2026-06-01",
  last_confirmed: "2026-06-15",
  confidence: "medium",
} as const;

describe("confirmLearningEntry", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
    await persistLearningEntry(tempDir, APPLIED_ENTRY);
    await persistLearningEntry(tempDir, BYSTANDER_ENTRY);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("advances only last_confirmed of the targeted entry", async () => {
    const result = await confirmLearningEntry(
      tempDir,
      APPLIED_ID,
      CONFIRM_DATE
    );
    expect(result.status).toBe("confirmed");
    expect(result.id).toBe(APPLIED_ID);
    expect(result.previous).toBe(ORIGIN_DATE);
    expect(result.file).toBe(learningsPath);
    const entries = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(entries).toEqual([
      { ...APPLIED_ENTRY, last_confirmed: CONFIRM_DATE },
      BYSTANDER_ENTRY,
    ]);
  });

  it("leaves untargeted entries byte-identical", async () => {
    const before = await readFile(learningsPath, "utf8");
    const bystanderBlock = before
      .split("\n")
      .filter(line => line.includes(BYSTANDER_ID));
    await confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE);
    const after = await readFile(learningsPath, "utf8");
    const bystanderAfter = after
      .split("\n")
      .filter(line => line.includes(BYSTANDER_ID));
    expect(bystanderAfter).toEqual(bystanderBlock);
  });

  it("returns a structured no-op for an unknown id without throwing", async () => {
    const before = await readFile(learningsPath, "utf8");
    const result = await confirmLearningEntry(
      tempDir,
      "learning-missing",
      CONFIRM_DATE
    );
    expect(result).toEqual({
      status: "not-found",
      id: "learning-missing",
      file: learningsPath,
    });
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("returns a structured no-op when the learnings file does not exist", async () => {
    const emptyRoot = await createTempDir();
    try {
      const result = await confirmLearningEntry(
        emptyRoot,
        APPLIED_ID,
        CONFIRM_DATE
      );
      expect(result).toEqual({ status: "not-found", id: APPLIED_ID });
      expect(await fs.pathExists(path.join(emptyRoot, ".claude"))).toBe(false);
    } finally {
      await cleanupTempDir(emptyRoot);
    }
  });

  it("is idempotent: re-confirming the same date is an unchanged no-op", async () => {
    await confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE);
    const afterFirst = await readFile(learningsPath, "utf8");
    const result = await confirmLearningEntry(
      tempDir,
      APPLIED_ID,
      CONFIRM_DATE
    );
    expect(result.status).toBe("unchanged");
    expect(await readFile(learningsPath, "utf8")).toBe(afterFirst);
  });

  it("never regresses last_confirmed to an earlier date", async () => {
    await confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE);
    const before = await readFile(learningsPath, "utf8");
    const result = await confirmLearningEntry(
      tempDir,
      APPLIED_ID,
      "2026-07-05"
    );
    expect(result.status).toBe("unchanged");
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("keeps the last_confirmed >= first_learned invariant valid on write", async () => {
    await confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE);
    const entries = parseLearningsFile(await readFile(learningsPath, "utf8"));
    const applied = entries.find(entry => entry.id === APPLIED_ID);
    expect(applied).toBeDefined();
    expect(applied!.last_confirmed >= applied!.first_learned).toBe(true);
  });

  it.each(["July 19", "2026-13-01", "2026-02-30", ""])(
    "rejects the malformed confirmation date %j",
    async date => {
      await expect(
        confirmLearningEntry(tempDir, APPLIED_ID, date)
      ).rejects.toThrow(/date|last_confirmed/i);
    }
  );

  it("rejects a non-string id without touching the file", async () => {
    const before = await readFile(learningsPath, "utf8");
    await expect(
      confirmLearningEntry(tempDir, 42 as never, CONFIRM_DATE)
    ).rejects.toThrow(/id/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("propagates malformed-document failures without mutating the file", async () => {
    await fs.outputFile(learningsPath, "# Project Learnings\n\nnot-jsonl\n");
    const before = await readFile(learningsPath, "utf8");
    await expect(
      confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE)
    ).rejects.toThrow(/format|json/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("rejects a symlinked learnings file before reading it", async () => {
    const external = path.join(tempDir, "external.md");
    await fs.move(learningsPath, external);
    await fs.symlink(external, learningsPath);
    await expect(
      confirmLearningEntry(tempDir, APPLIED_ID, CONFIRM_DATE)
    ).rejects.toThrow(/not a regular file/i);
  });
});
