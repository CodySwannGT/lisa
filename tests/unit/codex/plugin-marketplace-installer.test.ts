/**
 * Unit tests for Lisa's repo-local Codex plugin marketplace installer.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_MARKETPLACE_PATH,
  installCodexMarketplace,
  mergeLisaMarketplace,
} from "../../../src/codex/plugin-marketplace-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/plugin-marketplace-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(
      tempDir,
      "project",
      "node_modules",
      "@codyswann",
      "lisa"
    );
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(lisaDir, "plugins", "lisa"));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("creates a repo-local marketplace with Lisa plugin entries", async () => {
    const result = await installCodexMarketplace(lisaDir, destDir);
    expect(result.created).toBe(true);
    expect(result.pluginEntries).toBe(10);

    const marketplacePath = path.join(destDir, CODEX_MARKETPLACE_PATH);
    const parsed = JSON.parse(await fs.readFile(marketplacePath, "utf8"));
    expect(parsed.name).toBe("lisa");
    expect(
      parsed.plugins.map((plugin: { name: string }) => plugin.name)
    ).toEqual([
      "lisa",
      "lisa-typescript",
      "lisa-expo",
      "lisa-nestjs",
      "lisa-cdk",
      "lisa-harper-fabric",
      "lisa-phaser",
      "lisa-rails",
      "lisa-wiki",
      "lisa-openclaw",
    ]);
    expect(parsed.plugins[0].source.path).toBe(
      "./node_modules/@codyswann/lisa/plugins/lisa"
    );
    expect(parsed.plugins[0].policy.installation).toBe("INSTALLED_BY_DEFAULT");
    expect(
      Object.fromEntries(
        parsed.plugins.map((plugin: { category: string; name: string }) => [
          plugin.name,
          plugin.category,
        ])
      )
    ).toEqual({
      lisa: "Productivity",
      "lisa-typescript": "Productivity",
      "lisa-expo": "Coding",
      "lisa-nestjs": "Coding",
      "lisa-cdk": "Coding",
      "lisa-harper-fabric": "Coding",
      "lisa-phaser": "Coding",
      "lisa-rails": "Coding",
      "lisa-wiki": "Productivity",
      "lisa-openclaw": "Productivity",
    });
  });

  it("preserves host marketplace entries while replacing Lisa entries", () => {
    const merged = mergeLisaMarketplace(
      {
        name: "local",
        interface: { displayName: "Local Plugins" },
        plugins: [
          { name: "host-plugin", source: "./plugins/host" },
          { name: "lisa", source: "./old/path" },
        ],
      },
      lisaDir,
      destDir
    );

    const plugins = merged.plugins as readonly { name: string }[];
    expect(plugins.map(plugin => plugin.name)).toContain("host-plugin");
    expect(plugins.filter(plugin => plugin.name === "lisa")).toHaveLength(1);
    expect(merged.interface).toEqual({ displayName: "Local Plugins" });
  });
});
