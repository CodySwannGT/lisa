/**
 * Regression guards for Phaser stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PHASER_PACKAGE_LISA_TEMPLATE = "phaser/package-lisa/package.lisa.json";
const PHASER_ESLINT_FACTORY = "src/configs/eslint/phaser.ts";

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
    expect(template.defaults?.dependencies?.["phaser"]).toBe("^4.2.0");
  });

  it("ships vitest scripts, not jest", () => {
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly force?: { readonly scripts?: Record<string, string> };
    };

    expect(template.force?.scripts?.["test"]).toBe("vitest run");
    expect(template.force?.scripts?.["test:cov"]).toBe("vitest run --coverage");
  });

  it("format script uses --write only; format:check uses --check only", () => {
    // Prettier's --check and --write are mutually exclusive modes.
    // --check exits non-zero when files need formatting (validation only);
    // --write rewrites files in place. Mixing both is undefined behaviour and
    // will make the format script a no-op fix (check fires before write).
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly force?: { readonly scripts?: Record<string, string> };
    };

    const formatScript = template.force?.scripts?.["format"] ?? "";
    const formatCheckScript = template.force?.scripts?.["format:check"] ?? "";

    expect(formatScript).toContain("--write");
    expect(formatScript).not.toContain("--check");
    expect(formatCheckScript).toContain("--check");
    expect(formatCheckScript).not.toContain("--write");
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
    const factory = readText(PHASER_ESLINT_FACTORY);

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

  it("registers eslint-plugin-phaser and its stateful rules in the factory", () => {
    const factory = readText(PHASER_ESLINT_FACTORY);

    expect(factory).toContain("eslint-plugin-phaser/index.js");
    expect(factory).toContain("phaser/no-create-in-update");
    expect(factory).toContain("phaser/no-allocation-in-update");
    expect(factory).toContain("phaser/require-shutdown-cleanup");
  });

  it("enforces determinism and the architecture boundary in the factory", () => {
    const factory = readText(PHASER_ESLINT_FACTORY);

    // Determinism + event-bus + physics-debug bans.
    expect(factory).toContain("Date");
    expect(factory).toContain("performance");
    expect(factory).toContain("debug");
    // The pure-logic boundary: src/logic may not import phaser.
    expect(factory).toContain("src/logic/**/*.ts");
    expect(factory).toContain("no-restricted-imports");
    // Storage discipline outside services.
    expect(factory).toContain("no-restricted-globals");
    expect(factory).toContain("src/services/**/*.ts");
  });

  it("registers the eslint-plugin-phaser workspace and ships it in the package", () => {
    const pkg = readJson("package.json") as {
      readonly workspaces?: readonly string[];
      readonly files?: readonly string[];
    };

    expect(pkg.workspaces).toContain("eslint-plugin-phaser");
    expect(pkg.files).toContain("eslint-plugin-phaser");
  });

  it("exports all three rules from the eslint-plugin-phaser index", () => {
    const index = readText("eslint-plugin-phaser/index.js");

    expect(index).toContain("no-create-in-update");
    expect(index).toContain("no-allocation-in-update");
    expect(index).toContain("require-shutdown-cleanup");
  });

  it("applies game-strict TypeScript flags in tsconfig/phaser.json", () => {
    const tsconfig = readJson("tsconfig/phaser.json") as {
      readonly compilerOptions?: Record<string, unknown>;
    };
    const opts = tsconfig.compilerOptions ?? {};

    expect(opts["noUncheckedIndexedAccess"]).toBe(true);
    expect(opts["noImplicitOverride"]).toBe(true);
    expect(opts["exactOptionalPropertyTypes"]).toBe(true);
  });

  it("ships the Phaser 4 toolchain (PWA, packing, bundle budget) in defaults", () => {
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly defaults?: {
        readonly devDependencies?: Record<string, string>;
      };
    };
    const dev = template.defaults?.devDependencies ?? {};

    expect(dev["vite-plugin-pwa"]).toBeDefined();
    expect(dev["free-tex-packer-core"]).toBeDefined();
    expect(dev["size-limit"]).toBeDefined();
  });

  it("defers to Phaser's official skills and drops duplicative lisa skills", () => {
    // Phaser ships authoritative API skills in node_modules/phaser/skills; the
    // lisa-phaser plugin must point at them, not duplicate (and drift from) them.
    const rules = readText("plugins/src/phaser/rules/phaser.md");
    expect(rules).toContain("node_modules/phaser/skills");

    const skillsDir = path.join(REPO_ROOT, "plugins/src/phaser/skills");
    const skills = fs.readdirSync(skillsDir);
    // Removed: these duplicate official Phaser skills.
    for (const dup of [
      "phaser-scenes",
      "phaser-gameobjects",
      "phaser-physics",
      "phaser-assets",
      "phaser-rendering",
      "phaser-v3-migration",
    ]) {
      expect(skills).not.toContain(dup);
    }
    // Kept: the opinionated / enforcement-tied skills not covered upstream.
    for (const keep of [
      "phaser-project-structure",
      "phaser-services",
      "phaser-asset-pipeline",
      "phaser-accessibility",
      "phaser-i18n",
      "phaser-build-deploy",
      "phaser-testing",
    ]) {
      expect(skills).toContain(keep);
    }
  });

  it("wires the Phaser Editor MCP server, disabled by default", () => {
    const mcp = readJson("phaser/merge/.mcp.json") as {
      readonly mcpServers?: Record<string, { command?: string }>;
    };
    expect(mcp.mcpServers?.["phaser-editor"]?.command).toBe("npx");

    const settings = readJson("phaser/merge/.claude/settings.json") as {
      readonly disabledMcpjsonServers?: readonly string[];
    };
    expect(settings.disabledMcpjsonServers).toContain("phaser-editor");
  });

  it("ships .gitignore as a dotless `gitignore` template (npm strips .gitignore)", () => {
    // npm excludes .gitignore from published tarballs, so the template must
    // ship as `gitignore`; the copy-contents strategy restores the dot on apply.
    expect(
      fs.existsSync(path.join(REPO_ROOT, "phaser/copy-contents/gitignore"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "phaser/copy-contents/.gitignore"))
    ).toBe(false);
  });

  it("aligns the vite version with the forced override (no npm EOVERRIDE)", () => {
    // A literal vite default that differs from the inherited `^8.0.16` override
    // makes `npm install` / `npx lisa apply` fail with EOVERRIDE. Pin the
    // default to the override and point overrides/resolutions at $vite.
    const template = readJson(PHASER_PACKAGE_LISA_TEMPLATE) as {
      readonly force?: {
        readonly overrides?: Record<string, string>;
        readonly resolutions?: Record<string, string>;
      };
      readonly defaults?: {
        readonly devDependencies?: Record<string, string>;
      };
    };

    expect(template.defaults?.devDependencies?.["vite"]).toBe("^8.0.16");
    expect(template.force?.overrides?.["vite"]).toBe("$vite");
    expect(template.force?.resolutions?.["vite"]).toBe("$vite");
  });
});
