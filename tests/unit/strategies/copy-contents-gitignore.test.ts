import * as fs from "fs-extra";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GITIGNORE = ".gitignore";
const DOTLESS = "gitignore";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";
const GIT_BIN = "/usr/bin/git";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VERIFICATION_STATUS = ".lisa/verification-status.json";
const STANDARDS_PROOF = ".lisa/standards/latest.json";
const ROSTER = ".lisa/roster.md";
const CROSS_POLLINATION_LOCK = ".lisa/cross-pollination.lock.json";
const AUTOMATION_RUN_RECORD = ".lisa/automations/runs/probe-loop.jsonl";
const AUTOMATION_RUNBOOK = ".lisa/automations/probe-loop.runbook.md";
const CHECK_IGNORE = "check-ignore";
const SHARED_TEMPLATE = "all/copy-contents/gitignore";

/**
 * Return an isolated environment for git commands run inside temp fixtures.
 * @returns Process environment without hook-provided repository overrides.
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

describe("CopyContentsStrategy — dotless gitignore shipping", () => {
  let strategy: CopyContentsStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyContentsStrategy();
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
   * Create a strategy context for testing.
   * @returns Strategy context with test defaults
   */
  function createContext(): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  it("restores a dotless `gitignore` template to `.gitignore` at the destination", async () => {
    // npm strips .gitignore from published tarballs, so templates ship as
    // `gitignore` (no dot). The core passes that dotless name through; the
    // strategy must write the real dotfile so downstream projects get it.
    const srcFile = path.join(srcDir, DOTLESS);
    const destFile = path.join(destDir, DOTLESS);
    const sourceContent = `${BEGIN_MARKER}\nnode_modules\n${END_MARKER}\n`;
    await fs.writeFile(srcFile, sourceContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(result.relativePath).toBe(GITIGNORE);
    expect(await fs.pathExists(path.join(destDir, GITIGNORE))).toBe(true);
    expect(await fs.pathExists(destFile)).toBe(false);
    expect(await fs.readFile(path.join(destDir, GITIGNORE), "utf-8")).toBe(
      sourceContent
    );
  });

  it("merges a dotless `gitignore` template into an existing `.gitignore`", async () => {
    const srcFile = path.join(srcDir, DOTLESS);
    const destFile = path.join(destDir, DOTLESS);
    const destGitignore = path.join(destDir, GITIGNORE);
    await fs.writeFile(
      srcFile,
      `${BEGIN_MARKER}\nnode_modules\n${END_MARKER}\n`
    );
    await fs.writeFile(destGitignore, "custom-entry\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );

    expect(result.action).toBe("merged");
    expect(result.relativePath).toBe(GITIGNORE);
    expect(await fs.pathExists(destFile)).toBe(false);
    const merged = await fs.readFile(destGitignore, "utf-8");
    expect(merged).toContain("custom-entry");
    expect(merged).toContain("node_modules");
  });

  it("ignores only the transient verification verdict and preserves host rules on re-apply", async () => {
    const srcFile = path.join(REPO_ROOT, SHARED_TEMPLATE);
    const destFile = path.join(destDir, DOTLESS);
    const destGitignore = path.join(destDir, GITIGNORE);
    const hostRule = "host-owned-cache/";
    await fs.writeFile(
      destGitignore,
      [
        "# Host rules before Lisa",
        hostRule,
        "",
        BEGIN_MARKER,
        "old-lisa-rule/",
        END_MARKER,
        "",
        "# Host rules after Lisa",
        "host-owned-output/",
        "",
      ].join("\n")
    );

    const first = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );
    const second = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );

    expect(first.action).toBe("merged");
    expect(second.action).toBe("skipped");
    const merged = await fs.readFile(destGitignore, "utf-8");
    expect(merged).toContain("# Host rules before Lisa\nhost-owned-cache/");
    expect(merged).toContain("# Host rules after Lisa\nhost-owned-output/");
    expect(merged).not.toContain("old-lisa-rule/");

    await fs.outputFile(path.join(destDir, VERIFICATION_STATUS), "{}\n");
    await fs.outputFile(path.join(destDir, STANDARDS_PROOF), "{}\n");
    await fs.outputFile(path.join(destDir, ROSTER), "# Roster\n");
    await fs.outputFile(path.join(destDir, CROSS_POLLINATION_LOCK), "{}\n");
    const gitEnv = cleanGitEnv();
    execFileSync(GIT_BIN, ["init", "-q"], {
      cwd: destDir,
      env: gitEnv,
    });

    const verdict = spawnSync(
      GIT_BIN,
      [CHECK_IGNORE, "-q", VERIFICATION_STATUS],
      { cwd: destDir, env: gitEnv }
    );
    const roster = spawnSync(GIT_BIN, [CHECK_IGNORE, "-q", ROSTER], {
      cwd: destDir,
      env: gitEnv,
    });
    const standards = spawnSync(
      GIT_BIN,
      [CHECK_IGNORE, "-q", STANDARDS_PROOF],
      { cwd: destDir, env: gitEnv }
    );
    const lock = spawnSync(
      GIT_BIN,
      [CHECK_IGNORE, "-q", CROSS_POLLINATION_LOCK],
      { cwd: destDir, env: gitEnv }
    );
    const status = execFileSync(
      GIT_BIN,
      ["status", "--short", "--untracked-files=all"],
      { cwd: destDir, env: gitEnv, encoding: "utf8" }
    );

    expect(verdict.status).toBe(0);
    expect(standards.status).toBe(0);
    expect(roster.status).toBe(1);
    expect(lock.status).toBe(1);
    expect(status).not.toContain(VERIFICATION_STATUS);
    expect(status).not.toContain(STANDARDS_PROOF);
    expect(status).toContain(ROSTER);
    expect(status).toContain(CROSS_POLLINATION_LOCK);
  });

  it("ignores automation run records but keeps runbooks trackable in a real repo", async () => {
    // Test hardened to kill mutant M001 (Risk Factor: host-project git hygiene /
    // over-broad ignore). Rule-text pins can pass while the *effective* ignore
    // set is wrong — an over-broad `.lisa/automations/` rule would also swallow
    // runbooks (RBC-2 project knowledge). Materialize the shipped template and
    // let git adjudicate: a run record MUST be ignored, a runbook MUST NOT be.
    const srcFile = path.join(REPO_ROOT, SHARED_TEMPLATE);
    const destFile = path.join(destDir, DOTLESS);
    await strategy.apply(srcFile, destFile, DOTLESS, createContext());

    const gitEnv = cleanGitEnv();
    execFileSync(GIT_BIN, ["init", "-q"], { cwd: destDir, env: gitEnv });
    await fs.outputFile(path.join(destDir, AUTOMATION_RUN_RECORD), "{}\n");
    await fs.outputFile(path.join(destDir, AUTOMATION_RUNBOOK), "# runbook\n");

    const runRecord = spawnSync(
      GIT_BIN,
      [CHECK_IGNORE, "-q", AUTOMATION_RUN_RECORD],
      { cwd: destDir, env: gitEnv }
    );
    const runbook = spawnSync(
      GIT_BIN,
      [CHECK_IGNORE, "-q", AUTOMATION_RUNBOOK],
      {
        cwd: destDir,
        env: gitEnv,
      }
    );
    const status = execFileSync(
      GIT_BIN,
      ["status", "--short", "--untracked-files=all"],
      { cwd: destDir, env: gitEnv, encoding: "utf8" }
    );

    expect(runRecord.status).toBe(0);
    expect(runbook.status).toBe(1);
    expect(status).not.toContain(AUTOMATION_RUN_RECORD);
    expect(status).toContain(AUTOMATION_RUNBOOK);
  });
});

