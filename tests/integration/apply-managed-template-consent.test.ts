/** Real orchestrator, prompter, strategies and backups; Git is an explicit no-op collaborator. */
import * as fs from "fs-extra";
import * as path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import {
  BackupService,
  DryRunBackupService,
} from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const OVERWRITES = ["vitest.config.ts", ".prettierignore"];
const HOOKS = [".husky/pre-push", ".husky/post-checkout"];
const CURATED = ["knip.json", "audit.ignore.config.json"];
const OLD = "previous installed template\n";
const NEW = "// This file IS replaced on each lisa run.\ncurrent-template\n";
const BEGIN = "# BEGIN: AI GUARDRAILS";
const END = "# END: AI GUARDRAILS";
const PREFIX = "#!/bin/sh\n# host-owned prefix\n";
const SUFFIX = "# host-owned suffix\n";
const OLD_HOOK = `${PREFIX}${BEGIN}\nprevious-hook\n${END}\n${SUFFIX}`;
const CURRENT_BLOCK = `${BEGIN}\ncurrent-hook\n${END}\n`;
const NEW_HOOK = PREFIX + CURRENT_BLOCK + SUFFIX;
const HOST_CONFIG = '{"host-owned":["retain-this"]}\n';
const TARGETS = [...OVERWRITES, ...HOOKS, ...CURATED];

/**
 * Expected fixture bytes after a successful explicit apply.
 * @param relative Target path.
 * @returns Current bytes.
 */
function currentContents(relative: string): string {
  if (OVERWRITES.includes(relative)) return NEW;
  return HOOKS.includes(relative) ? NEW_HOOK : HOST_CONFIG;
}

/**
 * Original fixture bytes, also the required persistent backup.
 * @param relative Target path.
 * @returns Prior bytes.
 */
function originalContents(relative: string): string {
  if (HOOKS.includes(relative)) return OLD_HOOK;
  return CURATED.includes(relative) ? HOST_CONFIG : OLD;
}

describe("managed-template consent through Lisa.apply (#4759)", () => {
  const originalTty = process.stdin.isTTY;
  let root: string;
  let lisaDir: string;
  let destDir: string;

  beforeAll(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  });
  afterAll(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalTty,
      configurable: true,
    });
  });
  beforeEach(async () => {
    root = await createTempDir();
    lisaDir = path.join(root, "templates");
    destDir = path.join(root, "host");
    for (const relative of TARGETS) await seed(relative);
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "owned-template-fixture",
      version: "1.0.0",
    });
    await fs.writeJson(path.join(destDir, "tsconfig.json"), {});
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Populate one fixture-owned template and its original host file.
   * @param relative Target path.
   */
  async function seed(relative: string): Promise<void> {
    const hook = HOOKS.includes(relative);
    const strategy = hook ? "copy-contents" : "copy-overwrite";
    const source = hook
      ? CURRENT_BLOCK
      : CURATED.includes(relative)
        ? '{"upstream":true}\n'
        : NEW;
    await fs.outputFile(
      path.join(lisaDir, "typescript", strategy, relative),
      source
    );
    await fs.outputFile(
      path.join(destDir, relative),
      originalContents(relative)
    );
  }

  /**
   * Read every actual persistent backup for a target.
   * @param relative Target path.
   * @returns Backup byte strings.
   */
  async function backupsFor(relative: string): Promise<string[]> {
    const backups = [];
    for (const directory of await fs.readdir(path.join(destDir, ".lisabak"))) {
      const file = path.join(destDir, ".lisabak", directory, relative);
      if (await fs.pathExists(file))
        backups.push(await fs.readFile(file, "utf8"));
    }
    return backups;
  }

  /**
   * The minimal Claude fixture has no settings.json or plugins to register;
   * Claude emits only fixture-owned AGENTS.md/CLAUDE.md. No vendor is launched.
   * @param skipGitCheck Dirty-tree waiver input, independent of the real prompter.
   * @param dryRun Whether to measure without writes.
   * @returns Real orchestrator result.
   */
  async function apply(skipGitCheck: boolean, dryRun = false) {
    const logger = new SilentLogger();
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun,
      yesMode: true,
      validateOnly: false,
      skipGitCheck,
      harness: "claude",
    };
    return new Lisa(config, {
      logger,
      prompter: createPrompter(config.yesMode),
      backupService: dryRun
        ? new DryRunBackupService()
        : new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    }).apply();
  }

  it.each([false, true])(
    "refreshes four files, preserves two, and backs up once: skipGitCheck=%s",
    async skipGitCheck => {
      const first = await apply(skipGitCheck);
      expect(first.success).toBe(true);
      for (const relative of TARGETS) {
        expect(await fs.readFile(path.join(destDir, relative), "utf8")).toBe(
          currentContents(relative)
        );
        expect(first.stalePaths.includes(relative)).toBe(
          CURATED.includes(relative)
        );
      }
      const second = await apply(skipGitCheck);
      expect(second.success).toBe(true);
      for (const relative of TARGETS) {
        expect(await backupsFor(relative)).toEqual(
          CURATED.includes(relative) ? [] : [originalContents(relative)]
        );
        expect(await fs.readFile(path.join(destDir, relative), "utf8")).toBe(
          currentContents(relative)
        );
      }
    }
  );

  it("dry-run changes none of the six files and creates no backups", async () => {
    const before = await Promise.all(
      TARGETS.map(relative => fs.readFile(path.join(destDir, relative)))
    );
    expect((await apply(true, true)).success).toBe(true);
    for (const [index, relative] of TARGETS.entries()) {
      expect(await fs.readFile(path.join(destDir, relative))).toEqual(
        before[index]
      );
    }
    expect(await fs.pathExists(path.join(destDir, ".lisabak"))).toBe(false);
  });
});
