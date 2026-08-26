/** Mutation-only migration coverage for compatibility-window v1 ledgers. */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import {
  parseLearningsDocument,
  renderLearningsFile,
} from "../../../src/core/learnings-document.js";
import {
  parseLearningsFile,
  persistLearningEntry,
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

/** Exact persisted compatibility-window v1 entry shape. */
type LegacyLearningEntry = Omit<LearningEntry, "fingerprint">;

/**
 * Render canonical compatibility-window v1 bytes.
 * @param entries - Exact seven-field legacy entries
 * @returns Canonical v1 Markdown and JSONL document
 */
function renderLegacyEntries(entries: readonly LegacyLearningEntry[]): string {
  return `# Project Learnings

<!-- lisa-learnings-contract:v1 -->

\`\`\`jsonl
${entries.map(entry => JSON.stringify(entry)).join("\n")}
\`\`\`
`;
}

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

  it("rejects the reproduced 7226-byte legacy document whose stable id cannot migrate boundedly", () => {
    const legacy = renderLegacyEntries([
      {
        ...LEGACY_ENTRY,
        id: "a".repeat(7007),
        rule: "r",
        why: "w".repeat(20),
        provenance: ["p"],
      },
    ]);

    expect(Buffer.byteLength(legacy, "utf8")).toBe(7226);
    expect(() => parseLearningsDocument(legacy)).toThrow(
      /id exceeds max stable token bytes 128/i
    );
  });

  it("guarantees every accepted worst-case v1 stable-key shape fits after normalization", () => {
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries },
      (_unused, index): LegacyLearningEntry => {
        const prefix = `legacy-${String(index).padStart(2, "0")}-`;
        return {
          ...LEGACY_ENTRY,
          id: `${prefix}${"x".repeat(128 - prefix.length)}`,
          rule: `Legacy rule ${index}.`,
          why: "w",
          provenance: [`issue:#${index}`],
        };
      }
    );
    const initial = renderLegacyEntries(entries);
    const padding = 12_000 - Buffer.byteLength(initial, "utf8");
    expect(padding).toBeGreaterThan(0);
    entries[0] = { ...entries[0], why: `w${"x".repeat(padding)}` };
    const legacy = renderLegacyEntries(entries);

    expect(Buffer.byteLength(legacy, "utf8")).toBe(12_000);
    const parsed = parseLearningsDocument(legacy);
    expect(Buffer.byteLength(renderLearningsFile(parsed.entries), "utf8")).toBe(
      LEARNINGS_CONTRACT.maxTokens
    );
  });
});
