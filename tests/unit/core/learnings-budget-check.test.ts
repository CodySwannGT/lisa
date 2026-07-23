import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLearningsBudget } from "../../../src/core/learnings-budget-check.js";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";

const BUDGET_REMEDIATION = "to fit the learnings budget";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("checkLearningsBudget", () => {
  it("returns ok for a within-budget canonical file", async () => {
    const fixture = writeFixture(
      "valid.md",
      renderLearningsFile([createEntry("valid-entry")])
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.entryCount).toBe(1);
      expect(result.maxEntries).toBe(LEARNINGS_CONTRACT.maxEntries);
      expect(result.maxTokens).toBe(LEARNINGS_CONTRACT.maxTokens);
      expect(result.measuredTokens).toBeGreaterThan(0);
    }
  });

  it("returns a distinct missing result for an absent file", async () => {
    const fixture = path.join(createTemporaryDirectory(), "absent.md");

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("missing");
    expect(result.kind === "missing" && result.detail).toContain("ENOENT");
  });

  it("returns a violation naming maxTokens when the token ceiling is exceeded", async () => {
    const measuredBytes = LEARNINGS_CONTRACT.maxTokens + 1;
    const fixture = writeFixture("over-tokens.md", "x".repeat(measuredBytes));

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain("maxTokens");
      expect(result.detail).toContain(String(measuredBytes));
      expect(result.detail).toContain(BUDGET_REMEDIATION);
    }
  });

  it("returns a violation naming maxEntries when the entry count is exceeded", async () => {
    const measuredEntries = LEARNINGS_CONTRACT.maxEntries + 1;
    const entries = Array.from({ length: measuredEntries }, (_unused, index) =>
      createEntry(`entry-${index}`)
    );
    const fixture = writeFixture(
      "over-entries.md",
      renderLearningsFile(entries)
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain("maxEntries");
      expect(result.detail).toContain(String(measuredEntries));
      expect(result.detail).toContain("consolidate or remove entries");
      expect(result.detail).toContain(BUDGET_REMEDIATION);
    }
  });

  it("returns a violation naming the offending entry id on a per-entry cap breach", async () => {
    const id = "over-character-cap";
    const fixture = writeFixture(
      "over-characters.md",
      renderLearningsFile([
        createEntry(id, {
          rule: "x".repeat(LEARNINGS_CONTRACT.maxRuleCharacters + 1),
        }),
      ])
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toContain("maxRuleCharacters");
      // Rendered with single quotes, never double-escaped `\"id\"`.
      expect(result.detail).toContain(`'${id}'`);
      expect(result.detail).not.toContain(`\\"${id}\\"`);
      // Per-entry breaches keep their id-naming and get no budget remediation.
      expect(result.detail).not.toContain(BUDGET_REMEDIATION);
    }
  });

  it("returns a violation with remediation for a non-canonical document", async () => {
    const fixture = writeFixture(
      "noncanonical.md",
      `${JSON.stringify(createEntry("valid-but-unwrapped"))}\n`
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toMatch(/canonical|format/i);
      expect(result.detail).toContain("re-generate");
    }
  });

  it("returns a clear corruption violation for embedded conflict markers", async () => {
    const fixture = writeFixture(
      "conflicted.md",
      renderLearningsFile([createEntry("conflicted-entry")]).replace(
        '"rule":"r"',
        '<<<<<<< HEAD\n"rule":"r"\n=======\n"rule":"other"\n>>>>>>> branch'
      )
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("violation");
    if (result.kind === "violation") {
      expect(result.detail).toMatch(/corrupted by concurrent write/i);
      // Singular, and pinned to a line: the guard reports the FIRST marker it
      // finds rather than the set, so an operator is sent to a specific line.
      expect(result.detail).toMatch(/conflict marker on line \d+/i);
      expect(result.detail).toMatch(/recompact/i);
    }
  });

  it("returns a violation for a non-regular file without blocking", async () => {
    const directory = createTemporaryDirectory();

    const result = await checkLearningsBudget(directory);

    expect(result.kind).toBe("violation");
    expect(result.kind === "violation" && result.detail).toMatch(
      /regular file|EISDIR/i
    );
  });
});

/**
 * Create one structurally valid entry, optionally replacing selected fields.
 * @param id - Stable learning identifier
 * @param overrides - Fields replaced for a specific boundary fixture
 * @returns Learning entry suitable for canonical rendering
 */
function createEntry(
  id: string,
  overrides: Partial<LearningEntry> = {}
): LearningEntry {
  return {
    id,
    rule: "r",
    why: "w",
    provenance: ["p"],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "low",
    ...overrides,
  };
}

/**
 * Write one real learnings document to an isolated temporary directory.
 * @param fileName - Fixture basename
 * @param content - Complete learnings document
 * @returns Absolute fixture path
 */
function writeFixture(fileName: string, content: string): string {
  const filePath = path.join(createTemporaryDirectory(), fileName);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Allocate and remember a temporary directory for deterministic cleanup.
 * @returns Absolute temporary-directory path
 */
function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-budget-core-"));
  temporaryDirectories.push(directory);
  return directory;
}
