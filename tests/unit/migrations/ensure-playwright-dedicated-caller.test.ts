/**
 * Tests the retrofit that repoints a project's seeded Playwright caller.
 *
 * The seeded caller lives in the create-only lane, which `src/core/lisa.ts`
 * skips whenever the destination exists. Editing the template therefore reaches
 * greenfield projects ONLY — "fixed upstream" and "a version bump carries it"
 * are independent claims in that lane. This migration is the second claim.
 *
 * The interesting half is what it refuses to do. Most `ensure-*` migrations add
 * something absent; this one REWRITES a file the host owns, so the tests pin
 * both directions: the rewrite fires on a shape Lisa recognises, and a caller
 * carrying host intent Lisa cannot honour is left byte-identical and reported.
 * @module tests/unit/migrations/ensure-playwright-dedicated-caller
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import type { ILogger } from "../../../src/logging/index.js";
import {
  DECLARED_INPUTS,
  EnsurePlaywrightDedicatedCallerMigration,
} from "../../../src/migrations/ensure-playwright-dedicated-caller.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { loadWorkflow } from "../../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Basename shared by the seeded caller and the workflow it calls. */
const PLAYWRIGHT_YML = "playwright-e2e.yml";

const CALLER_FILE = path.join(".github", "workflows", PLAYWRIGHT_YML);

/** The complete environment facade declaration used by idempotency fixtures. */
const FACADE_SCRIPTS = ["environment:reset", "environment:reseed"] as const;

/**
 * Everything below `jobs:` in a seeded caller.
 * @param uses - The reusable workflow reference the caller targets
 * @param extra - Additional `with:` lines, already indented
 * @returns The `jobs:` block as YAML text
 */
function jobsBlock(uses: string, extra: string): string {
  return `
jobs:
  playwright:
    name: 🎭 Playwright Web E2E
    uses: ${uses}
    with:
      node_version: '22.21.1'
      package_manager: 'bun'
      moment: 'continuous:development'
      concurrency_group: 'e2e-shared-development'
${extra}      playwright_shards: 2
      cache_build: false
      playwright_setup_command: |
        cp .env.development .env.local
`;
}

const HEADER = `# Seeded by Lisa on first setup — this file is YOURS.

name: 🎭 Playwright Web E2E

on:
  schedule:
    - cron: '0 7 * * *'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: playwright-e2e-development
  cancel-in-progress: false
`;

/** The `skip_jobs` inversion a stale caller carries, with its seeded prose. */
const SKIP_JOBS = `      # A KNOWN-BAD SHAPE: it names the jobs it does not want.
      skip_jobs: 'bdd_coverage,build,dead_code,lint,maestro_e2e,test:unit,typecheck'
`;

/** The shape every project installed before the split still holds. */
const STALE_CALLER =
  HEADER +
  jobsBlock("CodySwannGT/lisa/.github/workflows/quality.yml@main", SKIP_JOBS);

/** The same caller, pinned to a tag rather than tracking a branch. */
const STALE_CALLER_PINNED =
  HEADER +
  jobsBlock(
    "CodySwannGT/lisa/.github/workflows/quality.yml@v3.19.1",
    SKIP_JOBS
  );

/** A caller that already targets the dedicated workflow. */
const CURRENT_CALLER =
  HEADER +
  jobsBlock(
    "CodySwannGT/lisa/.github/workflows/playwright-e2e.yml@main",
    "      prepare_environment: 'development'\n      prepare_verbs: 'reset,reseed'\n"
  );

/**
 * A caller the host diverged: it asks the shared workflow for something the
 * dedicated one does not declare, so repointing it would break dispatch.
 */
const DIVERGED_CALLER =
  HEADER +
  jobsBlock(
    "CodySwannGT/lisa/.github/workflows/quality.yml@main",
    `${SKIP_JOBS}      sonar_project_key: 'host-chosen-key'\n`
  );

/** An ILogger that keeps what it was told, so the tests can read the report. */
class RecordingLogger implements ILogger {
  readonly messages: { level: string; message: string }[] = [];

  /**
   * Record an informational message.
   * @param message - Text logged
   */
  info(message: string): void {
    this.messages.push({ level: "info", message });
  }

  /**
   * Record a success message.
   * @param message - Text logged
   */
  success(message: string): void {
    this.messages.push({ level: "success", message });
  }

