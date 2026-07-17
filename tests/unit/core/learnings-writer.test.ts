/** Persistence, validation, concurrency, and filesystem-safety tests. */
import * as fs from "fs-extra";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  parseLearningsFile,
  persistLearningEntry,
  renderLearningsFile,
  validateLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const VALID_ENTRY = {
  id: "learning-stable-id",
  rule: "Reject over-budget learnings before persistence.",
  why: "Silent truncation destroys the rule and its audit trail.",
  provenance: ["issue:#1568", "pr:#example"],
  first_learned: "2026-07-16",
  last_confirmed: "2026-07-16",
  confidence: "high",
} as const;

/**
 * Build a compact valid entry for file-budget tests.
 * @param index - Stable numeric suffix
 * @returns Compact valid entry
 */
function numberedEntry(index: number) {
  return {
    ...VALID_ENTRY,
    id: `learning-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
  } as const;
}

describe("learnings writer", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".claude", "rules", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("persists a valid caller-supplied entry with all seven fields", async () => {
    await persistLearningEntry(tempDir, VALID_ENTRY);
    const persisted = await readFile(learningsPath, "utf8");
    for (const field of LEARNINGS_CONTRACT.fields) {
      expect(persisted).toContain(`"${field}"`);
    }
    expect(parseLearningsFile(persisted)).toEqual([VALID_ENTRY]);
  });

  it("rejects an over-cap rule and leaves the file byte-identical", async () => {
    await persistLearningEntry(tempDir, VALID_ENTRY);
    const before = await readFile(learningsPath, "utf8");
    const overCapEntry = {
      ...VALID_ENTRY,
      id: "learning-over-cap",
      rule: "x".repeat(LEARNINGS_CONTRACT.maxRuleCharacters + 1),
    };
    await expect(persistLearningEntry(tempDir, overCapEntry)).rejects.toThrow(
      new RegExp(
        `maxRuleCharacters.*${LEARNINGS_CONTRACT.maxRuleCharacters}`,
        "i"
      )
    );
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("counts ASCII and Unicode line separators toward maxRuleLines", () => {
    for (const rule of [
      "one\rtwo\rthree",
      "one\ntwo\nthree",
      "one\r\ntwo\r\nthree",
      "one\u0085two\u0085three",
      "one\u2028two\u2028three",
      "one\u2029two\u2029three",
    ]) {
      expect(() => validateLearningEntry({ ...VALID_ENTRY, rule })).toThrow(
        /maxRuleLines.*2/i
      );
    }
  });

  it("rejects accessor-backed fields without invoking them", () => {
    const candidate = { ...VALID_ENTRY } as Record<string, unknown>;
    const getter = vi.fn(() => "high");
    Object.defineProperty(candidate, "confidence", {
      enumerable: true,
      get: getter,
    });
    expect(() => validateLearningEntry(candidate)).toThrow(/accessor/i);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ["missing why", { ...VALID_ENTRY, why: undefined }, /why/i],
    ["empty provenance", { ...VALID_ENTRY, provenance: [] }, /provenance/i],
    ["invalid date", { ...VALID_ENTRY, first_learned: "July 16" }, /date/i],
    [
      "invalid confidence",
      { ...VALID_ENTRY, confidence: "certain" },
      /confidence/i,
    ],
    ["unknown field", { ...VALID_ENTRY, extra: true }, /field/i],
  ] as const)("rejects malformed entry: %s", async (_name, entry, error) => {
    await expect(persistLearningEntry(tempDir, entry as never)).rejects.toThrow(
      error
    );
  });

  it("rejects duplicate ids without changing the file", async () => {
    await persistLearningEntry(tempDir, VALID_ENTRY);
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistLearningEntry(tempDir, { ...VALID_ENTRY, rule: "Different rule." })
    ).rejects.toThrow(/duplicate.*id/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("serializes concurrent unique writes without losing entries", async () => {
    const entries = Array.from({ length: 10 }, (_unused, index) =>
      numberedEntry(index)
    );
    await Promise.all(
      entries.map(entry => persistLearningEntry(tempDir, entry))
    );
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.map(entry => entry.id)).toEqual(
      entries.map(entry => entry.id)
    );
  });

  it("publishes lock ownership atomically under repeated contention", async () => {
    for (let round = 0; round < 10; round += 1) {
      const projectRoot = path.join(tempDir, `round-${round}`);
      await fs.ensureDir(projectRoot);
      const entries = Array.from({ length: 10 }, (_unused, index) =>
        numberedEntry(index)
      );
      await Promise.all(
        entries.map(entry => persistLearningEntry(projectRoot, entry))
      );
      const content = await readFile(
        path.join(projectRoot, ".claude", "rules", LEARNINGS_FILENAME),
        "utf8"
      );
      expect(parseLearningsFile(content)).toHaveLength(entries.length);
    }
  });

  it("reclaims a stale owned lock and removes it after success", async () => {
    const lockPath = `${learningsPath}.lock`;
    await fs.outputJson(lockPath, {
      token: "dead-owner",
      pid: 2_147_483_647,
      createdAt: Date.now() - 60_000,
    });
    await persistLearningEntry(tempDir, VALID_ENTRY);
    expect(await fs.pathExists(lockPath)).toBe(false);
  });

  it.each([0, -1])("reclaims a malformed lock-owner pid %i", async pid => {
    const lockPath = `${learningsPath}.lock`;
    await fs.outputJson(lockPath, {
      token: "invalid-pid-owner",
      pid,
      createdAt: Date.now() - 60_000,
    });
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, stale, stale);
    await persistLearningEntry(tempDir, VALID_ENTRY);
    expect(await fs.pathExists(lockPath)).toBe(false);
  });

  it("rejects provenance beyond its dedicated reference cap", () => {
    const provenance = Array.from(
      { length: LEARNINGS_CONTRACT.maxProvenanceReferences + 1 },
      (_unused, index) => `issue:#${index}`
    );
    expect(() => validateLearningEntry({ ...VALID_ENTRY, provenance })).toThrow(
      new RegExp(
        `provenance.*${LEARNINGS_CONTRACT.maxProvenanceReferences}`,
        "i"
      )
    );
  });

  it.each(["", "{"])(
    "reclaims stale partial lock content %j after a crashed acquisition",
    async partial => {
      const lockPath = `${learningsPath}.lock`;
      await fs.outputFile(lockPath, partial);
      const stale = new Date(Date.now() - 60_000);
      await fs.utimes(lockPath, stale, stale);
      await persistLearningEntry(tempDir, VALID_ENTRY);
      expect(await fs.pathExists(lockPath)).toBe(false);
    }
  );

  it.each([false, true])(
    "recovers one stale lock under concurrent writers (retained owner: %s)",
    async retainedOwner => {
      const lockPath = `${learningsPath}.lock`;
      const owner = {
        token: "crashed-owner",
        pid: 2_147_483_647,
        createdAt: Date.now() - 60_000,
      };
      const ownerPath = `${lockPath}.${owner.token}.owner`;
      if (retainedOwner) {
        await fs.outputJson(ownerPath, owner);
        await fs.ensureLink(ownerPath, lockPath);
      } else {
        await fs.outputJson(lockPath, owner);
      }
      const entries = Array.from({ length: 10 }, (_unused, index) =>
        numberedEntry(index)
      );
      await Promise.all(
        entries.map(entry => persistLearningEntry(tempDir, entry))
      );
      const persisted = parseLearningsFile(
        await readFile(learningsPath, "utf8")
      );
      expect(persisted).toHaveLength(entries.length);
    }
  );

  it("rejects entry and token budgets without changing persisted bytes", async () => {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistLearningEntry(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow(/maxEntries/i);
    await expect(
      persistLearningEntry(tempDir, {
        ...VALID_ENTRY,
        id: "learning-over-token-budget",
        why: "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1),
      })
    ).rejects.toThrow(/maxTokens/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("rejects a single over-budget entry before creating directories", async () => {
    await expect(
      persistLearningEntry(tempDir, {
        ...VALID_ENTRY,
        why: "x".repeat(LEARNINGS_CONTRACT.maxTokens - 20),
      })
    ).rejects.toThrow(/maxTokens/i);
    expect(await fs.pathExists(path.join(tempDir, ".claude"))).toBe(false);
  });

  it("rejects malformed fences and existing documents without mutation", async () => {
    const valid = renderLearningsFile([VALID_ENTRY]);
    expect(() =>
      parseLearningsFile(valid.replace("```jsonl\n", "123456789"))
    ).toThrow(/format/i);
    await fs.outputFile(learningsPath, "# Project Learnings\n\nnot-jsonl\n");
    const before = await readFile(learningsPath, "utf8");
    await expect(persistLearningEntry(tempDir, VALID_ENTRY)).rejects.toThrow(
      /format|json/i
    );
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("rejects an oversized public parser input before JSONL processing", () => {
    expect(() =>
      parseLearningsFile("{".repeat(LEARNINGS_CONTRACT.maxTokens + 1))
    ).toThrow(/maxTokens/i);
  });

  it("rejects a symlink before reading external content", async () => {
    const external = path.join(tempDir, "external.md");
    await fs.writeFile(external, renderLearningsFile([VALID_ENTRY]));
    await fs.ensureDir(path.dirname(learningsPath));
    await fs.symlink(external, learningsPath);
    await expect(persistLearningEntry(tempDir, VALID_ENTRY)).rejects.toThrow(
      /not a regular file/i
    );
  });

  it("imports the executable contract instead of copying cap constants", async () => {
    const source = await readFile(
      path.resolve("src/core/learnings-document.ts"),
      "utf8"
    );
    expect(source).toMatch(/import\s+\{[^}]*LEARNINGS_CONTRACT/s);
    expect(source).not.toMatch(/const\s+MAX_(?:RULE|ENTRIES|TOKENS)/);
    expect(createHash("sha256").update(source).digest("hex")).toHaveLength(64);
  });
});
