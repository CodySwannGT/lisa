import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkLearningsBudget,
  describeLearningsSaturation,
  formatBudgetVerdict,
} from "../../../src/core/learnings-budget-check.js";
import {
  LEARNINGS_CONTRACT,
  PER_ENTRY_BYTE_ALLOWANCE,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";

const LEDGER_AUDIT = "/lisa:learnings:audit";
const OVERFLOW_COMMAND = "lisa learnings-overflow";
const INVALID_OVERFLOW = "invalid-overflow.md";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("overflow learnings budget presentation", () => {
  it("renders a saturated overflow with gardener drain remediation", () => {
    const verdict = formatBudgetVerdict(
      "/project/.lisa/PROJECT_LEARNINGS.overflow.md",
      {
        kind: "ok",
        entryCount: LEARNINGS_CONTRACT.maxEntries,
        maxEntries: LEARNINGS_CONTRACT.maxEntries,
        measuredTokens: 1,
        maxTokens: LEARNINGS_CONTRACT.maxTokens,
        saturation: describeLearningsSaturation(
          LEARNINGS_CONTRACT.maxEntries,
          1,
          LEARNINGS_CONTRACT.maxTokens,
          "overflow"
        ),
      },
      { surface: "overflow" }
    );

    expect(verdict).toContain("learnings overflow budget saturated");
    expect(verdict).toContain(OVERFLOW_COMMAND);
    expect(verdict).not.toContain(LEDGER_AUDIT);
  });

  it("remediates a byte breach by draining, never trimming", async () => {
    const fixture = writeFixture(
      "PROJECT_LEARNINGS.overflow.md",
      "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1)
    );

    const result = await checkOverflow(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain(OVERFLOW_COMMAND);
      expect(result.detail).not.toMatch(
        /shorten or remove|consolidate or remove/i
      );
    }
  });

  it("remediates an entry-count breach by draining", async () => {
    const fixture = writeFixture(
      "overflow-entries.md",
      renderLearningsFile(
        Array.from(
          { length: LEARNINGS_CONTRACT.maxEntries + 1 },
          (_unused, index) => createEntry(`overflow-entry-${index}`)
        )
      )
    );

    const result = await checkOverflow(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain("maxEntries");
      expect(result.detail).toContain(OVERFLOW_COMMAND);
      expect(result.detail).not.toContain("consolidate or remove");
    }
  });

  it("uses the same byte saturation boundary with drain wording", () => {
    const detail = describeLearningsSaturation(
      1,
      LEARNINGS_CONTRACT.maxTokens - PER_ENTRY_BYTE_ALLOWANCE + 1,
      LEARNINGS_CONTRACT.maxTokens,
      "overflow"
    );

    expect(detail).toContain(String(PER_ENTRY_BYTE_ALLOWANCE));
    expect(detail).toContain(OVERFLOW_COMMAND);
    expect(detail).not.toContain(LEDGER_AUDIT);
  });

  it("gives a noncanonical overflow restore-then-drain guidance", async () => {
    const fixture = writeFixture(
      INVALID_OVERFLOW,
      `${JSON.stringify(createEntry("invalid-overflow"))}\n`
    );

    const result = await checkOverflow(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain(OVERFLOW_COMMAND);
      expect(result.detail).toContain("never hand-edit");
      expect(result.detail).not.toContain("re-generate");
    }
  });

  it.each([
    [
      "malformed JSONL",
      renderLearningsFile([]).replace("```jsonl\n", "```jsonl\n{bad}\n"),
    ],
    [
      "duplicate identities",
      renderLearningsFile([
        createEntry("duplicate-overflow"),
        createEntry("duplicate-overflow"),
      ]),
    ],
    ["invalid UTF-8", Buffer.from([0xff, 0xfe, 0xfd])],
  ])("adds overflow recovery to %s", async (_case, content) => {
    const result = await checkOverflow(writeFixture(INVALID_OVERFLOW, content));

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain(OVERFLOW_COMMAND);
      expect(result.detail).toContain("never hand-edit");
    }
  });

  it("keeps conflict repair and adds the overflow drain action", async () => {
    const fixture = writeFixture(
      "conflicted-overflow.md",
      renderLearningsFile([createEntry("conflicted-overflow")]).replace(
        '"rule":"r"',
        '<<<<<<< HEAD\n"rule":"r"\n=======\n"rule":"other"\n>>>>>>> branch'
      )
    );

    const result = await checkOverflow(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain("recompact");
      expect(result.detail).toContain("lisa install-merge-driver");
      expect(result.detail).toContain(OVERFLOW_COMMAND);
    }
  });

  it("does not infer overflow mode from a ledger filename", async () => {
    const fixture = writeFixture(
      "custom.overflow.md",
      renderLearningsFile(
        Array.from(
          { length: LEARNINGS_CONTRACT.maxEntries },
          (_unused, index) => createEntry(`named-overflow-${index}`)
        )
      )
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const verdict = formatBudgetVerdict(fixture, result);
      expect(verdict).toContain("learnings budget saturated");
      expect(verdict).toContain(LEDGER_AUDIT);
      expect(verdict).not.toContain("learnings overflow budget");
    }
  });
});

/**
 * Check one fixture using overflow presentation policy.
 * @param fixture - Absolute overflow fixture path
 * @returns Shared checker result
 */
function checkOverflow(
  fixture: string
): ReturnType<typeof checkLearningsBudget> {
  return checkLearningsBudget(fixture, { surface: "overflow" });
}

/**
 * Create one structurally valid learning entry.
 * @param id - Stable learning identifier
 * @returns Canonical learning entry
 */
function createEntry(id: string): LearningEntry {
  return {
    id,
    fingerprint: id,
    rule: "r",
    why: "w",
    provenance: ["p"],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "low",
  };
}

/**
 * Write a learnings document to an isolated temporary directory.
 * @param fileName - Fixture basename
 * @param content - Complete document bytes
 * @returns Absolute fixture path
 */
function writeFixture(fileName: string, content: string | Uint8Array): string {
  const filePath = path.join(createTemporaryDirectory(), fileName);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Allocate and remember one temporary directory for cleanup.
 * @returns Absolute temporary directory path
 */
function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-overflow-budget-"));
  temporaryDirectories.push(directory);
  return directory;
}
