/** Preserve an existing verification opt-in through the real template copy. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  createMigrationRegistry,
  MigrationRegistry,
} from "../../../src/migrations/index.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { stepNamed } from "../../integration/quality-gate-facade-fixture.js";

const CI = ".github/workflows/ci.yml";
const CONFIG = ".lisa.config.json";
const MIGRATION = "preserve-verification-opt-ins";
const LEGACY_LINE =
  "      verify_enforced: true # already selected by the project\n";
const DECLARATION = { level: "required", run: "check:verification" };
const CALLER = `name: CI
on: [pull_request]
jobs:
  quality:
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
    with:
      verify_enforced: true # already selected by the project
      package_manager: bun
  unrelated:
    uses: actions/example/.github/workflows/check.yml@v1
    with:
      verify_enforced: true
`;

describe("preserve-verification-opt-ins", () => {
  let projectDir: string;
  let registry: MigrationRegistry;
  beforeEach(async () => {
    projectDir = await createTempDir();
    // Before this migration exists, the old update path executes unchanged.
    registry = new MigrationRegistry(
      createMigrationRegistry()
        .getAll()
        .filter(migration => migration.name === MIGRATION)
    );
    await fs.outputFile(path.join(projectDir, CI), CALLER);
    await fs.writeJson(path.join(projectDir, CONFIG), {
      tracker: "github",
      gates: {
        runner: "bun run",
        "coverage-adequacy": { push: { level: "optional", run: "test:cov" } },
      },
    });
  });
  afterEach(async () => cleanupTempDir(projectDir));

  /**
   * Build an explicit update context.
   * @param postinstallSafe - Whether to use the legacy reduced apply mode.
   * @returns Migration context for this fixture.
   */
  function context(postinstallSafe = false): MigrationContext {
    return {
      projectDir,
      lisaDir: process.cwd(),
      detectedTypes: ["phaser", "typescript"],
      dryRun: false,
      postinstallSafe,
      logger: new SilentLogger(),
    };
  }

  /** Read the current project configuration.
   * @returns Parsed fixture configuration.
   */
  async function config() {
    return fs.readJson(path.join(projectDir, CONFIG));
  }

  it.each([false, true])(
    "keeps the prior opt-in through template updates (legacy postinstall-safe=%s)",
    async postinstallSafe => {
      const ctx = context(postinstallSafe);
      const sourcePath = path.resolve("phaser/copy-overwrite", CI);
      const template = await fs.readFile(sourcePath, "utf8");
      const previous = template.replace(
        "    with:\n",
        "    with:\n      verify_enforced: true\n"
      );
      expect(previous).not.toBe(template);
      await fs.writeFile(path.join(projectDir, CI), previous);
      await registry.runBeforeStrategies(ctx);
      const copied = await new CopyOverwriteStrategy().apply(
        sourcePath,
        path.join(projectDir, CI),
        CI,
        {
          config: {
            lisaDir: ctx.lisaDir,
            destDir: projectDir,
            dryRun: false,
            yesMode: true,
            validateOnly: false,
            skipGitCheck: postinstallSafe,
            postinstall: postinstallSafe,
            harness: "codex",
          },
          hashLedger: {
            [CI]: [createHash("sha256").update(previous).digest("hex")],
          },
          backupFile: async () => {},
          promptOverwrite: async () => true,
        }
      );
      expect(copied.action).toBe(postinstallSafe ? "stale" : "overwritten");
      expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
        postinstallSafe ? previous : template
      );
      await registry.runAll(ctx);
      expect((await config()).gates["coverage-adequacy"]).toEqual({
        push: { level: "optional", run: "test:cov" },
        "pull-request": DECLARATION,
      });
      expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
        template
      );
    }
  );

  it("migrates an existing caller without changing unrelated YAML or settings", async () => {
    await registry.runBeforeStrategies(context());
    await registry.runAll(context());
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
      CALLER.replace(LEGACY_LINE, "")
    );
    expect((await config()).tracker).toBe("github");
    expect((await config()).gates.runner).toBe("bun run");
    expect((await config()).gates["coverage-adequacy"]["pull-request"]).toEqual(
      DECLARATION
    );
    const first = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
    await registry.runAll(context());
    expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
      first
    );
  });

  it("resolves the migrated choice to the existing check with the same diff inputs", async () => {
    await registry.runBeforeStrategies(context());
    await registry.runAll(context());
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("all/copy-overwrite/scripts/lisa-gates.mjs"),
        "list",
        "--moment=pull-request",
        "--json",
        "--include-off",
      ],
      { cwd: projectDir, encoding: "utf8", timeout: 10000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toContainEqual(
      expect.objectContaining({
        id: "coverage-adequacy",
        level: "required",
        mode: "run",
        task: "check:verification",
      })
    );
    const declared = stepNamed(
      "verification_coverage",
      "✅ Run the coverage-adequacy gate"
    );
    const fallback = stepNamed(
      "verification_coverage",
      "✅ Require a verification (e2e) spec delta on feat/fix"
    );
    const manifest = await fs.readJson(
      "typescript/package-lisa/package.lisa.json"
    );
    expect(manifest.force.scripts["check:verification"]).toBe(fallback?.run);
    for (const key of ["VERIFY_BASE_SHA", "VERIFY_HEAD_SHA", "VERIFY_LABELS"]) {
      expect(declared?.env?.[key]).toBeTruthy();
      expect(declared?.env?.[key]).toBe(fallback?.env?.[key]);
    }
  });

  it.each(["required", "optional", "off"])(
    "preserves the project's explicit %s declaration",
    async level => {
      await fs.writeJson(path.join(projectDir, CONFIG), {
        gates: {
          "coverage-adequacy": {
            "pull-request": { level, run: "custom:verification" },
          },
        },
      });
      const original = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
      await registry.runBeforeStrategies(context());
      await registry.runAll(context());
      expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
        original
      );
      expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
        CALLER.replace(LEGACY_LINE, "")
      );
    }
  );

  it.each(["false", '"true"', "${{ inputs.verify }}"])(
    "does not enable a caller with input %s",
    async value => {
      const original = CALLER.replace(
        "true # already selected by the project",
        value
      );
      await fs.writeFile(path.join(projectDir, CI), original);
      const before = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
      await registry.runBeforeStrategies(context());
      await registry.runAll(context());
      expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
        before
      );
      expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
        original
      );
    }
  );

  it("does not enable an undeclared caller", async () => {
    await fs.writeFile(
      path.join(projectDir, CI),
      CALLER.replace(LEGACY_LINE, "")
    );
    const before = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
    await registry.runBeforeStrategies(context());
    await registry.runAll(context());
    expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
      before
    );
  });

  it("reports a dry run without changing either file", async () => {
    const before = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
    const ctx = { ...context(), dryRun: true };
    await registry.runBeforeStrategies(ctx);
    const result = await registry.runAll(ctx);
    expect(result.some(entry => entry.action === "applied")).toBe(true);
    expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
      before
    );
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(CALLER);
  });

  it("removes an emptied with map while preserving surrounding comments", async () => {
    const source = CALLER.replace("      package_manager: bun\n", "");
    await fs.writeFile(path.join(projectDir, CI), source);
    await registry.runBeforeStrategies(context());
    await registry.runAll(context());
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(
      source.replace(
        "    with:\n      verify_enforced: true # already selected by the project\n",
        ""
      )
    );
  });

  it("refuses malformed settings before the managed caller can be overwritten", async () => {
    await fs.writeFile(path.join(projectDir, CONFIG), "{unfinished");
    await expect(registry.runBeforeStrategies(context())).rejects.toThrow();
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(CALLER);
    expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
      "{unfinished"
    );
  });

  it("allows an unsupported caller to retry after preserving its choice manually", async () => {
    const source = CALLER.replace(
      "      package_manager: bun",
      "      package_manager: bun\n      working_directory: packages/app"
    );
    await fs.writeFile(path.join(projectDir, CI), source);
    await expect(registry.runBeforeStrategies(context())).rejects.toThrow(
      "then remove verify_enforced"
    );
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(source);
    const scoped = path.join(projectDir, "packages/app", CONFIG);
    await fs.outputJson(scoped, {
      gates: { "coverage-adequacy": { "pull-request": DECLARATION } },
    });
    const repaired = source.replace(LEGACY_LINE, "");
    await fs.writeFile(path.join(projectDir, CI), repaired);
    await registry.runBeforeStrategies(context());
    await registry.runAll(context());
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(repaired);
    expect(
      (await fs.readJson(scoped)).gates["coverage-adequacy"]["pull-request"]
    ).toEqual(DECLARATION);
  });

  it("refuses an ambiguous inline input before changing any file", async () => {
    const source = CALLER.replace(
      "    with:\n      verify_enforced: true # already selected by the project\n      package_manager: bun",
      "    with: {verify_enforced: true, package_manager: bun}"
    );
    await fs.writeFile(path.join(projectDir, CI), source);
    const before = await fs.readFile(path.join(projectDir, CONFIG), "utf8");
    await expect(registry.runBeforeStrategies(context())).rejects.toThrow(
      "Cannot safely migrate"
    );
    expect(await fs.readFile(path.join(projectDir, CI), "utf8")).toBe(source);
    expect(await fs.readFile(path.join(projectDir, CONFIG), "utf8")).toBe(
      before
    );
  });
});
