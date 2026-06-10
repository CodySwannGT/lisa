import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureWikiSourceDeclaredMigration } from "../../../src/migrations/ensure-wiki-source-declared.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";
const WIKI_CONFIG = path.join("wiki", "lisa-wiki.config.json");

describe("EnsureWikiSourceDeclaredMigration", () => {
  const migration = new EnsureWikiSourceDeclaredMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-wikisrc-"));
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
  const writeWiki = (wikiRoot?: string): Promise<void> =>
    fs.outputJson(
      path.join(projectDir, WIKI_CONFIG),
      wikiRoot ? { wikiRoot } : { org: "x" }
    );
  const readConfig = (): Promise<Record<string, unknown>> =>
    fs.readJson(path.join(projectDir, LISA_CONFIG));

  it("is a noop when the project has no local wiki", async () => {
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), { tracker: "jira" });
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("declares wiki.source.path when a wiki exists and config lacks it", async () => {
    await writeWiki();
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      tracker: "jira",
      source: "notion",
    });
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());
    const c = await readConfig();
    expect(c.wiki).toEqual({ source: { path: "wiki" } });
    expect(c.tracker).toBe("jira"); // existing keys preserved
    expect(c.source).toBe("notion");
  });

  it("honors a non-default wikiRoot from lisa-wiki.config.json", async () => {
    await writeWiki("docs/wiki");
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {});
    await migration.apply(ctx());
    expect((await readConfig()).wiki).toEqual({
      source: { path: "docs/wiki" },
    });
  });

  it("creates .lisa.config.json when absent", async () => {
    await writeWiki();
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());
    expect((await readConfig()).wiki).toEqual({ source: { path: "wiki" } });
  });

  it("is idempotent when wiki.source already declared", async () => {
    await writeWiki();
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      wiki: { source: { url: "git@github.com:org/wiki.git" } },
    });
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("preserves sibling wiki keys (e.g. ttlSeconds) while adding source", async () => {
    await writeWiki();
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      wiki: { ttlSeconds: 600 },
    });
    await migration.apply(ctx());
    expect((await readConfig()).wiki).toEqual({
      ttlSeconds: 600,
      source: { path: "wiki" },
    });
  });

  it("dry-run reports applied without writing", async () => {
    await writeWiki();
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), { tracker: "jira" });
    expect((await migration.apply(ctx(true))).action).toBe("applied");
    expect((await readConfig()).wiki).toBeUndefined();
  });
});
