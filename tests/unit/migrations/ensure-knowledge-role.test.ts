import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureKnowledgeRoleMigration } from "../../../src/migrations/ensure-knowledge-role.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";

describe("EnsureKnowledgeRoleMigration", () => {
  const migration = new EnsureKnowledgeRoleMigration();
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-knowledge-"));
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  const ctx = (dryRun = false, postinstallSafe = false): MigrationContext => ({
    projectDir,
    lisaDir: tempDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
    postinstallSafe,
  });
  const configPath = (): string => path.join(projectDir, LISA_CONFIG);

  it("does nothing for a project without a config", async () => {
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
    expect(await fs.pathExists(configPath())).toBe(false);
  });

  it("declares the default backend and removes the retired wiki key", async () => {
    await fs.writeJson(configPath(), {
      tracker: "github",
      wiki: { source: { url: "git@example.com:org/wiki.git" } },
    });

    expect(await migration.applies(ctx())).toBe(true);
    const result = await migration.apply(ctx());

    expect(result.action).toBe("applied");
    // The removed location is reported, never dropped silently.
    expect(result.message).toContain("git@example.com:org/wiki.git");
    expect(await fs.readJson(configPath())).toEqual({
      tracker: "github",
      knowledge: "llm-wiki",
    });
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("keeps an existing knowledge value", async () => {
    await fs.writeJson(configPath(), { knowledge: "llm-wiki", wiki: {} });
    await migration.apply(ctx());
    expect(await fs.readJson(configPath())).toEqual({ knowledge: "llm-wiki" });
  });

  it("writes nothing on a dry run", async () => {
    await fs.writeJson(configPath(), { tracker: "jira" });
    const result = await migration.apply(ctx(true));
    expect(result.action).toBe("applied");
    expect(await fs.readJson(configPath())).toEqual({ tracker: "jira" });
  });

  it("leaves the checked-in config alone during a package install", async () => {
    const before = { tracker: "github", wiki: { source: "../shared-wiki" } };
    await fs.writeJson(configPath(), before);
    const result = await migration.apply(ctx(false, true));
    expect(result.action).toBe("skipped");
    expect(result.message).toContain("lisa apply .");
    expect(await fs.readJson(configPath())).toEqual(before);
  });
});
