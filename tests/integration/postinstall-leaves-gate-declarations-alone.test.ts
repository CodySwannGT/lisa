/**
 * The reproduction from CodySwannGT/lisa#3574, driven through the real
 * orchestrator.
 *
 * `bun install` in a consumer runs a Lisa apply — that is the whole point of
 * the postinstall trampoline, and it is how template and guardrail updates
 * reach a repository that only ever bumps a dependency. What it must NOT do is
 * change the project's `.lisa.config.json` gate declarations, because those are
 * the project's statement of what its own pushes and pull requests have to
 * prove. Measured in a caller repo in the portfolio: an install added
 * `dependency-vulnerability` at `push` as `required`, five times over two days,
 * and the only trace was one modified file in `git status`.
 *
 * ## Why this is an integration test and not another unit test
 *
 * The unit tests beside the migration prove the migration declines. They cannot
 * prove that the ORCHESTRATOR tells it an install is happening — and that
 * wiring is a single field on the migration context, set in `core/lisa.ts`, the
 * kind of link that silently reverts and takes a control with it. Here the
 * apply runs for real, with the flags a package manager passes, and the
 * assertion is on the file the consumer has checked in.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/postinstall-leaves-gate-declarations-alone
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const LISA_CONFIG = ".lisa.config.json";

/** The declaration the reported install added without being asked. */
const ADDED_GATE = "dependency-vulnerability";
const ADDED_MOMENT = "push";

/**
 * The consumer's checked-in config, with `runner` where its author put it.
 * @returns A fresh copy of the fixture
 */
const fixtureConfig = (): Record<string, unknown> => ({
  harness: "claude",
  tracker: "github",
  gates: {
    "code-style": { push: "required", "pull-request": "required" },
    runner: "bun run",
    "type-correctness": { push: "required", "pull-request": "required" },
    [ADDED_GATE]: {
      "pull-request": "required",
      "continuous:production": "required",
    },
  },
});

describe("a package manager's install over a project's gate declarations", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;
  let before: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(destDir);
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "placeholder-host",
      version: "1.0.0",
      scripts: {
        "security:audit": "npm audit --production --json",
        typecheck: "tsc --noEmit",
        lint: "oxlint",
      },
    });
    await fs.writeJson(path.join(destDir, LISA_CONFIG), fixtureConfig(), {
      spaces: 2,
    });
    before = await fs.readFile(path.join(destDir, LISA_CONFIG), "utf8");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the apply with the flags Lisa's own postinstall passes: the clean-tree
   * waiver AND the declaration that this is an install lifecycle.
   * @returns Nothing; the assertion is on the file left behind
   */
  async function runPostinstallApply(): Promise<void> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      postinstall: true,
      harness: "claude",
    };
    const logger = new SilentLogger();
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    await new Lisa(config, deps).apply();
  }

  it("adds no required push gate to the checked-in declarations", async () => {
    // THE BITE. Before the fix this apply wrote `"push": "required"` into
    // `dependency-vulnerability` — a stricter contract for every developer and
    // every agent in the repository, authored by a dependency install.
    await runPostinstallApply();

    const parsed = (await fs.readJson(path.join(destDir, LISA_CONFIG))) as {
      gates: Record<string, Record<string, unknown>>;
    };

    expect(parsed.gates[ADDED_GATE]?.[ADDED_MOMENT]).toBeUndefined();
  });

  it("leaves the whole file byte-for-byte as the project committed it", async () => {
    // The guard that does not depend on knowing which key gets touched next.
    // A rewrite that LOOSENED a gate would be invisible in `git status` in
    // exactly the same way the tightening one was, so the install writes
    // nothing here at all.
    await runPostinstallApply();

    expect(await fs.readFile(path.join(destDir, LISA_CONFIG), "utf8")).toBe(
      before
    );
  });
});
