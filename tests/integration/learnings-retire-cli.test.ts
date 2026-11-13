/**
 * `lisa learnings-retire`, run as a real process against an over-cap ledger
 * (CodySwannGT/lisa#4536).
 *
 * The unit suites drive `runLearningsRetire` in-process. This one spawns the
 * built CLI, because the operator-facing contract is the process: its exit
 * code, its JSON, and the bytes left on disk. The ledger starts over
 * `maxTokens` — the state the retire exists to repair, and the state that
 * locked every writer out before the fix.
 *
 * - A well-formed but stale fingerprint exits 1 and changes no byte of the
 *   ledger and creates no overflow file.
 * - The right fingerprint exits 0, reports `retired`, strictly shrinks the
 *   ledger, leaves every other entry byte-identical, and the result still
 *   parses through the tolerant read.
 * @module tests/integration/learnings-retire-cli
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../src/core/learnings-contract.js";
import {
  LearningsBudgetError,
  parseLearningsFile,
  renderLearningsFile,
} from "../../src/core/learnings-document.js";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLI = path.join(__dirname, "..", "..", "dist", "index.js");
const CLI_TIMEOUT_MS = ioLatencyBudgetMs(60_000);
const ENTRY_COUNT = 20;
const WHY_LENGTH = 760;
const TARGET_INDEX = 5;

/**
 * Build one valid learning entry.
 * @param index - Stable numeric suffix
 * @returns Eight-field entry
 */
function entry(index: number) {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `gotcha-${suffix}`,
    fingerprint: `fp-gotcha-${suffix}-v1`,
    rule: `Always run the migration dry-run before deploying service ${index}.`,
    why: `Deploy ${index} broke because the dry-run was skipped; `
      .repeat(WHY_LENGTH)
      .slice(0, WHY_LENGTH),
    provenance: [`issue:#${1000 + index}`],
    first_learned: "2026-10-01",
    last_confirmed: "2026-10-01",
    confidence: "high",
  } as const;
}

const TARGET = entry(TARGET_INDEX);

/**
 * Run `lisa learnings-retire` in the project.
 * @param cwd - Project root
 * @param fingerprint - Fingerprint to pass
 * @returns Exit status and both streams
 */
function retire(cwd: string, fingerprint: string) {
  const result = spawnSync(
    process.execPath,
    [
      DIST_CLI,
      "learnings-retire",
      "--id",
      TARGET.id,
      "--fingerprint",
      fingerprint,
      "--reason",
      "proof",
    ],
    { cwd, encoding: "utf8", timeout: CLI_TIMEOUT_MS }
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Hash a file's bytes.
 * @param file - Absolute path
 * @returns Hex sha256
 */
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("lisa learnings-retire (built CLI, over-cap ledger)", () => {
  let root: string;
  let ledger: string;
  let overflow: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-retire-cli-"));
    ledger = path.join(root, ".lisa", "PROJECT_LEARNINGS.md");
    overflow = path.join(root, ".lisa", "PROJECT_LEARNINGS.overflow.md");
    mkdirSync(path.dirname(ledger), { recursive: true });
    const entries = Array.from({ length: ENTRY_COUNT }, (_, k) => entry(k + 1));
    writeFileSync(ledger, renderLearningsFile(entries));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("starts from a valid ledger the default read refuses as over budget", () => {
    expect(existsSync(DIST_CLI)).toBe(true);
    const content = readFileSync(ledger, "utf8");
    expect(Buffer.byteLength(content)).toBeGreaterThan(
      LEARNINGS_CONTRACT.maxTokens
    );
    expect(() => parseLearningsFile(content)).toThrow(LearningsBudgetError);
    expect(parseLearningsFile(content, { allowOverBudget: true })).toHaveLength(
      ENTRY_COUNT
    );
  });

  it(
    "exits 1 on a stale fingerprint and writes nothing",
    () => {
      const before = sha256(ledger);
      const run = retire(root, "fp-gotcha-05-v2");
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout)).toMatchObject({
        status: "stale",
        id: TARGET.id,
        actualFingerprint: TARGET.fingerprint,
      });
      expect(sha256(ledger)).toBe(before);
      expect(existsSync(overflow)).toBe(false);
    },
    CLI_TIMEOUT_MS
  );

  it(
    "exits 0 on the right fingerprint and strictly shrinks the ledger",
    () => {
      const beforeText = readFileSync(ledger, "utf8");
      const beforeEntries = parseLearningsFile(beforeText, {
        allowOverBudget: true,
      });
      const run = retire(root, TARGET.fingerprint);
      expect(run.status).toBe(0);
      const proof = JSON.parse(run.stdout);
      expect(proof).toMatchObject({ status: "retired", id: TARGET.id });
      const afterText = readFileSync(ledger, "utf8");
      expect(Buffer.byteLength(afterText)).toBeLessThan(
        Buffer.byteLength(beforeText)
      );
      expect(proof.reason).toBe("proof");
      expect(proof.retired.id).toBe(TARGET.id);
      const afterEntries = parseLearningsFile(afterText, {
        allowOverBudget: true,
      });
      expect(afterEntries).toEqual(
        beforeEntries.filter(current => current.id !== TARGET.id)
      );
      expect(existsSync(overflow)).toBe(false);
    },
    CLI_TIMEOUT_MS
  );
});
