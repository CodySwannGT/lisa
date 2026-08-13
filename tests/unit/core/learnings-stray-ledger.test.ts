/**
 * Detection coverage for a SECOND learnings ledger outside the configured path.
 *
 * The fleet lost 19 captured learnings because a ledger scaffolded into
 * `.claude/rules/` kept collecting writes while the canonical `.lisa/` ledger
 * sat empty, and nothing in Lisa ever looked. These tests pin the scanner that
 * makes a stray ledger visible, including how many entries are stranded in it.
 * @module tests/unit/core/learnings-stray-ledger
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findStrayLearningsLedgers } from "../../../src/core/learnings-stray-ledger.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CANONICAL_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const CLAUDE_RULES_LEDGER = ".claude/rules/PROJECT_LEARNINGS.md";
const RELOCATED_LEDGER = "docs/state/PROJECT_LEARNINGS.md";

const ENTRY_ONE =
  '{"id":"learning-1","rule":"Rule one.","why":"Reason.","provenance":["issue:#1"],"first_learned":"2026-08-12","last_confirmed":"2026-08-12","confidence":"high"}';
const ENTRY_TWO =
  '{"id":"learning-2","rule":"Rule two.","why":"Reason.","provenance":["issue:#2"],"first_learned":"2026-08-12","last_confirmed":"2026-08-12","confidence":"high"}';

/**
 * Write a ledger-shaped document containing the given JSONL rows.
 * @param root - Project root
 * @param relative - Project-relative ledger path
 * @param rows - Raw JSONL rows
 */
async function writeLedger(
  root: string,
  relative: string,
  rows: readonly string[]
): Promise<void> {
  const body = `# Project Learnings\n\n<!-- lisa-learnings-contract:v1 -->\n\n\`\`\`jsonl\n${rows.join("\n")}\n\`\`\`\n`;
  await fse.outputFile(path.join(root, relative), body);
}

describe("stray learnings ledger detection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reports nothing when only the canonical ledger exists", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY_ONE]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.canonicalFile).toBe(CANONICAL_LEDGER);
    expect(scan.strays).toEqual([]);
  });

  it("reports nothing at all in an empty project", async () => {
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([]);
  });

  it("finds a populated ledger inside the Claude rules tree and counts entries", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, []);
    await writeLedger(tempDir, CLAUDE_RULES_LEDGER, [ENTRY_ONE, ENTRY_TWO]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([{ path: CLAUDE_RULES_LEDGER, entryCount: 2 }]);
  });

  it("finds strays in every auto-loaded rules tree, sorted deterministically", async () => {
    await writeLedger(tempDir, ".cursor/rules/PROJECT_LEARNINGS.md", [
      ENTRY_ONE,
    ]);
    await writeLedger(tempDir, ".agents/rules/PROJECT_LEARNINGS.md", []);
    await writeLedger(tempDir, ".github/instructions/PROJECT_LEARNINGS.md", []);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays.map(stray => stray.path)).toEqual([
      ".agents/rules/PROJECT_LEARNINGS.md",
      ".cursor/rules/PROJECT_LEARNINGS.md",
      ".github/instructions/PROJECT_LEARNINGS.md",
    ]);
  });

  it("finds a ledger nested below a rules tree", async () => {
    await writeLedger(tempDir, ".claude/rules/lisa/PROJECT_LEARNINGS.md", [
      ENTRY_ONE,
    ]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([
      { path: ".claude/rules/lisa/PROJECT_LEARNINGS.md", entryCount: 1 },
    ]);
  });

  it("reports an empty stray with a zero count rather than hiding it", async () => {
    await writeLedger(tempDir, CLAUDE_RULES_LEDGER, []);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([{ path: CLAUDE_RULES_LEDGER, entryCount: 0 }]);
  });

  it("reports an unreadable-format stray with an unknown count", async () => {
    await fse.outputFile(
      path.join(tempDir, CLAUDE_RULES_LEDGER),
      "# Project Learnings\n\nfree prose, no fence\n"
    );
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([
      { path: CLAUDE_RULES_LEDGER, entryCount: undefined },
    ]);
  });

  it("follows a configured learnings.file, making the default location a stray", async () => {
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      learnings: { file: RELOCATED_LEDGER },
    });
    await writeLedger(tempDir, RELOCATED_LEDGER, [ENTRY_ONE]);
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY_TWO]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.canonicalFile).toBe(RELOCATED_LEDGER);
    expect(scan.strays).toEqual([{ path: CANONICAL_LEDGER, entryCount: 1 }]);
  });

  it("does not treat the canonical overflow buffer as a stray", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY_ONE]);
    await writeLedger(tempDir, ".lisa/PROJECT_LEARNINGS.overflow.md", [
      ENTRY_TWO,
    ]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([]);
  });

  it("treats an overflow buffer inside a rules tree as a stray", async () => {
    await writeLedger(tempDir, ".claude/rules/PROJECT_LEARNINGS.overflow.md", [
      ENTRY_ONE,
    ]);
    const scan = await findStrayLearningsLedgers(tempDir);
    expect(scan.strays).toEqual([
      { path: ".claude/rules/PROJECT_LEARNINGS.overflow.md", entryCount: 1 },
    ]);
  });
});
