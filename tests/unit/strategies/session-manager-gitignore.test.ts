/**
 * Ignore contract for session-manager machine state (CodySwannGT/lisa#4448).
 *
 * The session manager keeps a per-machine ledger of the workers it spawned
 * under `.lisa/session-manager/`. Committing it would collide across machines
 * and tell a teammate nothing they can act on. The manager's runbook lives in
 * `.lisa/automations/session-manager.runbook.md` and is project knowledge, so
 * it must stay trackable — an over-broad rule would silently swallow it.
 *
 * Rule text can look right while the effective ignore set is wrong, so git
 * adjudicates: once against the shipped template materialized by the real
 * copy-contents strategy, and once against this repository's own `.gitignore`,
 * which PROJECT_RULES requires to change together with the template. Kept out
 * of `copy-contents-gitignore.test.ts` only because that file is at the
 * max-lines limit.
 * @module tests/unit/strategies/session-manager-gitignore
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { devNull } from "node:os";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT_BIN = resolveGit();
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SHARED_TEMPLATE = "all/copy-contents/gitignore";
const STATE_DIR_RULE = ".lisa/session-manager/";
const LEDGER = ".lisa/session-manager/ledger.json";
const RUNBOOK = ".lisa/automations/session-manager.runbook.md";

/**
 * Return an environment that isolates git from global config and hook-provided
 * repository overrides.
 * @returns Process environment for git commands in temp fixtures
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
}

/**
 * Ask git whether a path is ignored.
 * @param cwd - Repository directory
 * @param relativePath - Path to test, relative to cwd
 * @param env - Environment for the git process
 * @returns The `git check-ignore` exit status (0 ignored, 1 not ignored)
 */
function checkIgnore(
  cwd: string,
  relativePath: string,
  env: NodeJS.ProcessEnv
): number | null {
  return boundedSpawnSync({
    label: `git check-ignore ${relativePath}`,
    command: GIT_BIN,
    args: ["check-ignore", "-q", "--no-index", relativePath],
    cwd,
    env,
  }).status;
}

describe("session-manager state ignore rules", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("ships a commented `.lisa/session-manager/` rule in the template", () => {
    const lines = fs
      .readFileSync(path.join(REPO_ROOT, SHARED_TEMPLATE), "utf-8")
      .split("\n");
    const index = lines.indexOf(STATE_DIR_RULE);
    expect(index).toBeGreaterThan(0);
    expect(lines[index - 1]).toMatch(/^#/);
  });

  it("ignores the ledger but not the runbook in a host materialized from the template", async () => {
    const destDir = path.join(tempDir, "dest");
    await fs.ensureDir(destDir);
    const config: LisaConfig = {
      lisaDir: path.join(REPO_ROOT, "all"),
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    await new CopyContentsStrategy().apply(
      path.join(REPO_ROOT, SHARED_TEMPLATE),
      path.join(destDir, "gitignore"),
      "gitignore",
      { config, backupFile: async () => {}, promptOverwrite: async () => true }
    );
    const env = cleanGitEnv();
    boundedExecFileSync({
      label: "git init",
      command: GIT_BIN,
      args: ["init", "-q"],
      cwd: destDir,
      env,
    });

    expect(checkIgnore(destDir, LEDGER, env)).toBe(0);
    expect(checkIgnore(destDir, RUNBOOK, env)).toBe(1);
  });

  it("ignores the ledger but not the runbook in this repository", () => {
    expect(checkIgnore(REPO_ROOT, LEDGER, process.env)).toBe(0);
    expect(checkIgnore(REPO_ROOT, RUNBOOK, process.env)).toBe(1);
  });
});
