import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureSonarExcludesLisaHarnessMigration } from "../../../src/migrations/ensure-sonar-excludes-lisa-harness.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const SONAR = "sonar-project.properties";
const CODEX = ".codex/**";
const OPENCODE = ".opencode/**";
const AGENTS = ".agents/**";

describe("EnsureSonarExcludesLisaHarnessMigration", () => {
  const migration = new EnsureSonarExcludesLisaHarnessMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-sonar-"));
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
  const sonarPath = (): string => path.join(projectDir, SONAR);
  const readSonar = (): Promise<string> => fs.readFile(sonarPath(), "utf8");

  it("is a noop when no sonar-project.properties exists", async () => {
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("appends missing harness globs, preserving existing exclusions and other keys", async () => {
    await fs.writeFile(
      sonarPath(),
      "sonar.exclusions=node_modules/**/*,scripts/**\nsonar.host.url=https://sonarcloud.io\n"
    );
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());
    const out = await readSonar();
    for (const g of [
      "node_modules/**/*",
      "scripts/**",
      CODEX,
      OPENCODE,
      AGENTS,
    ]) {
      expect(out).toContain(g);
    }
    expect(out).toContain("sonar.host.url=https://sonarcloud.io");
  });

  it("is idempotent when the globs are already present", async () => {
    await fs.writeFile(
      sonarPath(),
      `sonar.exclusions=a/**,${CODEX},${OPENCODE},${AGENTS}\n`
    );
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("creates the exclusions line when absent", async () => {
    await fs.writeFile(sonarPath(), "sonar.projectKey=foo\n");
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());
    const out = await readSonar();
    expect(out).toMatch(/sonar\.exclusions=.*\.codex\/\*\*/);
    expect(out).toContain("sonar.projectKey=foo");
  });

  it("leaves a backslash-continued exclusions value untouched", async () => {
    const original = "sonar.exclusions=a/**,\\\n  b/**\n";
    await fs.writeFile(sonarPath(), original);
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
    expect(await readSonar()).toBe(original);
  });

  it("dry-run reports applied without writing", async () => {
    await fs.writeFile(sonarPath(), "sonar.exclusions=a/**\n");
    expect((await migration.apply(ctx(true))).action).toBe("applied");
    expect(await readSonar()).not.toContain(CODEX);
  });
});
