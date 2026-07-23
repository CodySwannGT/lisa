/**
 * Conflict-marker corruption guard for the project-learnings ledger.
 *
 * The fs-level lock (`learnings-lock.ts`) already serializes writers inside one
 * filesystem, but every learner pass runs on its own `learning/<fingerprint>`
 * branch in its own worktree, so N concurrent passes produce N pull requests
 * merging the same JSONL block. A path-scoped lock provably cannot serialize
 * two worktrees, so the corruption that actually reaches the ledger is a git
 * merge artifact: literal conflict markers embedded in the document.
 *
 * These tests pin the diagnosis, not just the rejection — before this guard a
 * conflicted ledger failed with the generic "Invalid project learnings JSONL
 * payload", which tells an operator nothing about what happened or how to
 * recover (CodySwannGT/lisa#1995).
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLearningsBudget } from "../../../src/core/learnings-budget-check.js";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  parseLearningsFile,
  persistLearningEntry,
  renderLearningsFile,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const VALID_ENTRY = {
  id: "learning-stable-id",
  rule: "Reject over-budget learnings before persistence.",
  why: "Silent truncation destroys the rule and its audit trail.",
  provenance: ["issue:#1568"],
  first_learned: "2026-07-16",
  last_confirmed: "2026-07-16",
  confidence: "high",
} as const;

/**
 * Build a compact valid entry.
 * @param index - Stable numeric suffix
 * @returns Valid learning entry
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

/**
 * Produce the document git actually leaves behind when two learner branches
 * both appended to the JSONL block and no union merge driver was registered.
 * @returns Conflicted ledger document
 */
function conflictedDocument(): string {
  const ours = JSON.stringify(numberedEntry(1));
  const theirs = JSON.stringify(numberedEntry(2));
  return [
    "# Project Learnings",
    "",
    "<!-- lisa-learnings-contract:v1 -->",
    "",
    "```jsonl",
    "<<<<<<< HEAD",
    ours,
    "=======",
    theirs,
    ">>>>>>> learning/9f2c1ab",
    "```",
    "",
  ].join("\n");
}

