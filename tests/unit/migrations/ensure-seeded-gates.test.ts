/**
 * Seeding is the mechanism that retires a hardcoded fallback, so the thing to
 * prove about it is restraint, not reach: it must decline everything whose
 * built-in it cannot reproduce.
 *
 * A migration that declared the registry's defaults wholesale would ship a red
 * fleet on a version bump — twenty of those defaults are tasks no template
 * ships — and, worse, would declare gates whose seeded task proves LESS than
 * the built-in it replaced while the configuration read deliberate.
 *
 * @module tests/unit/migrations/ensure-seeded-gates
 */
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureSeededGatesMigration } from "../../../src/migrations/ensure-seeded-gates.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";

/** The scripts the TypeScript template force-pins into a host project. */
const TEMPLATE_SCRIPTS: Record<string, string> = {
  lint: "oxlint && eslint . --quiet",
  "lint:slow": "eslint . --config eslint.slow.config.ts --quiet",
  typecheck: "tsc --noEmit",
  build: "tsc",
  "format:check": "prettier --check .",
  "test:cov": "vitest run --coverage",
  "test:cov:unit": "vitest run --coverage --exclude='**/integration/**'",
  "test:integration": "vitest run tests/integration",
  "knip:check": "knip",
  "check:work-item": "node scripts/lisa-work-item.mjs validate-pr",
  "check:work-item:push": "node scripts/lisa-work-item.mjs validate-push",
};

describe("EnsureSeededGatesMigration", () => {
  const migration = new EnsureSeededGatesMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-seedgates-"));
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  const ctx = (dryRun = false): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
  });

  /**
   * Stage a project.
   * @param scripts package.json scripts.
   * @param config .lisa.config.json contents, or null to omit the file.
   */
  const stage = async (
    scripts: Record<string, string>,
    config: Record<string, unknown> | null = { tracker: "github" }
  ): Promise<void> => {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "demo",
      scripts,
    });
    if (config !== null) {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), config);
    }
  };

  const readConfig = (): Promise<Record<string, unknown>> =>
    fs.readJson(path.join(projectDir, LISA_CONFIG));

  it("does not onboard a project that has no .lisa.config.json", async () => {
    await stage(TEMPLATE_SCRIPTS, null);
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("is a noop for a project whose scripts reproduce nothing", async () => {
    await stage({ start: "node ." });
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("declares the properties the built-ins are already proving", async () => {
    await stage(TEMPLATE_SCRIPTS);
    expect(await migration.applies(ctx())).toBe(true);
    const result = await migration.apply(ctx());
    expect(result.action).toBe("applied");
    expect(result.changedFiles).toEqual([LISA_CONFIG]);
    const gates = (await readConfig()).gates as Record<string, unknown>;
    expect(gates["type-correctness"]).toEqual({
      push: "required",
      "pull-request": "required",
    });
  });

  it("names the task that reproduces the built-in, not the registry default", async () => {
    await stage(TEMPLATE_SCRIPTS);
    await migration.apply(ctx());
    const gates = (await readConfig()).gates as Record<
      string,
      Record<string, unknown>
    >;
    // The whole safety argument in one assertion: the pre-push unit step proves
    // the suite AND the coverage thresholds in one run, so a declaration naming
    // `test:unit` would stop enforcing coverage at push without changing a
    // visible line of behaviour.
    expect(gates["test-correctness"]?.["push"]).toEqual({
      level: "required",
      run: "test:cov:unit",
    });
  });

  it("preserves every other key in the config", async () => {
    await stage(TEMPLATE_SCRIPTS, { tracker: "github", wiki: { source: {} } });
    await migration.apply(ctx());
    const config = await readConfig();
    expect(config["tracker"]).toBe("github");
    expect(config["wiki"]).toEqual({ source: {} });
  });

  it("never overwrites a declaration the project made", async () => {
    await stage(TEMPLATE_SCRIPTS, {
      gates: { runner: "bun run", "type-correctness": { push: "off" } },
    });
    await migration.apply(ctx());
    const gates = (await readConfig()).gates as Record<
      string,
      Record<string, unknown>
    >;
    expect(gates["type-correctness"]?.["push"]).toBe("off");
    expect(gates["runner"]).toBe("bun run");
  });

  it("records the runner the project's lockfile implies", async () => {
    await stage(TEMPLATE_SCRIPTS);
    await fs.writeFile(path.join(projectDir, "bun.lock"), "");
    await migration.apply(ctx());
    const gates = (await readConfig()).gates as Record<string, unknown>;
    expect(gates["runner"]).toBe("bun run");
  });

  it("is idempotent", async () => {
    await stage(TEMPLATE_SCRIPTS);
    await migration.apply(ctx());
    const first = await readConfig();
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
    expect(await readConfig()).toEqual(first);
  });

  it("writes nothing on a dry run", async () => {
    await stage(TEMPLATE_SCRIPTS);
    const result = await migration.apply(ctx(true));
    expect(result.action).toBe("applied");
    expect((await readConfig()).gates).toBeUndefined();
  });
});
