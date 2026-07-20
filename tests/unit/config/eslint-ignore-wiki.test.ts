/**
 * Unit tests that pin `wiki/**` into both the shared `defaultIgnores` and the
 * copy-overwrite `eslint.ignore.config.json` template Lisa ships to projects.
 *
 * Background: the compiled `defaultIgnores` (src/configs/eslint/base.ts)
 * already excludes `wiki/**`, but the copy-overwrite template that Lisa stamps
 * into every project did NOT. Because a project that supplies its own
 * `eslint.ignore.config.json` REPLACES `defaultIgnores` (see the
 * `ignorePatterns = defaultIgnores` default param in the stack configs), and
 * because the template is copy-overwrite, every Lisa update clobbered any
 * project's hand-added `wiki/**` entry. `eslint .` then linted
 * `wiki/lisa-wiki.config.json` and failed `sonarjs/no-duplicate-string` on the
 * schema-required enum literals — hitting thumbwar-infrastructure, api-creator,
 * qualis-infrastructure, and thumbwar-frontend.
 *
 * These tests keep the template and the compiled default in lock-step so the
 * regression cannot return silently.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { defaultIgnores } from "../../../src/configs/eslint/base.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Read an `eslint.ignore.config.json` template and return its `ignores` array.
 * @param relativePath - Path relative to the Lisa repo root
 * @returns The `ignores` string array from the template
 */
function readIgnores(relativePath: string): readonly string[] {
  const absolute = path.join(REPO_ROOT, relativePath);
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf-8")) as {
    ignores?: readonly string[];
  };
  return parsed.ignores ?? [];
}

describe("wiki/** ESLint ignore", () => {
  it("compiled defaultIgnores excludes wiki/**", () => {
    expect(defaultIgnores).toContain("wiki/**");
  });

  it("the typescript copy-overwrite template excludes wiki/**", () => {
    // This is the file copied into every project; it must carry wiki/** so an
    // update never clobbers a project's wiki exclusion.
    expect(
      readIgnores("typescript/copy-overwrite/eslint.ignore.config.json")
    ).toContain("wiki/**");
  });

  it("Lisa's own root ignore config excludes wiki/**", () => {
    expect(readIgnores("eslint.ignore.config.json")).toContain("wiki/**");
  });
});

/**
 * Same regression class as wiki/**, for `.lisa.config.json`: it is project
 * *config data* (e.g. repeated GitHub label literals like `status:done`), not
 * source, so linting it with code-smell rules such as
 * `sonarjs/no-duplicate-string` is wrong. It must be ignored in lock-step
 * across the compiled default and both shipped templates — mirroring how
 * `audit.ignore.config.json` is already ignored.
 */
describe(".lisa.config.json ESLint ignore", () => {
  const LISA_CONFIG = ".lisa.config.json";

  it("compiled defaultIgnores excludes .lisa.config.json", () => {
    expect(defaultIgnores).toContain(LISA_CONFIG);
  });

  it("the typescript copy-overwrite template excludes .lisa.config.json", () => {
    expect(
      readIgnores("typescript/copy-overwrite/eslint.ignore.config.json")
    ).toContain(LISA_CONFIG);
  });

  it("Lisa's own root ignore config excludes .lisa.config.json", () => {
    expect(readIgnores("eslint.ignore.config.json")).toContain(LISA_CONFIG);
  });
});

/**
 * The managed eslint.config.ts / eslint.slow.config.ts wrappers must (a) retain
 * the factory's ReturnType so `tsc --noEmit` under `declaration: true` does not
 * surface @eslint/core's `RulesConfig` (TS2883), and (b) merge an optional,
 * project-owned eslint.ignore.config.local.json so the copy-overwrite of
 * eslint.ignore.config.json stops wiping host ignore customizations. Neither may
 * import `Linter` from "eslint" directly (knip unlisted-dependency). Kept in
 * lock-step across every stack copy + Lisa's own root.
 */
describe("managed eslint config wrappers", () => {
  const readText = (relativePath: string): string =>
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
  const EXPO_CONFIG = "expo/copy-overwrite/eslint.config.ts";

  const CONFIGS = [
    ["eslint.config.ts", "getTypescriptConfig"],
    ["typescript/copy-overwrite/eslint.config.ts", "getTypescriptConfig"],
    [EXPO_CONFIG, "getExpoConfig"],
    ["nestjs/copy-overwrite/eslint.config.ts", "getNestjsConfig"],
    ["cdk/copy-overwrite/eslint.config.ts", "getCdkConfig"],
    ["harper-fabric/copy-overwrite/eslint.config.ts", "getHarperFabricConfig"],
    ["phaser/copy-overwrite/eslint.config.ts", "getPhaserConfig"],
  ] as const;

  const SLOW_CONFIGS = [
    "eslint.slow.config.ts",
    "typescript/copy-overwrite/eslint.slow.config.ts",
    "expo/copy-overwrite/eslint.slow.config.ts",
    "nestjs/copy-overwrite/eslint.slow.config.ts",
    "cdk/copy-overwrite/eslint.slow.config.ts",
  ] as const;

  it.each(
    CONFIGS.filter(([relPath]) => relPath !== EXPO_CONFIG).map(c => [
      c[0],
      c[1],
    ])
  )(
    "%s annotates the default export with ReturnType<typeof %s> and never imports Linter",
    (relPath, factory) => {
      const src = readText(relPath);
      expect(src).toContain(`ReturnType<typeof ${factory}>`);
      // Only real import statements count — the header comment mentions the
      // `from "eslint"` it forbids, so filter to lines that actually import.
      const importsEslint = src
        .split("\n")
        .filter(line => /^\s*import\b/.test(line))
        .some(line => /from ["']eslint["']/.test(line));
      expect(importsEslint).toBe(false);
    }
  );

  it.each(CONFIGS.map(c => [c[0]]).concat(SLOW_CONFIGS.map(p => [p])))(
    "%s merges the optional project-owned eslint.ignore.config.local.json",
    relPath => {
      const src = readText(relPath);
      expect(src).toContain("eslint.ignore.config.local.json");
      expect(src).toContain("localIgnores");
    }
  );

  it.each(SLOW_CONFIGS.map(p => [p]))(
    "%s annotates the default export with ReturnType<typeof getSlowConfig>",
    relPath => {
      const src = readText(relPath);
      expect(src).toContain("ReturnType<typeof getSlowConfig>");
      // Only real import statements count — the header comment mentions the
      // `from "eslint"` it forbids, so filter to lines that actually import.
      const importsEslint = src
        .split("\n")
        .filter(line => /^\s*import\b/.test(line))
        .some(line => /from ["']eslint["']/.test(line));
      expect(importsEslint).toBe(false);
    }
  );

  it("trusts Expo host config only at the localConfig spread boundary", () => {
    const src = readText(EXPO_CONFIG);

    expect(src).not.toMatch(
      /const\s+config\s*:\s*ReturnType<typeof\s+getExpoConfig>\s*=\s*\[/
    );
    expect(src).toContain(
      "...(localConfig as unknown as ReturnType<typeof getExpoConfig>)"
    );
  });
});