describe("learnings conflict-marker guard", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("names concurrent-write corruption instead of a generic JSONL failure", () => {
    expect(() => parseLearningsFile(conflictedDocument())).toThrow(
      /conflict marker/i
    );
  });

  it("points the operator at recompaction rather than hand-editing", () => {
    expect(() => parseLearningsFile(conflictedDocument())).toThrow(
      /recompact/i
    );
  });

  it("detects a closing marker even when the opener was already removed", () => {
    const partial = conflictedDocument()
      .split("\n")
      .filter(line => !line.startsWith("<<<<<<<"))
      .join("\n");
    expect(() => parseLearningsFile(partial)).toThrow(/conflict marker/i);
  });

  it("diagnoses an over-budget document ahead of the byte guard", () => {
    // Ordering check on the pure parser only. The end-to-end cases below are
    // what prove the guard survives the readers' own size checks — an earlier
    // version of this suite tested ONLY this, which passed while both real
    // callers still reported "shorten or remove entries".
    const bloated = conflictedDocument().replace(
      '"Reason."',
      `"${"x".repeat(13_000)}"`
    );
    expect(() => parseLearningsFile(bloated)).toThrow(/conflict marker/i);
  });

  describe("marker widths git can actually emit", () => {
    // Seven characters is only the DEFAULT. Git's `conflict-marker-size`
    // attribute widens every marker, and a host `.gitattributes` setting it
    // survives `lisa apply` because copy-contents preserves lines outside the
    // managed block — so a fixed {7} quantifier stops recognizing corruption in
    // exactly the repositories that configured it, reverting to the misleading
    // "shorten entries" advice this guard exists to remove.

    /**
     * Build a conflicted ledger using markers of a given width.
     * @param width - Marker character count
     * @param lineEnding - Line ending to join with
     * @returns Conflicted document
     */
    function conflictedAtWidth(width: number, lineEnding = "\n"): string {
      const open = "<".repeat(width);
      const mid = "=".repeat(width);
      const close = ">".repeat(width);
      return [
        "# Project Learnings",
        "",
        "<!-- lisa-learnings-contract:v1 -->",
        "",
        "```jsonl",
        `${open} HEAD`,
        JSON.stringify(numberedEntry(1)),
        mid,
        JSON.stringify(numberedEntry(2)),
        `${close} learning/9f2c1ab`,
        "```",
        "",
      ].join(lineEnding);
    }

    it.each([7, 8, 12, 32])("detects %i-character markers", width => {
      expect(() => parseLearningsFile(conflictedAtWidth(width))).toThrow(
        /conflict marker/i
      );
    });

    it("detects markers in a CRLF checkout", () => {
      expect(() => parseLearningsFile(conflictedAtWidth(7, "\r\n"))).toThrow(
        /conflict marker/i
      );
    });

    it("still ignores a bare row of equals signs", () => {
      // `=======` alone is ordinary prose punctuation, never a signal.
      const clean = renderLearningsFile([
        { ...VALID_ENTRY, why: "A divider:\n=======\nfollows." },
      ]);
      expect(parseLearningsFile(clean)).toHaveLength(1);
    });
  });

  it("does not false-positive on marker text carried inside an entry field", () => {
    // Entries are rendered one JSON object per line and JSON.stringify escapes
    // every newline, so a marker sequence stored in `why` can never begin a
    // line. Only a line that STARTS with a marker is foreign to the format.
    const smuggled = {
      ...VALID_ENTRY,
      why: "Guard against\n<<<<<<< HEAD\n=======\n>>>>>>> theirs\nmarkers.",
    };
    const rendered = renderLearningsFile([smuggled]);
    expect(
      rendered.split("\n").filter(line => line.startsWith("<<<<<<<")).length
    ).toBe(0);
    expect(parseLearningsFile(rendered)[0]?.why).toBe(smuggled.why);
  });

  it("still accepts a clean canonical document", () => {
    const clean = renderLearningsFile([numberedEntry(1), numberedEntry(2)]);
    expect(parseLearningsFile(clean).map(entry => entry.id)).toEqual([
      "learning-1",
      "learning-2",
    ]);
  });

  it("refuses to write over a conflicted ledger and leaves it byte-identical", async () => {
    await fs.outputFile(learningsPath, conflictedDocument());
    const before = await readFile(learningsPath, "utf8");
    await expect(persistLearningEntry(tempDir, VALID_ENTRY)).rejects.toThrow(
      /conflict marker/i
    );
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("reports conflict remediation through the CI budget gate", async () => {
    await fs.outputFile(learningsPath, conflictedDocument());
    const result = await checkLearningsBudget(learningsPath);
    expect(result.kind).toBe("violation");
    if (result.kind !== "violation") return;
    expect(result.detail).toMatch(/conflict marker/i);
    expect(result.detail).toMatch(/merge driver|recompact/i);
  });

  describe("at the size real corruption actually produces", () => {
    // The live ledger sits near its 12000-byte ceiling, and a git conflict
    // duplicates the whole JSONL block — so EVERY real corruption of a healthy
    // ledger lands over budget. Both readers apply a file-size guard of their
    // own before the parser ever sees the bytes, so the guard has to survive
    // that path or it is inert exactly when it matters.

    /**
     * Build a near-full clean ledger, then corrupt it the way git does.
     * @returns Conflicted document comfortably over the byte budget
     */
    function oversizedConflictedDocument(): string {
      const entries = Array.from(
        { length: LEARNINGS_CONTRACT.maxEntries },
        (_unused, index) => ({
          ...VALID_ENTRY,
          id: `learning-${index}`,
          why: "y".repeat(400),
          provenance: [`issue:#${index}`],
        })
      );
      const clean = renderLearningsFile(entries);
      const payload = clean
        .split("```jsonl\n")[1]
        ?.replace("\n```\n", "") as string;
      return clean.replace(
        payload,
        [
          "<<<<<<< HEAD",
          payload,
          "=======",
          payload,
          ">>>>>>> learning/9f2c1ab",
        ].join("\n")
      );
    }

    it("exceeds the byte budget, as a real conflicted ledger does", () => {
      expect(
        Buffer.byteLength(oversizedConflictedDocument(), "utf8")
      ).toBeGreaterThan(LEARNINGS_CONTRACT.maxTokens);
    });

    it("tells the CI gate to recompact, not to shorten entries", async () => {
      await fs.outputFile(learningsPath, oversizedConflictedDocument());
      const result = await checkLearningsBudget(learningsPath);
      expect(result.kind).toBe("violation");
      if (result.kind !== "violation") return;
      expect(result.detail).toMatch(/conflict marker/i);
      expect(result.detail).not.toMatch(/shorten or remove entries/i);
    });

    it("tells the writer the ledger is conflicted, not merely too large", async () => {
      await fs.outputFile(learningsPath, oversizedConflictedDocument());
      const before = await readFile(learningsPath, "utf8");
      await expect(persistLearningEntry(tempDir, VALID_ENTRY)).rejects.toThrow(
        /conflict marker/i
      );
      expect(await readFile(learningsPath, "utf8")).toBe(before);
    });

    it("still reports a plain byte-budget breach when there is no conflict", async () => {
      // The size guard must keep working for genuinely oversized clean files.
      await fs.outputFile(
        learningsPath,
        renderLearningsFile([
          { ...VALID_ENTRY, why: "z".repeat(LEARNINGS_CONTRACT.maxTokens) },
        ])
      );
      const result = await checkLearningsBudget(learningsPath);
      expect(result.kind).toBe("violation");
      if (result.kind !== "violation") return;
      expect(result.detail).toMatch(/maxTokens/);
      expect(result.detail).not.toMatch(/conflict marker/i);
    });
  });
});
