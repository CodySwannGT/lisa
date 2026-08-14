/**
 * A version bump has to deliver an enforcement gate that is not named `lisa-`.
 *
 * `copy-overwrite-lisa-owned-guards.test.ts` proves the refresh path works for
 * an artifact carrying the `lisa-` namespace. That leaves the thing #2551 is
 * actually about unproved: whether a gate Lisa ships *without* the namespace
 * reaches an adopter who already has the file. Asserting the predicate and the
 * provenance verdict separately is not the same claim — it is two facts that
 * ought to compose, and "ought to compose" is how the original defect survived a
 * green suite.
 *
 * So these drive `CopyOverwriteStrategy` end to end, on the real shipped bytes
 * of `scripts/check-state-classification.mjs`, against the **real** hash ledger
 * rather than an injected fixture. Both cases pivot on the shipped bytes the
 * ledger records: the host running them and Lisa moving ahead, and the host
 * having edited them. Neither reads git history, because `--follow` returns a
 * single revision under CI's shallow clone — a history-based fixture passes
 * locally and asserts nothing where it matters.
 * @module tests/unit/strategies/copy-overwrite-enforcement-scripts
 */
import * as path from "node:path";

import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const GATE = "scripts/check-state-classification.mjs";
const GATE_SOURCE = `all/copy-overwrite/${GATE}`;

describe("CopyOverwriteStrategy: enforcement gates without a lisa- segment", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * The context a postinstall apply runs with: non-interactive, no opt-in flag.
   *
   * `hashLedger` is deliberately omitted so the strategy falls back to the real
   * `LISA_OWNED_HASH_LEDGER`. A fixture ledger here would let this pass while
   * the shipped one had no entry for the gate — which is exactly the state that
   * would silently clobber adopters.
   * @returns Strategy context representing a version-bump apply
   */
  function versionBumpContext(): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      harness: "claude",
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  /**
   * Stage the gate with chosen template and installed bytes.
   * @param template - Bytes Lisa ships
   * @param installed - Bytes already present in the project
   * @returns Absolute source and destination paths
   */
  async function stage(
    template: Buffer,
    installed: Buffer
  ): Promise<{ srcFile: string; destFile: string }> {
    const srcFile = path.join(srcDir, GATE);
    const destFile = path.join(destDir, GATE);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, template);
    await fs.writeFile(destFile, installed);
    return { srcFile, destFile };
  }

  it("delivers a new release of the state gate to an installed project", async () => {
    // The host runs today's released bytes — which the ledger records — and
    // Lisa publishes the next version. Deliberately not "read an older revision
    // from git": `git log --follow` yields one revision under CI's shallow
    // clone, so that fixture proves nothing there while passing locally.
    const shipped = await fs.readFile(path.join(REPO_ROOT, GATE_SOURCE));
    const nextRelease = Buffer.concat([
      shipped,
      Buffer.from("\n// next release\n"),
    ]);
    const { srcFile, destFile } = await stage(nextRelease, shipped);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GATE,
      versionBumpContext()
    );

    // Before #2551 this returned `stale` and wrote nothing, at every version
    // bump, forever — while CI ran the frozen gate and passed.
    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile)).toEqual(nextRelease);
  });

  it("keeps a state gate the project edited, rather than clobbering it", async () => {
    // The shape a real downstream hardening takes: Lisa's own file plus a line.
    // It inherits every marker Lisa's copy carries, so nothing about its
    // declarations distinguishes it — only its absence from the ledger does.
    const shipped = await fs.readFile(path.join(REPO_ROOT, GATE_SOURCE));
    const hardened = Buffer.concat([
      shipped,
      Buffer.from("\n// locally hardened\n"),
    ]);
    const { srcFile, destFile } = await stage(shipped, hardened);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GATE,
      versionBumpContext()
    );

    expect(result.action).toBe("host-ahead");
    expect(await fs.readFile(destFile)).toEqual(hardened);
    expect(result.note).toContain("Kept yours");
  });
});
