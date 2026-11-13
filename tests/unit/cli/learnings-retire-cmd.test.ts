/**
 * `lisa learnings-retire` is the gardener's RETIRE handle (CodySwannGT/lisa#4536).
 *
 * The audit skill must never hand-edit the ledger, so a RETIRE verdict needs a
 * command that carries the contract's lock, containment checks, fingerprint
 * guard, and atomic write — the same reason `learnings-overflow` exists. Output
 * is JSON for an agent consumer; anything other than an applied retire exits
 * non-zero so a script cannot mistake a refused retire for a done one.
 */
import { Command } from "commander";
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GATE_COMMAND_NAMES,
  addGateCommands,
} from "../../../src/cli/gate-commands.js";
import { runLearningsRetire } from "../../../src/cli/learnings-retire-cmd.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 * Build a compact valid entry with a stable numeric suffix.
 * @param index - Stable numeric suffix
 * @returns Valid eight-field entry
 */
function numberedEntry(index: number) {
  return {
    id: `learner-${index}`,
    fingerprint: `learner-fingerprint-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

describe("lisa learnings-retire", () => {
  let tempDir: string;
  let ledger: string;
  let out: string[];
  let err: string[];

  beforeEach(async () => {
    tempDir = await createTempDir();
    ledger = path.join(tempDir, ".lisa", "PROJECT_LEARNINGS.md");
    out = [];
    err = [];
    await persistLearningEntry(tempDir, numberedEntry(1));
    await persistLearningEntry(tempDir, numberedEntry(2));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the command with captured output.
   * @param fingerprint - Fingerprint to stamp
   * @param id - Entry id to retire
   * @returns Process exit code
   */
  function run(fingerprint: string, id = "learner-1"): Promise<number> {
    return runLearningsRetire(
      { id, fingerprint, reason: "promoted to a lint rule" },
      {
        cwd: tempDir,
        log: message => out.push(message),
        error: message => err.push(message),
      }
    );
  }

  it("retires the stamped entry and prints the proof as JSON", async () => {
    expect(await run("learner-fingerprint-1")).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload).toMatchObject({
      status: "retired",
      id: "learner-1",
      reason: "promoted to a lint rule",
      withinBudget: true,
    });
    expect(payload.bytesAfter).toBeLessThan(payload.bytesBefore);
    expect(await readFile(ledger, "utf8")).not.toContain('learner-1"');
    expect(err).toEqual([]);
  });

  it("exits non-zero on a stale fingerprint and writes nothing", async () => {
    const before = await readFile(ledger, "utf8");
    expect(await run("learner-fingerprint-x")).toBe(1);
    expect(err.join("\n")).toMatch(/^learnings-retire: .*stale/);
    expect(JSON.parse(out.join("\n")).status).toBe("stale");
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("exits non-zero on an unknown id", async () => {
    expect(await run("learner-fingerprint-9", "learner-9")).toBe(1);
    expect(err.join("\n")).toMatch(/^learnings-retire: .*not found/);
  });

  it("exits non-zero with the diagnostic on an invalid stamp", async () => {
    expect(await run("NOT A TOKEN")).toBe(1);
    expect(err.join("\n")).toMatch(
      /^learnings-retire: Invalid supersede stamp/
    );
    expect(out).toEqual([]);
  });

  it("is registered as a gate command", async () => {
    expect(GATE_COMMAND_NAMES).toContain("learnings-retire");
    const program = new Command();
    addGateCommands(program, {
      runCheckLearningsBudget: async () => 0,
      runFileUpstream: async () => 0,
    });
    const command = program.commands.find(
      candidate => candidate.name() === "learnings-retire"
    );
    expect(command?.options.map(option => option.long)).toEqual([
      "--id",
      "--fingerprint",
      "--reason",
    ]);
    expect(await fs.pathExists(ledger)).toBe(true);
  });
});
