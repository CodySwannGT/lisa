/** Mutation-only migration coverage for compatibility-window v1 ledgers. */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseLearningsFile,
  persistLearningEntry,
  renderLearningsFile,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEGACY_ID = "learning-legacy";
const LEGACY_ENTRY = {
  id: LEGACY_ID,
  rule: "Keep legacy ledgers readable until a real mutation occurs.",
  why: "Read-time rewrites create unrelated working-tree changes.",
  provenance: ["issue:#2015"],
  first_learned: "2026-08-26",
  last_confirmed: "2026-08-26",
  confidence: "high",
} as const;
const APPENDED_ENTRY = {
  ...LEGACY_ENTRY,
  id: "learning-appended",
  fingerprint: "learning-appended-fingerprint",
  rule: "A real append publishes the normalized v2 document.",
} as const;

describe("v1 mutation-only migration", () => {
  let projectRoot: string;
  let ledger: string;

  beforeEach(async () => {
    projectRoot = await createTempDir();
    ledger = path.join(projectRoot, ".lisa", "PROJECT_LEARNINGS.md");
  });

  afterEach(async () => {
    await cleanupTempDir(projectRoot);
  });

  it("leaves v1 bytes unchanged on read and migrates atomically on append", async () => {
    const legacy = renderLearningsFile([])
      .replace("lisa-learnings-contract:v2", "lisa-learnings-contract:v1")
      .replace("```jsonl\n", `\`\`\`jsonl\n${JSON.stringify(LEGACY_ENTRY)}`);
    await fs.outputFile(ledger, legacy);

    expect(parseLearningsFile(await readFile(ledger, "utf8"))).toEqual([
      { ...LEGACY_ENTRY, fingerprint: LEGACY_ID },
    ]);
    expect(await readFile(ledger, "utf8")).toBe(legacy);

    await persistLearningEntry(projectRoot, APPENDED_ENTRY);
    const migrated = await readFile(ledger, "utf8");
    expect(migrated).toContain("lisa-learnings-contract:v2");
    expect(migrated).toContain(
      `"id":"${LEGACY_ID}","fingerprint":"${LEGACY_ID}"`
    );
  });
});