  /**
   * Record a warning message.
   * @param message - Text logged
   */
  warn(message: string): void {
    this.messages.push({ level: "warn", message });
  }

  /**
   * Record an error message.
   * @param message - Text logged
   */
  error(message: string): void {
    this.messages.push({ level: "error", message });
  }

  /**
   * Record a dry-run message.
   * @param message - Text logged
   */
  dry(message: string): void {
    this.messages.push({ level: "dry", message });
  }

  /**
   * Every message recorded at the given level.
   * @param level - Level to filter by
   * @returns The message texts, in order
   */
  at(level: string): readonly string[] {
    return this.messages
      .filter(entry => entry.level === level)
      .map(entry => entry.message);
  }
}

describe("EnsurePlaywrightDedicatedCallerMigration", () => {
  let migration: EnsurePlaywrightDedicatedCallerMigration;
  let tempDir: string;
  let projectDir: string;
  let logger: RecordingLogger;

  beforeEach(async () => {
    migration = new EnsurePlaywrightDedicatedCallerMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    logger = new RecordingLogger();
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for testing.
   * @param dryRun - Whether to run in dry-run mode
   * @param detectedTypes - Detected project types
   * @returns A migration context suitable for tests
   */
  function createContext(
    dryRun = false,
    detectedTypes: readonly ProjectType[] = ["expo"]
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: path.join(tempDir, "lisa"),
      detectedTypes,
      dryRun,
      logger,
    };
  }

  /**
   * Write the project's seeded caller.
   * @param content - File contents
   */
  async function writeCaller(content: string): Promise<void> {
    await fs.writeFile(path.join(projectDir, CALLER_FILE), content);
  }

  /**
   * Read the project's seeded caller back.
   * @returns Current file contents
   */
  async function readCaller(): Promise<string> {
    return fs.readFile(path.join(projectDir, CALLER_FILE), "utf8");
  }

  /**
   * Declare the environment facade scripts in the project's package.json.
   * @param scripts - Script names to declare
   */
  async function writeScripts(scripts: readonly string[]): Promise<void> {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "project",
      scripts: Object.fromEntries(scripts.map(name => [name, "echo run"])),
    });
  }

  describe("a stale caller", () => {
    it("repoints the caller at the dedicated Playwright workflow", async () => {
      await writeCaller(STALE_CALLER);

      expect(await migration.applies(createContext())).toBe(true);
      const result = await migration.apply(createContext());
      expect(result.action).toBe("applied");

      const after = await readCaller();
      expect(after).toContain(
        "uses: CodySwannGT/lisa/.github/workflows/playwright-e2e.yml@main"
      );
      expect(after).not.toContain("quality.yml@");
    });

    it("drops the retired skip_jobs inversion and its prose", async () => {
      await writeCaller(STALE_CALLER);

      await migration.apply(createContext());

      const after = await readCaller();
      expect(after).not.toContain("skip_jobs");
      expect(after).not.toContain("A KNOWN-BAD SHAPE");
      // Everything else the caller passed is host configuration and survives.
      expect(after).toContain("cp .env.development .env.local");
      expect(after).toContain("concurrency_group: 'e2e-shared-development'");
    });

    it("preserves a pinned ref rather than moving the project onto @main", async () => {
      await writeCaller(STALE_CALLER_PINNED);

      await migration.apply(createContext());

      expect(await readCaller()).toContain(
        "uses: CodySwannGT/lisa/.github/workflows/playwright-e2e.yml@v3.19.1"
      );
    });

    it("requires the complete environment lifecycle", async () => {
      await writeScripts(FACADE_SCRIPTS);
      await writeCaller(STALE_CALLER);

      await migration.apply(createContext());

      const after = await readCaller();
      expect(after).toContain("prepare_environment: 'development'");
      expect(after).toContain("prepare_verbs: 'reset,reseed'");
    });

    it("does not hide missing facade scripts by leaving the environment unprepared", async () => {
      await writeCaller(STALE_CALLER);

      const result = await migration.apply(createContext());

      const after = await readCaller();
      expect(after).toContain("prepare_environment: 'development'");
      expect(after).toContain("prepare_verbs: 'reset,reseed'");
      expect(result.message).toContain("complete environment lifecycle");
    });

    it("produces a caller whose inputs the dedicated workflow all declare", async () => {
      await writeScripts(FACADE_SCRIPTS);
      await writeCaller(STALE_CALLER);

      await migration.apply(createContext());

      const callee = loadWorkflow(
        path.join(REPO_ROOT, ".github", "workflows", PLAYWRIGHT_YML)
      );
      const declared = Object.keys(callee.on?.workflow_call?.inputs ?? {});
      expect(declared.length).toBeGreaterThan(0);

      const after = loadWorkflow(path.join(projectDir, CALLER_FILE));
      const passed = Object.keys(after.jobs.playwright?.with ?? {});
      expect(passed.length).toBeGreaterThan(0);
      expect(passed.filter(key => !declared.includes(key))).toEqual([]);
    });

    it("reports the retrofit rather than changing the file silently", async () => {
      await writeCaller(STALE_CALLER);

      await migration.apply(createContext());

      expect(logger.at("success").join("\n")).toContain(
        "pointed it at the dedicated Playwright workflow"
      );
    });

    it("changes nothing on disk in dry-run mode", async () => {
      await writeCaller(STALE_CALLER);

      const result = await migration.apply(createContext(true));

      expect(result.action).toBe("applied");
      expect(await readCaller()).toBe(STALE_CALLER);
      expect(logger.at("dry").join("\n")).toContain(CALLER_FILE);
    });
  });

  describe("an already-current caller", () => {
    it("does not apply", async () => {
      await writeCaller(CURRENT_CALLER);

      expect(await migration.applies(createContext())).toBe(false);
    });

    it("is a no-op when applied anyway", async () => {
      await writeCaller(CURRENT_CALLER);

      const result = await migration.apply(createContext());

      expect(result.action).toBe("noop");
      expect(await readCaller()).toBe(CURRENT_CALLER);
    });

    it("is what a second run of the retrofit produces", async () => {
      await writeScripts(FACADE_SCRIPTS);
      await writeCaller(STALE_CALLER);

      await migration.apply(createContext());
      const afterFirst = await readCaller();

      expect(await migration.applies(createContext())).toBe(false);
      await migration.apply(createContext());
      expect(await readCaller()).toBe(afterFirst);
    });
  });

  describe("a diverged caller", () => {
    it("is left byte-identical", async () => {
      await writeCaller(DIVERGED_CALLER);

      await migration.apply(createContext());

      expect(await readCaller()).toBe(DIVERGED_CALLER);
    });

    it("is reported, naming the input that blocked the retrofit", async () => {
      await writeCaller(DIVERGED_CALLER);

      const result = await migration.apply(createContext());

      expect(result.action).toBe("skipped");
      expect(result.message).toContain("sonar_project_key");
      expect(logger.at("warn").join("\n")).toContain("sonar_project_key");
    });

    it("still applies, so the report is reached rather than skipped in silence", async () => {
      await writeCaller(DIVERGED_CALLER);

      expect(await migration.applies(createContext())).toBe(true);
    });
  });

  describe("a project this retrofit has no business touching", () => {
    it("does not apply when there is no seeded caller at all", async () => {
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("does not apply when the file calls no Lisa workflow", async () => {
      await writeCaller(
        `${HEADER}\njobs:\n  playwright:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx playwright test\n`
      );

      expect(await migration.applies(createContext())).toBe(false);
    });
  });

  it("knows exactly the inputs the dedicated workflow declares", () => {
    // `.github/` is not in the npm `files` allowlist, so the migration cannot
    // read the callee at runtime and carries a hardcoded copy of its input set.
    // This is the only thing keeping that copy honest: an input added or
    // renamed upstream would otherwise turn every caller passing it into a
    // "diverged" verdict that nothing ever retrofits.
    const callee = loadWorkflow(
      path.join(REPO_ROOT, ".github", "workflows", PLAYWRIGHT_YML)
    );
    const declared = Object.keys(callee.on?.workflow_call?.inputs ?? {});
    expect(declared.length).toBeGreaterThan(0);
    expect([...DECLARED_INPUTS].sort((a, b) => a.localeCompare(b))).toEqual(
      [...declared].sort((a, b) => a.localeCompare(b))
    );
  });

  it("is registered in the default migration registry", () => {
    const names = createMigrationRegistry()
      .getAll()
      .map(entry => entry.name);
    expect(names).toContain("ensure-playwright-dedicated-caller");
  });
});
