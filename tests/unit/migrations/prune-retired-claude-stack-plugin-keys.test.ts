/**
 * Retired stack plugin keys (`typescript@lisa`, `cdk@lisa`, …) were enabled by
 * Lisa's merge templates from 2026-03-01 to 2026-03-05 and then renamed to
 * `lisa-<type>@lisa`. The merge strategy only adds keys, so hosts that applied
 * Lisa in that window kept the old names forever and every apply and worktree
 * bootstrap tried, and failed, to install them (CodySwannGT/lisa#4645).
 * @module tests/unit/migrations/prune-retired-claude-stack-plugin-keys
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { PruneRetiredClaudeStackPluginKeysMigration } from "../../../src/migrations/prune-retired-claude-stack-plugin-keys.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");
const OLD_TS = "typescript@lisa";
const NEW_TS = "lisa-typescript@lisa";
const OLD_CDK = "cdk@lisa";
const NEW_CDK = "lisa-cdk@lisa";

/** Logger that records success and dry-run lines an operator would see. */
class RecordingLogger implements ILogger {
  readonly lines: string[] = [];
  /**
   * Record a success line.
   * @param message - Success line
   */
  success(message: string): void {
    this.lines.push(message);
  }
  /**
   * Record a dry-run line.
   * @param message - Dry-run line
   */
  dry(message: string): void {
    this.lines.push(message);
  }
  /**
   * Record a warning line.
   * @param message - Warning line
   */
  warn(message: string): void {
    this.lines.push(message);
  }
  /** Ignore info output. */
  info(): void {}
  /** Ignore error output. */
  error(): void {}
}

describe("PruneRetiredClaudeStackPluginKeysMigration", () => {
  let migration: PruneRetiredClaudeStackPluginKeysMigration;
  let tempDir: string;
  let projectDir: string;
  let logger: RecordingLogger;

  beforeEach(async () => {
    migration = new PruneRetiredClaudeStackPluginKeysMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    logger = new RecordingLogger();
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context.
   * @param detectedTypes - Detected project types
   * @param dryRun - Whether to describe instead of write
   * @returns Migration context
   */
  function ctx(
    detectedTypes: readonly ProjectType[],
    dryRun = false
  ): MigrationContext {
    return { projectDir, lisaDir: tempDir, detectedTypes, dryRun, logger };
  }

  /**
   * Write enabledPlugins into the project's settings.
   * @param enabledPlugins - Map to write
   */
  async function writePlugins(
    enabledPlugins: Record<string, boolean>
  ): Promise<void> {
    await fs.outputJson(path.join(projectDir, SETTINGS_REL_PATH), {
      permissions: { allow: ["Bash(ls)"] },
      enabledPlugins,
    });
  }

  /**
   * Read back enabledPlugins.
   * @returns Current enabledPlugins map
   */
  async function readPlugins(): Promise<Record<string, boolean>> {
    const settings = (await fs.readJson(
      path.join(projectDir, SETTINGS_REL_PATH)
    )) as { enabledPlugins: Record<string, boolean> };
    return settings.enabledPlugins;
  }

  it("removes a retired key when its successor is present and names it", async () => {
    await writePlugins({ [OLD_TS]: true, [NEW_TS]: true, "lisa@lisa": true });

    expect(await migration.applies(ctx(["typescript"]))).toBe(true);
    const result = await migration.apply(ctx(["typescript"]));

    expect(await readPlugins()).toEqual({ [NEW_TS]: true, "lisa@lisa": true });
    expect(result.action).toBe("applied");
    expect(result.message).toContain(OLD_TS);
    expect(logger.lines.join("\n")).toContain(OLD_TS);
  });

  it("removes every retired key from the 2026-03 templates alongside successors", async () => {
    await writePlugins({
      [OLD_TS]: true,
      [OLD_CDK]: true,
      "expo@lisa": true,
      "nestjs@lisa": true,
      "rails@lisa": true,
      [NEW_TS]: true,
      [NEW_CDK]: true,
      "lisa-expo@lisa": true,
      "lisa-nestjs@lisa": true,
      "lisa-rails@lisa": true,
    });

    await migration.apply(
      ctx(["typescript", "cdk", "expo", "nestjs", "rails"])
    );

    expect(
      Object.keys(await readPlugins()).sort((a, b) => a.localeCompare(b))
    ).toEqual([
      NEW_CDK,
      "lisa-expo@lisa",
      "lisa-nestjs@lisa",
      "lisa-rails@lisa",
      NEW_TS,
    ]);
  });

  it("keeps a retired key whose type still applies but has no successor yet", async () => {
    await writePlugins({ [OLD_TS]: true });

    expect(await migration.applies(ctx(["typescript"]))).toBe(false);
    const result = await migration.apply(ctx(["typescript"]));

    expect(result.action).toBe("noop");
    expect(await readPlugins()).toEqual({ [OLD_TS]: true });
  });

  it("removes a retired key whose stack type no longer applies, even without a successor", async () => {
    await writePlugins({ [OLD_CDK]: true, [NEW_TS]: true });

    await migration.apply(ctx(["typescript"]));

    expect(await readPlugins()).toEqual({ [NEW_TS]: true });
  });

  it("never touches host keys or keys that merely look retired", async () => {
    const hostKeys = {
      "typescript@other-market": true,
      "typescript-lsp@claude-plugins-official": true,
      "lisa-wiki@lisa": true,
      "phaser@lisa": true,
    };
    await writePlugins({ ...hostKeys, [NEW_TS]: true });

    expect(await migration.applies(ctx([]))).toBe(false);
    expect(await readPlugins()).toEqual({ ...hostKeys, [NEW_TS]: true });
  });

  it("preserves the rest of settings.json", async () => {
    await writePlugins({ [OLD_TS]: true, [NEW_TS]: true });
    await migration.apply(ctx(["typescript"]));
    const settings = (await fs.readJson(
      path.join(projectDir, SETTINGS_REL_PATH)
    )) as { permissions: unknown };
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
  });

  it("describes without writing in dry-run", async () => {
    await writePlugins({ [OLD_TS]: true, [NEW_TS]: true });
    const result = await migration.apply(ctx(["typescript"], true));
    expect(result.action).toBe("applied");
    expect(logger.lines.join("\n")).toContain(OLD_TS);
    expect(await readPlugins()).toEqual({ [OLD_TS]: true, [NEW_TS]: true });
  });

  it("is a silent no-op without settings or enabledPlugins", async () => {
    expect(await migration.applies(ctx(["typescript"]))).toBe(false);
    expect((await migration.apply(ctx(["typescript"]))).action).toBe("noop");
    await fs.outputJson(path.join(projectDir, SETTINGS_REL_PATH), {});
    expect(await migration.applies(ctx(["typescript"]))).toBe(false);
    expect((await migration.apply(ctx(["typescript"]))).action).toBe("noop");
  });

  it("is idempotent: a second run reports nothing", async () => {
    await writePlugins({ [OLD_TS]: true, [NEW_TS]: true });
    await migration.apply(ctx(["typescript"]));
    expect(await migration.applies(ctx(["typescript"]))).toBe(false);
  });

  it("runs after reconcile-claude-stack-plugins, so a successor reconcile adds retires its predecessor in the same apply", () => {
    const names = new MigrationRegistry().getAll().map(m => m.name);
    const prune = names.indexOf("prune-retired-claude-stack-plugin-keys");
    expect(prune).toBeGreaterThan(
      names.indexOf("reconcile-claude-stack-plugins")
    );
  });
});
