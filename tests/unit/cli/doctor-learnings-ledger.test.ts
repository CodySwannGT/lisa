/**
 * Doctor coverage for a second, stranded learnings ledger.
 *
 * A fleet project silently lost 19 captured learnings from a ledger sitting in
 * `.claude/rules/` while the canonical `.lisa/` ledger stayed empty. Nothing
 * reported it. These tests pin doctor's new check: strays are named, counted,
 * and paired with repair guidance an operator can follow.
 * @module tests/unit/cli/doctor-learnings-ledger
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Single learnings ledger?";
const CANONICAL_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const CLAUDE_RULES_LEDGER = ".claude/rules/PROJECT_LEARNINGS.md";

const ENTRY =
  '{"id":"learning-1","rule":"Rule one.","why":"Reason.","provenance":["issue:#1"],"first_learned":"2026-08-12","last_confirmed":"2026-08-12","confidence":"high"}';

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

/**
 * Run doctor offline against a fixture and return the ledger check.
 * @param cwd - Fixture project path
 * @returns The learnings-ledger check result
 */
async function ledgerCheck(
  cwd: string
): Promise<{ status: string; detail: string }> {
  const result = await runDoctor(
    cwd,
    { json: true, offline: true },
    {
      write: vi.fn(),
      setExitCode: vi.fn(),
      runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
    }
  );
  const check = result.checks.find(candidate => candidate.name === CHECK_NAME);
  if (check === undefined) {
    throw new Error(`doctor did not run the "${CHECK_NAME}" check`);
  }
  return check;
}

describe("doctor learnings-ledger check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("passes when only the canonical ledger exists", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY]);
    const check = await ledgerCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toContain(CANONICAL_LEDGER);
  });

  it("fails when a populated second ledger sits in a rules tree", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, []);
    await writeLedger(tempDir, CLAUDE_RULES_LEDGER, [ENTRY]);
    const check = await ledgerCheck(tempDir);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain(CLAUDE_RULES_LEDGER);
    expect(check.detail).toContain("1 entr");
    expect(check.detail).toContain(CANONICAL_LEDGER);
  });

  it("gives repair guidance naming the canonical file and the deletion step", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, []);
    await writeLedger(tempDir, CLAUDE_RULES_LEDGER, [ENTRY]);
    const check = await ledgerCheck(tempDir);
    expect(check.detail).toMatch(/copy[\s\S]*then delete/iu);
  });

  it("warns rather than fails when the only stray is empty", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY]);
    await writeLedger(tempDir, CLAUDE_RULES_LEDGER, []);
    const check = await ledgerCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(CLAUDE_RULES_LEDGER);
  });

  it("fails when a stray cannot be counted, because content may be at risk", async () => {
    await writeLedger(tempDir, CANONICAL_LEDGER, [ENTRY]);
    await fse.outputFile(
      path.join(tempDir, CLAUDE_RULES_LEDGER),
      "# Project Learnings\n\nhand-edited prose\n"
    );
    const check = await ledgerCheck(tempDir);
    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/unknown|unreadable/iu);
  });
});
