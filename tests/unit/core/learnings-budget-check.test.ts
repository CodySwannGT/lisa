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

  it("accepts canonical v1 under its historical 12000-byte source budget", async () => {
    const current = createEntry("legacy-entry");
    const { fingerprint: _fingerprint, ...legacy } = current;
    const fixture = writeFixture(
      "legacy.md",
      `# Project Learnings

<!-- lisa-learnings-contract:v1 -->

\`\`\`jsonl
${JSON.stringify(legacy)}
\`\`\`
`
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.maxTokens).toBe(12000);
      expect(result.entryCount).toBe(1);
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

  // #3089. This repository's own ledger sat at 20/20 entries and 11924/12000
  // bytes and this function called it `ok` with nothing else said, so the gate
  // read green at 100% of the entry cap and the next agent to capture a
  // learning was the one who found out. Saturation is now a reported state.
  it("reports saturation for a ledger at the entry cap", async () => {
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries },
      (_unused, index) => createEntry(`at-cap-${index}`)
    );
    const fixture = writeFixture("at-cap.md", renderLearningsFile(entries));

    const result = await checkLearningsBudget(fixture);

    // Still `ok`: the document is valid and every entry is serveable. The
    // caps have not moved and nothing that used to fail now passes.
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.entryCount).toBe(LEARNINGS_CONTRACT.maxEntries);
      expect(result.saturation).toBeDefined();
      expect(result.saturation).toContain("entry slots is taken");
      expect(result.saturation).toContain("/lisa:learnings:audit");
    }
  });

  // NEGATIVE CONTROL. A saturation signal that fires on a healthy ledger is
  // noise, and noise is what gets a gate ignored.
  it("reports no saturation for a ledger with room to spare", async () => {
    const fixture = writeFixture(
      "roomy.md",
      renderLearningsFile([createEntry("roomy-entry")])
    );

    const result = await checkLearningsBudget(fixture);

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.saturation).toBeUndefined();
  });

  it("names the byte arm when slots remain but bytes do not", () => {
    const detail = describeLearningsSaturation(
      1,
      LEARNINGS_CONTRACT.maxTokens - PER_ENTRY_BYTE_ALLOWANCE + 1
    );

    expect(detail).toBeDefined();
    expect(detail).toContain(String(PER_ENTRY_BYTE_ALLOWANCE));
    expect(detail).toContain("less than one average entry");
  });

  // The boundary is DERIVED, not a hand-picked percentage: a ledger is
  // saturated exactly when one further average-sized entry would not fit, and
  // the average is the same PER_ENTRY_BYTE_ALLOWANCE the byte cap itself is
  // derived from. Pinning both sides of it is what stops the band and the cap
  // drifting apart the way maxEntries and a flat byte cap once did (#1959).
  it("puts the byte boundary exactly one average entry below the cap", () => {
    expect(
      describeLearningsSaturation(
        1,
        LEARNINGS_CONTRACT.maxTokens - PER_ENTRY_BYTE_ALLOWANCE
      )
    ).toBeUndefined();
    expect(
      describeLearningsSaturation(
        1,
        LEARNINGS_CONTRACT.maxTokens - PER_ENTRY_BYTE_ALLOWANCE + 1
      )
    ).toBeDefined();
  });

  it("puts the entry boundary at the last free slot", () => {
    expect(
      describeLearningsSaturation(LEARNINGS_CONTRACT.maxEntries - 1, 0)
    ).toBeUndefined();
    expect(
      describeLearningsSaturation(LEARNINGS_CONTRACT.maxEntries, 0)
    ).toBeDefined();
  });

  it("renders a verdict word an operator can tell apart at a glance", () => {
    const counts = {
      kind: "ok",
      entryCount: 1,
      maxEntries: LEARNINGS_CONTRACT.maxEntries,
      measuredTokens: 1,
      maxTokens: LEARNINGS_CONTRACT.maxTokens,
    } as const;

    const healthy = formatBudgetVerdict("/ledger.md", {
      ...counts,
      saturation: undefined,
    });
    const full = formatBudgetVerdict("/ledger.md", {
      ...counts,
      saturation: "no room",
    });

    expect(healthy).toContain("learnings budget passed");
    expect(healthy).not.toContain("saturated");
    expect(full).toContain("learnings budget saturated");
    expect(full).not.toContain("learnings budget passed");
    expect(full).toContain("no room");
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
    fingerprint: id,
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