describe("all/copy-contents/gitignore shipped content", () => {
  const readShared = (): string =>
    fs.readFileSync(path.join(REPO_ROOT, SHARED_TEMPLATE), "utf-8");

  it("orders the broad tasks.json ignore before the re-include (last-match-wins)", () => {
    // gitignore is last-match-wins: a broad `tasks.json` after `!tasks/tasks.json`
    // would re-ignore the tracked file. The broad rule must come first. Compare
    // the actual rule lines (comments may mention either token).
    const rules = readShared()
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
    const broad = rules.indexOf("tasks.json");
    const reinclude = rules.indexOf("!tasks/tasks.json");
    expect(broad).toBeGreaterThan(-1);
    expect(reinclude).toBeGreaterThan(-1);
    expect(broad).toBeLessThan(reinclude);
  });

  it("ignores the NestJS boot-check scratch dir", () => {
    // .build-boot/ is written by the NestJS pre-push AppModule boot check and
    // must not be caught by `git add -A`.
    expect(readShared()).toContain(".build-boot/");
  });

  it("ignores the verification verdict without ignoring the whole .lisa directory", () => {
    const rules = readShared()
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
    expect(rules).toContain(VERIFICATION_STATUS);
    expect(rules).not.toContain(".lisa/");
  });

  it("ignores automation run records while keeping runbooks trackable", () => {
    // Test hardened to kill mutant M002 (Risk Factor: host-project git hygiene /
    // over-broad ignore). Fast rule-text guard for the behavioral check above.
    // Host projects run the automation loops that write
    // .lisa/automations/runs/<loop-id>.jsonl; those local scheduler
    // observations must be ignored. Runbooks (.lisa/automations/*.runbook.md)
    // are project knowledge and must stay trackable, so the rule targets only
    // the runs/ subdirectory — never the whole automations directory.
    const rules = readShared()
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
    expect(rules).toContain(".lisa/automations/runs/");
    expect(rules).not.toContain(".lisa/automations/");
  });
});
