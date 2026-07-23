/**
 * `.gitattributes` must follow the project's ACTUAL ledger path.
 *
 * `learnings.file` is a real, validated override in `.lisa.config.json`. The
 * shipped copy-contents template hardcodes the default path, so a project that
 * relocates its ledger would get an attribute pointing at a file it does not
 * use — leaving the real ledger on git's default text merge with nothing to
 * signal it.
 */
import * as fs from "fs-extra";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureLearningsGitattributesMigration } from "../../../src/migrations/ensure-learnings-gitattributes.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const GITATTRIBUTES = ".gitattributes";
const DEFAULT_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const RELOCATED = "docs/knowledge/PROJECT_LEARNINGS.md";
const CONFIG_FILE = ".lisa.config.json";

describe("EnsureLearningsGitattributesMigration", () => {
  const migration = new EnsureLearningsGitattributesMigration();
  let tempDir: string;
  let projectDir: string;

  const ctx = (dryRun = false): MigrationContext => ({
    projectDir,
    lisaDir: path.join(tempDir, "lisa"),
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
  });

  /**
   * Read the project's `.gitattributes`.
   * @returns File contents, or empty string when absent
   */
  async function attributes(): Promise<string> {
    const target = path.join(projectDir, GITATTRIBUTES);
    return (await fs.pathExists(target)) ? fs.readFile(target, "utf8") : "";
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-gitattr-"));
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("binds the default ledger path with no configuration", async () => {
    await migration.apply(ctx());
    expect(await attributes()).toContain(`${DEFAULT_LEDGER} merge=`);
  });

  it("follows a relocated ledger declared via learnings.file", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { file: RELOCATED },
    });
    await migration.apply(ctx());
    const contents = await attributes();
    expect(contents).toContain(`${RELOCATED} merge=`);
    expect(contents).not.toContain(`${DEFAULT_LEDGER} merge=`);
  });

  it("preserves host-authored attributes outside the managed block", async () => {
    await fs.outputFile(
      path.join(projectDir, GITATTRIBUTES),
      "*.psd filter=lfs diff=lfs merge=lfs -text\n"
    );
    await migration.apply(ctx());
    const contents = await attributes();
    expect(contents).toContain("*.psd filter=lfs");
    expect(contents).toContain(`${DEFAULT_LEDGER} merge=`);
  });

  it("rewrites its own block when the ledger moves", async () => {
    await migration.apply(ctx());
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { file: RELOCATED },
    });
    await migration.apply(ctx());
    const contents = await attributes();
    expect(contents).toContain(`${RELOCATED} merge=`);
    expect(contents).not.toContain(`${DEFAULT_LEDGER} merge=`);
  });

  it("is idempotent", async () => {
    await migration.apply(ctx());
    const first = await attributes();
    const second = await migration.apply(ctx());
    expect(second.action).toBe("noop");
    expect(await attributes()).toBe(first);
  });

  it("does not apply once the block already matches", async () => {
    await migration.apply(ctx());
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("writes nothing when the host opted out of the merge driver", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { mergeDriver: false },
    });
    await migration.apply(ctx());
    expect(await attributes()).toBe("");
  });

  it("does not apply when the host opted out", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { mergeDriver: false },
    });
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("writes nothing during a dry run", async () => {
    const result = await migration.apply(ctx(true));
    expect(result.action).toBe("applied");
    expect(await attributes()).toBe("");
  });
});
