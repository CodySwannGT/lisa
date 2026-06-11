/**
 * Regression guards for Phaser stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PHASER_PACKAGE_LISA_TEMPLATE = "phaser/package-lisa/package.lisa.json";

/**
 * Read a JSON template from the Lisa repository.
 * @param relativePath - Repo-relative JSON path
 * @returns Parsed template content
 */
function readJson(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
  );
}

/**
 * Read a text template from the Lisa repository.
 * @param relativePath - Repo-relative text path
 * @returns Template content
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

describe("Phaser templates", () => {
  it("delete inherited Jest local config from the TypeScript parent stack", () => {
    const deletions = readJson("phaser/deletions.json") as {
      readonly paths?: readonly string[];
    };

    expect(deletions.paths).toContain("jest.config.local.ts");
  });

  it("keeps the phaser dependency in defaults, never force", () => {
    // Forcing a framework major clobbers projects that pin a different line —
    // the same lesson as the Expo SDK pin (2.132.6). The pack targets Phaser 4
    // through skills and lint enforcement, not a forced dependency version.
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly force?: { readonly dependencies?: Record<string, string> };
      readonly defaults?: { readonly dependencies?: Record<string, string> };
    };

    expect(template.force?.dependencies?.["phaser"]).toBeUndefined();
    expect(template.defaults?.dependencies?.["phaser"]).toBe("^4.1.0");
  });

  it("ships vitest scripts, not jest", () => {
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly force?: { readonly scripts?: Record<string, string> };
    };

    expect(template.force?.scripts?.["test"]).toBe("vitest run");
    expect(template.force?.scripts?.["test:cov"]).toBe("vitest run --coverage");
  });

  it("wraps the Phaser ESLint factory in the shipped eslint.config.ts", () => {
    const config = readText("phaser/copy-overwrite/eslint.config.ts");

    expect(config).toContain("getPhaserConfig");
    expect(config).toContain("@codyswann/lisa/eslint/phaser");
  });

  it("wraps the Phaser Vitest factory in the shipped vitest.config.ts", () => {
    const config = readText("phaser/copy-overwrite/vitest.config.ts");

    expect(config).toContain("getPhaserVitestConfig");
    expect(config).toContain("@codyswann/lisa/vitest/phaser");
  });

  it("ignores game assets across every lint/format surface", () => {
    // Asset payloads (atlases, packs, audio) must never feed linters or
    // formatters; a miss on one surface fails gates the way Harper's
    // generated artifacts did (d54d6913, 8e87cae1).
    const assetGlobPattern = /public\/assets/;

    expect(readText("phaser/copy-contents/.prettierignore")).toMatch(
      assetGlobPattern
    );
    expect(readText("phaser/merge/.oxlintrc.json")).toMatch(assetGlobPattern);
    expect(readText("phaser/copy-overwrite/knip.json")).toMatch(
      assetGlobPattern
    );
    expect(readText("phaser/copy-overwrite/tsconfig.eslint.json")).toMatch(
      assetGlobPattern
    );
    expect(readText("tsconfig/phaser.json")).toMatch(assetGlobPattern);
    expect(readText("oxlint/phaser.json")).toMatch(assetGlobPattern);
  });

  it("enables the lisa-phaser plugin in merged Claude settings", () => {
    const settings = readJson("phaser/merge/.claude/settings.json") as {
      readonly enabledPlugins?: Record<string, boolean>;
    };

    expect(settings.enabledPlugins?.["lisa-phaser@lisa"]).toBe(true);
  });

  it("bans Phaser 3 idioms in the ESLint factory", () => {
    const factory = readText("src/configs/eslint/phaser.ts");

    for (const banned of [
      "setPipeline",
      "setPostPipeline",
      "setTintFill",
      "preFX",
      "postFX",
      "Struct",
      "random",
    ]) {
      expect(factory).toContain(banned);
    }
  });
});
