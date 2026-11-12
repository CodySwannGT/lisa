/**
 * Coverage for the migration that removes retired third-party plugins and
 * their marketplaces from a host's `.claude/settings.json`
 * (CodySwannGT/lisa#4799).
 * @module tests/unit/migrations/prune-retired-third-party-plugins
 */
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { PruneRetiredThirdPartyPluginsMigration } from "../../../src/migrations/prune-retired-third-party-plugins.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LISA_MARKETPLACE = {
  source: { source: "github", repo: "CodySwannGT/lisa" },
};

/** A host settings file in the shape a pre-#4799 apply left behind. */
const LEGACY_SETTINGS = {
  attribution: { commit: "keep me" },
  enabledPlugins: {
    "lisa@lisa": true,
    "cc-safety-net@cc-marketplace": true,
    "safety-net@cc-marketplace": false,
    "impeccable@impeccable": true,
    "code-review@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "skill-creator@claude-plugins-official": true,
    "coderabbit@claude-plugins-official": true,
    "atlassian@claude-plugins-official": true,
  },
  extraKnownMarketplaces: {
    "CodySwannGT/lisa": LISA_MARKETPLACE,
    "kenryu42/cc-marketplace": {
      source: { source: "github", repo: "kenryu42/cc-marketplace" },
    },
    "pbakaus/impeccable": {
      source: { source: "github", repo: "pbakaus/impeccable" },
    },
  },
};

describe("prune-retired-third-party-plugins migration", () => {
  let tempDir: string;
  let projectDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    settingsPath = path.join(projectDir, ".claude", "settings.json");
    await fs.ensureDir(path.dirname(settingsPath));
  });

  afterEach(async () => cleanupTempDir(tempDir));

  /**
   * Run the migration against one settings object.
   * @param settings - Starting `.claude/settings.json`
   * @param dryRun - Whether to only describe the change
   * @returns The applies() verdict and the settings afterwards
   */
  async function migrate(
    settings: Record<string, unknown>,
    dryRun = false
  ): Promise<{
    readonly applies: boolean;
    readonly after: Record<string, unknown>;
  }> {
    await fs.writeJson(settingsPath, settings);
    const detectedTypes: readonly ProjectType[] = ["typescript"];
    const ctx = {
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
    const migration = new PruneRetiredThirdPartyPluginsMigration();
    const applies = await migration.applies(ctx);
    if (applies) await migration.apply(ctx);
    return { applies, after: await fs.readJson(settingsPath) };
  }

  it("removes every retired plugin and marketplace, and nothing else", async () => {
    const { applies, after } = await migrate(LEGACY_SETTINGS);

    expect(applies).toBe(true);
    expect(after).toEqual({
      attribution: { commit: "keep me" },
      enabledPlugins: {
        "lisa@lisa": true,
        "coderabbit@claude-plugins-official": true,
        "atlassian@claude-plugins-official": true,
      },
      extraKnownMarketplaces: { "CodySwannGT/lisa": LISA_MARKETPLACE },
    });
  });

  it("removes a retired plugin even when the host explicitly enabled it", async () => {
    const { after } = await migrate({
      enabledPlugins: { "cc-safety-net@cc-marketplace": true },
    });
    expect(after).toEqual({ enabledPlugins: {} });
  });

  it("does nothing to a host that carries none of them", async () => {
    const clean = {
      enabledPlugins: { "lisa@lisa": true },
      extraKnownMarketplaces: { "CodySwannGT/lisa": LISA_MARKETPLACE },
    };
    const { applies, after } = await migrate(clean);
    expect(applies).toBe(false);
    expect(after).toEqual(clean);
  });

  it("does not add sections a host never had", async () => {
    const { after } = await migrate({
      extraKnownMarketplaces: {
        "pbakaus/impeccable": {
          source: { source: "github", repo: "pbakaus/impeccable" },
        },
      },
    });
    expect(after).toEqual({ extraKnownMarketplaces: {} });
  });

  it("changes nothing on a dry run", async () => {
    const { applies, after } = await migrate(LEGACY_SETTINGS, true);
    expect(applies).toBe(true);
    expect(after).toEqual(LEGACY_SETTINGS);
  });

  it("does not apply when there is no settings file", async () => {
    await fs.remove(settingsPath);
    const migration = new PruneRetiredThirdPartyPluginsMigration();
    expect(
      await migration.applies({
        projectDir,
        lisaDir: tempDir,
        detectedTypes: ["typescript"],
        dryRun: false,
        logger: new SilentLogger(),
      })
    ).toBe(false);
  });
});
