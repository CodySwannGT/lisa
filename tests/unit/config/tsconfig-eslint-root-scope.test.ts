/**
 * Lisa's own `tsconfig.eslint.json` covers exactly what its two ESLint configs
 * lint (CodySwannGT/lisa#4927).
 *
 * `eslint.config.ts` (fast) and `eslint.slow.config.ts` (slow, type-aware import
 * rules) both point `parserOptions.project` at `tsconfig.eslint.json`. A file
 * either one lints but the program excludes fails with "file was not found in
 * any of the provided project(s)"; a file the program includes but neither
 * lints is a type error nobody asked for. So there is ONE list —
 * `eslint.ignore.config.local.json` — which both configs read and which the
 * program's `exclude` mirrors exactly. These tests fail if any of the three
 * diverge. Each config is assembled from the factory source the way the root
 * file assembles it, and asked with ESLint's own `isPathIgnored`.
 * @module tests/unit/config/tsconfig-eslint-root-scope
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import localConfig from "../../../eslint.config.local.js";
import { defaultThresholds } from "../../../src/configs/eslint/base.js";
import { getSlowConfig } from "../../../src/configs/eslint/slow.js";
import { getTypescriptConfig } from "../../../src/configs/eslint/typescript.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ESLINT_PROGRAM = "tsconfig.eslint.json";

/** A tsconfig, reduced to what this suite reads. */
type Tsconfig = {
  readonly compilerOptions?: {
    readonly allowJs?: boolean;
    readonly checkJs?: boolean;
    readonly types?: readonly string[];
  };
  readonly exclude?: readonly string[];
};

/**
 * Read a JSON file relative to the repository root.
 * @param relative - Path under the repository root.
 * @returns The parsed value.
 */
function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"));
}

describe("Lisa's own tsconfig.eslint.json", () => {
  /** Program exclusions that are not trees of source: install and build output. */
  const BASE_EXCLUDES = ["node_modules", "dist", "build", "worktrees"];

  /**
   * The ignore patterns eslint.config.ts and eslint.slow.config.ts both pass
   * their factory: the copy-overwrite list plus Lisa's own local list.
   * @returns The combined `ignorePatterns`.
   */
  function sharedIgnores(): readonly string[] {
    return [
      ...readJson<{ readonly ignores: readonly string[] }>(
        "eslint.ignore.config.json"
      ).ignores,
      ...readJson<{ readonly ignores: readonly string[] }>(
        "eslint.ignore.config.local.json"
      ).ignores,
    ];
  }

  /**
   * An ESLint instance over one of Lisa's two configs, assembled from the
   * factory SOURCE exactly as the root config files assemble it (the `dist/`
   * those files import is deleted and rebuilt by sibling suites, #1824).
   * @param profile - Which root config to mirror.
   * @returns ESLint, for `isPathIgnored`.
   */
  function eslintFor(profile: "fast" | "slow"): ESLint {
    const ignorePatterns = sharedIgnores();
    const config =
      profile === "fast"
        ? [
            ...getTypescriptConfig({
              ignorePatterns: [...ignorePatterns],
              thresholds: {
                ...defaultThresholds,
                ...readJson<Record<string, number>>("eslint.thresholds.json"),
              },
              tsconfigRootDir: REPO_ROOT,
            }),
            ...localConfig,
          ]
        : getSlowConfig({ ignorePatterns });
    return new ESLint({
      cwd: REPO_ROOT,
      overrideConfig: config,
      overrideConfigFile: true,
    });
  }

  it("both root ESLint configs read the shared local ignore list", () => {
    for (const file of ["eslint.config.ts", "eslint.slow.config.ts"]) {
      expect(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")).toContain(
        'require("./eslint.ignore.config.local.json").ignores'
      );
    }
  });

  it("excludes exactly the trees in the shared ignore list", () => {
    const excluded = (readJson<Tsconfig>(ESLINT_PROGRAM).exclude ?? []).filter(
      tree => !BASE_EXCLUDES.includes(tree)
    );
    const listed = readJson<{ readonly ignores: readonly string[] }>(
      "eslint.ignore.config.local.json"
    ).ignores.map(pattern => pattern.replace(/\/\*\*$/u, ""));

    expect([...excluded].sort((a, b) => a.localeCompare(b))).toEqual(
      [...listed].sort((a, b) => a.localeCompare(b))
    );
  });

  it.each(["fast", "slow"] as const)(
    "the %s ESLint config lints nothing the program excludes",
    async profile => {
      const eslint = eslintFor(profile);
      const excluded = readJson<Tsconfig>(ESLINT_PROGRAM).exclude ?? [];
      const linted: string[] = [];
      for (const tree of excluded) {
        if (!(await eslint.isPathIgnored(`${tree}/probe.ts`)))
          linted.push(tree);
      }

      expect(linted).toEqual([]);
      // Control: an ordinary source file IS linted, so the check above can fail.
      expect(await eslint.isPathIgnored("src/probe.ts")).toBe(false);
    }
  );

  it("matches the test program's globals and JS interop", () => {
    const eslint = readJson<Tsconfig>(ESLINT_PROGRAM).compilerOptions ?? {};
    const tests = readJson<Tsconfig>("tsconfig.tests.json").compilerOptions;

    expect(eslint.types).toEqual(tests?.types);
    expect(eslint.allowJs).toBe(tests?.allowJs);
    expect(eslint.checkJs).toBe(tests?.checkJs);
  });
});
