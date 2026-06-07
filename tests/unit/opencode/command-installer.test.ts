/**
 * Unit tests for the OpenCode command installer (discovery reuse + transform +
 * stale cleanup).
 *
 * Covers:
 *   - Writes commands to `.opencode/commands/lisa-<name>.md`
 *   - Nested commands use the dash-joined `lisa-` name
 *   - $ARGUMENTS preserved in the emitted command
 *   - Stale cleanup scoped to `commands/lisa-*` — never touches host commands
 *   - managedFiles for manifest persistence; idempotence
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_COMMANDS_SUBDIR,
  discoverAndInstallCommands,
} from "../../../src/opencode/command-installer.js";
import { LISA_COMMAND_SKILL_PREFIX } from "../../../src/core/lisa-skill-sources.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const PLUGIN_LISA = "lisa";
const OPENCODE_DIR = ".opencode";
const HOST_COMMAND_MD = "host-command.md";
const OLD_COMMAND_OUT = `${LISA_COMMAND_SKILL_PREFIX}old.md`;

const SAMPLE_COMMAND = `---
description: "Fix a bug via TDD."
argument-hint: "<description>"
---

Execute the Implement flow.

$ARGUMENTS
`;

describe("opencode/command-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a fake command file under plugins/<plugin>/commands/<relPath>.
   * @param pluginName - Plugin directory name.
   * @param relPath - Path under commands/ (e.g. "fix.md", "git/commit.md").
   * @param content - Markdown content of the command file.
   */
  async function seedCommand(
    pluginName: string,
    relPath: string,
    content: string
  ): Promise<void> {
    const filePath = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "commands",
      relPath
    );
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, "utf8");
  }

  /**
   * Resolve the absolute path of an installed Lisa command file.
   * @param filename - Emitted filename (e.g. "lisa-fix.md").
   * @returns Absolute path under `.opencode/commands/`.
   */
  function installedCommandPath(filename: string): string {
    return path.join(destDir, OPENCODE_DIR, LISA_COMMANDS_SUBDIR, filename);
  }

  it("writes a top-level command to .opencode/commands/lisa-<name>.md", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    const result = await discoverAndInstallCommands(lisaDir, destDir, []);

    const filename = `${LISA_COMMAND_SKILL_PREFIX}fix.md`;
    expect(result.installed.map(c => c.name)).toContain(
      `${LISA_COMMAND_SKILL_PREFIX}fix`
    );
    expect(await fs.pathExists(installedCommandPath(filename))).toBe(true);
    const content = await fs.readFile(installedCommandPath(filename), "utf8");
    expect(content).toContain('description: "Fix a bug via TDD."');
    expect(content).toContain("$ARGUMENTS");
  });

  it("names nested commands with the dash-joined lisa- prefix", async () => {
    await seedCommand(PLUGIN_LISA, "git/commit.md", SAMPLE_COMMAND);
    const result = await discoverAndInstallCommands(lisaDir, destDir, []);

    const filename = `${LISA_COMMAND_SKILL_PREFIX}git-commit.md`;
    expect(await fs.pathExists(installedCommandPath(filename))).toBe(true);
    expect(result.installed.map(c => c.name)).toContain(
      `${LISA_COMMAND_SKILL_PREFIX}git-commit`
    );
  });

  it("excludes per-harness variant plugins so the canonical body wins", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    // A cursor fanout copy with a reformatted body must not win the dedup.
    const variantCommand = SAMPLE_COMMAND.replace(
      "Execute the Implement flow.",
      "CURSOR REFORMATTED BODY"
    );
    await seedCommand("lisa-cursor", "fix.md", variantCommand);
    const result = await discoverAndInstallCommands(lisaDir, destDir, []);

    expect(result.installed.map(c => c.name)).toEqual([
      `${LISA_COMMAND_SKILL_PREFIX}fix`,
    ]);
    const content = await fs.readFile(
      installedCommandPath(`${LISA_COMMAND_SKILL_PREFIX}fix.md`),
      "utf8"
    );
    expect(content).toContain("Execute the Implement flow.");
    expect(content).not.toContain("CURSOR REFORMATTED BODY");
  });

  it("returns managedFiles for manifest persistence", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    const result = await discoverAndInstallCommands(lisaDir, destDir, []);
    expect(result.managedFiles).toContain(
      path.join(LISA_COMMANDS_SUBDIR, `${LISA_COMMAND_SKILL_PREFIX}fix.md`)
    );
  });

  it("deletes stale lisa- commands managed previously but not shipped now", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    const commandsDir = path.join(destDir, OPENCODE_DIR, LISA_COMMANDS_SUBDIR);
    await fs.ensureDir(commandsDir);
    await fs.writeFile(
      path.join(commandsDir, OLD_COMMAND_OUT),
      "stale",
      "utf8"
    );
    const previousManagedFiles = [
      path.join(LISA_COMMANDS_SUBDIR, `${LISA_COMMAND_SKILL_PREFIX}fix.md`),
      path.join(LISA_COMMANDS_SUBDIR, OLD_COMMAND_OUT),
    ];
    const result = await discoverAndInstallCommands(
      lisaDir,
      destDir,
      previousManagedFiles
    );

    expect(result.deleted).toEqual([
      path.join(LISA_COMMANDS_SUBDIR, OLD_COMMAND_OUT),
    ]);
    expect(await fs.pathExists(path.join(commandsDir, OLD_COMMAND_OUT))).toBe(
      false
    );
  });

  it("never deletes host commands (files without the lisa- prefix)", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    const commandsDir = path.join(destDir, OPENCODE_DIR, LISA_COMMANDS_SUBDIR);
    await fs.ensureDir(commandsDir);
    await fs.writeFile(
      path.join(commandsDir, HOST_COMMAND_MD),
      "host-owned",
      "utf8"
    );
    const result = await discoverAndInstallCommands(lisaDir, destDir, [
      path.join(LISA_COMMANDS_SUBDIR, HOST_COMMAND_MD),
    ]);

    expect(result.deleted).toEqual([]);
    expect(await fs.pathExists(path.join(commandsDir, HOST_COMMAND_MD))).toBe(
      true
    );
  });

  it("idempotent: running twice produces identical output", async () => {
    await seedCommand(PLUGIN_LISA, "fix.md", SAMPLE_COMMAND);
    const filename = `${LISA_COMMAND_SKILL_PREFIX}fix.md`;
    await discoverAndInstallCommands(lisaDir, destDir, []);
    const first = await fs.readFile(installedCommandPath(filename), "utf8");
    await discoverAndInstallCommands(lisaDir, destDir, []);
    const second = await fs.readFile(installedCommandPath(filename), "utf8");
    expect(second).toBe(first);
  });
});
